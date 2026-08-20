from __future__ import annotations

import json
import os
import shlex
import subprocess
from pathlib import Path
from typing import Any


class SessionReaderUnavailable(RuntimeError):
    pass


def read_session(session_id: str, *, transcript_file: Path | None = None) -> dict[str, Any]:
    if transcript_file is not None:
        return {
            "session_id": session_id,
            "content": transcript_file.read_text(encoding="utf-8"),
            "source": "provided_file",
        }
    command = os.environ.get("AI_SPEAKING_SESSION_READER_CMD")
    if not command:
        raise SessionReaderUnavailable(
            "No session reader adapter configured. Retrieve the Voice session through the host, "
            "or set AI_SPEAKING_SESSION_READER_CMD."
        )
    process = subprocess.run(
        shlex.split(command),
        input=json.dumps({"session_id": session_id}, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=False,
    )
    if process.returncode != 0:
        raise RuntimeError(process.stderr.strip() or "Session reader failed")
    payload = json.loads(process.stdout)
    if not payload.get("content"):
        raise RuntimeError("Session reader returned no content")
    return payload
