"""
Tests for engine/analyzer.py (Stage 2 — Static analysis).

Every test builds a minimal in-memory repo in a temp directory and asserts
on the Graph produced by analyze_repo(). This covers:
  - Node creation and the id scheme (module:, class:, function:)
  - Edge types (contains, imports, calls)
  - Cross-file call resolution
  - Import resolution (absolute and relative)
  - __init__ / index file normalization
  - SyntaxError graceful skip
  - LOC calculation
  - Incremental re-analysis (file-hash cache)
"""
import json
import textwrap
from pathlib import Path

import pytest

from engine.analyzer import Graph, analyze_repo, analyze_repo_incremental


# ── helpers ───────────────────────────────────────────────────────────────────

def repo(tmp_path: Path, files: dict) -> Path:
    """Write {rel_path: source} to tmp_path and return it."""
    for rel, content in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(textwrap.dedent(content), encoding="utf-8")
    return tmp_path


def node_ids(graph: Graph) -> set:
    return set(graph.nodes)


def edge_triples(graph: Graph) -> set:
    return {(e.source, e.target, e.type) for e in graph.edges}


# ── node creation ─────────────────────────────────────────────────────────────

def test_module_node_created(tmp_path):
    g = analyze_repo(repo(tmp_path, {"app.py": "x = 1\n"}))
    assert "module:app" in g.nodes
    assert g.nodes["module:app"].type == "module"


def test_function_node_id_scheme(tmp_path):
    g = analyze_repo(repo(tmp_path, {"utils.py": "def helper(): pass\n"}))
    assert "function:utils.helper" in g.nodes
    fn = g.nodes["function:utils.helper"]
    assert fn.name == "helper"
    assert fn.type == "function"


def test_class_node_id_scheme(tmp_path):
    g = analyze_repo(repo(tmp_path, {"models.py": """\
        class User:
            pass
    """}))
    assert "class:models.User" in g.nodes
    assert g.nodes["class:models.User"].type == "class"


def test_method_nested_under_class(tmp_path):
    g = analyze_repo(repo(tmp_path, {"models.py": """\
        class User:
            def save(self):
                pass
    """}))
    assert "function:models.User.save" in g.nodes


def test_async_function_captured(tmp_path):
    g = analyze_repo(repo(tmp_path, {"views.py": """\
        async def fetch():
            pass
    """}))
    assert "function:views.fetch" in g.nodes


# ── edge types ────────────────────────────────────────────────────────────────

def test_contains_edge_module_to_function(tmp_path):
    g = analyze_repo(repo(tmp_path, {"utils.py": "def helper(): pass\n"}))
    assert ("module:utils", "function:utils.helper", "contains") in edge_triples(g)


def test_contains_edge_module_to_class(tmp_path):
    g = analyze_repo(repo(tmp_path, {"models.py": "class User: pass\n"}))
    assert ("module:models", "class:models.User", "contains") in edge_triples(g)


def test_contains_edge_class_to_method(tmp_path):
    g = analyze_repo(repo(tmp_path, {"models.py": """\
        class User:
            def save(self): pass
    """}))
    assert ("class:models.User", "function:models.User.save", "contains") in edge_triples(g)


# ── call resolution ───────────────────────────────────────────────────────────

def test_same_file_call_resolved(tmp_path):
    g = analyze_repo(repo(tmp_path, {"app.py": """\
        def helper(): pass
        def main(): helper()
    """}))
    assert ("function:app.main", "function:app.helper", "calls") in edge_triples(g)


def test_cross_file_call_resolved(tmp_path):
    g = analyze_repo(repo(tmp_path, {
        "db.py":  "def connect(): pass\n",
        "app.py": "def start(): connect()\n",
    }))
    assert ("function:app.start", "function:db.connect", "calls") in edge_triples(g)


def test_method_call_resolved(tmp_path):
    g = analyze_repo(repo(tmp_path, {"svc.py": """\
        def query(): pass
        class Service:
            def run(self): query()
    """}))
    assert ("function:svc.Service.run", "function:svc.query", "calls") in edge_triples(g)


# ── import resolution ─────────────────────────────────────────────────────────

def test_import_edge_absolute(tmp_path):
    g = analyze_repo(repo(tmp_path, {
        "db.py":  "def connect(): pass\n",
        "app.py": "import db\n",
    }))
    assert ("module:app", "module:db", "imports") in edge_triples(g)


def test_import_from_edge(tmp_path):
    g = analyze_repo(repo(tmp_path, {
        "db.py":  "def connect(): pass\n",
        "app.py": "from db import connect\n",
    }))
    assert ("module:app", "module:db", "imports") in edge_triples(g)


# ── __init__ / package normalization ──────────────────────────────────────────

def test_init_file_maps_to_package(tmp_path):
    g = analyze_repo(repo(tmp_path, {
        "pkg/__init__.py": "",
        "pkg/auth.py": "def login(): pass\n",
    }))
    assert "module:pkg" in g.nodes
    assert "module:pkg.auth" in g.nodes
    assert "function:pkg.auth.login" in g.nodes


def test_nested_package_id(tmp_path):
    g = analyze_repo(repo(tmp_path, {
        "app/__init__.py": "",
        "app/db/__init__.py": "",
        "app/db/conn.py": "def open(): pass\n",
    }))
    assert "function:app.db.conn.open" in g.nodes


# ── graceful degradation ──────────────────────────────────────────────────────

def test_syntax_error_file_skipped(tmp_path):
    g = analyze_repo(repo(tmp_path, {
        "bad.py":  "def (: pass\n",
        "good.py": "def ok(): pass\n",
    }))
    assert "function:good.ok" in g.nodes
    assert "module:bad" in g.nodes                       # module node still created
    assert not any(n.startswith("function:bad.") for n in g.nodes)


def test_excluded_dirs_not_walked(tmp_path):
    r = repo(tmp_path, {"app.py": "def run(): pass\n"})
    skip = r / "node_modules" / "lib.py"
    skip.parent.mkdir()
    skip.write_text("def dep(): pass\n")
    g = analyze_repo(r)
    assert "function:app.run" in g.nodes
    assert "module:node_modules.lib" not in g.nodes


# ── LOC ───────────────────────────────────────────────────────────────────────

def test_loc_computed(tmp_path):
    g = analyze_repo(repo(tmp_path, {"utils.py": """\
        def big():
            a = 1
            b = 2
            return a + b
    """}))
    fn = g.nodes.get("function:utils.big")
    assert fn is not None
    assert fn.loc >= 4


# ── incremental re-analysis ───────────────────────────────────────────────────

def test_incremental_cold_run(tmp_path):
    r = repo(tmp_path, {"a.py": "def foo(): pass\n", "b.py": "def bar(): pass\n"})
    g, cache = analyze_repo_incremental(r, {})
    assert "function:a.foo" in g.nodes
    assert "function:b.bar" in g.nodes
    assert set(cache.keys()) == {"a.py", "b.py"}


def test_incremental_unchanged_files_reuse_cache(tmp_path):
    r = repo(tmp_path, {"a.py": "def foo(): pass\n", "b.py": "def bar(): pass\n"})
    _, cache1 = analyze_repo_incremental(r, {})
    g2, cache2 = analyze_repo_incremental(r, cache1)
    assert "function:a.foo" in g2.nodes
    # Cache entries for unchanged files must be identical dicts
    assert cache2["a.py"] == cache1["a.py"]
    assert cache2["b.py"] == cache1["b.py"]


def test_incremental_only_reparsed_modified_file(tmp_path):
    r = repo(tmp_path, {"a.py": "def foo(): pass\n", "b.py": "def bar(): pass\n"})
    _, cache1 = analyze_repo_incremental(r, {})
    old_a_hash = cache1["a.py"]["content_hash"]

    # Modify only a.py
    (r / "a.py").write_text("def foo(): pass\ndef new_fn(): pass\n", encoding="utf-8")
    g3, cache3 = analyze_repo_incremental(r, cache1)

    assert "function:a.new_fn" in g3.nodes
    assert cache3["a.py"]["content_hash"] != old_a_hash
    assert cache3["b.py"] == cache1["b.py"]   # b.py untouched


def test_incremental_cache_round_trips_json(tmp_path):
    r = repo(tmp_path, {"m.py": "class Foo:\n    def bar(self): pass\n"})
    _, cache = analyze_repo_incremental(r, {})
    entry = cache["m.py"]
    # All cache fields must be valid JSON strings
    for field in ("nodes_json", "edges_json", "pending_calls_json", "pending_imports_json"):
        assert field in entry
        json.loads(entry[field])   # must not raise
