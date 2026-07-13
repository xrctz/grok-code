import * as fs from 'node:fs';
import * as path from 'node:path';
/** Default request timeout when none is configured. */
export const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;
/**
 * Resolve bridge connection settings from env, optional .vscode-mcp.env, or defaults.
 */
export function loadBridgeConfig(cwd = process.cwd()) {
    // Load .vscode-mcp.env from cwd or parents (written by the extension)
    loadDotEnv(findEnvFile(cwd));
    const host = process.env.VSCODE_MCP_HOST || '127.0.0.1';
    const port = Number(process.env.VSCODE_MCP_PORT || '7331');
    const token = process.env.VSCODE_MCP_TOKEN || '';
    const baseUrl = process.env.VSCODE_MCP_URL || `http://${host}:${port}`;
    const timeoutMs = clampTimeout(Number(process.env.VSCODE_MCP_TIMEOUT_MS));
    return { host, port, token, baseUrl, timeoutMs };
}
function clampTimeout(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return DEFAULT_TIMEOUT_MS;
    }
    return Math.min(Math.max(value, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}
function findEnvFile(start) {
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
function loadDotEnv(file) {
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
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
}
export class BridgeClient {
    config;
    constructor(config) {
        this.config = config;
    }
    get settings() {
        return this.config;
    }
    /** Effective per-request timeout (falls back to the default for legacy configs). */
    get timeoutMs() {
        const t = this.config.timeoutMs;
        return typeof t === 'number' && t > 0 ? t : DEFAULT_TIMEOUT_MS;
    }
    async health() {
        // Health is a lightweight liveness probe — cap it so discovery fails fast.
        return this.request('GET', '/health', undefined, false, Math.min(this.timeoutMs, 5_000));
    }
    async get(pathname, query) {
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
    async post(pathname, body) {
        return this.request('POST', pathname, body);
    }
    async request(method, pathname, body, auth = true, timeoutMs = this.timeoutMs) {
        const url = `${this.config.baseUrl.replace(/\/$/, '')}${pathname}`;
        const headers = {
            Accept: 'application/json'
        };
        if (auth) {
            if (!this.config.token) {
                throw new Error('VSCODE_MCP_TOKEN is not set. Start Grok Code with the bridge extension (it writes .vscode-mcp.env) or export the token.');
            }
            headers.Authorization = `Bearer ${this.config.token}`;
            headers['X-MCP-Token'] = this.config.token;
        }
        let payload;
        if (body !== undefined) {
            payload = JSON.stringify(body);
            headers['Content-Type'] = 'application/json';
        }
        // Abort hung requests so a stuck bridge never blocks the agent indefinitely.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res;
        try {
            res = await fetch(url, { method, headers, body: payload, signal: controller.signal });
        }
        catch (err) {
            if (controller.signal.aborted) {
                throw new Error(`Grok Code bridge request timed out after ${timeoutMs}ms: ${method} ${pathname}. ` +
                    'Increase VSCODE_MCP_TIMEOUT_MS or check whether the editor is responsive.');
            }
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Cannot reach Grok Code bridge at ${url}: ${message}. Is Grok Code open with the bridge running?`);
        }
        finally {
            clearTimeout(timer);
        }
        const text = await res.text();
        let data;
        try {
            data = text ? JSON.parse(text) : null;
        }
        catch {
            data = text;
        }
        if (!res.ok) {
            const errMsg = typeof data === 'object' && data && 'error' in data
                ? String(data.error)
                : text || res.statusText;
            throw new Error(`Bridge ${method} ${pathname} -> ${res.status}: ${errMsg}`);
        }
        return data;
    }
}
export function textResult(data) {
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return { content: [{ type: 'text', text }] };
}
export function errorResult(err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}
//# sourceMappingURL=client.js.map