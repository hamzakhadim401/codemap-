"""
Tests for engine/graph_builder.py (Stage 6 — Unification).

Verifies the canonical JSON schema, blast_radius calculation, trace-data
merging, and that the node ID scheme passes through unchanged.
"""
import pytest

from engine.analyzer import Edge, Graph, Node
from engine.graph_builder import to_json


# ── helpers ───────────────────────────────────────────────────────────────────

def simple_graph() -> Graph:
    """
    module:app
      ├─contains─> function:app.login   (called by logout)
      └─contains─> function:app.logout
    function:app.logout ─calls─> function:app.login
    """
    g = Graph()
    g.add_node(Node("module:app",           "module",   "app",    "app.py",  1,  0))
    g.add_node(Node("function:app.login",   "function", "login",  "app.py",  5,  10))
    g.add_node(Node("function:app.logout",  "function", "logout", "app.py", 20,   5))
    g.add_edge("module:app",          "function:app.login",  "contains")
    g.add_edge("module:app",          "function:app.logout", "contains")
    g.add_edge("function:app.logout", "function:app.login",  "calls")
    return g


def by_id(data: dict) -> dict:
    return {n["id"]: n for n in data["nodes"]}


# ── schema shape ──────────────────────────────────────────────────────────────

def test_output_has_nodes_and_edges():
    data = to_json(simple_graph())
    assert "nodes" in data and "edges" in data
    assert isinstance(data["nodes"], list)
    assert isinstance(data["edges"], list)


def test_all_required_node_fields_present():
    data = to_json(simple_graph())
    required = ("id", "type", "name", "file", "line", "loc", "blast_radius")
    for n in data["nodes"]:
        for field in required:
            assert field in n, f"Node {n['id']!r} missing field {field!r}"


def test_all_required_edge_fields_present():
    data = to_json(simple_graph())
    for e in data["edges"]:
        assert "source" in e and "target" in e and "type" in e


def test_node_count_matches():
    g = simple_graph()
    data = to_json(g)
    assert len(data["nodes"]) == len(g.nodes)


def test_edge_count_matches():
    g = simple_graph()
    data = to_json(g)
    assert len(data["edges"]) == len(g.edges)


# ── blast_radius ──────────────────────────────────────────────────────────────

def test_blast_radius_is_in_degree():
    data = to_json(simple_graph())
    nodes = by_id(data)
    # login is called by logout AND contained by app → 2 incoming edges
    assert nodes["function:app.login"]["blast_radius"] == 2
    # logout has only 1 incoming (contains from app)
    assert nodes["function:app.logout"]["blast_radius"] == 1
    # module:app has no incoming edges
    assert nodes["module:app"]["blast_radius"] == 0


def test_blast_radius_zero_for_isolated_node():
    g = Graph()
    g.add_node(Node("module:lonely", "module", "lonely", "lonely.py", 1))
    data = to_json(g)
    assert data["nodes"][0]["blast_radius"] == 0


# ── node id scheme ────────────────────────────────────────────────────────────

def test_node_ids_preserved_verbatim():
    data = to_json(simple_graph())
    ids = {n["id"] for n in data["nodes"]}
    assert "module:app" in ids
    assert "function:app.login" in ids
    assert "function:app.logout" in ids


def test_edge_source_target_match_node_ids():
    data = to_json(simple_graph())
    valid_ids = {n["id"] for n in data["nodes"]}
    for e in data["edges"]:
        assert e["source"] in valid_ids
        assert e["target"] in valid_ids


# ── trace data merging ────────────────────────────────────────────────────────

def test_trace_adds_call_count_to_node():
    trace = {"node_counts": {"function:app.login": 42}, "edge_counts": {}}
    data = to_json(simple_graph(), trace=trace)
    nodes = by_id(data)
    assert nodes["function:app.login"]["call_count"] == 42
    assert "call_count" not in nodes["function:app.logout"]
    assert "call_count" not in nodes["module:app"]


def test_trace_adds_call_count_to_edge():
    trace = {
        "node_counts": {},
        "edge_counts": {"function:app.logout->function:app.login": 17},
    }
    data = to_json(simple_graph(), trace=trace)
    call_edges = [
        e for e in data["edges"]
        if e["source"] == "function:app.logout" and e["target"] == "function:app.login"
    ]
    assert call_edges and call_edges[0]["call_count"] == 17


def test_no_trace_no_call_count_fields():
    data = to_json(simple_graph())
    for n in data["nodes"]:
        assert "call_count" not in n
    for e in data["edges"]:
        assert "call_count" not in e


def test_empty_trace_dict_is_no_op():
    data_plain = to_json(simple_graph())
    data_empty = to_json(simple_graph(), trace={})
    assert data_plain == data_empty


def test_partial_trace_only_hits_tagged():
    trace = {"node_counts": {"function:app.login": 5}, "edge_counts": {}}
    data = to_json(simple_graph(), trace=trace)
    nodes = by_id(data)
    # Only login gets call_count; logout and module do not
    assert "call_count" in nodes["function:app.login"]
    assert "call_count" not in nodes["function:app.logout"]
    assert "call_count" not in nodes["module:app"]


# ── integration: analyzer -> graph_builder ────────────────────────────────────

def test_end_to_end_blast_radius(tmp_path):
    """Connect two callers -> one callee; callee blast_radius must be >= 2."""
    from engine.analyzer import analyze_repo
    (tmp_path / "db.py").write_text("def connect(): pass\n")
    (tmp_path / "a.py").write_text("def run_a(): connect()\n")
    (tmp_path / "b.py").write_text("def run_b(): connect()\n")
    g = analyze_repo(tmp_path)
    data = to_json(g)
    connect = next((n for n in data["nodes"] if n["id"] == "function:db.connect"), None)
    assert connect is not None
    assert connect["blast_radius"] >= 2
