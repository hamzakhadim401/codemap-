"""
Stage 2 - Static analysis (multi-language dispatcher + incremental re-analysis)

Walks every supported source file in a working directory and builds a graph of:
  nodes: modules, classes, functions
  edges: contains (module->class/function, class->method),
         imports (module->module),
         calls   (function->function)

Phase 1: Python via stdlib ast.
Phase 2: JavaScript / TypeScript via tree-sitter (analyzers/js_ts.py).
         Falls back gracefully if tree-sitter is not installed.

Call/import resolution is deliberately name-based, not a full symbol table --
good enough to reveal real architecture for the MVP. Precise disambiguation
(LSP / type inference) is a Phase 3 task.
"""
import ast
import hashlib
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Tuple

EXCLUDED_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv", "build", "dist"}

_JS_LIKE_EXTS = frozenset({".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"})

_EXT_TO_LANG: Dict[str, str] = {
    ".py":  "python",
    ".js":  "javascript",
    ".jsx": "javascriptreact",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts":  "typescript",
    ".tsx": "typescriptreact",
}


@dataclass
class Node:
    id: str
    type: str        # module | class | function
    name: str
    file: str
    lineno: int
    loc: int = 0


@dataclass
class Edge:
    source: str
    target: str
    type: str         # contains | imports | calls


@dataclass
class Graph:
    nodes: Dict[str, Node] = field(default_factory=dict)
    edges: List[Edge] = field(default_factory=list)
    pending_calls: List[Tuple[str, str]] = field(default_factory=list)     # (caller_id, callee_short_name)
    pending_imports: List[Tuple[str, str]] = field(default_factory=list)  # (module_id, imported_dotted_name)

    def add_node(self, node: Node):
        self.nodes[node.id] = node

    def add_edge(self, source: str, target: str, type_: str):
        if source in self.nodes and target in self.nodes:
            self.edges.append(Edge(source, target, type_))


def _module_id_for(rel_path: str) -> str:
    p = Path(rel_path)
    suffix = p.suffix.lower()
    if suffix == ".py" or suffix in _JS_LIKE_EXTS:
        dotted = str(p.with_suffix(""))
    else:
        dotted = rel_path
    # Normalize path separators (Windows backslash or forward slash) to dots
    dotted = dotted.replace("\\", ".").replace("/", ".").strip(".")
    # Python __init__ and JS index both represent the directory, not a submodule
    if dotted.endswith(".__init__") or dotted == "__init__":
        dotted = dotted[: -len(".__init__")] or "root"
    elif dotted.endswith(".index") or dotted == "index":
        dotted = dotted[: -len(".index")] or "root"
    return f"module:{dotted}"


class _FileVisitor(ast.NodeVisitor):
    def __init__(self, graph: Graph, module_id: str, file_rel: str):
        self.graph = graph
        self.module_id = module_id
        self.file_rel = file_rel
        self.scope_stack = [module_id]
        self.local_names: Dict[str, str] = {}  # short name -> full id, scoped to this file

    def _scope(self) -> str:
        return self.scope_stack[-1]

    def visit_ClassDef(self, node: ast.ClassDef):
        parent_name = self._scope().split(":", 1)[1]
        class_id = f"class:{parent_name}.{node.name}"
        self.graph.add_node(Node(class_id, "class", node.name, self.file_rel, node.lineno))
        self.graph.add_edge(self._scope(), class_id, "contains")
        self.local_names[node.name] = class_id
        self.scope_stack.append(class_id)
        self.generic_visit(node)
        self.scope_stack.pop()

    def visit_FunctionDef(self, node):
        self._handle_function(node)

    def visit_AsyncFunctionDef(self, node):
        self._handle_function(node)

    def _handle_function(self, node):
        parent_scope = self._scope()
        parent_name = parent_scope.split(":", 1)[1]
        func_id = f"function:{parent_name}.{node.name}"
        end = getattr(node, "end_lineno", node.lineno)
        loc = (end - node.lineno + 1) if end else 1
        self.graph.add_node(Node(func_id, "function", node.name, self.file_rel, node.lineno, loc))
        self.graph.add_edge(parent_scope, func_id, "contains")
        self.local_names[node.name] = func_id
        self.scope_stack.append(func_id)
        self.generic_visit(node)
        self.scope_stack.pop()

    def visit_Call(self, node: ast.Call):
        callee = None
        if isinstance(node.func, ast.Name):
            callee = node.func.id
        elif isinstance(node.func, ast.Attribute):
            callee = node.func.attr
        if callee and self._scope().startswith(("function:", "class:")):
            if callee in self.local_names:
                self.graph.add_edge(self._scope(), self.local_names[callee], "calls")
            else:
                self.graph.pending_calls.append((self._scope(), callee))
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import):
        for alias in node.names:
            self.graph.pending_imports.append((self.module_id, alias.name))
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom):
        if node.module:
            self.graph.pending_imports.append((self.module_id, node.module))
        self.generic_visit(node)


def _file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def _parse_one_file(fpath: Path, rel: str, graph: Graph, lang: str,
                    js_analyzer) -> None:
    """Parse a single file and add its nodes/pending edges to graph (Pass 1)."""
    module_id = _module_id_for(rel)
    display_name = module_id.split(":")[-1].split(".")[-1]
    graph.add_node(Node(module_id, "module", display_name, rel, 1))

    if lang == "python":
        try:
            source = fpath.read_text(encoding="utf-8", errors="ignore")
            tree = ast.parse(source, filename=rel)
            _FileVisitor(graph, module_id, rel).visit(tree)
        except SyntaxError:
            pass
    elif js_analyzer:
        try:
            js_analyzer(fpath, rel, graph, lang)
        except Exception:
            pass


def _resolve_edges(graph: Graph) -> None:
    """
    Pass 2: resolve pending cross-file calls.
    Pass 3: resolve pending imports.
    Always runs on the full node set after all files are loaded.
    """
    # Pass 2 — call resolution
    global_function_index: Dict[str, List[str]] = {}
    for node in graph.nodes.values():
        if node.type == "function":
            global_function_index.setdefault(node.name, []).append(node.id)

    for caller_id, callee_name in graph.pending_calls:
        for target_id in global_function_index.get(callee_name, []):
            if target_id != caller_id:
                graph.add_edge(caller_id, target_id, "calls")

    # Pass 3 — import resolution
    module_ids_by_dotted: Dict[str, str] = {
        mid.split(":", 1)[1]: mid for mid in graph.nodes if mid.startswith("module:")
    }
    file_to_module: Dict[str, str] = {
        node.file: nid for nid, node in graph.nodes.items() if node.type == "module"
    }

    for module_id, imported in graph.pending_imports:
        match = None
        if imported.startswith("."):
            importer_node = graph.nodes.get(module_id)
            if importer_node:
                importer_dir = str(Path(importer_node.file).parent)
                try:
                    resolved = os.path.normpath(os.path.join(importer_dir, imported))
                    resolved_fwd = resolved.replace("\\", "/")
                    for fpath_key, mid in file_to_module.items():
                        fpath_fwd = fpath_key.replace("\\", "/")
                        fpath_stem = str(Path(fpath_key).with_suffix("")).replace("\\", "/")
                        if fpath_fwd == resolved_fwd or fpath_stem == resolved_fwd:
                            match = mid
                            break
                except (ValueError, OSError):
                    pass
        else:
            match = module_ids_by_dotted.get(imported)
            if not match:
                for dotted, mid in module_ids_by_dotted.items():
                    if dotted == imported or dotted.endswith("." + imported.split(".")[-1]):
                        match = mid
                        break
        if match and match != module_id:
            graph.add_edge(module_id, match, "imports")


def analyze_repo(root: Path) -> Graph:
    graph = Graph()
    root = Path(root)

    _js_analyzer = None
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]
        for fname in filenames:
            fpath = Path(dirpath) / fname
            lang = _EXT_TO_LANG.get(fpath.suffix.lower())
            if not lang:
                continue
            rel = str(fpath.relative_to(root))
            if lang != "python" and _js_analyzer is None:
                try:
                    from .analyzers.js_ts import analyze_js_file
                    _js_analyzer = analyze_js_file
                except ImportError:
                    _js_analyzer = False
            _parse_one_file(fpath, rel, graph, lang, _js_analyzer)

    _resolve_edges(graph)
    return graph


def analyze_repo_incremental(root: Path, old_cache: Dict[str, Dict]) -> Tuple[Graph, Dict[str, Dict]]:
    """
    Incremental re-analysis for Stage 10 CI loop.

    Skips re-parsing files whose content hash hasn't changed since the last
    run. Cross-file edge resolution (calls + imports) always runs on the full
    merged node set — it's cheap (in-memory dict lookups) and must see all
    nodes to correctly link callers to callees across file boundaries.

    Returns:
        graph      — the fully resolved graph (same schema as analyze_repo)
        new_cache  — {rel_path: cache_entry} to persist via store.set_file_cache()

    Cache entry keys: content_hash, nodes_json, edges_json,
                      pending_calls_json, pending_imports_json
    """
    graph = Graph()
    root = Path(root)
    new_cache: Dict[str, Dict] = {}
    reused = skipped = 0

    _js_analyzer = None

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]
        for fname in filenames:
            fpath = Path(dirpath) / fname
            lang = _EXT_TO_LANG.get(fpath.suffix.lower())
            if not lang:
                continue
            rel = str(fpath.relative_to(root))
            h = _file_hash(fpath)
            cached = old_cache.get(rel)

            if cached and cached.get("content_hash") == h:
                # Fast path: restore cached Pass-1 output
                for n in json.loads(cached["nodes_json"]):
                    graph.nodes[n["id"]] = Node(**n)
                for e in json.loads(cached["edges_json"]):
                    graph.edges.append(Edge(**e))
                graph.pending_calls.extend(json.loads(cached["pending_calls_json"]))
                graph.pending_imports.extend(json.loads(cached["pending_imports_json"]))
                new_cache[rel] = cached
                reused += 1
            else:
                # Slow path: re-parse the file
                if lang != "python" and _js_analyzer is None:
                    try:
                        from .analyzers.js_ts import analyze_js_file
                        _js_analyzer = analyze_js_file
                    except ImportError:
                        _js_analyzer = False

                nodes_before = set(graph.nodes)
                edges_before = len(graph.edges)
                calls_before = len(graph.pending_calls)
                imports_before = len(graph.pending_imports)

                _parse_one_file(fpath, rel, graph, lang, _js_analyzer)

                new_nodes = [
                    {"id": n.id, "type": n.type, "name": n.name,
                     "file": n.file, "lineno": n.lineno, "loc": n.loc}
                    for nid, n in graph.nodes.items() if nid not in nodes_before
                ]
                new_edges = [
                    {"source": e.source, "target": e.target, "type": e.type}
                    for e in graph.edges[edges_before:]
                ]
                new_cache[rel] = {
                    "content_hash": h,
                    "nodes_json":           json.dumps(new_nodes),
                    "edges_json":           json.dumps(new_edges),
                    "pending_calls_json":   json.dumps(graph.pending_calls[calls_before:]),
                    "pending_imports_json": json.dumps(graph.pending_imports[imports_before:]),
                }
                skipped += 1

    print(f"  [incr]   {reused} files reused from cache, {skipped} re-parsed")
    _resolve_edges(graph)
    return graph, new_cache
