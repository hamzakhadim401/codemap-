"""
Visual Codebase Mapping Platform - CLI entry point

Usage:
    python cli.py <repo_path_or_git_url> [options]

Examples:
    python cli.py samples/python_only --name "Sample App"
    python cli.py samples/python_only --trace
    python cli.py samples/python_only --trace-cmd "python tests/test_basic.py"
    python cli.py samples/python_and_js --name "Mixed Repo"
    python cli.py https://github.com/someorg/somerepo.git --confidential
"""
import argparse
import sys
import traceback
from pathlib import Path

from engine.ingest import ingest, cleanup, IngestError
from engine.analyzer import analyze_repo
from engine.graph_builder import to_json
from engine.visualize import render_html


def main():
    parser = argparse.ArgumentParser(description="Visual Codebase Mapping Platform")
    parser.add_argument("source", help="Local repo path or git URL")
    parser.add_argument("--output", default=None, help="Output HTML file path (default: outputs/<name>.html)")
    parser.add_argument(
        "--confidential", action="store_true",
        help="Process entirely in an ephemeral temp dir; nothing is persisted or logged verbatim",
    )
    parser.add_argument("--name", default=None, help="Display name for the repo")
    parser.add_argument(
        "--trace", action="store_true",
        help="Auto-detect test suite and run it under sys.settrace to capture real call frequencies",
    )
    parser.add_argument(
        "--trace-cmd", default=None, metavar="CMD",
        help="Explicit command to trace, e.g. 'pytest tests/' or 'python main.py'",
    )
    args = parser.parse_args()

    print(f"[1/4] Ingesting {args.source} {'(confidential mode)' if args.confidential else ''}")
    try:
        result = ingest(args.source, confidential=args.confidential)
    except IngestError as e:
        print(f"Ingestion failed: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        print("[2/4] Running static analysis...")
        graph = analyze_repo(result.working_dir)

        # Stage 3: optional runtime tracing
        trace_data = None
        if args.trace or args.trace_cmd:
            from engine.tracer import detect_test_cmd, run_with_trace, to_trace_json
            cmd = args.trace_cmd.split() if args.trace_cmd else detect_test_cmd(result.working_dir)
            if cmd:
                print(f"[2.5/4] Runtime tracing: {' '.join(cmd)}")
                raw = run_with_trace(result.working_dir, cmd, confidential=args.confidential)
                trace_data = to_trace_json(raw, graph)
                hit = len(trace_data.get("node_counts", {}))
                print(f"         {hit} functions reached at runtime")
            else:
                print("[2.5/4] No test suite detected -- skipping tracing. Use --trace-cmd to specify one.")

        print("[3/4] Building unified graph...")
        data = to_json(graph, trace=trace_data)

        print("[4/4] Rendering visualization...")
        repo_name = args.name or Path(args.source.rstrip("/")).name.replace(".git", "")
        if args.output:
            out_path = args.output
        else:
            out_dir = Path(__file__).parent / "outputs"
            out_dir.mkdir(exist_ok=True)
            safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in repo_name)
            out_path = str(out_dir / f"{safe_name}.html")
        render_html(data, repo_name, out_path, confidential=args.confidential)

        node_msg = f"{len(data['nodes'])} nodes, {len(data['edges'])} edges"
        trace_msg = f", {len(trace_data.get('node_counts', {}))} functions traced" if trace_data else ""
        print(f"\nDone -- {node_msg}{trace_msg}")
        print(f"Open {out_path} in a browser to explore it.")

    except Exception:
        print("Analysis failed:", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
    finally:
        cleanup(result)


if __name__ == "__main__":
    main()
