"""
Natural-language query layer (Phase 5).

Two search modes — selected automatically:
  keyword  — always available, instant, scores nodes by token overlap with name/file/type
  llm      — requires ANTHROPIC_API_KEY; sends query + compact node list to Claude Haiku,
              gets back ranked node IDs + a human-readable explanation

search_graph() tries LLM first and falls back to keyword if the key is missing or
if the API call fails, so the endpoint is always usable.
"""

import json
import os
import re
from typing import Dict, List

_HAIKU = "claude-haiku-4-5-20251001"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def search_graph(graph_data: dict, query: str) -> dict:
    """
    Returns:
        {
            "matching_nodes": [node_id, ...],   # ranked best-first
            "explanation":    str,
            "mode":           "llm" | "keyword",
            "warning":        str,              # only present on LLM fallback
        }
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if api_key:
        try:
            return _llm_search(graph_data, query, api_key)
        except Exception as exc:
            result = _keyword_search(graph_data, query)
            result["warning"] = f"LLM unavailable ({exc}); using keyword search"
            return result
    return _keyword_search(graph_data, query)


# ---------------------------------------------------------------------------
# Keyword search
# ---------------------------------------------------------------------------

def _keyword_search(graph_data: dict, query: str) -> dict:
    tokens = set(re.findall(r"\w+", query.lower()))
    nodes  = graph_data.get("nodes", [])

    scored: List[tuple] = []
    for node in nodes:
        name  = node.get("name", "").lower()
        file_ = node.get("file", "").lower()
        ntype = node.get("type", "").lower()
        nid   = node.get("id",   "").lower()

        score = 0
        for tok in tokens:
            if len(tok) < 2:
                continue
            if tok == name:       score += 4
            elif tok in name:     score += 2
            if tok in file_:      score += 1
            if tok in ntype:      score += 1
            if tok in nid:        score += 1

        if score > 0:
            scored.append((score, node["id"]))

    scored.sort(reverse=True)
    top = [nid for _, nid in scored[:20]]

    explanation = (
        f"Found {len(top)} node(s) matching '{query}'."
        if top else
        f"No nodes matched '{query}'. Try different keywords."
    )
    return {"matching_nodes": top, "explanation": explanation, "mode": "keyword"}


# ---------------------------------------------------------------------------
# LLM search  (Claude Haiku — fast, cheap, sufficient for graph navigation)
# ---------------------------------------------------------------------------

def _llm_search(graph_data: dict, query: str, api_key: str) -> dict:
    import anthropic

    nodes = graph_data.get("nodes", [])

    # Compact representation sorted by blast_radius so the LLM sees the most
    # important nodes first.  Cap at 150 to stay within a comfortable context.
    compact = sorted(
        [
            {
                "id":   n["id"],
                "name": n.get("name", ""),
                "type": n.get("type", ""),
                "file": n.get("file", ""),
                "br":   n.get("blast_radius", 0),
            }
            for n in nodes
        ],
        key=lambda x: x["br"],
        reverse=True,
    )[:150]

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=_HAIKU,
        max_tokens=1024,
        system="""You are a code navigation assistant for a visual codebase explorer.
Given a JSON list of code graph nodes (functions, classes, modules) and a developer's
natural-language query, return the most relevant node IDs.

RESPOND WITH VALID JSON ONLY — no markdown fences, no prose outside the JSON object:
{"matching_nodes":["id1","id2",...],"explanation":"One or two sentences."}

Rules:
- matching_nodes: 0-20 node IDs, most relevant first
- Only include IDs that genuinely answer the query — no padding
- explanation: 1-2 developer-facing sentences that name the actual nodes found
- If nothing matches, return matching_nodes:[] and explain what you searched for""",
        messages=[
            {
                "role": "user",
                "content": f"Query: {query}\n\nNodes:\n{json.dumps(compact)}",
            }
        ],
    )

    text = response.content[0].text.strip()

    # Tolerate models that wrap JSON in markdown code fences
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise ValueError(f"LLM returned non-JSON: {text[:120]}")

    result = json.loads(m.group())

    # Validate IDs — drop any hallucinated ones
    valid_ids = {n["id"] for n in nodes}
    result["matching_nodes"] = [
        nid for nid in result.get("matching_nodes", []) if nid in valid_ids
    ]
    result["mode"] = "llm"
    return result
