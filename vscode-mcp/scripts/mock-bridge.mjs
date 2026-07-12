#!/usr/bin/env node
/**
 * Mock VS Code MCP Bridge for offline smoke tests.
 * Mimics the extension HTTP API without a real editor.
 *
 *   node scripts/mock-bridge.mjs
 *   VSCODE_MCP_TOKEN=dev-token-123 node mcp-server/dist/index.js
 */
import http from 'node:http';

const HOST = process.env.VSCODE_MCP_HOST || '127.0.0.1';
const PORT = Number(process.env.VSCODE_MCP_PORT || '7331');
const TOKEN = process.env.VSCODE_MCP_TOKEN || 'dev-token-123';
const MAX_BODY = 8 * 1024 * 1024;

const state = {
  files: new Map([
    [
      '/tmp/hello-vscode-mcp.ts',
      {
        languageId: 'typescript',
        text: 'export function greet(name: string) {\n  return `hello ${name}`;\n}\n'
      }
    ],
    [
      '/tmp/workspace/app.ts',
      {
        languageId: 'typescript',
        text: 'const answer = 42;\nconsole.log(answer);\n'
      }
    ]
  ]),
  activePath: '/tmp/hello-vscode-mcp.ts',
  selection: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 }, text: '', isEmpty: true },
  messages: [],
  terminals: [{ name: 'bash', output: 'mock shell ready\n' }],
  shellHistory: []
};

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MCP-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(body);
}

function auth(req) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const x = (req.headers['x-mcp-token'] || '').trim();
  return bearer === TOKEN || x === TOKEN;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MCP-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const path = url.pathname;

  if (path === '/health' && req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      service: 'vscode-mcp-bridge',
      version: '0.1.4-mock',
      vscode: 'mock',
      workspace: 'mock-workspace',
      folderCount: 1,
      hasBrowserFrame: false,
      browserFrameAgeMs: null
    });
  }

  if (path === '/browser/frame/status' && req.method === 'GET') {
    return json(res, 200, { ok: true, hasFrame: false, ageMs: null, meta: null, path: null });
  }

  if (!auth(req)) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const bodyText = req.method === 'POST' ? await readBody(req) : '';
  const body = bodyText ? JSON.parse(bodyText) : {};

  if (path === '/status' && req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      vscode: 'mock',
      appName: 'Mock Grok Code',
      workspaceFolders: [{ name: 'mock', path: '/tmp' }],
      activeFile: state.activePath,
      activeLanguage: state.files.get(state.activePath)?.languageId ?? null,
      dirtyEditors: 0,
      browserOpen: false,
      activeBrowserTab: null,
      bridge: { host: HOST, port: PORT }
    });
  }

  if (path === '/workspace' && req.method === 'GET') {
    return json(res, 200, {
      name: 'mock-workspace',
      folders: [{ name: 'mock', path: '/tmp', index: 0 }]
    });
  }

  if (path === '/editors' && req.method === 'GET') {
    const doc = state.files.get(state.activePath);
    return json(res, 200, {
      active: {
        path: state.activePath,
        languageId: doc?.languageId,
        isDirty: false,
        lineCount: doc?.text.split('\n').length,
        cursor: state.selection.start,
        selection: state.selection
      },
      visible: [],
      tabCount: 1
    });
  }

  if (path === '/tabs' && req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      groupCount: 1,
      tabCount: 1,
      groups: [
        {
          isActive: true,
          viewColumn: 1,
          tabs: [
            {
              label: state.activePath.split('/').pop(),
              isActive: true,
              isDirty: false,
              kind: 'text',
              uri: `file://${state.activePath}`
            }
          ]
        }
      ],
      active: { label: state.activePath.split('/').pop(), isActive: true, kind: 'text' }
    });
  }

  if (path === '/browser' && req.method === 'GET') {
    return json(res, 200, { ok: true, open: false, count: 0, active: null, tabs: [], frame: null });
  }

  if (
    (path === '/browser/screenshot' && (req.method === 'GET' || req.method === 'POST')) ||
    (path === '/browser/frame' && req.method === 'POST')
  ) {
    return json(res, 200, {
      ok: true,
      source: 'mock',
      path: null,
      mime: 'image/png',
      bytes: 0,
      ageMs: 0,
      meta: {},
      imageBase64: '',
      note: 'mock has no real browser frame'
    });
  }

  if (path === '/selection' && req.method === 'GET') {
    return json(res, 200, {
      open: true,
      path: state.activePath,
      languageId: state.files.get(state.activePath)?.languageId,
      ...state.selection
    });
  }

  if (path === '/document' && req.method === 'GET') {
    const p = url.searchParams.get('path') || state.activePath;
    const doc = state.files.get(p);
    if (!doc) return json(res, 404, { error: 'not found' });
    return json(res, 200, {
      open: true,
      path: p,
      languageId: doc.languageId,
      lineCount: doc.text.split('\n').length,
      isDirty: false,
      eol: 'lf',
      text: doc.text
    });
  }

  if (path === '/diagnostics' && req.method === 'GET') {
    return json(res, 200, { count: 0, diagnostics: [] });
  }

  if (path === '/search-files' && req.method === 'GET') {
    const q = (url.searchParams.get('query') || '').toLowerCase();
    const files = [...state.files.keys()].filter((f) => f.toLowerCase().includes(q.replace(/\*/g, '')));
    return json(res, 200, { query: q, count: files.length, files });
  }

  if (
    (path === '/search-text' && req.method === 'GET') ||
    (path === '/search-text' && req.method === 'POST')
  ) {
    const query =
      (req.method === 'POST' ? body.query : url.searchParams.get('query')) || '';
    const caseSensitive =
      req.method === 'POST'
        ? !!body.caseSensitive
        : url.searchParams.get('caseSensitive') === '1';
    const needle = caseSensitive ? query : query.toLowerCase();
    const matches = [];
    for (const [filePath, doc] of state.files) {
      const lines = doc.text.split(/\r?\n/);
      lines.forEach((line, i) => {
        const hay = caseSensitive ? line : line.toLowerCase();
        const idx = hay.indexOf(needle);
        if (query && idx >= 0) {
          matches.push({
            path: filePath,
            line: i + 1,
            column: idx + 1,
            preview: line.trim().slice(0, 240)
          });
        }
      });
    }
    return json(res, 200, {
      ok: true,
      query,
      count: matches.length,
      matches,
      scannedFiles: state.files.size,
      truncated: false
    });
  }

  if (path === '/open' && req.method === 'POST') {
    if (!body.path) return json(res, 400, { error: 'path required' });
    if (!state.files.has(body.path)) {
      state.files.set(body.path, { languageId: 'plaintext', text: '' });
    }
    state.activePath = body.path;
    return json(res, 200, { ok: true, path: body.path, languageId: state.files.get(body.path).languageId });
  }

  if (path === '/insert' && req.method === 'POST') {
    const doc = state.files.get(state.activePath);
    doc.text += body.text ?? '';
    return json(res, 200, { ok: true, path: state.activePath });
  }

  if (path === '/replace-selection' && req.method === 'POST') {
    return json(res, 200, { ok: true, path: state.activePath, replacedRange: state.selection });
  }

  if (path === '/edit' && req.method === 'POST') {
    return json(res, 200, { ok: true, path: body.path, editCount: body.edits?.length ?? 0, saved: !!body.save });
  }

  if (path === '/save' && req.method === 'POST') {
    return json(res, 200, { ok: true, path: body.path || state.activePath });
  }

  if (path === '/command' && req.method === 'POST') {
    if (body.command === 'workbench.action.quit') {
      return json(res, 500, { error: 'Command blocked by bridge denylist: workbench.action.quit' });
    }
    return json(res, 200, { ok: true, command: body.command, result: null });
  }

  if (path === '/show-message' && req.method === 'POST') {
    state.messages.push(body);
    console.error(`[mock toast:${body.type || 'info'}] ${body.message}`);
    return json(res, 200, { ok: true });
  }

  if (path === '/reveal-line' && req.method === 'POST') {
    return json(res, 200, { ok: true, path: state.activePath, line: body.line, column: body.column ?? 1 });
  }

  if (path === '/notifications/clear' && req.method === 'POST') {
    return json(res, 200, { ok: true, ran: ['notifications.clearAll'] });
  }

  if (path === '/browser/open' && req.method === 'POST') {
    return json(res, 200, { ok: true, url: body.url, browser: { open: true, count: 1 } });
  }

  if (path === '/create-file' && req.method === 'POST') {
    const overwrite = body.overwrite !== false;
    if (!overwrite && state.files.has(body.path)) {
      return json(res, 500, { error: `File already exists: ${body.path}` });
    }
    state.files.set(body.path, { languageId: 'plaintext', text: body.content ?? '' });
    return json(res, 200, { ok: true, path: body.path });
  }

  if (path === '/delete-file' && req.method === 'POST') {
    state.files.delete(body.path);
    return json(res, 200, { ok: true, path: body.path, trash: body.trash !== false });
  }

  if (path === '/rename-file' && req.method === 'POST') {
    const doc = state.files.get(body.oldPath);
    if (doc) {
      state.files.delete(body.oldPath);
      state.files.set(body.newPath, doc);
    }
    return json(res, 200, { ok: true, oldPath: body.oldPath, newPath: body.newPath });
  }

  if (path === '/terminal/create' && req.method === 'POST') {
    const name = body.name || 'bash';
    if (!state.terminals.find((t) => t.name === name)) {
      state.terminals.push({ name, output: '' });
    }
    return json(res, 200, { ok: true, name });
  }

  if (path === '/terminal/send-text' && req.method === 'POST') {
    const name = body.name || state.terminals[0]?.name || 'bash';
    const t = state.terminals.find((x) => x.name === name) || state.terminals[0];
    if (t) {
      t.output += `\$ ${body.text || ''}\n`;
    }
    return json(res, 200, { ok: true, name });
  }

  if (path === '/terminal/list' && req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      count: state.terminals.length,
      terminals: state.terminals.map((t) => ({ name: t.name, state: {}, processId: 1234 }))
    });
  }

  if (path === '/terminal/close' && req.method === 'POST') {
    state.terminals = state.terminals.filter((t) => t.name !== body.name);
    return json(res, 200, { ok: true, name: body.name });
  }

  if (
    (path === '/terminal/output' && req.method === 'GET') ||
    (path === '/terminal/output' && req.method === 'POST')
  ) {
    const name =
      (req.method === 'POST' ? body.name : url.searchParams.get('name')) ||
      state.terminals[0]?.name;
    const t = state.terminals.find((x) => x.name === name) || state.terminals[0];
    const maxChars = Number(
      (req.method === 'POST' ? body.maxChars : url.searchParams.get('maxChars')) || 8000
    );
    const output = (t?.output || '').slice(-maxChars);
    if (req.method === 'POST' && body.clear && t) {
      t.output = '';
    }
    return json(res, 200, {
      ok: true,
      available: !!output,
      name: t?.name || name,
      output,
      length: output.length,
      totalBuffered: t?.output?.length || 0
    });
  }

  if (path === '/shell/exec' && req.method === 'POST') {
    const command = body.command || '';
    state.shellHistory.push(command);
    const t = state.terminals[0];
    if (t) {
      t.output += `$ ${command}\nmock-ok\n`;
    }
    return json(res, 200, {
      ok: true,
      command,
      cwd: body.cwd || '/tmp',
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: `mock-ok\n`,
      stderr: ''
    });
  }

  return json(res, 404, { error: 'Not found', path });
});

server.listen(PORT, HOST, () => {
  console.error(`[mock-bridge] http://${HOST}:${PORT}  token=${TOKEN}`);
});
