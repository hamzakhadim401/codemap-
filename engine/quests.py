"""
Stage 9 - Onboarding UX: auto-generated guided quests.

Takes the unified graph JSON ({nodes, edges}) and produces a list of
structured "quests" — curated sequences of graph nodes a new engineer
should visit to understand the codebase, ranked by architectural importance.

Three quest types (always generated unless there are too few nodes):

  1. Critical Components  — top nodes by blast_radius (most depended-upon).
     Walk order: highest blast_radius first; if A calls B, show A's module first.
     Intent: show the new engineer what NOT to break.

  2. Module Tour          — one representative node per module (the
     highest blast_radius function within it).
     Intent: give a "bird's eye" structural overview of the repo.

  3. Hot Path             — only emitted when runtime tracing data is present
     (i.e., any node has call_count > 0). Top nodes by call_count.
     Intent: show what actually ran during tests / real traffic.
"""
from __future__ import annotations

from typing import Dict, List


def _pluralise(n: int, singular: str, plural: str = "") -> str:
    return f"{n} {singular if n == 1 else (plural or singular + 's')}"


def _why_blast(node: dict) -> str:
    br = node.get("blast_radius", 0)
    if br == 0:
        return "No other code depends on this directly — safe to change in isolation."
    return (f"{_pluralise(br, 'other node')} depend on this. "
            "Changing it has a wide ripple effect.")


def _why_module(node: dict, module_name: str) -> str:
    br = node.get("blast_radius", 0)
    return (f"The most central function in the {module_name!r} module "
            f"(blast radius {br}). Start here to understand what this module does.")


def _why_hot(node: dict) -> str:
    cc = node.get("call_count", 0)
    return (f"Called {_pluralise(cc, 'time')} during the last traced run. "
            "This is the busiest code path — understanding it explains most runtime behaviour.")


def _module_of(node: dict) -> str:
    """Return the dotted module path for a node (strips type prefix + leaf name)."""
    nid: str = node["id"]
    if ":" not in nid:
        return nid
    parts = nid.split(":", 1)[1].rsplit(".", 1)
    return parts[0] if len(parts) > 1 else parts[0]


def _is_function(node: dict) -> bool:
    return node.get("type") == "function"


def generate_quests(graph_data: dict) -> List[dict]:
    """
    graph_data: the {nodes, edges} dict from store.get_graph().
    Returns a list of quest objects, each with:
      id, title, description, icon, estimated_minutes, steps[]
    Each step: step, node_id, title, why, file, line
    """
    nodes: List[dict] = graph_data.get("nodes", [])
    if not nodes:
        return []

    by_id: Dict[str, dict] = {n["id"]: n for n in nodes}
    functions = [n for n in nodes if _is_function(n)]

    quests = []

    # ── Quest 1: Critical Components ──────────────────────────────────────────
    if functions:
        ranked = sorted(functions, key=lambda n: n.get("blast_radius", 0), reverse=True)
        top = ranked[:min(8, len(ranked))]
        steps = []
        for i, n in enumerate(top, 1):
            steps.append({
                "step":    i,
                "node_id": n["id"],
                "title":   n.get("name", n["id"].split(".")[-1]),
                "why":     _why_blast(n),
                "file":    n.get("file", ""),
                "line":    n.get("line", 1),
            })
        if steps:
            max_br = top[0].get("blast_radius", 0)
            quests.append({
                "id":                  "critical-components",
                "title":               "Critical Components",
                "description":         (
                    f"The {len(steps)} most depended-upon functions in the codebase. "
                    f"The top one has {_pluralise(max_br, 'direct dependent')}. "
                    "Start here to understand what you must not break."
                ),
                "icon":                "⬡",
                "estimated_minutes":   len(steps) * 3,
                "steps":               steps,
            })

    # ── Quest 2: Module Tour ───────────────────────────────────────────────────
    module_best: Dict[str, dict] = {}
    for n in functions:
        mod = _module_of(n)
        if not mod:
            continue
        prev = module_best.get(mod)
        if prev is None or n.get("blast_radius", 0) > prev.get("blast_radius", 0):
            module_best[mod] = n

    if len(module_best) >= 2:
        ordered_mods = sorted(
            module_best.items(),
            key=lambda kv: kv[1].get("blast_radius", 0),
            reverse=True,
        )
        steps = []
        for i, (mod, n) in enumerate(ordered_mods[:8], 1):
            mod_display = mod.split(".")[-1] if "." in mod else mod
            steps.append({
                "step":    i,
                "node_id": n["id"],
                "title":   f"{mod_display} module",
                "why":     _why_module(n, mod_display),
                "file":    n.get("file", ""),
                "line":    n.get("line", 1),
            })
        if steps:
            quests.append({
                "id":                  "module-tour",
                "title":               "Module Tour",
                "description":         (
                    f"A one-function-per-module tour across all {len(steps)} modules. "
                    "Gives you the high-level shape of the repo before diving into details."
                ),
                "icon":                "◎",
                "estimated_minutes":   len(steps) * 2,
                "steps":               steps,
            })

    # ── Quest 3: Hot Path (traced only) ───────────────────────────────────────
    traced = [n for n in functions if n.get("call_count", 0) > 0]
    if traced:
        hot = sorted(traced, key=lambda n: n.get("call_count", 0), reverse=True)
        top_hot = hot[:min(8, len(hot))]
        steps = []
        for i, n in enumerate(top_hot, 1):
            steps.append({
                "step":    i,
                "node_id": n["id"],
                "title":   n.get("name", n["id"].split(".")[-1]),
                "why":     _why_hot(n),
                "file":    n.get("file", ""),
                "line":    n.get("line", 1),
            })
        if steps:
            total_calls = sum(n.get("call_count", 0) for n in top_hot)
            quests.append({
                "id":                  "hot-path",
                "title":               "Hot Path",
                "description":         (
                    f"Functions observed during the last traced run. "
                    f"Combined {_pluralise(total_calls, 'invocation')} — "
                    "this is what the code actually does at runtime, not just what it could do."
                ),
                "icon":                "↻",
                "estimated_minutes":   len(steps) * 2,
                "steps":               steps,
            })

    return quests
