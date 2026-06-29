"""
Stage 0 - Ingestion

Accepts either a local filesystem path or a git remote URL and produces a
normalized working copy for analysis.

Confidential mode is a real architectural property, not a checkbox:
when enabled, all work happens inside a temp directory that is the only
place the source ever touches disk, and cleanup() is called unconditionally
(success or failure) so nothing outlives the analysis job.
"""
import os
import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path


class IngestError(Exception):
    pass


@dataclass
class IngestResult:
    working_dir: Path   # path to the cloned/copied repo
    job_dir: Path       # parent dir to remove on cleanup (working_dir's container)
    source: str
    confidential: bool


def _is_git_url(source: str) -> bool:
    return source.startswith(("http://", "https://", "git@")) or source.endswith(".git")


def ingest(source: str, confidential: bool = False, workspace_root: str | None = None) -> IngestResult:
    """
    source: local file/directory path OR a git remote URL (https/ssh)
    confidential: if True, the job runs in an ephemeral temp dir regardless
                  of workspace_root, and no logs below will ever contain
                  file contents -- only counts and structural metadata.
    workspace_root: where to put non-confidential jobs (e.g. a persistent
                  cache dir enabling incremental re-analysis on the next
                  CI run). Ignored when confidential=True.
    """
    # Strip whitespace and surrounding quotes that users paste from file-explorer dialogs
    source = source.strip().strip('"\'').strip()
    if confidential or not workspace_root:
        job_dir = Path(tempfile.mkdtemp(prefix="codemap_"))
    else:
        job_dir = Path(workspace_root) / f"job_{uuid.uuid4().hex[:8]}"
        job_dir.mkdir(parents=True, exist_ok=True)

    target = job_dir / "repo"

    try:
        if _is_git_url(source):
            # Shallow clone only -- structural analysis never needs full history
            proc = subprocess.run(
                ["git", "clone", "--depth", "1", source, str(target)],
                capture_output=True,
                text=True,
            )
            if proc.returncode != 0:
                # Never log proc.stderr verbatim in confidential mode -- it can
                # echo back partial file contents or auth errors with tokens
                raise IngestError("git clone failed" if confidential else f"git clone failed: {proc.stderr.strip()}")
        else:
            src_path = Path(source).expanduser().resolve()
            if not src_path.exists():
                raise IngestError(f"Path does not exist: {source}")
            # Single-file input: analyze the directory it lives in
            if src_path.is_file():
                src_path = src_path.parent
            shutil.copytree(src_path, target, ignore=shutil.ignore_patterns(
                ".git", "node_modules", "__pycache__", ".venv", "venv"
            ))
    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise

    return IngestResult(working_dir=target, job_dir=job_dir, source=source, confidential=confidential)


def cleanup(result: IngestResult) -> None:
    """Irreversibly remove the working copy. Always call this in a finally block."""
    shutil.rmtree(result.job_dir, ignore_errors=True)
