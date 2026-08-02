import io
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from scripts.agents_kit.models import (
    ContentMode,
    SourceSpec,
    parse_skill_frontmatter,
)
from scripts.agents_kit.skills import build_source_record
from scripts.agents_kit.sources import (
    GitProvider,
    HttpProvider,
    SourceError,
    SourceSession,
    _common_source_parent,
    _safe_changed_line_limit,
)

SKILL = "---\nname: {name}\ndescription: {name} description\n---\n"


class FakeResponse:
    def __init__(self, content):
        self.content = content
        self.headers = {"ETag": '"abc"'}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def read(self, limit):
        return self.content


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def make_skill(self, parent, name):
        path = parent / name
        path.mkdir(parents=True)
        (path / "SKILL.md").write_text(SKILL.format(name=name), encoding="utf-8")
        return path

    def test_local_provider_returns_snapshot(self):
        skill = self.make_skill(self.root, "alpha")

        with SourceSession(timeout=5) as session:
            spec = session.spec(str(skill))
            snapshot = session.snapshot(spec)

            self.assertEqual(spec.provider, "local")
            self.assertEqual(snapshot.declared_name, "alpha")
            self.assertEqual(len(snapshot.content_sha256), 64)

    def test_multiple_candidates_require_selection(self):
        parent = self.root / "collection"
        self.make_skill(parent, "alpha")
        self.make_skill(parent, "beta")

        with SourceSession(timeout=5) as session:
            spec = session.spec(str(parent))
            candidates = session.candidates(spec)
            self.assertEqual(
                [candidate.declared_name for candidate in candidates],
                ["alpha", "beta"],
            )
            with self.assertRaises(SourceError):
                session.snapshot(spec)
            snapshot = session.snapshot(spec, candidate_path="alpha")
            self.assertEqual(snapshot.declared_name, "alpha")
            self.assertEqual(snapshot.spec.locator["path"], "alpha")
            record = build_source_record(snapshot, policy="review")
            self.assertEqual(
                session.snapshot_from_record(record).declared_name, "alpha"
            )

    def test_skill_symlink_cannot_escape(self):
        skill = self.make_skill(self.root, "alpha")
        (skill / "outside").symlink_to(self.root / "other")

        with SourceSession(timeout=5) as session:
            spec = session.spec(str(skill))
            with self.assertRaises(SourceError):
                session.snapshot(spec)

    def test_git_provider_reuses_checkout_for_different_paths(self):
        repo = self.root / "repo"
        self.make_skill(repo / "skills", "alpha")
        self.make_skill(repo / "skills", "beta")
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(repo),
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-qm",
                "fixture",
            ],
            check=True,
        )

        with SourceSession(timeout=10) as session:
            alpha = session.spec(
                repo.as_uri(),
                provider_id="git",
                options={"path": "skills/alpha"},
            )
            beta = session.spec(
                repo.as_uri(),
                provider_id="git",
                options={"path": "skills/beta"},
            )
            self.assertEqual(session.snapshot(alpha).declared_name, "alpha")
            self.assertEqual(session.snapshot(beta).declared_name, "beta")

    def test_github_clone_tries_ssh_before_https(self):
        attempts = GitProvider()._clone_urls(
            "https://github.com/example/repository.git"
        )

        self.assertEqual([label for label, _, _ in attempts], ["SSH", "HTTPS"])

    def test_sparse_paths_collapse_to_common_parent(self):
        self.assertEqual(
            _common_source_parent(["skills/alpha", "skills/beta"]),
            "skills",
        )
        self.assertEqual(
            _common_source_parent(["skills/alpha", "packages/beta"]),
            "",
        )

    def test_high_similarity_allows_larger_line_change(self):
        self.assertEqual(_safe_changed_line_limit(0.9799), 500)
        self.assertEqual(_safe_changed_line_limit(0.98), 1000)

    def test_git_failure_is_cached_for_same_repository(self):
        provider = GitProvider()
        spec = SourceSpec(
            provider="git",
            locator={
                "url": "https://github.com/example/repository.git",
                "ref": "main",
                "path": "skills/alpha",
            },
        )
        with patch.object(
            provider, "_clone", side_effect=SourceError("network down")
        ) as clone:
            with self.assertRaises(SourceError):
                provider.resolve(spec, self.root, timeout=1)
            with self.assertRaisesRegex(SourceError, "前次获取失败"):
                provider.resolve(spec, self.root, timeout=1)

        self.assertEqual(clone.call_count, 1)

    @patch("urllib.request.urlopen")
    def test_http_provider_supports_direct_skill(self, urlopen):
        urlopen.return_value = FakeResponse(SKILL.format(name="alpha").encode())

        with SourceSession(timeout=5) as session:
            spec = session.spec("https://example.com/alpha/SKILL.md")
            snapshot = session.snapshot(spec)

            self.assertEqual(snapshot.declared_name, "alpha")
            self.assertEqual(snapshot.revision, '"abc"')
            self.assertEqual(snapshot.content_mode, ContentMode.SKILL_FILE)

    def test_invalid_frontmatter_yaml_is_reported_as_value_error(self):
        with self.assertRaises(ValueError):
            parse_skill_frontmatter("---\nname: [\n---\n")

    def test_zip_path_traversal_is_rejected(self):
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w") as archive:
            archive.writestr("../outside", "bad")

        with self.assertRaises(SourceError):
            HttpProvider._extract_zip(content.getvalue(), self.root / "extract")


if __name__ == "__main__":
    unittest.main()
