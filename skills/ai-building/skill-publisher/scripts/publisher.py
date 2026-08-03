#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from lib.adapters import (
    discover_platform,
    load_platform_registry,
    normalize_targets,
    preflight_platform,
    probe_official_sources,
    publish_platform,
    verify_platform,
)
from lib.core import (
    discover_skill_files,
    inspect_repository,
    inspect_skill,
    select_skill,
    utc_now,
    validate_semver,
    validate_skill,
)
from lib.state import (
    append_event,
    atomic_write_text,
    create_run_directory,
    load_run,
    render_report,
    save_run,
    write_receipt,
)

SKILL_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_VERSION = 1
RECORDED_REMOTE_STATUSES = {"submitted", "pending_review", "published", "rejected"}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Plan, publish, resume, and verify Agent Skill releases."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    plan = subparsers.add_parser("plan", help="Create a read-only publication plan.")
    plan.add_argument("source", help="Skill directory, SKILL.md, or repository.")
    plan.add_argument(
        "--skill", help="Select one Skill when a repository contains several."
    )
    plan.add_argument(
        "--version", help="Semantic version. Defaults to Skill metadata or 1.0.0."
    )
    plan.add_argument(
        "--target",
        action="append",
        default=[],
        help="Platform, comma-separated platforms, or profile. Repeatable.",
    )
    plan.add_argument("--clawhub-owner", help="ClawHub owner handle.")
    plan.add_argument(
        "--state-root", type=Path, help="Override the local state directory."
    )
    plan.add_argument(
        "--offline",
        action="store_true",
        help="Skip platform preflight and remote discovery; useful for local review only.",
    )

    source_check = subparsers.add_parser(
        "source-check",
        help="Check official URLs and installed CLI help for a saved run.",
    )
    source_check.add_argument("run_dir", type=Path)
    source_check.add_argument("--platform", action="append", default=[])
    source_check.add_argument(
        "--skip-url-checks",
        action="store_true",
        help="Run CLI probes without requesting official URLs.",
    )

    review = subparsers.add_parser(
        "review-sources",
        help="Record the Agent's semantic review of current official sources.",
    )
    review.add_argument("run_dir", type=Path)
    review.add_argument("--platform", action="append", required=True)
    review.add_argument("--status", choices=("current", "changed"), required=True)
    review.add_argument("--note", required=True)

    publish = subparsers.add_parser(
        "publish",
        help="Execute a confirmed plan and save results after every platform.",
    )
    publish.add_argument("run_dir", type=Path)
    publish.add_argument(
        "--confirm",
        required=True,
        help="Exact run ID shown in the plan. Prevents accidental publication.",
    )
    publish.add_argument("--platform", action="append", default=[])

    record = subparsers.add_parser(
        "record",
        help="Record the result of an assisted platform submission.",
    )
    record.add_argument("run_dir", type=Path)
    record.add_argument("--platform", required=True)
    record.add_argument(
        "--status",
        choices=("submitted", "pending_review", "published", "rejected"),
        required=True,
    )
    record.add_argument("--submission-id")
    record.add_argument("--public-url")
    record.add_argument("--note", required=True)

    verify = subparsers.add_parser(
        "verify",
        help="Read remote platform state without publishing.",
    )
    verify.add_argument("run_dir", type=Path)
    verify.add_argument("--platform", action="append", default=[])

    status = subparsers.add_parser("status", help="Show a saved run.")
    status.add_argument("run_dir", type=Path)

    resume = subparsers.add_parser(
        "resume", help="Alias for status; shows remaining work."
    )
    resume.add_argument("run_dir", type=Path)
    return parser


def command_plan(args: argparse.Namespace) -> int:
    registry = load_platform_registry(SKILL_ROOT)
    targets = normalize_targets(registry, args.target)
    skill_files = discover_skill_files(args.source)
    skill_file = select_skill(skill_files, args.skill)
    skill = inspect_skill(skill_file)
    engine = inspect_skill(SKILL_ROOT / "SKILL.md")
    repository = inspect_repository(skill.root)
    version = validate_semver(args.version or skill.version or "1.0.0")
    checks = validate_skill(skill, repository, target_platforms=targets)

    source = repository.to_dict()
    if repository.root:
        try:
            relative_path = Path(skill.root).relative_to(repository.root).as_posix()
        except ValueError:
            relative_path = "."
    else:
        relative_path = "."
    skill_data = {**skill.to_dict(), "relative_path": relative_path}

    repository_key = (
        f"{repository.github_owner}-{repository.github_repo}"
        if repository.github_owner and repository.github_repo
        else hashlib.sha256(skill.root.encode("utf-8")).hexdigest()[:16]
    )
    run_id, run_dir = create_run_directory(
        skill_name=skill.name or skill_file.parent.name,
        version=version,
        fingerprint=skill.fingerprint,
        repository_key=repository_key,
        root=args.state_root,
    )
    clawhub_owner = args.clawhub_owner or (
        repository.github_owner.lower() if repository.github_owner else None
    )
    owners = {
        "github": repository.github_owner,
        "clawhub": _normalize_clawhub_owner(clawhub_owner),
    }
    plan: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "engine": {
            "name": engine.name,
            "fingerprint": engine.fingerprint,
        },
        "source": source,
        "skill": skill_data,
        "version": version,
        "version_source": (
            "argument"
            if args.version
            else "skill-metadata"
            if skill.version
            else "default"
        ),
        "source_review_ttl_hours": registry.get("source_review_ttl_hours", 6),
        "owners": owners,
        "targets": targets,
        "checks": [check.to_dict() for check in checks],
        "source_reviews": {
            platform: {
                "status": "pending",
                "official_sources": registry["platforms"][platform]["official_sources"],
                "reviewed_at": None,
                "note": None,
            }
            for platform in targets
        },
        "platforms": {},
    }

    blockers = [check for check in checks if check.severity == "blocker"]
    for platform in targets:
        definition = registry["platforms"][platform]
        idempotency_key = _idempotency_key(plan, platform)
        if blockers:
            plan["platforms"][platform] = {
                "status": "blocked",
                "idempotency_key": idempotency_key,
                "next_action": "Resolve the common preflight blockers.",
            }
            continue
        if args.offline:
            plan["platforms"][platform] = {
                "status": "planned",
                "idempotency_key": idempotency_key,
                "planned_action": definition["planned_action"],
                "preflight": {"status": "skipped-offline", "checks": []},
                "remote_before": {"status": "unknown"},
            }
            continue
        preflight = preflight_platform(platform, definition, plan)
        remote = discover_platform(platform, definition, plan)
        current_status = (
            remote["status"]
            if remote["status"] in {"verified", "indexed", "version_conflict"}
            else "planned"
            if preflight["status"] != "blocked"
            else "blocked"
        )
        plan["platforms"][platform] = {
            "status": current_status,
            "idempotency_key": idempotency_key,
            "planned_action": preflight.get("planned_action")
            or definition["planned_action"],
            "preflight": preflight,
            "remote_before": remote,
            "public_url": remote.get("public_url"),
            "next_action": (
                None
                if current_status in {"verified", "indexed"}
                else preflight.get("reason") or remote.get("next_action")
            ),
        }

    save_run(run_dir, plan)
    _write_outputs(run_dir, plan)
    append_event(
        run_dir,
        event="plan-created",
        status="blocked" if blockers else "planned",
        details={"targets": targets, "blocker_count": len(blockers)},
    )
    _print_json(
        {
            "status": "blocked" if blockers else "planned",
            "run_id": run_id,
            "run_dir": str(run_dir),
            "report": str(run_dir / "report.md"),
            "blockers": [check.to_dict() for check in blockers],
            "next_command": (
                f"python3 {Path(__file__).resolve()} source-check {run_dir}"
                if not blockers
                else None
            ),
        }
    )
    return 2 if blockers else 0


def command_source_check(args: argparse.Namespace) -> int:
    run_dir = args.run_dir.expanduser().resolve()
    plan = load_run(run_dir)
    registry = load_platform_registry(SKILL_ROOT)
    platforms = _selected_platforms(plan, args.platform)
    failures = 0
    evidence_by_platform: dict[str, dict[str, Any]] = {}
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=min(4, len(platforms))
    ) as pool:
        futures = {
            platform: pool.submit(
                probe_official_sources,
                platform,
                registry["platforms"][platform],
                check_urls=not args.skip_url_checks,
            )
            for platform in platforms
        }
        for platform in platforms:
            evidence_by_platform[platform] = futures[platform].result()

    for platform in platforms:
        evidence = evidence_by_platform[platform]
        previous = plan["source_reviews"].get(platform, {})
        plan["source_reviews"][platform] = {
            **previous,
            "status": evidence["status"],
            "automatic_status": evidence["automatic_status"],
            "checked_at": evidence["checked_at"],
            "automatic_evidence": evidence,
            "reviewed_at": None,
            "note": None,
        }
        if evidence["automatic_status"] == "fail":
            failures += 1
        append_event(
            run_dir,
            event="official-sources-probed",
            platform=platform,
            status=evidence["automatic_status"],
        )
        save_run(run_dir, plan)
    _write_outputs(run_dir, plan)
    _print_json(
        {
            "status": "needs-review" if failures == 0 else "blocked",
            "run_dir": str(run_dir),
            "platforms": {
                platform: plan["source_reviews"][platform]["automatic_status"]
                for platform in platforms
            },
            "next_action": (
                "Open each official source, compare it with the adapter and CLI evidence, "
                "then record review-sources --status current or changed."
            ),
        }
    )
    return 1 if failures else 0


def command_review_sources(args: argparse.Namespace) -> int:
    run_dir = args.run_dir.expanduser().resolve()
    plan = load_run(run_dir)
    selected = _selected_platforms(plan, args.platform)
    for platform in selected:
        review = plan["source_reviews"].get(platform)
        if not review or "automatic_evidence" not in review:
            raise ValueError(f"Run source-check before reviewing {platform}")
        if args.status == "current" and review.get("automatic_status") not in {
            "pass",
            "partial",
        }:
            raise ValueError(
                f"Automatic source checks failed for {platform}; record changed or fix access"
            )
        review.update(
            {
                "status": args.status,
                "reviewed_at": utc_now(),
                "note": args.note,
            }
        )
        append_event(
            run_dir,
            event="official-sources-reviewed",
            platform=platform,
            status=args.status,
            details={"note": args.note},
        )
    save_run(run_dir, plan)
    _write_outputs(run_dir, plan)
    _print_json(
        {
            "status": "recorded",
            "run_dir": str(run_dir),
            "platforms": selected,
            "review_status": args.status,
        }
    )
    return 0


def command_publish(args: argparse.Namespace) -> int:
    run_dir = args.run_dir.expanduser().resolve()
    plan = load_run(run_dir)
    if args.confirm != plan["run_id"]:
        raise ValueError("--confirm must exactly match the saved run_id")
    blockers = [
        check for check in plan.get("checks", []) if check["severity"] == "blocker"
    ]
    if blockers:
        raise ValueError("The saved plan has unresolved common blockers")

    _assert_engine_unchanged(plan)
    _assert_source_unchanged(plan)
    registry = load_platform_registry(SKILL_ROOT)
    platforms = _selected_platforms(plan, args.platform)
    ttl_hours = float(
        registry.get(
            "source_review_ttl_hours",
            plan.get("source_review_ttl_hours", 6),
        )
    )
    for platform in platforms:
        review = plan["source_reviews"].get(platform, {})
        if review.get("status") != "current":
            raise ValueError(
                f"Official source review for {platform} is {review.get('status', 'missing')}; "
                "publishing is blocked"
            )
        if not _review_is_fresh(review, ttl_hours=ttl_hours):
            raise ValueError(
                f"Official source review for {platform} is older than {ttl_hours:g} hours; "
                "run source-check and review-sources again"
            )

    failed = 0
    for platform in platforms:
        current = plan["platforms"].get(platform, {})
        if current.get("status") in {
            "verified",
            "indexed",
            *RECORDED_REMOTE_STATUSES,
        }:
            append_event(
                run_dir,
                event="publish-skipped",
                platform=platform,
                status=current["status"],
                details={
                    "reason": (
                        "Remote state already matches."
                        if current["status"] in {"verified", "indexed"}
                        else "The assisted platform already has a recorded outcome."
                    )
                },
            )
            continue
        if current.get("preflight", {}).get("status") == "blocked":
            failed += 1
            continue
        append_event(
            run_dir, event="publish-started", platform=platform, status="running"
        )
        result = publish_platform(
            platform,
            registry["platforms"][platform],
            plan,
        )
        plan["platforms"][platform] = {
            **current,
            **result,
            "published_at": utc_now(),
        }
        if result["status"] in {"blocked", "version_conflict"}:
            failed += 1
        append_event(
            run_dir,
            event="publish-finished",
            platform=platform,
            status=result["status"],
        )
        save_run(run_dir, plan)
        _write_outputs(run_dir, plan)

    _print_json(_status_payload(run_dir, plan))
    return 1 if failed else 0


def command_record(args: argparse.Namespace) -> int:
    run_dir = args.run_dir.expanduser().resolve()
    plan = load_run(run_dir)
    registry = load_platform_registry(SKILL_ROOT)
    platform = args.platform.strip()
    if platform not in plan["targets"]:
        raise ValueError(f"Platform is not in the saved plan: {platform}")
    definition = registry["platforms"][platform]
    if definition.get("automation") != "assisted":
        raise ValueError(
            f"{platform} is fully automated; use publish and verify instead of record"
        )
    if args.public_url:
        _validate_public_url(args.public_url)

    next_actions = {
        "submitted": "Wait for the platform response, then record its new status.",
        "pending_review": "Wait for review, then record the decision and verify any public page.",
        "published": "Run verify to confirm the public listing.",
        "rejected": "Read the platform feedback before preparing a new submission.",
    }
    result: dict[str, Any] = {
        "status": args.status,
        "note": args.note,
        "recorded_at": utc_now(),
        "next_action": next_actions[args.status],
    }
    if args.submission_id:
        result["submission_id"] = args.submission_id
    if args.public_url:
        result["public_url"] = args.public_url

    previous = plan["platforms"].get(platform, {})
    plan["platforms"][platform] = {**previous, **result}
    append_event(
        run_dir,
        event="assisted-status-recorded",
        platform=platform,
        status=args.status,
        details={
            "note": args.note,
            "has_submission_id": bool(args.submission_id),
            "has_public_url": bool(args.public_url),
        },
    )
    save_run(run_dir, plan)
    _write_outputs(run_dir, plan)
    _print_json(_status_payload(run_dir, plan))
    return 0


def command_verify(args: argparse.Namespace) -> int:
    run_dir = args.run_dir.expanduser().resolve()
    plan = load_run(run_dir)
    registry = load_platform_registry(SKILL_ROOT)
    platforms = _selected_platforms(plan, args.platform)
    unverified = 0
    for platform in platforms:
        result = verify_platform(platform, registry["platforms"][platform], plan)
        previous = plan["platforms"].get(platform, {})
        if (
            result["status"] == "unknown"
            and previous.get("status") in RECORDED_REMOTE_STATUSES
        ):
            result = {
                **result,
                "status": previous["status"],
                "next_action": previous.get("next_action") or result.get("next_action"),
            }
        plan["platforms"][platform] = {
            **previous,
            **result,
            "verified_at": utc_now(),
        }
        if result["status"] not in {
            "verified",
            "indexed",
            "pending_review",
            "submitted",
        }:
            unverified += 1
        append_event(
            run_dir,
            event="remote-verified",
            platform=platform,
            status=result["status"],
        )
        save_run(run_dir, plan)
    _write_outputs(run_dir, plan)
    _print_json(_status_payload(run_dir, plan))
    return 1 if unverified else 0


def command_status(args: argparse.Namespace) -> int:
    run_dir = args.run_dir.expanduser().resolve()
    plan = load_run(run_dir)
    _write_outputs(run_dir, plan)
    _print_json(_status_payload(run_dir, plan))
    return 0


def _assert_source_unchanged(plan: dict[str, Any]) -> None:
    planned_skill = plan["skill"]
    planned_source = plan["source"]
    current_skill = inspect_skill(planned_skill["skill_file"])
    current_source = inspect_repository(current_skill.root)
    changes: list[str] = []
    if current_skill.fingerprint != planned_skill.get("fingerprint"):
        changes.append("the Skill bundle fingerprint changed")
    if current_source.commit != planned_source.get("commit"):
        changes.append("the Git commit changed")
    if current_source.remote_url != planned_source.get("remote_url"):
        changes.append("the Git origin changed")
    if current_source.dirty:
        changes.append("the Git worktree has uncommitted changes")
    if changes:
        raise ValueError(
            "Source changed after this plan was created: "
            + "; ".join(changes)
            + ". Create a new publication plan."
        )


def _assert_engine_unchanged(plan: dict[str, Any]) -> None:
    planned_fingerprint = plan.get("engine", {}).get("fingerprint")
    current_fingerprint = inspect_skill(SKILL_ROOT / "SKILL.md").fingerprint
    if not planned_fingerprint or current_fingerprint != planned_fingerprint:
        raise ValueError(
            "The publisher changed after this plan was created. "
            "Create a new publication plan."
        )


def _review_is_fresh(
    review: dict[str, Any],
    *,
    ttl_hours: float,
    now: datetime | None = None,
) -> bool:
    if ttl_hours <= 0 or review.get("automatic_status") not in {"pass", "partial"}:
        return False
    reviewed_at = _parse_timestamp(review.get("reviewed_at"))
    checked_at = _parse_timestamp(review.get("checked_at"))
    if reviewed_at is None or checked_at is None or reviewed_at < checked_at:
        return False
    current_time = now or datetime.now(timezone.utc)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)
    age_seconds = (current_time - reviewed_at).total_seconds()
    return 0 <= age_seconds <= ttl_hours * 3600


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _validate_public_url(value: str) -> None:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("--public-url must be an absolute http(s) URL")
    if parsed.username or parsed.password:
        raise ValueError("--public-url must not contain credentials")


def _normalize_clawhub_owner(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().removeprefix("@").lower()
    if (
        not normalized
        or normalized.startswith("-")
        or normalized.endswith("-")
        or not all(
            character in "abcdefghijklmnopqrstuvwxyz0123456789-"
            for character in normalized
        )
    ):
        raise ValueError("--clawhub-owner must be a handle such as ezra-y")
    return normalized


def _write_outputs(run_dir: Path, plan: dict[str, Any]) -> None:
    atomic_write_text(run_dir / "report.md", render_report(plan))
    write_receipt(run_dir, plan)


def _selected_platforms(plan: dict[str, Any], requested: list[str]) -> list[str]:
    if not requested:
        return list(plan["targets"])
    selected = []
    for value in requested:
        selected.extend(part.strip() for part in value.split(",") if part.strip())
    unknown = sorted(set(selected) - set(plan["targets"]))
    if unknown:
        raise ValueError(f"Platforms are not in the saved plan: {', '.join(unknown)}")
    return list(dict.fromkeys(selected))


def _idempotency_key(plan: dict[str, Any], platform: str) -> str:
    source = plan["source"]
    material = "|".join(
        [
            platform,
            source.get("remote_url") or source.get("root") or "",
            plan["skill"]["name"],
            plan["version"],
            source.get("commit") or "",
        ]
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _status_payload(run_dir: Path, plan: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": plan["run_id"],
        "run_dir": str(run_dir),
        "report": str(run_dir / "report.md"),
        "receipt": str(run_dir / "receipt.json"),
        "platforms": {
            platform: {
                "status": plan["platforms"].get(platform, {}).get("status", "planned"),
                "public_url": plan["platforms"].get(platform, {}).get("public_url"),
                "next_action": (
                    plan["platforms"].get(platform, {}).get("next_action")
                    or plan["platforms"].get(platform, {}).get("planned_action")
                ),
            }
            for platform in plan["targets"]
        },
    }


def _print_json(value: dict[str, Any]) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command == "plan":
            return command_plan(args)
        if args.command == "source-check":
            return command_source_check(args)
        if args.command == "review-sources":
            return command_review_sources(args)
        if args.command == "publish":
            return command_publish(args)
        if args.command == "record":
            return command_record(args)
        if args.command == "verify":
            return command_verify(args)
        if args.command in {"status", "resume"}:
            return command_status(args)
        parser.error(f"Unknown command: {args.command}")
    except (
        FileNotFoundError,
        TypeError,
        ValueError,
        OSError,
        json.JSONDecodeError,
    ) as error:
        print(
            json.dumps(
                {"status": "error", "error": str(error)},
                ensure_ascii=False,
                indent=2,
            ),
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
