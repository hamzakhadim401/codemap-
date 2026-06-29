"""
Tests for engine/ingest.py (Stage 1 — Ingestion).
"""
import tempfile
from pathlib import Path

import pytest

from engine.ingest import IngestError, cleanup, ingest


# ── helpers ──────────────────────────────────────────────────────────────────

def make_dir(files: dict | None = None) -> Path:
    d = Path(tempfile.mkdtemp())
    for name, content in (files or {}).items():
        p = d / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
    return d


# ── local directory ingestion ─────────────────────────────────────────────────

def test_local_directory_ingested():
    src = make_dir({"main.py": "x = 1\n"})
    result = ingest(str(src))
    try:
        assert result.working_dir.exists()
        assert (result.working_dir / "main.py").exists()
    finally:
        cleanup(result)


def test_working_dir_is_copy_not_original():
    src = make_dir({"main.py": "x = 1\n"})
    result = ingest(str(src))
    try:
        assert result.working_dir != src
    finally:
        cleanup(result)


def test_single_file_input_uses_parent_dir():
    src_dir = make_dir({"utils.py": "def f(): pass\n", "other.py": ""})
    single_file = src_dir / "utils.py"
    result = ingest(str(single_file))
    try:
        assert (result.working_dir / "utils.py").exists()
        assert (result.working_dir / "other.py").exists()
    finally:
        cleanup(result)


def test_excludes_git_pycache_venv(tmp_path):
    src = make_dir({"app.py": ""})
    (src / "__pycache__").mkdir()
    (src / "__pycache__" / "app.cpython-313.pyc").write_bytes(b"\x00")
    (src / ".venv").mkdir()
    (src / ".venv" / "python").write_text("")
    (src / ".git").mkdir()
    (src / ".git" / "config").write_text("")
    result = ingest(str(src))
    try:
        assert not (result.working_dir / "__pycache__").exists()
        assert not (result.working_dir / ".venv").exists()
        assert not (result.working_dir / ".git").exists()
    finally:
        cleanup(result)


def test_shell_quoted_path_stripped():
    src = make_dir({"x.py": ""})
    result = ingest(f'"{src}"')
    try:
        assert result.working_dir.exists()
    finally:
        cleanup(result)


# ── confidential mode ─────────────────────────────────────────────────────────

def test_confidential_flag_set():
    src = make_dir({"a.py": ""})
    result = ingest(str(src), confidential=True)
    try:
        assert result.confidential is True
    finally:
        cleanup(result)


def test_confidential_uses_temp_dir():
    import tempfile as _tf
    src = make_dir({"a.py": ""})
    result = ingest(str(src), confidential=True)
    try:
        # Job dir should be inside the system temp root
        sys_tmp = Path(_tf.gettempdir()).resolve()
        assert result.job_dir.resolve().is_relative_to(sys_tmp)
    finally:
        cleanup(result)


# ── cleanup ───────────────────────────────────────────────────────────────────

def test_cleanup_removes_job_dir():
    src = make_dir({"a.py": ""})
    result = ingest(str(src))
    job_dir = result.job_dir
    cleanup(result)
    assert not job_dir.exists()


def test_cleanup_idempotent():
    src = make_dir({"a.py": ""})
    result = ingest(str(src))
    cleanup(result)
    cleanup(result)   # second call must not raise


# ── error cases ───────────────────────────────────────────────────────────────

def test_nonexistent_path_raises():
    with pytest.raises(IngestError, match="does not exist"):
        ingest("/this/path/definitely/does/not/exist/42")


def test_workspace_root_used_for_non_confidential(tmp_path):
    src = make_dir({"a.py": ""})
    result = ingest(str(src), confidential=False, workspace_root=str(tmp_path))
    try:
        assert str(result.job_dir).startswith(str(tmp_path))
    finally:
        cleanup(result)
