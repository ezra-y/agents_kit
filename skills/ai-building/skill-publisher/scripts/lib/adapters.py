from __future__ import annotations

import concurrent.futures
import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .core import check_url, load_json, run_command, utc_now

Runner = Callable[..., dict[str, Any]]
UrlChecker = Callable[..., dict[str, Any]]


def load_platform_registry(skill_root: Path | str) -> dict[str, Any]:
    path = Path(skill_root).resolve() / "assets" / "platforms.json"
    registry = load_json(path)
    if registry.get("schema_version") != 1:
        raise ValueError(f"Unsupported platform registry schema: {path}")
    platforms = registry.get("platforms")
    if not isinstance(platforms, dict):
        raise TypeError(f"Missing platforms mapping: {path}")
    return registry


def normalize_targets(registry: dict[str, Any], values: list[str]) -> list[str]:
    platforms = registry["platforms"]
    expanded: list[str] = []
    for value in values:
        if value in registry.get("profiles", {}):
            expanded.extend(registry["profiles"][value])
        else:
            expanded.extend(part.strip() for part in value.split(",") if part.strip())
    if not expanded:
        expanded = list(registry["profiles"]["core"])
    unknown = sorted(set(expanded) - set(platforms))
    if unknown:
        raise ValueError(f"Unknown platforms: {', '.join(unknown)}")
    return list(dict.fromkeys(expanded))


def probe_official_sources(
    platform_id: str,
    definition: dict[str, Any],
    *,
    runner: Runner = run_command,
    url_checker: UrlChecker = check_url,
    check_urls: bool = True,
) -> dict[str, Any]:
    source_urls = definition.get("official_sources", [])
    if check_urls and source_urls:
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=min(4, len(source_urls))
        ) as pool:
            futures = {url: pool.submit(url_checker, url) for url in source_urls}
            urls = [futures[url].result() for url in source_urls]
    else:
        urls = [
            {"url": url, "reachable": None, "status": None, "skipped": True}
            for url in source_urls
        ]

    probes = []
    for argv in definition.get("cli_probes", []):
        probes.append(_compact_command_result(runner(list(argv), timeout=60)))

    checked_urls = [item for item in urls if not item.get("skipped")]
    all_urls_ok = all(item.get("reachable") is not False for item in checked_urls)
    any_url_ok = any(item.get("reachable") is True for item in checked_urls)
    all_probes_ok = all(item.get("returncode") == 0 for item in probes)
    has_evidence = bool(checked_urls or probes)
    enough_evidence = all_probes_ok and (any_url_ok or bool(probes))
    if not has_evidence:
        automatic_status = "fail"
    elif all_urls_ok and all_probes_ok:
        automatic_status = "pass"
    elif enough_evidence:
        automatic_status = "partial"
    else:
        automatic_status = "fail"
    return {
        "platform": platform_id,
        "checked_at": utc_now(),
        "automatic_status": automatic_status,
        "official_sources": urls,
        "cli_probes": probes,
        "semantic_review_required": True,
        "status": "pending_semantic_review",
    }


def preflight_platform(
    platform_id: str,
    definition: dict[str, Any],
    plan: dict[str, Any],
    *,
    runner: Runner = run_command,
) -> dict[str, Any]:
    adapter = definition["adapter"]
    if adapter == "github":
        return _preflight_github(plan, runner)
    if adapter == "clawhub":
        return _preflight_clawhub(plan, runner)
    if adapter == "reviewed_form" and platform_id == "claude":
        return _preflight_claude(plan, runner)
    return {
        "status": "assisted" if definition["automation"] == "assisted" else "ready",
        "checks": [],
        "planned_action": definition["planned_action"],
    }


def _preflight_github(plan: dict[str, Any], runner: Runner) -> dict[str, Any]:
    source = plan["source"]
    auth_check = _compact_command_result(runner(["gh", "auth", "status"], timeout=30))
    if auth_check["returncode"] == 0:
        auth_check["stdout"] = ""
        auth_check["stderr"] = ""
    checks = [auth_check]
    checks.append(
        _compact_command_result(
            runner(
                ["gh", "skill", "publish", source["root"], "--dry-run"],
                cwd=source["root"],
                timeout=180,
            )
        )
    )
    ready = all(result["returncode"] == 0 for result in checks)
    return {
        "status": "ready" if ready else "blocked",
        "checks": checks,
        "planned_action": (
            f"Create GitHub release v{plan['version']} for "
            f"{source.get('github_owner')}/{source.get('github_repo')}."
        ),
    }


def _preflight_clawhub(plan: dict[str, Any], runner: Runner) -> dict[str, Any]:
    skill = plan["skill"]
    command = [
        "npx",
        "-y",
        "clawhub",
        "skill",
        "publish",
        skill["root"],
        "--slug",
        skill["name"],
        "--version",
        plan["version"],
        "--dry-run",
        "--json",
    ]
    owner = plan.get("owners", {}).get("clawhub")
    if owner:
        command.extend(["--owner", owner])
    result = _compact_command_result(runner(command, timeout=240))
    return {
        "status": "ready" if result["returncode"] == 0 else "blocked",
        "checks": [result],
        "planned_action": (
            f"Publish {skill['name']} {plan['version']} to ClawHub"
            + (f" as @{owner}." if owner else ".")
        ),
    }


def _preflight_claude(plan: dict[str, Any], runner: Runner) -> dict[str, Any]:
    skill_root = Path(plan["skill"]["root"])
    plugin_manifest = skill_root / ".claude-plugin" / "plugin.json"
    marketplace_manifest = skill_root / ".claude-plugin" / "marketplace.json"
    if not plugin_manifest.is_file() and not marketplace_manifest.is_file():
        return {
            "status": "blocked",
            "checks": [],
            "planned_action": "Prepare a Claude community directory submission.",
            "reason": "No .claude-plugin/plugin.json or marketplace.json was found.",
        }
    result = _compact_command_result(
        runner(["claude", "plugin", "validate", str(skill_root)], timeout=120)
    )
    return {
        "status": "assisted" if result["returncode"] == 0 else "blocked",
        "checks": [result],
        "planned_action": "Open Anthropic's official submission form after validation.",
    }


def discover_platform(
    platform_id: str,
    definition: dict[str, Any],
    plan: dict[str, Any],
    *,
    runner: Runner = run_command,
) -> dict[str, Any]:
    adapter = definition["adapter"]
    if adapter == "github":
        return _verify_github(plan, runner)
    if adapter == "clawhub":
        return _verify_clawhub(plan, runner)
    if adapter == "github_import":
        return _verify_agentskill(plan)
    if adapter == "auto_index":
        return _verify_skills_sh(plan)
    if adapter == "reviewed_form":
        platform_state = plan.get("platforms", {}).get(platform_id, {})
        public_url = platform_state.get("public_url")
        if public_url:
            if not _is_allowed_public_url(public_url, definition):
                return {
                    "status": "unknown",
                    "public_url": public_url,
                    "next_action": (
                        "The recorded page is outside the platform's reviewed official hosts."
                    ),
                }
            return _verify_public_page(
                public_url,
                plan["skill"]["name"],
                success_status="verified",
            )
    return {
        "status": "unknown",
        "next_action": "Check the signed-in official platform for a submission or public listing.",
    }


def publish_platform(
    platform_id: str,
    definition: dict[str, Any],
    plan: dict[str, Any],
    *,
    runner: Runner = run_command,
) -> dict[str, Any]:
    existing = discover_platform(platform_id, definition, plan, runner=runner)
    if existing["status"] in {"verified", "indexed", "published"}:
        return {
            **existing,
            "skipped": True,
            "reason": "The remote version already exists; continue verification.",
        }
    if existing["status"] == "version_conflict":
        return existing

    adapter = definition["adapter"]
    if adapter == "github":
        return _publish_github(plan, runner)
    if adapter == "clawhub":
        return _publish_clawhub(plan, runner)
    if adapter == "github_import":
        return {
            "status": "manual_handoff",
            "official_url": definition["publish_url"],
            "next_action": (
                "Open the official import page and submit "
                f"{plan['source']['remote_url']}; then rerun verify."
            ),
        }
    if adapter == "auto_index":
        return {
            "status": "manual_handoff",
            "official_url": definition["official_sources"][0],
            "next_action": (
                "Install the public GitHub Skill with the official skills CLI if it is not "
                "indexed yet, then rerun verify."
            ),
        }
    if adapter == "reviewed_form":
        return {
            "status": "manual_handoff",
            "official_url": definition["publish_url"],
            "next_action": definition["handoff"],
        }
    return {
        "status": "blocked",
        "next_action": f"No supported adapter for {platform_id}.",
    }


def verify_platform(
    platform_id: str,
    definition: dict[str, Any],
    plan: dict[str, Any],
    *,
    runner: Runner = run_command,
) -> dict[str, Any]:
    return discover_platform(platform_id, definition, plan, runner=runner)


def _publish_github(plan: dict[str, Any], runner: Runner) -> dict[str, Any]:
    source = plan["source"]
    command = [
        "gh",
        "skill",
        "publish",
        source["root"],
        "--tag",
        f"v{plan['version']}",
    ]
    result = _compact_command_result(runner(command, cwd=source["root"], timeout=300))
    if result["returncode"] != 0:
        return {
            "status": "blocked",
            "command_result": result,
            "next_action": "Resolve the GitHub CLI error and create a new plan.",
        }
    verified = _verify_github(plan, runner)
    if verified["status"] == "unknown":
        verified = {
            **verified,
            "status": "published",
            "next_action": "The release command succeeded; rerun verify after propagation.",
        }
    return {**verified, "command_result": result}


def _publish_clawhub(plan: dict[str, Any], runner: Runner) -> dict[str, Any]:
    skill = plan["skill"]
    source = plan["source"]
    command = [
        "npx",
        "-y",
        "clawhub",
        "skill",
        "publish",
        skill["root"],
        "--slug",
        skill["name"],
        "--name",
        skill["name"],
        "--version",
        plan["version"],
        "--json",
    ]
    owner = plan.get("owners", {}).get("clawhub")
    if owner:
        command.extend(["--owner", owner])
    if source.get("github_owner") and source.get("github_repo"):
        command.extend(
            [
                "--source-repo",
                f"{source['github_owner']}/{source['github_repo']}",
                "--source-commit",
                source["commit"],
                "--source-path",
                skill["relative_path"],
            ]
        )
    result = _compact_command_result(runner(command, timeout=300))
    if result["returncode"] != 0:
        return {
            "status": "blocked",
            "command_result": result,
            "next_action": "Resolve the ClawHub CLI error and create a new plan.",
        }
    verified = _verify_clawhub(plan, runner)
    if verified["status"] == "unknown":
        verified = {
            **verified,
            "status": "published",
            "next_action": "The publish command succeeded; rerun verify after propagation.",
        }
    return {**verified, "command_result": result}


def _verify_github(plan: dict[str, Any], runner: Runner) -> dict[str, Any]:
    source = plan["source"]
    owner = source.get("github_owner")
    repo = source.get("github_repo")
    if not owner or not repo:
        return {"status": "blocked", "next_action": "Add a recognized GitHub origin."}
    tag = f"v{plan['version']}"
    raw_release_result = runner(
        ["gh", "api", f"repos/{owner}/{repo}/releases/tags/{tag}"],
        timeout=60,
    )
    release_result = _compact_command_result(raw_release_result)
    if raw_release_result["returncode"] != 0:
        return {
            "status": "unknown",
            "next_action": f"No verified GitHub release was found for {tag}.",
            "evidence": [release_result],
        }
    release = _parse_json_output(raw_release_result["stdout"])
    tag_commit, tag_evidence = _github_tag_commit(owner, repo, tag, runner)
    expected_commit = source.get("commit")
    if expected_commit and not tag_commit:
        return {
            "status": "published",
            "public_url": release.get("html_url"),
            "remote_version": plan["version"],
            "remote_commit": None,
            "next_action": "The release exists, but its tag commit is not yet verifiable.",
            "evidence": [release_result, *tag_evidence],
        }
    if tag_commit and expected_commit and tag_commit != expected_commit:
        return {
            "status": "version_conflict",
            "public_url": release.get("html_url"),
            "remote_commit": tag_commit,
            "expected_commit": expected_commit,
            "next_action": "The release tag points to different content; choose a new version.",
            "evidence": [release_result, *tag_evidence],
        }
    return {
        "status": "verified",
        "public_url": release.get("html_url"),
        "remote_version": plan["version"],
        "remote_commit": tag_commit,
        "evidence": [release_result, *tag_evidence],
    }


def _github_tag_commit(
    owner: str,
    repo: str,
    tag: str,
    runner: Runner,
) -> tuple[str | None, list[dict[str, Any]]]:
    evidence: list[dict[str, Any]] = []
    raw_ref_result = runner(
        ["gh", "api", f"repos/{owner}/{repo}/git/ref/tags/{tag}"],
        timeout=60,
    )
    ref_result = _compact_command_result(raw_ref_result)
    evidence.append(ref_result)
    if raw_ref_result["returncode"] != 0:
        return None, evidence
    ref = _parse_json_output(raw_ref_result["stdout"])
    obj = ref.get("object", {})
    for _ in range(4):
        if obj.get("type") == "commit":
            return obj.get("sha"), evidence
        if obj.get("type") != "tag" or not obj.get("sha"):
            return None, evidence
        raw_tag_result = runner(
            ["gh", "api", f"repos/{owner}/{repo}/git/tags/{obj['sha']}"],
            timeout=60,
        )
        tag_result = _compact_command_result(raw_tag_result)
        evidence.append(tag_result)
        if raw_tag_result["returncode"] != 0:
            return None, evidence
        tag_data = _parse_json_output(raw_tag_result["stdout"])
        obj = tag_data.get("object", {})
    return None, evidence


def _verify_clawhub(plan: dict[str, Any], runner: Runner) -> dict[str, Any]:
    skill = plan["skill"]
    owner = plan.get("owners", {}).get("clawhub")
    if not owner:
        return {
            "status": "unknown",
            "next_action": "Set the ClawHub owner handle before verification.",
        }
    identifier = f"@{owner}/{skill['name']}"
    raw_result = runner(
        [
            "npx",
            "-y",
            "clawhub",
            "inspect",
            identifier,
            "--version",
            plan["version"],
            "--json",
        ],
        timeout=180,
    )
    if raw_result["returncode"] != 0:
        return {
            "status": "unknown",
            "next_action": (
                f"No verified ClawHub version {plan['version']} was found for {identifier}."
            ),
            "evidence": [_compact_command_result(raw_result)],
        }
    data = _parse_json_output(raw_result["stdout"])
    result = _compact_command_result(raw_result)
    version = data.get("version") or data.get("latestVersion") or {}
    remote_version = version.get("version")
    if remote_version != plan["version"]:
        return {
            "status": "unknown",
            "remote_version": remote_version,
            "next_action": "The requested ClawHub version is not visible yet.",
            "evidence": [result],
        }
    moderation = data.get("moderation") or {}
    security = version.get("security") or {}
    moderation_verdict = str(moderation.get("verdict") or "").lower()
    security_status = str(security.get("status") or "").lower()
    scan_signals = [
        signal for signal in (moderation_verdict, security_status) if signal
    ]
    blocked_values = {"malware", "blocked", "malware_blocked"}
    if moderation.get("isMalwareBlocked") is True or any(
        signal in blocked_values for signal in scan_signals
    ):
        return {
            "status": "blocked",
            "remote_version": remote_version,
            "scan_status": "/".join(scan_signals) or "blocked",
            "next_action": "Inspect the official ClawHub scan report.",
            "evidence": [result],
        }
    clean_values = {"approved", "clean", "passed", "safe"}
    status = (
        "verified"
        if scan_signals
        and all(signal in clean_values for signal in scan_signals)
        and moderation.get("isSuspicious") is not True
        else "published"
    )
    return {
        "status": status,
        "public_url": f"https://clawhub.ai/{owner}/skills/{skill['name']}",
        "remote_version": remote_version,
        "scan_status": "/".join(scan_signals) or "missing",
        "next_action": (
            None if status == "verified" else "Wait for a clean terminal scan result."
        ),
        "evidence": [result],
    }


def _verify_agentskill(plan: dict[str, Any]) -> dict[str, Any]:
    source = plan["source"]
    owner = source.get("github_owner")
    if not owner:
        return {"status": "unknown", "next_action": "A GitHub owner is required."}
    url = f"https://agentskill.sh/@{owner.lower()}/{plan['skill']['name']}"
    return _verify_public_page(url, plan["skill"]["name"], success_status="verified")


def _verify_skills_sh(plan: dict[str, Any]) -> dict[str, Any]:
    source = plan["source"]
    owner = source.get("github_owner")
    repo = source.get("github_repo")
    if not owner or not repo:
        return {"status": "unknown", "next_action": "A GitHub repository is required."}
    url = f"https://skills.sh/{owner.lower()}/{repo.lower()}/{plan['skill']['name']}"
    return _verify_public_page(url, plan["skill"]["name"], success_status="indexed")


def _verify_public_page(
    url: str, marker: str, *, success_status: str
) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "skill-publisher-verifier/0.1"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            content = response.read(512 * 1024).decode("utf-8", errors="replace")
            marker_found = marker.lower() in content.lower()
            if 200 <= response.status < 300 and marker_found:
                return {
                    "status": success_status,
                    "public_url": response.geturl(),
                    "http_status": response.status,
                }
            return {
                "status": "unknown",
                "public_url": response.geturl(),
                "http_status": response.status,
                "next_action": "The page responded, but the Skill identity was not confirmed.",
            }
    except urllib.error.HTTPError as error:
        return {
            "status": "unknown",
            "public_url": url,
            "http_status": error.code,
            "next_action": "No public listing was found.",
        }
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return {
            "status": "unknown",
            "public_url": url,
            "http_status": None,
            "next_action": f"Public-page verification failed: {error}",
        }


def _is_allowed_public_url(url: str, definition: dict[str, Any]) -> bool:
    candidate_host = (urllib.parse.urlsplit(url).hostname or "").lower()
    source_urls = [
        definition.get("publish_url"),
        *definition.get("official_sources", []),
    ]
    allowed_hosts = {
        (urllib.parse.urlsplit(source).hostname or "").lower()
        for source in source_urls
        if source
    }
    allowed_hosts.update(
        host.lower() for host in definition.get("verification_hosts", [])
    )
    return bool(candidate_host) and candidate_host in allowed_hosts


def _parse_json_output(text: str) -> dict[str, Any]:
    stripped = text.strip()
    decoder = json.JSONDecoder()
    for index, character in enumerate(stripped):
        if character != "{":
            continue
        try:
            value, _ = decoder.raw_decode(stripped[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise ValueError("Command did not return a JSON object")


def _compact_command_result(
    result: dict[str, Any],
    *,
    limit: int = 6000,
) -> dict[str, Any]:
    compact = dict(result)
    truncated_fields = []
    for field in ("stdout", "stderr"):
        value = compact.get(field)
        if not isinstance(value, str) or len(value) <= limit:
            continue
        compact[f"{field}_sha256"] = hashlib.sha256(value.encode("utf-8")).hexdigest()
        compact[field] = value[:limit] + "\n...[truncated by skill-publisher]..."
        truncated_fields.append(field)
    if truncated_fields:
        compact["truncated_fields"] = truncated_fields
    return compact
