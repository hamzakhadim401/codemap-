"""
Stage 3 - Runtime tracing (Python)

Instruments a Python codebase using sys.settrace to capture actual call
counts during a test run. The output enriches the static graph:
  - nodes gain call_count (how many times the function was invoked)
  - edges gain call_count (how often this caller -> callee path was taken)

Opt-in only: requires --trace or --trace-cmd flag. Never runs against
production without explicit user consent. Respects confidential mode
(captures only structural counts, never code contents or call arguments).
"""
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple


class TraceError(Exception):
    pass


# ---------------------------------------------------------------------------
# Runner script — written to a temp file and run as a subprocess.
# Installs sys.settrace BEFORE any user code executes, then runs the target.
# ---------------------------------------------------------------------------
_RUNNER_SCRIPT = """\
import sys, os, json, atexit, runpy

ROOT   = sys.argv[1]
OUT    = sys.argv[2]
MODE   = sys.argv[3]   # "module" or "path"
TARGET = sys.argv[4]
sys.argv = [TARGET] + sys.argv[5:]

_counts: dict = {}   # "rel/path.py::func_name" -> call count
_edges:  dict = {}   # "caller_key->callee_key" -> call count
_stack:  list = []   # [(frame_id, key), ...]

def _key(frame):
    fname = frame.f_code.co_filename
    if "<" in fname:
        return None
    try:
        rel = os.path.relpath(fname, ROOT)
    except ValueError:
        return None
    if rel.startswith(".."):
        return None
    return rel.replace(os.sep, "/") + "::" + frame.f_code.co_name

def _tracer(frame, event, arg):
    if event == "call":
        k = _key(frame)
        if k is None:
            return None          # don't trace this frame
        _counts[k] = _counts.get(k, 0) + 1
        if _stack:
            ek = _stack[-1][1] + "->" + k
            _edges[ek] = _edges.get(ek, 0) + 1
        _stack.append((id(frame), k))
        return _tracer           # receive return/exception events for this frame
    elif event == "return":
        if _stack and _stack[-1][0] == id(frame):
            _stack.pop()
    return _tracer

def _save():
    try:
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump({"counts": _counts, "edges": _edges}, f)
    except Exception:
        pass

atexit.register(_save)
sys.settrace(_tracer)

try:
    if MODE == "path":
        runpy.run_path(TARGET, run_name="__main__")
    else:
        runpy.run_module(TARGET, run_name="__main__", alter_sys=True)
except SystemExit:
    pass
except Exception as exc:
    sys.stderr.write(f"[codemap tracer] runner error: {exc}\\n")
"""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def detect_test_cmd(root: Path) -> Optional[List[str]]:
    """
    Scan root for a test suite and return a command list to run it, or None.
    Prefers pytest; falls back to unittest discover; finally tries main.py.
    """
    root = Path(root)

    pytest_signals = [
        root / "pytest.ini",
        root / "pyproject.toml",
        root / "setup.cfg",
        root / "conftest.py",
        root / "tox.ini",
    ]
    has_pytest_config = any(p.exists() for p in pytest_signals)
    test_files = (
        list(root.glob("**/test_*.py"))
        + list(root.glob("**/*_test.py"))
        + list(root.glob("tests/*.py"))
    )
    has_tests = bool(test_files)

    if has_pytest_config or has_tests:
        return ["pytest"]

    if (root / "__main__.py").exists():
        return ["python", "__main__.py"]
    if (root / "main.py").exists():
        return ["python", "main.py"]

    return None


def run_with_trace(
    root: Path,
    cmd: List[str],
    confidential: bool = False,
) -> Dict:
    """
    Run *cmd* inside *root* with sys.settrace instrumentation.

    Returns {"counts": {"rel/path.py::func": n, ...}, "edges": {"a->b": n, ...}}.
    Never raises -- returns {} on timeout or failure so the pipeline can
    continue without runtime data (graceful degradation per non-functional reqs).
    """
    import subprocess

    root = Path(root).resolve()

    # Resolve mode and target from the command list
    first = cmd[0] if cmd else ""
    if first in ("python", "python3", sys.executable):
        if len(cmd) >= 3 and cmd[1] == "-m":
            mode, target, extra = "module", cmd[2], cmd[3:]
        elif len(cmd) >= 2:
            mode, target, extra = "path", cmd[1], cmd[2:]
        else:
            return {}
    else:
        mode, target, extra = "module", first, cmd[1:]

    runner_fd, runner_path = tempfile.mkstemp(suffix=".py", prefix="codemap_runner_")
    out_path = runner_path + ".json"

    try:
        with os.fdopen(runner_fd, "w", encoding="utf-8") as f:
            f.write(_RUNNER_SCRIPT)

        proc = subprocess.run(
            [sys.executable, runner_path, str(root), out_path, mode, target] + list(extra),
            cwd=root,
            capture_output=confidential,
            timeout=120,
        )

        if Path(out_path).exists():
            with open(out_path, encoding="utf-8") as f:
                return json.load(f)
        return {}

    except (subprocess.TimeoutExpired, Exception):
        return {}

    finally:
        for p in [runner_path, out_path]:
            try:
                os.unlink(p)
            except OSError:
                pass


def to_trace_json(raw: Dict, graph) -> Dict:
    """
    Map raw tracer output (rel_path::func_name -> count) to stable node IDs
    using the static analysis graph.

    Returns {"node_counts": {node_id: n}, "edge_counts": {"src->tgt": n}}.
    Empty dict if raw is empty (clean no-op when tracing was skipped).
    """
    if not raw:
        return {}

    # Build lookup: (normalized_rel_path, short_func_name) -> node_id
    # co_name gives only the leaf name, matching node.name from static analysis.
    lookup: Dict[Tuple[str, str], str] = {}
    for nid, node in graph.nodes.items():
        if node.type == "function":
            rel = node.file.replace("\\", "/")
            lookup[(rel, node.name)] = nid

    node_counts: Dict[str, int] = {}
    for raw_key, count in raw.get("counts", {}).items():
        if "::" not in raw_key:
            continue
        rel, fn = raw_key.rsplit("::", 1)
        nid = lookup.get((rel, fn))
        if nid:
            node_counts[nid] = node_counts.get(nid, 0) + count

    edge_counts: Dict[str, int] = {}
    for raw_edge, count in raw.get("edges", {}).items():
        if "->" not in raw_edge:
            continue
        src_key, tgt_key = raw_edge.split("->", 1)
        if "::" not in src_key or "::" not in tgt_key:
            continue
        src_rel, src_fn = src_key.rsplit("::", 1)
        tgt_rel, tgt_fn = tgt_key.rsplit("::", 1)
        src_id = lookup.get((src_rel, src_fn))
        tgt_id = lookup.get((tgt_rel, tgt_fn))
        if src_id and tgt_id:
            ek = f"{src_id}->{tgt_id}"
            edge_counts[ek] = edge_counts.get(ek, 0) + count

    return {"node_counts": node_counts, "edge_counts": edge_counts}
