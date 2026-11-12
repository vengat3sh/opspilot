"""Docker-only execution boundary for consequential developer tools.

There is deliberately no host-shell fallback. If Docker or the configured
sandbox is unavailable the caller receives an honest ``unavailable`` result.
"""
from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from ..config import Settings


@dataclass
class SandboxResult:
    available: bool
    returncode: int | None
    stdout: str
    stderr: str
    timed_out: bool = False
    message: str = ""


def sandbox_available(settings: Settings) -> tuple[bool, str]:
    if not settings.sandbox_enabled:
        return False, "Sandbox execution is disabled (SANDBOX_ENABLED=false)."
    binary = shutil.which(settings.sandbox_docker_bin)
    if not binary:
        return False, f"Docker executable '{settings.sandbox_docker_bin}' was not found."
    try:
        probe = subprocess.run(
            [binary, "info", "--format", "{{.ServerVersion}}"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"Docker daemon probe failed: {type(exc).__name__}."
    if probe.returncode != 0:
        return False, "Docker daemon is not reachable."
    return True, "Docker sandbox is available."


def run_in_sandbox(
    settings: Settings,
    root: Path,
    command: list[str],
    *,
    timeout_seconds: int | None = None,
) -> SandboxResult:
    available, reason = sandbox_available(settings)
    if not available:
        return SandboxResult(False, None, "", "", message=reason)
    if not command or any(not isinstance(part, str) or "\x00" in part for part in command):
        return SandboxResult(True, None, "", "", message="Invalid command arguments.")
    allowlist = {part.strip() for part in settings.tool_command_allowlist.split(",") if part.strip()}
    executable = Path(command[0]).name
    if executable not in allowlist:
        return SandboxResult(
            True,
            None,
            "",
            "",
            message=f"Command '{executable}' is not in TOOL_COMMAND_ALLOWLIST.",
        )
    root = root.resolve()
    timeout = max(5, min(int(timeout_seconds or settings.sandbox_timeout_seconds), 300))
    args = [
        shutil.which(settings.sandbox_docker_bin) or settings.sandbox_docker_bin,
        "run",
        "--rm",
        "--init",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        f"--memory={settings.sandbox_memory_limit}",
        f"--cpus={settings.sandbox_cpu_limit}",
        "--pids-limit=128",
        f"--stop-timeout={min(10, timeout)}",
    ]
    if settings.sandbox_network_disabled:
        args.append("--network=none")
    args.extend([
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=64m",
        "-v",
        f"{root}:/workspace:ro",
        "-w",
        "/workspace",
        settings.sandbox_image,
        *command,
    ])
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return SandboxResult(True, None, "", "", timed_out=True, message=f"Sandbox timed out after {timeout}s.")
    except OSError as exc:
        return SandboxResult(False, None, "", "", message=f"Sandbox failed to start: {type(exc).__name__}.")
    stdout = (result.stdout or "")[-20_000:]
    stderr = (result.stderr or "")[-10_000:]
    return SandboxResult(
        True,
        result.returncode,
        stdout,
        stderr,
        message="Sandbox command completed." if result.returncode == 0 else "Sandbox command failed.",
    )
