from __future__ import annotations

import json
import mimetypes
import subprocess
import sys
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from . import automation, runtime
from .repository import Repository


class UiError(RuntimeError):
    pass


def open_skill(
    repo: Repository, name: str, *, dry_run: bool = False
) -> dict[str, object]:
    entry = repo.require_skill(name)
    command = ["/usr/bin/open", str(entry.path)]
    if not dry_run:
        if sys.platform != "darwin":
            raise UiError("Finder 打开功能只支持 macOS")
        try:
            subprocess.run(command, check=True)
        except (OSError, subprocess.CalledProcessError) as exc:
            raise UiError(f"Finder 无法打开技能目录：{entry.path}") from exc
    return {
        "skill": name,
        "path": str(entry.path),
        "opened": not dry_run,
        "command": command,
    }


class CatalogServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, repo: Repository, html_path: Path, port: int):
        self.repo = repo
        self.html_path = html_path
        super().__init__(("127.0.0.1", port), CatalogHandler)


class CatalogHandler(BaseHTTPRequestHandler):
    server: CatalogServer

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/status":
            self._send_json(automation.read_status(self.server.repo))
            return
        if path == "/api/runtime":
            self._send_json(runtime.plugin_report(self.server.repo))
            return
        if path == "/api/health":
            self._send_json({"ok": True})
            return
        if path in {"/", "/index.html", "/docs/index.html"}:
            self._send_file(self.server.html_path)
            return
        if path.startswith(("/skills/", "/plugins/")):
            candidate = self._skill_file(path)
            if candidate is not None:
                self._send_file(candidate)
                return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if self.headers.get("X-Agents-Kit-UI") != "1":
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        parts = urlsplit(self.path).path.strip("/").split("/")
        if (
            len(parts) != 4
            or parts[0] != "api"
            or parts[1] != "skills"
            or parts[3] != "open"
        ):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            result = open_skill(self.server.repo, unquote(parts[2]))
        except (OSError, RuntimeError, ValueError) as exc:
            self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        self._send_json({"ok": True, **result})

    def log_message(self, _format: str, *args: object) -> None:
        return

    def _skill_file(self, request_path: str) -> Path | None:
        prefix = "/plugins/" if request_path.startswith("/plugins/") else "/skills/"
        relative = Path(unquote(request_path.removeprefix(prefix)))
        if relative.is_absolute() or ".." in relative.parts:
            return None
        root = (
            self.server.repo.plugins_dir
            if prefix == "/plugins/"
            else self.server.repo.skills_dir
        ).resolve()
        candidate = (root / relative).resolve()
        if candidate != root and root not in candidate.parents:
            return None
        if candidate.is_dir():
            candidate = candidate / "SKILL.md"
        return candidate if candidate.is_file() else None

    def _send_file(self, path: Path) -> None:
        try:
            payload = path.read_bytes()
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if content_type.startswith("text/"):
            content_type += "; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def _send_json(
        self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK
    ) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)


def create_server(repo: Repository, html_path: Path, *, port: int = 0) -> CatalogServer:
    if not html_path.is_file():
        raise UiError(f"网页清册不存在：{html_path}")
    return CatalogServer(repo, html_path, port)


def serve(
    repo: Repository,
    html_path: Path,
    *,
    port: int = 0,
    open_browser: bool = True,
) -> dict[str, object]:
    server = create_server(repo, html_path, port=port)
    host, selected_port = server.server_address
    url = f"http://{host}:{selected_port}/"
    print(f"技能清册：{url}", flush=True)
    print("按 Ctrl+C 关闭本地服务。", flush=True)
    if open_browser:
        webbrowser.open_new_tab(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return {"served": True, "url": url}
