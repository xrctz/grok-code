import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BridgeConfig {
  host: string;
  port: number;
  token: string;
  baseUrl: string;
}

/**
 * Resolve bridge connection settings from env, optional .vscode-mcp.env, or defaults.
 */
export function loadBridgeConfig(cwd = process.cwd()): BridgeConfig {
  // Load .vscode-mcp.env from cwd or parents (written by the extension)
  loadDotEnv(findEnvFile(cwd));

  const host = process.env.VSCODE_MCP_HOST || '127.0.0.1';
  const port = Number(process.env.VSCODE_MCP_PORT || '7331');
  const token = process.env.VSCODE_MCP_TOKEN || '';
  const baseUrl = process.env.VSCODE_MCP_URL || `http://${host}:${port}`;

  return { host, port, token, baseUrl };
}

function findEnvFile(start: string): string | undefined {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, '.vscode-mcp.env');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  // Durable locations written by the bridge (even with no workspace folder)
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    for (const candidate of [
      path.join(home, '.grok-code-app', '.vscode-mcp.env'),
      path.join(home, '.vscode-mcp.env')
    ]) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function loadDotEnv(file?: string): void {
  if (!file || !fs.existsSync(file)) {
    return;
  }
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export class BridgeClient {
  constructor(private readonly config: BridgeConfig) {}

  get settings(): BridgeConfig {
    return this.config;
  }

  async health(): Promise<unknown> {
    return this.request('GET', '/health', undefined, false);
  }

  async get(pathname: string, query?: Record<string, string | undefined>): Promise<unknown> {
    const qs = new URLSearchParams();
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v != null && v !== '') {
          qs.set(k, v);
        }
      }
    }
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.request('GET', `${pathname}${suffix}`);
  }

  async post(pathname: string, body?: unknown): Promise<unknown> {
    return this.request('POST', pathname, body);
  }

  private async request(
    method: string,
    pathname: string,
    body?: unknown,
    auth = true
  ): Promise<unknown> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${pathname}`;
    const headers: Record<string, string> = {
      Accept: 'application/json'
    };
    if (auth) {
      if (!this.config.token) {
        throw new Error(
          'VSCODE_MCP_TOKEN is not set. Start Grok Code with the bridge extension (it writes .vscode-mcp.env) or export the token.'
        );
      }
      headers.Authorization = `Bearer ${this.config.token}`;
      headers['X-MCP-Token'] = this.config.token;
    }
    let payload: string | undefined;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: payload });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Cannot reach Grok Code bridge at ${url}: ${message}. Is Grok Code open with the bridge running?`
      );
    }

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const errMsg =
        typeof data === 'object' && data && 'error' in data
          ? String((data as { error: unknown }).error)
          : text || res.statusText;
      throw new Error(`Bridge ${method} ${pathname} -> ${res.status}: ${errMsg}`);
    }
    return data;
  }
}

export function textResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function errorResult(err: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}
