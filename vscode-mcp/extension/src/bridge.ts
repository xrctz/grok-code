import * as http from 'http';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';

export interface BridgeOptions {
  host: string;
  port: number;
  token: string;
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

interface BrowserFrame {
  path: string;
  meta: Record<string, unknown>;
  ts: number;
  mime: string;
  source: string;
  bytes: number;
}

/**
 * Local HTTP bridge that exposes selected VS Code APIs to MCP clients.
 * Bound to localhost only; every mutating request requires the session token.
 */
/** Commands that must never be executed via the bridge. */
const COMMAND_DENYLIST = new Set([
  'workbench.action.quit',
  'workbench.action.closeWindow',
  'workbench.action.reloadWindow',
  'workbench.action.restartExtensionHost',
  'workbench.action.terminal.killAll',
  'vscode.openFolder',
  'workbench.action.files.revertFolder',
  'workbench.extensions.installExtension',
  'workbench.extensions.uninstallExtension',
  'workbench.action.openSettingsJson',
  'workbench.action.toggleDevTools'
]);

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8MB
const DEFAULT_BROWSER_FRAME_MAX_AGE_MS = 2500;

export class BridgeServer {
  private server: http.Server | undefined;
  private readonly options: BridgeOptions;
  /** Latest visual frame from the Browser / game page (for MCP vision). */
  private latestFrame: BrowserFrame | undefined;
  /** Best-effort ring buffers of terminal output keyed by terminal name. */
  private readonly terminalBuffers = new Map<string, string>();
  private terminalDataHooked = false;
  private static readonly TERMINAL_BUF_MAX = 64 * 1024;

  constructor(options: BridgeOptions) {
    this.options = options;
    this.hookTerminalData();
  }

  /** Track terminal writes when the proposed API is available. */
  private hookTerminalData(): void {
    if (this.terminalDataHooked) {
      return;
    }
    this.terminalDataHooked = true;
    try {
      const win = vscode.window as unknown as {
        onDidWriteTerminalData?: (
          listener: (e: { terminal: vscode.Terminal; data: string }) => void
        ) => vscode.Disposable;
      };
      if (typeof win.onDidWriteTerminalData === 'function') {
        win.onDidWriteTerminalData((e) => {
          const name = e.terminal.name || 'terminal';
          const prev = this.terminalBuffers.get(name) || '';
          let next = prev + e.data;
          if (next.length > BridgeServer.TERMINAL_BUF_MAX) {
            next = next.slice(-BridgeServer.TERMINAL_BUF_MAX);
          }
          this.terminalBuffers.set(name, next);
        });
      }
    } catch {
      /* proposed API unavailable — shell/exec still works */
    }
  }

  isListening(): boolean {
    return !!this.server?.listening;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handle(req, res);
      });
      this.server.once('error', reject);
      this.server.listen(this.options.port, this.options.host, () => resolve());
    });
  }

  stop(): void {
    this.server?.close();
    this.server = undefined;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS for local tooling
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-MCP-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${this.options.host}:${this.options.port}`);
    const pathname = url.pathname;

    // Health is public so clients can discover the bridge
    if (pathname === '/health' && req.method === 'GET') {
      return this.send(res, 200, {
        ok: true,
        service: 'grok-code',
        version: '0.1.5',
        product: 'Grok Code',
        vscode: vscode.version,
        workspace: vscode.workspace.name ?? null,
        folderCount: vscode.workspace.workspaceFolders?.length ?? 0,
        hasBrowserFrame: !!this.latestFrame,
        browserFrameAgeMs: this.latestFrame ? Date.now() - this.latestFrame.ts : null,
        terminalCapture: this.terminalBuffers.size > 0 || this.terminalDataHooked
      });
    }

    // Frame ingest requires token (local pages can read .vscode-mcp.env if needed).
    if (pathname === '/browser/frame' && req.method === 'POST') {
      if (!this.authorized(req)) {
        return this.send(res, 401, {
          error: 'Unauthorized. Pass Authorization: Bearer <token> or X-MCP-Token for frame ingest.'
        });
      }
      try {
        const body = await readBody(req, MAX_BODY_BYTES);
        const json = body ? safeJson(body) : undefined;
        return this.send(res, 200, await this.acceptBrowserFrame(json as FramePayload));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return this.send(res, 500, { error: message });
      }
    }

    if (pathname === '/browser/frame/status' && req.method === 'GET') {
      return this.send(res, 200, {
        ok: true,
        hasFrame: !!this.latestFrame,
        ageMs: this.latestFrame ? Date.now() - this.latestFrame.ts : null,
        meta: this.latestFrame?.meta ?? null,
        path: this.latestFrame?.path ?? null
      });
    }

    if (!this.authorized(req)) {
      return this.send(res, 401, { error: 'Unauthorized. Pass Authorization: Bearer <token> or X-MCP-Token.' });
    }

    try {
      const body =
        req.method === 'POST' || req.method === 'PUT' ? await readBody(req, MAX_BODY_BYTES) : undefined;
      const json = body ? safeJson(body) : undefined;

      switch (`${req.method} ${pathname}`) {
        case 'GET /status':
          return this.send(res, 200, await this.getStatus());
        case 'GET /workspace':
          return this.send(res, 200, this.getWorkspace());
        case 'GET /editors':
          return this.send(res, 200, this.getEditors());
        case 'GET /active-editor':
          return this.send(res, 200, this.getActiveEditor());
        case 'GET /selection':
          return this.send(res, 200, this.getSelection());
        case 'GET /document':
          return this.send(res, 200, await this.getDocument(url.searchParams.get('path') || undefined));
        case 'GET /document/lines':
          return this.send(
            res,
            200,
            await this.getDocumentLines({
              path: url.searchParams.get('path') || undefined,
              startLine: Number(url.searchParams.get('startLine') || '1'),
              endLine: url.searchParams.get('endLine')
                ? Number(url.searchParams.get('endLine'))
                : undefined
            })
          );
        case 'POST /document/lines':
          return this.send(
            res,
            200,
            await this.getDocumentLines(json as { path?: string; startLine?: number; endLine?: number })
          );
        case 'GET /diagnostics':
          return this.send(res, 200, this.getDiagnostics(url.searchParams.get('path') || undefined));
        case 'GET /search-files':
          return this.send(res, 200, await this.searchFiles(url.searchParams.get('query') || '**/*'));
        case 'GET /search-text':
          return this.send(
            res,
            200,
            await this.searchText({
              query: url.searchParams.get('query') || '',
              include: url.searchParams.get('include') || undefined,
              maxResults: Number(url.searchParams.get('maxResults') || '50'),
              caseSensitive: url.searchParams.get('caseSensitive') === '1'
            })
          );
        case 'POST /search-text':
          return this.send(res, 200, await this.searchText(json as SearchTextPayload));
        case 'GET /tabs':
          return this.send(res, 200, this.getTabs());
        case 'GET /browser':
          return this.send(res, 200, this.getBrowser());
        case 'GET /browser/screenshot':
          return this.send(res, 200, await this.getBrowserScreenshot(url.searchParams));
        case 'POST /open':
          return this.send(res, 200, await this.openFile(json as { path?: string; line?: number; column?: number }));
        case 'POST /insert':
          return this.send(res, 200, await this.insertText(json as { text?: string; path?: string }));
        case 'POST /replace-selection':
          return this.send(res, 200, await this.replaceSelection(json as { text?: string; path?: string }));
        case 'POST /edit':
          return this.send(res, 200, await this.applyEdit(json as EditPayload));
        case 'POST /save':
          return this.send(res, 200, await this.save(json as { path?: string; all?: boolean }));
        case 'POST /command':
          return this.send(res, 200, await this.runCommand(json as { command?: string; args?: unknown[] }));
        case 'POST /show-message':
          return this.send(res, 200, await this.showMessage(json as { message?: string; type?: string; toast?: boolean }));
        case 'POST /reveal-line':
          return this.send(res, 200, await this.revealLine(json as { path?: string; line?: number; column?: number }));
        case 'POST /browser/open':
          return this.send(res, 200, await this.openBrowser(json as { url?: string }));
        case 'POST /browser/screenshot':
          return this.send(
            res,
            200,
            await this.getBrowserScreenshot(
              undefined,
              json as { url?: string; force?: boolean; maxAgeMs?: number }
            )
          );
        case 'POST /notifications/clear':
          return this.send(res, 200, await this.clearNotifications());
        case 'POST /create-file':
          return this.send(res, 200, await this.createFile(json as { path?: string; content?: string; overwrite?: boolean }));
        case 'POST /delete-file':
          return this.send(res, 200, await this.deleteFile(json as { path?: string; recursive?: boolean; trash?: boolean }));
        case 'POST /rename-file':
          return this.send(res, 200, await this.renameFile(json as { oldPath?: string; newPath?: string; overwrite?: boolean }));
        case 'POST /terminal/create':
          return this.send(res, 200, await this.createTerminal(json as { name?: string; shellPath?: string; cwd?: string }));
        case 'POST /terminal/send-text':
          return this.send(res, 200, await this.sendTerminalText(json as { name?: string; text?: string; addNewLine?: boolean }));
        case 'GET /terminal/list':
          return this.send(res, 200, await this.listTerminals());
        case 'POST /terminal/close':
          return this.send(res, 200, await this.closeTerminal(json as { name?: string }));
        case 'GET /terminal/output':
          return this.send(
            res,
            200,
            await this.getTerminalOutput({
              name: url.searchParams.get('name') || undefined,
              maxChars: Number(url.searchParams.get('maxChars') || '8000')
            })
          );
        case 'POST /terminal/output':
          return this.send(res, 200, await this.getTerminalOutput(json as { name?: string; maxChars?: number; clear?: boolean }));
        case 'POST /shell/exec':
          return this.send(res, 200, await this.shellExec(json as ShellExecPayload));
        default:
          return this.send(res, 404, {
            error: 'Not found',
            endpoints: [
              'GET /health',
              'GET /status',
              'GET /workspace',
              'GET /editors',
              'GET /tabs',
              'GET /browser',
              'GET /browser/screenshot',
              'POST /browser/screenshot',
              'POST /browser/frame',
              'GET /browser/frame/status',
              'GET /active-editor',
              'GET /selection',
              'GET /document?path=',
              'GET|POST /document/lines',
              'GET /diagnostics?path=',
              'GET /search-files?query=',
              'GET|POST /search-text',
              'POST /open',
              'POST /insert',
              'POST /replace-selection',
              'POST /edit',
              'POST /save',
              'POST /command',
              'POST /show-message',
              'POST /reveal-line',
              'POST /browser/open',
              'POST /notifications/clear',
              'POST /create-file',
              'POST /delete-file',
              'POST /rename-file',
              'POST /terminal/create',
              'POST /terminal/send-text',
              'GET /terminal/list',
              'GET|POST /terminal/output',
              'POST /terminal/close',
              'POST /shell/exec'
            ]
          });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.send(res, 500, { error: message });
    }
  }

  private authorized(req: http.IncomingMessage): boolean {
    const header = req.headers['authorization'] || '';
    const bearer = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice(7).trim()
      : '';
    const xToken = (req.headers['x-mcp-token'] as string | undefined)?.trim() || '';
    const provided = bearer || xToken;
    return provided === this.options.token;
  }

  private send(res: http.ServerResponse, status: number, payload: Json): void {
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
  }

  private async getStatus(): Promise<Json> {
    const editor = vscode.window.activeTextEditor;
    const browser = this.getBrowser() as { open?: boolean; active?: { label?: string } | null };
    return {
      ok: true,
      vscode: vscode.version,
      appName: vscode.env.appName,
      language: vscode.env.language,
      remoteName: vscode.env.remoteName ?? null,
      shell: vscode.env.shell,
      workspaceFolders: (vscode.workspace.workspaceFolders || []).map((f) => ({
        name: f.name,
        path: f.uri.fsPath
      })),
      activeFile: editor?.document.uri.fsPath ?? null,
      activeLanguage: editor?.document.languageId ?? null,
      dirtyEditors: vscode.window.visibleTextEditors.filter((e) => e.document.isDirty).length,
      browserOpen: !!browser.open,
      activeBrowserTab: browser.active?.label ?? null,
      bridge: {
        host: this.options.host,
        port: this.options.port
      }
    };
  }

  /** All editor tabs including Browser / webviews (not just text editors). */
  private getTabs(): Json {
    const groups = vscode.window.tabGroups.all.map((g) => ({
      isActive: g.isActive,
      viewColumn: g.viewColumn,
      tabs: g.tabs.map((t) => serializeTab(t))
    }));
    const flat = groups.flatMap((g) => g.tabs);
    return {
      ok: true,
      groupCount: groups.length,
      tabCount: flat.length,
      groups,
      active: flat.find((t) => t.isActive) ?? null
    };
  }

  /** Built-in Grok Code / VS Code Browser tabs (workbench browser or Simple Browser). */
  private getBrowser(): Json {
    const tabs = vscode.window.tabGroups.all.flatMap((g) =>
      g.tabs.map((t) => serializeTab(t))
    );
    const browserTabs = tabs.filter(isBrowserTab);
    const active = browserTabs.find((t) => t.isActive) ?? browserTabs[0] ?? null;
    return {
      ok: true,
      open: browserTabs.length > 0,
      count: browserTabs.length,
      active,
      tabs: browserTabs,
      frame: this.latestFrame
        ? {
            path: this.latestFrame.path,
            ageMs: Date.now() - this.latestFrame.ts,
            source: this.latestFrame.source,
            meta: this.latestFrame.meta,
            bytes: this.latestFrame.bytes
          }
        : null,
      note:
        'Use GET /browser/screenshot for a live image (game posts canvas frames; Chrome headless is the fallback).'
    };
  }

  private frameDir(): string {
    const folders = vscode.workspace.workspaceFolders;
    const base = folders?.length
      ? path.join(folders[0].uri.fsPath, '.grok-browser')
      : path.join(os.homedir(), '.grok-code-app', 'browser-frames');
    fs.mkdirSync(base, { recursive: true });
    return base;
  }

  /** Accept a live canvas/DOM frame from the page running inside the Browser. */
  private async acceptBrowserFrame(payload: FramePayload): Promise<Json> {
    const dataUrl = (payload?.image || payload?.dataUrl || '').trim();
    if (!dataUrl) {
      throw new Error('image (data URL or base64) is required');
    }
    let mime = 'image/jpeg';
    let b64 = dataUrl;
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl);
    if (m) {
      mime = m[1];
      b64 = m[2];
    }
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 32) {
      throw new Error('image too small');
    }
    if (buf.length > 12_000_000) {
      throw new Error('image too large (max 12MB)');
    }
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const outPath = path.join(this.frameDir(), `live.${ext}`);
    fs.writeFileSync(outPath, buf);
    // also keep a timestamped copy for history (trim old)
    const stampPath = path.join(this.frameDir(), `frame-${Date.now()}.${ext}`);
    fs.writeFileSync(stampPath, buf);
    this.trimFrameHistory();

    this.latestFrame = {
      path: outPath,
      meta: {
        ...(payload?.meta && typeof payload.meta === 'object' ? payload.meta : {}),
        title: payload?.title ?? null,
        url: payload?.url ?? null
      },
      ts: Date.now(),
      mime,
      source: payload?.source || 'page-canvas',
      bytes: buf.length
    };
    return {
      ok: true,
      path: outPath,
      bytes: buf.length,
      mime,
      ageMs: 0
    };
  }

  private trimFrameHistory(): void {
    try {
      const dir = this.frameDir();
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith('frame-'))
        .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const old of files.slice(8)) {
        fs.unlinkSync(path.join(dir, old.f));
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Return the latest visual of the Browser contents.
   * Prefer live frames posted by the page; else Chrome headless screenshot of the URL.
   */
  private async getBrowserScreenshot(
    query?: URLSearchParams,
    body?: { url?: string; force?: boolean; maxAgeMs?: number }
  ): Promise<Json> {
    const force = body?.force === true || query?.get('force') === '1';
    const maxAge = normalizeBrowserFrameMaxAge(
      query?.get('maxAgeMs') ?? body?.maxAgeMs
    );
    const fresh =
      this.latestFrame && !force && Date.now() - this.latestFrame.ts <= maxAge;

    if (fresh && this.latestFrame && fs.existsSync(this.latestFrame.path)) {
      const b64 = fs.readFileSync(this.latestFrame.path).toString('base64');
      return {
        ok: true,
        source: this.latestFrame.source,
        path: this.latestFrame.path,
        mime: this.latestFrame.mime,
        bytes: this.latestFrame.bytes,
        ageMs: Date.now() - this.latestFrame.ts,
        maxAgeMs: maxAge,
        meta: this.latestFrame.meta,
        imageBase64: b64,
        browser: this.getBrowser()
      };
    }

    // Fallback: headless Chrome of the active browser URL / provided url
    const url =
      (body?.url || '').trim() ||
      query?.get('url') ||
      guessBrowserUrl(this.getBrowser() as { active?: { label?: string } | null }) ||
      'http://127.0.0.1:8765/';

    const shot = await captureUrlWithChrome(url, this.frameDir());
    this.latestFrame = {
      path: shot.path,
      meta: { url, note: 'chrome-headless fallback (may be a fresh page load)' },
      ts: Date.now(),
      mime: 'image/png',
      source: 'chrome-headless',
      bytes: shot.bytes
    };
    const b64 = fs.readFileSync(shot.path).toString('base64');
    return {
      ok: true,
      source: 'chrome-headless',
      path: shot.path,
      mime: 'image/png',
      bytes: shot.bytes,
      ageMs: 0,
      maxAgeMs: maxAge,
      meta: this.latestFrame.meta,
      imageBase64: b64,
      browser: this.getBrowser()
    };
  }

  private async openBrowser(payload: { url?: string }): Promise<Json> {
    const url = (payload?.url || '').trim();
    if (!url) {
      throw new Error('url is required (e.g. http://127.0.0.1:8765/)');
    }
    // Prefer the full workbench Browser (Grok Code browser tab), then Simple Browser.
    try {
      await vscode.commands.executeCommand('workbench.action.browser.open', url);
    } catch {
      await vscode.commands.executeCommand('simpleBrowser.show', url);
    }
    // Clear any toasts that would pause the browser overlay
    await this.clearNotifications();
    this.logActionToUI('open_browser', { url });
    return { ok: true, url, browser: this.getBrowser() };
  }

  private async clearNotifications(): Promise<Json> {
    const ran: string[] = [];
    for (const cmd of [
      'notifications.hideToasts',
      'notifications.clearAll',
      'notifications.hideList'
    ]) {
      try {
        await vscode.commands.executeCommand(cmd);
        ran.push(cmd);
      } catch {
        /* command may not exist on all builds */
      }
    }
    return { ok: true, ran };
  }

  private getWorkspace(): Json {
    return {
      name: vscode.workspace.name ?? null,
      folders: (vscode.workspace.workspaceFolders || []).map((f) => ({
        name: f.name,
        path: f.uri.fsPath,
        index: f.index
      }))
    };
  }

  private getEditors(): Json {
    return {
      active: serializeEditor(vscode.window.activeTextEditor),
      visible: vscode.window.visibleTextEditors.map(serializeEditor),
      tabCount: vscode.window.tabGroups.all.reduce((n, g) => n + g.tabs.length, 0)
    };
  }

  private getActiveEditor(): Json {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return { open: false };
    }
    const serialized = serializeEditor(editor) as Record<string, unknown>;
    return { open: true, ...serialized, textPreview: preview(editor.document.getText(), 2000) };
  }

  private getSelection(): Json {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return { open: false };
    }
    const sel = editor.selection;
    return {
      open: true,
      path: editor.document.uri.fsPath,
      languageId: editor.document.languageId,
      isEmpty: sel.isEmpty,
      text: editor.document.getText(sel),
      start: { line: sel.start.line + 1, column: sel.start.character + 1 },
      end: { line: sel.end.line + 1, column: sel.end.character + 1 }
    };
  }

  private async getDocument(filePath?: string): Promise<Json> {
    const doc = await resolveDocument(filePath);
    if (!doc) {
      return { open: false, error: 'No document' };
    }
    return {
      open: true,
      path: doc.uri.fsPath,
      languageId: doc.languageId,
      lineCount: doc.lineCount,
      isDirty: doc.isDirty,
      eol: doc.eol === vscode.EndOfLine.CRLF ? 'crlf' : 'lf',
      text: doc.getText()
    };
  }

  /**
   * Read a 1-based, inclusive line range of a document.
   * Cheaper than getDocument for large files — agents can page through a file
   * without paying the token cost of the whole thing.
   */
  private async getDocumentLines(payload: {
    path?: string;
    startLine?: number;
    endLine?: number;
  }): Promise<Json> {
    const doc = await resolveDocument(payload?.path);
    if (!doc) {
      return { open: false, error: 'No document' };
    }
    const total = doc.lineCount;
    const start = Math.min(Math.max(Math.floor(payload?.startLine ?? 1), 1), Math.max(total, 1));
    const requestedEnd = payload?.endLine ?? total;
    const end = Math.min(Math.max(Math.floor(requestedEnd), start), total);
    const range = new vscode.Range(
      new vscode.Position(start - 1, 0),
      new vscode.Position(end - 1, doc.lineAt(Math.max(end - 1, 0)).range.end.character)
    );
    return {
      ok: true,
      open: true,
      path: doc.uri.fsPath,
      languageId: doc.languageId,
      lineCount: total,
      startLine: start,
      endLine: end,
      eol: doc.eol === vscode.EndOfLine.CRLF ? 'crlf' : 'lf',
      text: doc.getText(range)
    };
  }

  private getDiagnostics(filePath?: string): Json {
    const all = vscode.languages.getDiagnostics();
    const items = all
      .filter(([uri]) => !filePath || pathsEqual(uri.fsPath, filePath))
      .flatMap(([uri, diags]) =>
        diags.map((d) => ({
          path: uri.fsPath,
          severity: severityName(d.severity),
          message: d.message,
          source: d.source ?? null,
          code: typeof d.code === 'object' ? d.code?.value : d.code ?? null,
          start: { line: d.range.start.line + 1, column: d.range.start.character + 1 },
          end: { line: d.range.end.line + 1, column: d.range.end.character + 1 }
        }))
      );
    return { count: items.length, diagnostics: items.slice(0, 200) };
  }

  private async searchFiles(query: string): Promise<Json> {
    const pattern = query.includes('*') || query.includes('?') || query.includes('{')
      ? query
      : `**/*${query}*`;
    const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 100);
    return {
      query: pattern,
      count: uris.length,
      files: uris.map((u) => u.fsPath)
    };
  }

  /** Content search across workspace files (coding-loop staple). */
  private async searchText(payload: SearchTextPayload): Promise<Json> {
    const query = (payload?.query || '').trim();
    if (!query) {
      throw new Error('query is required');
    }
    const maxResults = Math.min(Math.max(payload.maxResults ?? 50, 1), 200);
    const include =
      payload.include ||
      '**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,py,go,rs,java,cs,cpp,c,h,css,scss,html,yml,yaml,toml,sh,bash,zsh,txt}';
    const caseSensitive = !!payload.caseSensitive;
    const needle = caseSensitive ? query : query.toLowerCase();
    const exclude = payload.exclude || '**/node_modules/**';

    const uris = await vscode.workspace.findFiles(include, exclude, 300);
    const matches: Array<{
      path: string;
      line: number;
      column: number;
      preview: string;
    }> = [];

    for (const uri of uris) {
      if (matches.length >= maxResults) {
        break;
      }
      let text: string;
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        text = Buffer.from(bytes).toString('utf8');
      } catch {
        continue;
      }
      // Skip huge / binary-ish files
      if (text.length > 1_500_000 || text.includes('\0')) {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= maxResults) {
          break;
        }
        const line = lines[i];
        const hay = caseSensitive ? line : line.toLowerCase();
        const idx = hay.indexOf(needle);
        if (idx >= 0) {
          matches.push({
            path: uri.fsPath,
            line: i + 1,
            column: idx + 1,
            preview: line.trim().slice(0, 240)
          });
        }
      }
    }

    return {
      ok: true,
      query,
      include,
      caseSensitive,
      scannedFiles: uris.length,
      count: matches.length,
      matches,
      truncated: matches.length >= maxResults
    };
  }

  private async openFile(payload: { path?: string; line?: number; column?: number }): Promise<Json> {
    if (!payload?.path) {
      throw new Error('path is required');
    }
    const uri = toUri(payload.path);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    if (payload.line && payload.line > 0) {
      const line = Math.max(0, payload.line - 1);
      const col = Math.max(0, (payload.column ?? 1) - 1);
      const pos = new vscode.Position(line, col);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
    this.logActionToUI('open_file', { path: doc.uri.fsPath, line: payload.line || 1 });
    return { ok: true, path: doc.uri.fsPath, languageId: doc.languageId };
  }

  private async insertText(payload: { text?: string; path?: string }): Promise<Json> {
    if (payload?.text == null) {
      throw new Error('text is required');
    }
    const editor = await ensureEditor(payload.path);
    const pos = editor.selection.active;
    const ok = await editor.edit((b) => b.insert(pos, payload.text!));
    this.logActionToUI('insert_text', { path: editor.document.uri.fsPath, length: payload.text.length });
    return { ok, path: editor.document.uri.fsPath, at: { line: pos.line + 1, column: pos.character + 1 } };
  }

  private async replaceSelection(payload: { text?: string; path?: string }): Promise<Json> {
    if (payload?.text == null) {
      throw new Error('text is required');
    }
    const editor = await ensureEditor(payload.path);
    const sel = editor.selection;
    const ok = await editor.edit((b) => b.replace(sel, payload.text!));
    this.logActionToUI('replace_selection', { path: editor.document.uri.fsPath, length: payload.text.length });
    return {
      ok,
      path: editor.document.uri.fsPath,
      replacedRange: {
        start: { line: sel.start.line + 1, column: sel.start.character + 1 },
        end: { line: sel.end.line + 1, column: sel.end.character + 1 }
      }
    };
  }

  private async applyEdit(payload: EditPayload): Promise<Json> {
    if (!payload?.path || !payload.edits?.length) {
      throw new Error('path and edits[] are required');
    }
    const uri = toUri(payload.path);
    const doc = await vscode.workspace.openTextDocument(uri);
    const we = new vscode.WorkspaceEdit();
    for (const e of payload.edits) {
      const start = new vscode.Position(Math.max(0, (e.startLine ?? 1) - 1), Math.max(0, (e.startColumn ?? 1) - 1));
      const end = new vscode.Position(
        Math.max(0, (e.endLine ?? e.startLine ?? 1) - 1),
        Math.max(0, (e.endColumn ?? e.startColumn ?? 1) - 1)
      );
      we.replace(uri, new vscode.Range(start, end), e.newText ?? '');
    }
    const ok = await vscode.workspace.applyEdit(we);
    if (payload.save) {
      await doc.save();
    }
    this.logActionToUI('edit_file', { path: uri.fsPath, editsCount: payload.edits.length });
    return { ok, path: uri.fsPath, editCount: payload.edits.length, saved: !!payload.save && !doc.isDirty };
  }

  private async save(payload: { path?: string; all?: boolean }): Promise<Json> {
    if (payload?.all) {
      await vscode.workspace.saveAll(false);
      this.logActionToUI('save_file', { path: 'all' });
      return { ok: true, saved: 'all' };
    }
    const doc = await resolveDocument(payload?.path);
    if (!doc) {
      throw new Error('No document to save');
    }
    const ok = await doc.save();
    this.logActionToUI('save_file', { path: doc.uri.fsPath });
    return { ok, path: doc.uri.fsPath };
  }

  private async runCommand(payload: { command?: string; args?: unknown[] }): Promise<Json> {
    if (!payload?.command) {
      throw new Error('command is required');
    }
    const cmd = payload.command.trim();
    if (COMMAND_DENYLIST.has(cmd)) {
      throw new Error(`Command blocked by bridge denylist: ${cmd}`);
    }
    // Block extension host shell escapes and remote dangerous patterns
    if (/^workbench\.action\.terminal\.sendSequence$/i.test(cmd) && payload.args?.length) {
      const seq = JSON.stringify(payload.args);
      if (/rm\s+-rf\s+[\/~]|mkfs|dd\s+if=/i.test(seq)) {
        throw new Error('Command arguments blocked by safety filter');
      }
    }
    const result = await vscode.commands.executeCommand(cmd, ...(payload.args ?? []));
    this.logActionToUI('run_command', { command: cmd });
    return { ok: true, command: cmd, result: serializeResult(result) };
  }

  /**
   * Surface a short status without pausing the Grok Code browser.
   * Info messages go to the status bar by default (toasts pause Browser with
   * "Paused due to Notification"). Pass toast:true only when a modal toast is required.
   */
  private async showMessage(payload: {
    message?: string;
    type?: string;
    toast?: boolean;
  }): Promise<Json> {
    if (!payload?.message) {
      throw new Error('message is required');
    }
    const type = (payload.type || 'info').toLowerCase();
    const wantToast =
      payload.toast === true || (payload.toast !== false && type === 'error');

    // Always mirror to status bar (never blocks, never pauses browser)
    vscode.window.setStatusBarMessage(`$(sparkle) ${payload.message}`, 8000);

    if (wantToast) {
      // Fire-and-forget — do not await (awaiting holds the toast open and freezes browser)
      if (type === 'error') {
        void vscode.window.showErrorMessage(payload.message);
      } else if (type === 'warning' || type === 'warn') {
        void vscode.window.showWarningMessage(payload.message);
      } else {
        void vscode.window.showInformationMessage(payload.message);
      }
      // Immediately try to clear so Browser does not stay paused
      setTimeout(() => {
        void this.clearNotifications();
      }, 50);
    }
    this.logActionToUI('show_message', { message: payload.message, type });

    return { ok: true, toast: wantToast, via: wantToast ? 'status+toast' : 'status-bar' };
  }

  private async revealLine(payload: { path?: string; line?: number; column?: number }): Promise<Json> {
    if (!payload?.line) {
      throw new Error('line is required');
    }
    if (payload.path) {
      await this.openFile(payload);
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error('No active editor');
    }
    const line = Math.max(0, payload.line - 1);
    const col = Math.max(0, (payload.column ?? 1) - 1);
    const pos = new vscode.Position(Math.min(line, editor.document.lineCount - 1), col);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    return { ok: true, path: editor.document.uri.fsPath, line: pos.line + 1, column: pos.character + 1 };
  }

  private async createFile(payload: { path?: string; content?: string; overwrite?: boolean }): Promise<Json> {
    if (!payload?.path) {
      throw new Error('path is required');
    }
    const uri = toUri(payload.path);
    const overwrite = payload.overwrite !== false;

    if (!overwrite) {
      try {
        await vscode.workspace.fs.stat(uri);
        // Exists → refuse when overwrite is false
        throw new Error(`File already exists: ${payload.path}`);
      } catch (err) {
        if (err instanceof Error && /already exists/i.test(err.message)) {
          throw err;
        }
        // FileNotFoundError / missing file → OK to create
        const code = (err as { code?: string })?.code;
        if (code && code !== 'FileNotFound' && code !== 'ENOENT') {
          // Unknown fs error — rethrow unless it's a plain "not found" style Error
          const msg = err instanceof Error ? err.message : String(err);
          if (!/not\s*found|enoent|does not exist/i.test(msg)) {
            throw err instanceof Error ? err : new Error(msg);
          }
        }
      }
    }

    const contentBuffer = Buffer.from(payload.content ?? '', 'utf8');
    // Prefer fs.writeFile which creates parents via WorkspaceEdit createFile first
    const we = new vscode.WorkspaceEdit();
    we.createFile(uri, { overwrite, ignoreIfExists: !overwrite });
    const created = await vscode.workspace.applyEdit(we);
    if (!created && !overwrite) {
      throw new Error(`Could not create file (may already exist): ${uri.fsPath}`);
    }
    await vscode.workspace.fs.writeFile(uri, contentBuffer);
    this.logActionToUI('create_file', { path: uri.fsPath });
    return { ok: true, path: uri.fsPath };
  }

  private async deleteFile(payload: { path?: string; recursive?: boolean; trash?: boolean }): Promise<Json> {
    if (!payload?.path) {
      throw new Error('path is required');
    }
    const uri = toUri(payload.path);
    const recursive = !!payload.recursive;
    // Default to trash for safety (MCP tool docs say trash defaults true)
    const useTrash = payload.trash !== false;

    try {
      await vscode.workspace.fs.delete(uri, { recursive, useTrash });
      this.logActionToUI('delete_file', { path: uri.fsPath, trash: useTrash });
      return { ok: true, path: uri.fsPath, trash: useTrash };
    } catch (err) {
      // Fallback to WorkspaceEdit if fs.delete fails
      const we = new vscode.WorkspaceEdit();
      we.deleteFile(uri, { recursive, ignoreIfNotExists: true });
      const ok = await vscode.workspace.applyEdit(we);
      this.logActionToUI('delete_file', { path: uri.fsPath, trash: false, fallback: true });
      if (!ok) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`delete failed: ${message}`);
      }
      return { ok: true, path: uri.fsPath, trash: false, fallback: true };
    }
  }

  private async renameFile(payload: { oldPath?: string; newPath?: string; overwrite?: boolean }): Promise<Json> {
    if (!payload?.oldPath || !payload?.newPath) {
      throw new Error('oldPath and newPath are required');
    }
    const oldUri = toUri(payload.oldPath);
    const newUri = toUri(payload.newPath);
    const overwrite = !!payload.overwrite;

    const we = new vscode.WorkspaceEdit();
    we.renameFile(oldUri, newUri, { overwrite, ignoreIfExists: !overwrite });
    const ok = await vscode.workspace.applyEdit(we);
    this.logActionToUI('rename_file', { oldPath: oldUri.fsPath, newPath: newUri.fsPath });
    return { ok, oldPath: oldUri.fsPath, newPath: newUri.fsPath };
  }

  private async createTerminal(payload: { name?: string; shellPath?: string; cwd?: string }): Promise<Json> {
    const opts: vscode.TerminalOptions = {};
    if (payload.name) opts.name = payload.name;
    if (payload.shellPath) opts.shellPath = payload.shellPath;
    if (payload.cwd) opts.cwd = payload.cwd;

    const terminal = vscode.window.createTerminal(opts);
    terminal.show();
    this.logActionToUI('create_terminal', { name: terminal.name });
    return { ok: true, name: terminal.name };
  }

  private async sendTerminalText(payload: { name?: string; text?: string; addNewLine?: boolean }): Promise<Json> {
    if (payload.text == null) {
      throw new Error('text is required');
    }
    const name = payload.name;
    let terminal: vscode.Terminal | undefined;

    if (name) {
      terminal = vscode.window.terminals.find((t) => t.name === name);
      if (!terminal) {
        throw new Error(`Terminal with name "${name}" not found`);
      }
    } else {
      terminal = vscode.window.activeTerminal || (vscode.window.terminals.length > 0 ? vscode.window.terminals[0] : undefined);
      if (!terminal) {
        terminal = vscode.window.createTerminal();
      }
    }

    terminal.show();
    terminal.sendText(payload.text, payload.addNewLine !== false);
    this.logActionToUI('terminal_command', { name: terminal.name, command: payload.text });
    return { ok: true, name: terminal.name };
  }

  private async listTerminals(): Promise<Json> {
    const list = [];
    for (const t of vscode.window.terminals) {
      const pid = await t.processId;
      list.push({
        name: t.name,
        state: t.state,
        processId: pid
      });
    }
    return { ok: true, count: list.length, terminals: list };
  }

  private async closeTerminal(payload: { name?: string }): Promise<Json> {
    const name = payload.name;
    if (!name) {
      throw new Error('name is required');
    }
    const terminal = vscode.window.terminals.find((t) => t.name === name);
    if (!terminal) {
      throw new Error(`Terminal with name "${name}" not found`);
    }
    terminal.dispose();
    this.terminalBuffers.delete(name);
    this.logActionToUI('close_terminal', { name });
    return { ok: true, name };
  }

  private async getTerminalOutput(payload: {
    name?: string;
    maxChars?: number;
    clear?: boolean;
  }): Promise<Json> {
    const maxChars = Math.min(Math.max(payload?.maxChars ?? 8000, 100), BridgeServer.TERMINAL_BUF_MAX);
    let name = payload?.name;
    if (!name) {
      name = vscode.window.activeTerminal?.name || vscode.window.terminals[0]?.name;
    }
    if (!name) {
      return {
        ok: true,
        available: false,
        note: 'No terminals open. Use terminal/create or shell/exec.',
        output: '',
        length: 0
      };
    }
    const buf = this.terminalBuffers.get(name) || '';
    const output = buf.slice(-maxChars);
    if (payload?.clear) {
      this.terminalBuffers.set(name, '');
    }
    return {
      ok: true,
      available: buf.length > 0,
      name,
      output,
      length: output.length,
      totalBuffered: buf.length,
      note:
        buf.length === 0
          ? 'No captured output yet. Shell integration / onDidWriteTerminalData may be unavailable — use shell/exec for reliable stdout.'
          : undefined
    };
  }

  /**
   * Run a shell command with captured stdout/stderr/exit code.
   * Preferred for agent coding loops over blind terminal send-text.
   */
  private async shellExec(payload: ShellExecPayload): Promise<Json> {
    const command = (payload?.command || '').trim();
    if (!command) {
      throw new Error('command is required');
    }
    if (command.length > 8000) {
      throw new Error('command too long');
    }
    // Light safety filter — not a full sandbox
    if (/\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$|\bmkfs\b|\bdd\s+if=|\b:(){:|:&};:/.test(command)) {
      throw new Error('command blocked by safety filter');
    }

    const folders = vscode.workspace.workspaceFolders;
    const defaultCwd = folders?.[0]?.uri.fsPath || os.homedir();
    const cwd = payload.cwd ? path.resolve(payload.cwd) : defaultCwd;
    const timeoutMs = Math.min(Math.max(payload.timeoutMs ?? 60_000, 1000), 300_000);
    const shell = payload.shell || process.env.SHELL || '/bin/bash';

    // Optionally mirror into the integrated terminal so the user sees it
    if (payload.showInTerminal !== false) {
      try {
        let term =
          (payload.terminalName
            ? vscode.window.terminals.find((t) => t.name === payload.terminalName)
            : undefined) ||
          vscode.window.activeTerminal ||
          vscode.window.terminals[0];
        if (!term) {
          term = vscode.window.createTerminal({ name: payload.terminalName || 'Grok Shell', cwd });
        }
        term.show(true);
        term.sendText(command, true);
      } catch {
        /* ignore UI mirror failures */
      }
    }

    const result = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number | null;
      signal: string | null;
      timedOut: boolean;
    }>((resolve) => {
      const child = spawn(shell, ['-lc', command], {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const maxOut = 200_000;
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString('utf8');
        if (stdout.length > maxOut) {
          stdout = stdout.slice(-maxOut);
        }
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf8');
        if (stderr.length > maxOut) {
          stderr = stderr.slice(-maxOut);
        }
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr: stderr + (err.message || String(err)),
          exitCode: null,
          signal: null,
          timedOut
        });
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: code,
          signal: signal || null,
          timedOut
        });
      });
    });

    // Also stash into terminal buffer under a virtual name for getTerminalOutput
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (combined) {
      const key = payload.terminalName || 'Grok Shell';
      const prev = this.terminalBuffers.get(key) || '';
      let next = prev + combined + '\n';
      if (next.length > BridgeServer.TERMINAL_BUF_MAX) {
        next = next.slice(-BridgeServer.TERMINAL_BUF_MAX);
      }
      this.terminalBuffers.set(key, next);
    }

    this.logActionToUI('shell_exec', {
      command: command.slice(0, 120),
      exitCode: result.exitCode,
      timedOut: result.timedOut
    });

    return {
      ok: result.exitCode === 0 && !result.timedOut,
      command,
      cwd,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      stdout: result.stdout.slice(-100_000),
      stderr: result.stderr.slice(-50_000)
    };
  }

  private logActionToUI(action: string, details: Record<string, unknown>): void {
    try {
      void vscode.commands.executeCommand('grokCode.logAction', { action, ...details });
    } catch {
      // UI extension is not present or not active
    }
  }
}

interface EditPayload {
  path?: string;
  save?: boolean;
  edits?: Array<{
    startLine?: number;
    startColumn?: number;
    endLine?: number;
    endColumn?: number;
    newText?: string;
  }>;
}

interface SearchTextPayload {
  query?: string;
  include?: string;
  exclude?: string;
  maxResults?: number;
  caseSensitive?: boolean;
}

interface ShellExecPayload {
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  shell?: string;
  showInTerminal?: boolean;
  terminalName?: string;
}

interface FramePayload {
  image?: string;
  dataUrl?: string;
  meta?: Record<string, unknown>;
  title?: string;
  url?: string;
  source?: string;
}

function normalizeBrowserFrameMaxAge(value: unknown): number {
  if (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return DEFAULT_BROWSER_FRAME_MAX_AGE_MS;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_BROWSER_FRAME_MAX_AGE_MS;
}

function guessBrowserUrl(browser: { active?: { label?: string } | null }): string | null {
  const label = browser?.active?.label || '';
  if (/^\d+\.\d+\.\d+\.\d+:\d+/.test(label) || /^localhost:\d+/i.test(label)) {
    return `http://${label}/`;
  }
  if (/127\.0\.0\.1:\d+/.test(label)) {
    const m = label.match(/127\.0\.0\.1:\d+/);
    return m ? `http://${m[0]}/` : null;
  }
  if (/night of the|zombie game/i.test(label)) {
    return 'http://127.0.0.1:8765/';
  }
  return null;
}

function captureUrlWithChrome(
  url: string,
  dir: string
): Promise<{ path: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const outPath = path.join(dir, 'chrome-fallback.png');
    const chrome =
      process.env.CHROME_PATH ||
      ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find((p) =>
        fs.existsSync(p)
      );
    if (!chrome) {
      reject(new Error('Chrome/Chromium not found for headless screenshot fallback'));
      return;
    }
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1280,720',
      `--screenshot=${outPath}`,
      url
    ];
    const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('chrome screenshot timeout'));
    }, 20000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!fs.existsSync(outPath)) {
        reject(new Error(`chrome screenshot failed (code ${code}): ${err.slice(0, 400)}`));
        return;
      }
      const st = fs.statSync(outPath);
      resolve({ path: outPath, bytes: st.size });
    });
  });
}

function readBody(req: http.IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      total += buf.length;
      if (total > maxBytes) {
        reject(new Error(`Request body too large (max ${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeJson(body: string): unknown {
  if (!body.trim()) {
    return {};
  }
  return JSON.parse(body);
}

function serializeEditor(editor: vscode.TextEditor | undefined): Json {
  if (!editor) {
    return null;
  }
  const sel = editor.selection;
  return {
    path: editor.document.uri.fsPath,
    languageId: editor.document.languageId,
    isDirty: editor.document.isDirty,
    lineCount: editor.document.lineCount,
    cursor: { line: sel.active.line + 1, column: sel.active.character + 1 },
    selection: {
      isEmpty: sel.isEmpty,
      start: { line: sel.start.line + 1, column: sel.start.character + 1 },
      end: { line: sel.end.line + 1, column: sel.end.character + 1 }
    }
  };
}

function serializeTab(tab: vscode.Tab): {
  label: string;
  isActive: boolean;
  isDirty: boolean;
  isPinned: boolean;
  isPreview: boolean;
  inputType: string;
  kind: string;
  uri: string | null;
} {
  const input = tab.input as { uri?: vscode.Uri; viewType?: string } | undefined;
  const inputType = tab.input ? tab.input.constructor?.name || typeof tab.input : 'none';
  let uri: string | null = null;
  try {
    if (input && typeof input === 'object' && input.uri) {
      uri = input.uri.toString(true);
    }
  } catch {
    uri = null;
  }
  const kind = classifyTabKind(tab.label, inputType, uri);
  return {
    label: tab.label,
    isActive: tab.isActive,
    isDirty: tab.isDirty,
    isPinned: tab.isPinned,
    isPreview: tab.isPreview,
    inputType,
    kind,
    uri
  };
}

function classifyTabKind(label: string, inputType: string, uri: string | null): string {
  const blob = `${label} ${inputType} ${uri || ''}`.toLowerCase();
  if (
    blob.includes('browser') ||
    blob.includes('simplebrowser') ||
    /https?:\/\//.test(blob) ||
    blob.includes('127.0.0.1') ||
    blob.includes('localhost') ||
    /:\d{2,5}\b/.test(label) || // host:port page titles
    /night of the|zombie game/i.test(label)
  ) {
    return 'browser';
  }
  if (blob.includes('webview')) {
    return 'webview';
  }
  if (blob.includes('terminal')) {
    return 'terminal';
  }
  // Minified TabInput constructors often appear as "_m" / short names for Browser
  if (
    inputType &&
    !/tabinputtext|textdiff|notebook|terminal/i.test(inputType) &&
    (inputType.length <= 3 || inputType.startsWith('_'))
  ) {
    // Heuristic: non-text custom editors opened as tabs with page-like titles
    if (/[—–|-].+|about:|view-source:/.test(label)) {
      return 'browser';
    }
  }
  if (blob.includes('tabinputtext') || /\.([a-z0-9]{1,5})$/i.test(label)) {
    return 'text';
  }
  return 'other';
}

function isBrowserTab(tab: {
  label: string;
  inputType: string;
  kind: string;
  uri: string | null;
}): boolean {
  if (tab.kind === 'browser') {
    return true;
  }
  const blob = `${tab.label} ${tab.inputType} ${tab.uri || ''}`.toLowerCase();
  return (
    blob.includes('browser') ||
    blob.includes('simple browser') ||
    /https?:\/\//.test(blob) ||
    /127\.0\.0\.1|localhost/.test(blob) ||
    /:\d{2,5}\b/.test(tab.label) ||
    /night of the|zombie game/i.test(tab.label)
  );
}

function preview(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max) + `\n… (${text.length - max} more chars)`;
}

function severityName(s: vscode.DiagnosticSeverity): string {
  switch (s) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'info';
    case vscode.DiagnosticSeverity.Hint:
      return 'hint';
    default:
      return 'unknown';
  }
}

function toUri(filePath: string): vscode.Uri {
  if (filePath.startsWith('file:')) {
    return vscode.Uri.parse(filePath);
  }
  if (path.isAbsolute(filePath)) {
    return vscode.Uri.file(filePath);
  }
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length) {
    return vscode.Uri.joinPath(folders[0].uri, filePath);
  }
  return vscode.Uri.file(path.resolve(filePath));
}

function pathsEqual(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

async function resolveDocument(filePath?: string): Promise<vscode.TextDocument | undefined> {
  if (filePath) {
    const uri = toUri(filePath);
    const open = vscode.workspace.textDocuments.find((d) => pathsEqual(d.uri.fsPath, uri.fsPath));
    if (open) {
      return open;
    }
    return vscode.workspace.openTextDocument(uri);
  }
  return vscode.window.activeTextEditor?.document;
}

async function ensureEditor(filePath?: string): Promise<vscode.TextEditor> {
  if (filePath) {
    const uri = toUri(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    return vscode.window.showTextDocument(doc, { preview: false });
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error('No active editor. Open a file first or pass path.');
  }
  return editor;
}

function serializeResult(result: unknown): unknown {
  if (result == null) {
    return null;
  }
  if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
    return result;
  }
  try {
    return JSON.parse(JSON.stringify(result));
  } catch {
    return String(result);
  }
}
