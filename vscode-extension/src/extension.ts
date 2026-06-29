/**
 * CodeMap Sync — VS Code Extension  (Stage 8)
 *
 * Bidirectional click-sync between VS Code and the CodeMap web graph:
 *
 *   Graph → Editor  (primary flow):
 *     Polls GET /sync every N ms. When seq changes, opens the file+line
 *     indicated by the server, placing the cursor there and decorating
 *     the line with an amber highlight.
 *
 *   Editor → Graph  (secondary flow):
 *     When the active editor changes, POSTs the current file path to
 *     POST /sync so the web graph highlights matching nodes.
 *
 * No WebSocket needed — the /sync endpoint is a lightweight state cell
 * maintained by the server. seq increments on every POST so the extension
 * detects changes without comparing full payloads.
 */

import * as vscode from "vscode";
import * as http from "http";
import * as https from "https";
import * as path from "path";

// ─── State ───────────────────────────────────────────────────────────────────

let _timer: NodeJS.Timeout | undefined;
let _lastSeq = -1;
let _decoration: vscode.TextEditorDecorationType | undefined;
let _statusBar: vscode.StatusBarItem | undefined;
let _connected = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cfg<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration("codemap").get<T>(key, fallback);
}

function baseUrl(): string {
  return cfg<string>("serverUrl", "http://localhost:8000").replace(/\/$/, "");
}

function fetchJson(method: string, urlStr: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === "https:" ? https : http;
    const payload = body ? JSON.stringify(body) : undefined;
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Decoration (amber line highlight) ───────────────────────────────────────

function ensureDecoration(): vscode.TextEditorDecorationType {
  if (!_decoration) {
    _decoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
      borderRadius: "2px",
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.findMatchForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
  }
  return _decoration;
}

function clearDecoration() {
  vscode.window.visibleTextEditors.forEach((e) =>
    e.setDecorations(ensureDecoration(), [])
  );
}

// ─── Graph → Editor ──────────────────────────────────────────────────────────

async function pollSync() {
  try {
    const state = await fetchJson("GET", `${baseUrl()}/sync`);
    if (!state || state.seq === _lastSeq) return;
    _lastSeq = state.seq;

    const { file, line } = state as { file?: string; line?: number };
    if (!file || !line) return;

    // Resolve the file path relative to workspace folders
    let uri: vscode.Uri | undefined;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const candidate = vscode.Uri.joinPath(folder.uri, file);
      try {
        await vscode.workspace.fs.stat(candidate);
        uri = candidate;
        break;
      } catch {
        // not found in this workspace folder, try next
      }
    }
    // Fall back to treating file as an absolute path
    if (!uri) {
      uri = vscode.Uri.file(file);
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, {
      preserveFocus: true,
      preview: true,
    });

    const lineIndex = Math.max(0, (line ?? 1) - 1);
    const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    editor.selection = new vscode.Selection(lineIndex, 0, lineIndex, 0);
    editor.setDecorations(ensureDecoration(), [
      {
        range: new vscode.Range(lineIndex, 0, lineIndex, Number.MAX_SAFE_INTEGER),
      },
    ]);

    updateStatus(`CodeMap: ${path.basename(file)}:${line}`);
  } catch {
    // Server unreachable — silently wait for reconnect
  }
}

// ─── Editor → Graph ──────────────────────────────────────────────────────────

async function pushEditorSelection(editor: vscode.TextEditor) {
  if (!_connected) return;
  try {
    const wsFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    const file = wsFolder
      ? path.relative(wsFolder.uri.fsPath, editor.document.uri.fsPath).replace(/\\/g, "/")
      : editor.document.uri.fsPath;

    const line = editor.selection.active.line + 1;
    await fetchJson("POST", `${baseUrl()}/sync`, { file, line });
  } catch {
    // ignore
  }
}

// ─── Status bar ──────────────────────────────────────────────────────────────

function updateStatus(text: string) {
  if (_statusBar) _statusBar.text = text;
}

function setConnected(on: boolean) {
  _connected = on;
  if (_statusBar) {
    _statusBar.text = on ? "$(graph) CodeMap: connected" : "$(graph) CodeMap: disconnected";
    _statusBar.tooltip = on
      ? "CodeMap is syncing with the graph. Click to disconnect."
      : "CodeMap is not connected. Click to connect.";
    _statusBar.command = on ? "codemap.disconnect" : "codemap.connect";
  }
}

// ─── Connect / Disconnect ─────────────────────────────────────────────────────

async function connect() {
  try {
    const health = await fetchJson("GET", `${baseUrl()}/health`);
    if (!health || health.status !== "ok") {
      vscode.window.showErrorMessage(
        `CodeMap: server at ${baseUrl()} returned unexpected response. Is the server running?`
      );
      return;
    }
  } catch {
    vscode.window.showErrorMessage(
      `CodeMap: cannot reach server at ${baseUrl()}. Run "python server.py" first.`
    );
    return;
  }

  _lastSeq = -1;
  setConnected(true);

  const interval = cfg<number>("pollIntervalMs", 1000);
  _timer = setInterval(pollSync, interval);

  vscode.window.showInformationMessage(
    `CodeMap: connected to ${baseUrl()}. Click a node in the graph to jump to it here.`
  );
}

function disconnect() {
  if (_timer) clearInterval(_timer);
  _timer = undefined;
  clearDecoration();
  setConnected(false);
}

// ─── Extension lifecycle ─────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  _statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  _statusBar.show();
  context.subscriptions.push(_statusBar);

  setConnected(false);

  context.subscriptions.push(
    vscode.commands.registerCommand("codemap.connect", connect),
    vscode.commands.registerCommand("codemap.disconnect", disconnect),
    vscode.commands.registerCommand("codemap.revealCurrent", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) await pushEditorSelection(editor);
    }),

    // Editor → Graph: push on cursor move / tab change
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) pushEditorSelection(editor);
    }),
    vscode.window.onDidChangeTextEditorSelection((ev) => {
      pushEditorSelection(ev.textEditor);
    }),
  );

  // Auto-connect if server is reachable at startup
  fetchJson("GET", `${baseUrl()}/health`)
    .then((h) => { if (h?.status === "ok") connect(); })
    .catch(() => { /* server not running yet — user can connect manually */ });
}

export function deactivate() {
  disconnect();
}
