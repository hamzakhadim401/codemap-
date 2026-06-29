"""
Stage 2 language plugin - JavaScript / TypeScript (tree-sitter)

Produces the same Node/Edge/pending_calls/pending_imports shape as the
Python analyzer so graph_builder.py and visualize.py need no changes.

If tree-sitter is not installed, analyzer.py catches the ImportError and
skips JS/TS files rather than failing the whole run (graceful degradation).
"""
from __future__ import annotations

from pathlib import Path


def _build_parsers() -> dict:
    from tree_sitter import Language, Parser
    import tree_sitter_javascript as tsjs
    import tree_sitter_typescript as tsts

    def make_parser(lang_capsule):
        lang = Language(lang_capsule)
        try:
            return Parser(lang)           # tree-sitter >= 0.22
        except TypeError:
            p = Parser()                  # tree-sitter 0.21 compat
            p.set_language(lang)
            return p

    return {
        "javascript":       make_parser(tsjs.language()),
        "javascriptreact":  make_parser(tsjs.language()),
        "typescript":       make_parser(tsts.language_typescript()),
        "typescriptreact":  make_parser(tsts.language_tsx()),
    }


_parsers: dict | None = None


def _get_parser(lang: str):
    global _parsers
    if _parsers is None:
        _parsers = _build_parsers()
    return _parsers.get(lang)


def _walk(ts_root, source_bytes: bytes, graph, module_id: str, file_rel: str) -> None:
    """Recursively walk a tree-sitter parse tree, emitting Node/Edge objects."""
    from ..analyzer import Node  # safe: analyzer is fully loaded before this is ever called

    def text(n) -> str:
        return source_bytes[n.start_byte:n.end_byte].decode("utf-8", errors="replace")

    def fld(n, fname):
        return n.child_by_field_name(fname)

    def loc(n) -> int:
        return n.end_point[0] - n.start_point[0] + 1

    local_names: dict[str, str] = {}  # short name -> node id (file-scoped)

    def reg_func(name: str, ts_node, scope: str) -> str:
        prefix = scope.split(":", 1)[1]
        fid = f"function:{prefix}.{name}"
        graph.add_node(Node(fid, "function", name, file_rel, ts_node.start_point[0] + 1, loc(ts_node)))
        graph.add_edge(scope, fid, "contains")
        local_names[name] = fid
        return fid

    def reg_class(name: str, ts_node, scope: str) -> str:
        prefix = scope.split(":", 1)[1]
        cid = f"class:{prefix}.{name}"
        graph.add_node(Node(cid, "class", name, file_rel, ts_node.start_point[0] + 1))
        graph.add_edge(scope, cid, "contains")
        local_names[name] = cid
        return cid

    def walk(node, scope: str) -> None:
        nt = node.type

        # --- function declarations ---
        if nt in ("function_declaration", "generator_function_declaration"):
            nn = fld(node, "name")
            if nn:
                fid = reg_func(text(nn), node, scope)
                body = fld(node, "body")
                if body:
                    walk(body, fid)
            return

        # --- class declarations ---
        if nt == "class_declaration":
            nn = fld(node, "name")
            if nn:
                cid = reg_class(text(nn), node, scope)
                body = fld(node, "body")
                if body:
                    walk(body, cid)
            return

        # --- method definitions (inside class body) ---
        if nt == "method_definition":
            nn = fld(node, "name")
            if nn:
                fid = reg_func(text(nn), node, scope)
                body = fld(node, "body")
                if body:
                    walk(body, fid)
            return

        # --- const/let/var = arrow function or function expression ---
        if nt in ("lexical_declaration", "variable_declaration"):
            for child in node.children:
                if child.type == "variable_declarator":
                    nn = fld(child, "name")
                    val = fld(child, "value")
                    if nn and val and val.type in ("arrow_function", "function_expression",
                                                    "generator_function"):
                        fid = reg_func(text(nn), val, scope)
                        body = fld(val, "body")
                        if body:
                            walk(body, fid)
            return

        # --- export statements: unwrap the declaration ---
        if nt == "export_statement":
            decl = fld(node, "declaration")
            if decl:
                walk(decl, scope)
                return
            # export default function/class (may or may not be named)
            for child in node.named_children:
                if child.type in ("function_declaration", "class_declaration",
                                   "function", "class",
                                   "generator_function_declaration", "generator_function"):
                    walk(child, scope)
            return

        # --- import statements ---
        if nt == "import_statement":
            src = fld(node, "source")
            if src:
                raw = text(src).strip("'\"`")
                graph.pending_imports.append((module_id, raw))
            return

        # --- call expressions ---
        if nt == "call_expression":
            fn = fld(node, "function")
            callee = None
            if fn:
                if fn.type == "identifier":
                    callee = text(fn)
                elif fn.type == "member_expression":
                    prop = fld(fn, "property")
                    if prop:
                        callee = text(prop)

            if callee and scope != module_id:
                if callee in local_names:
                    graph.add_edge(scope, local_names[callee], "calls")
                else:
                    graph.pending_calls.append((scope, callee))

            # Still recurse into arguments (nested calls)
            args = fld(node, "arguments")
            if args:
                for child in args.children:
                    walk(child, scope)
            return

        # --- default: recurse into all children ---
        for child in node.children:
            walk(child, scope)

    walk(ts_root, module_id)


def analyze_js_file(path: Path, rel: str, graph, lang: str) -> None:
    parser = _get_parser(lang)
    if parser is None:
        return

    source = path.read_bytes()
    tree = parser.parse(source)

    module_id = None
    # Find this file's module node (already registered by analyze_repo pass 1)
    for nid, node in graph.nodes.items():
        if node.file == rel and node.type == "module":
            module_id = nid
            break
    if module_id is None:
        return

    _walk(tree.root_node, source, graph, module_id, rel)
