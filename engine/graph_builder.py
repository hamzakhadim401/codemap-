"""
Stage 6 (MVP version) - Unification

Converts the analyzer's internal Graph into the single JSON schema that
everything downstream (visualization, future IDE plugin, future query
layer) reads from. This is the seam where Phase 2/3 merges in:
  - runtime trace weights      -> call_count on nodes and edges  (Stage 3, done)
  - ML introspection data      -> "activation"/"gradient" on nodes
  - human exit-interview notes -> "annotations": [...] on nodes
None of those additions change a node's `id`, which is why getting the
id scheme right in Stage 2 matters so much.
"""
from collections import defaultdict
from typing import Optional

from .analyzer import Graph


def to_json(graph: Graph, trace: Optional[dict] = None) -> dict:
    """
    trace: optional output of tracer.to_trace_json() --
      {"node_counts": {node_id: int}, "edge_counts": {"src->tgt": int}}
    When present, call_count is added to nodes and edges that were hit.
    """
    in_degree = defaultdict(int)
    for e in graph.edges:
        in_degree[e.target] += 1

    node_counts = (trace or {}).get("node_counts", {})
    edge_counts = (trace or {}).get("edge_counts", {})

    nodes = []
    for n in graph.nodes.values():
        node = {
            "id":           n.id,
            "type":         n.type,
            "name":         n.name,
            "file":         n.file,
            "line":         n.lineno,
            "loc":          n.loc,
            "blast_radius": in_degree.get(n.id, 0),
        }
        if n.id in node_counts:
            node["call_count"] = node_counts[n.id]
        nodes.append(node)

    edges = []
    for e in graph.edges:
        edge = {"source": e.source, "target": e.target, "type": e.type}
        ek = f"{e.source}->{e.target}"
        if ek in edge_counts:
            edge["call_count"] = edge_counts[ek]
        edges.append(edge)

    return {"nodes": nodes, "edges": edges}
