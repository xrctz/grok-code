"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const crypto = __importStar(require("crypto"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const bridge_1 = require("./bridge");
let bridge;
let statusBar;
let sessionToken = '';
let sessionHost = '127.0.0.1';
let sessionPort = 7331;
function activate(context) {
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = 'vscodeMcpBridge.showStatus';
    statusBar.text = '$(debug-disconnect) Grok Code';
    statusBar.tooltip = 'Grok Code bridge (stopped)';
    statusBar.show();
    context.subscriptions.push(statusBar);
    context.subscriptions.push(vscode.commands.registerCommand('vscodeMcpBridge.start', () => startBridge(context)), vscode.commands.registerCommand('vscodeMcpBridge.stop', () => stopBridge()), vscode.commands.registerCommand('vscodeMcpBridge.copyToken', async () => {
        if (!sessionToken) {
            vscode.window.showWarningMessage('Grok Code bridge is not running.');
            return;
        }
        await vscode.env.clipboard.writeText(sessionToken);
        vscode.window.showInformationMessage('Grok Code bridge token copied to clipboard.');
    }), vscode.commands.registerCommand('vscodeMcpBridge.showStatus', () => {
        if (!bridge?.isListening()) {
            vscode.window.showInformationMessage('Grok Code bridge is stopped.');
            return;
        }
        vscode.window
            .showInformationMessage(`Grok Code bridge listening on http://${sessionHost}:${sessionPort}`, 'Copy Token', 'Copy URL')
            .then(async (choice) => {
            if (choice === 'Copy Token') {
                await vscode.env.clipboard.writeText(sessionToken);
            }
            else if (choice === 'Copy URL') {
                await vscode.env.clipboard.writeText(`http://${sessionHost}:${sessionPort}`);
            }
        });
    }), vscode.commands.registerCommand('vscodeMcpBridge.getBridgeInfo', () => ({
        running: !!bridge?.isListening(),
        host: sessionHost,
        port: sessionPort,
        hasToken: !!sessionToken,
        // Token only via dedicated copy command — not exposed to webviews by default
        url: `http://${sessionHost}:${sessionPort}`
    })));
    const autoStart = vscode.workspace
        .getConfiguration('vscodeMcpBridge')
        .get('autoStart', true);
    if (autoStart) {
        void startBridge(context);
    }
}
function deactivate() {
    stopBridge();
}
async function startBridge(context) {
    if (bridge?.isListening()) {
        vscode.window.showInformationMessage('Grok Code bridge is already running.');
        return;
    }
    const cfg = vscode.workspace.getConfiguration('vscodeMcpBridge');
    const port = cfg.get('port', 7331);
    const host = cfg.get('host', '127.0.0.1');
    const configuredToken = cfg.get('token', '')?.trim();
    sessionToken =
        configuredToken ||
            (context.workspaceState.get('mcpBridge.sessionToken') ??
                crypto.randomBytes(16).toString('hex'));
    sessionHost = host;
    sessionPort = port;
    if (!configuredToken) {
        await context.workspaceState.update('mcpBridge.sessionToken', sessionToken);
    }
    bridge = new bridge_1.BridgeServer({ host, port, token: sessionToken });
    try {
        await bridge.start();
        statusBar.text = '$(broadcast) Grok Code';
        statusBar.tooltip = `Grok Code bridge · http://${host}:${port}`;
        statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        // Persist token for MCP clients (workspace + durable profile dir)
        await writeClientEnvFiles(host, port, sessionToken);
        // Optional auto-register into local MCP client configs (off by default)
        if (cfg.get('autoRegisterMcp', false)) {
            await autoRegisterMcpClients(context, port, sessionToken);
        }
        // Quiet notification toasts without forcing global DND preference
        await quietNotifications();
        statusBar.text = '$(broadcast) Grok Code · bridge';
        vscode.window.setStatusBarMessage(`Grok Code bridge on http://${host}:${port}`, 5000);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        statusBar.text = '$(error) Grok Code';
        statusBar.tooltip = message;
        vscode.window.setStatusBarMessage(`Bridge error: ${message}`, 10000);
    }
}
/** Hide/clear notification toasts so Browser stays interactive. */
async function quietNotifications() {
    for (const cmd of [
        'notifications.hideToasts',
        'notifications.clearAll',
        'notifications.hideList'
    ]) {
        try {
            await vscode.commands.executeCommand(cmd);
        }
        catch {
            /* ignore */
        }
    }
}
function stopBridge() {
    bridge?.stop();
    bridge = undefined;
    statusBar.text = '$(debug-disconnect) Grok Code';
    statusBar.tooltip = 'Grok Code bridge (stopped)';
    statusBar.backgroundColor = undefined;
}
function envBody(host, port, token) {
    return [
        `# Auto-generated by Grok Code bridge — do not commit secrets to public repos`,
        `VSCODE_MCP_HOST=${host}`,
        `VSCODE_MCP_PORT=${port}`,
        `VSCODE_MCP_TOKEN=${token}`,
        `VSCODE_MCP_URL=http://${host}:${port}`,
        ''
    ].join('\n');
}
async function writeClientEnvFiles(host, port, token) {
    const body = envBody(host, port, token);
    const folders = vscode.workspace.workspaceFolders;
    // Workspace root (if open)
    if (folders?.length) {
        const envUri = vscode.Uri.joinPath(folders[0].uri, '.vscode-mcp.env');
        await vscode.workspace.fs.writeFile(envUri, Buffer.from(body, 'utf8'));
    }
    // Always also write under durable Grok profile so clients work with no folder open
    try {
        const durableDir = path.join(os.homedir(), '.grok-code-app');
        fs.mkdirSync(durableDir, { recursive: true });
        fs.writeFileSync(path.join(durableDir, '.vscode-mcp.env'), body, 'utf8');
        fs.writeFileSync(path.join(os.homedir(), '.vscode-mcp.env'), body, 'utf8');
    }
    catch (err) {
        console.error('Failed to write durable bridge env:', err);
    }
}
/** Resolve the MCP server entrypoint (dist/index.js) for local client configs. */
function resolveMcpServerEntry(context) {
    const cfg = vscode.workspace.getConfiguration('vscodeMcpBridge');
    const configured = cfg.get('mcpServerPath', '')?.trim();
    if (configured && fs.existsSync(configured)) {
        return configured;
    }
    // Walk up from extension install / development path looking for mcp-server/dist/index.js
    const seeds = [
        context.extensionPath,
        path.dirname(context.extensionPath),
        path.dirname(path.dirname(context.extensionPath)),
        path.join(os.homedir(), 'Desktop', 'VS Code Open Source', 'vscode-mcp'),
        process.env.GROK_CODE_ROOT || ''
    ].filter(Boolean);
    for (const seed of seeds) {
        let dir = seed;
        for (let i = 0; i < 6; i++) {
            const candidate = path.join(dir, 'mcp-server', 'dist', 'index.js');
            if (fs.existsSync(candidate)) {
                return candidate;
            }
            const sibling = path.join(dir, 'vscode-mcp', 'mcp-server', 'dist', 'index.js');
            if (fs.existsSync(sibling)) {
                return sibling;
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                break;
            }
            dir = parent;
        }
    }
    return undefined;
}
async function autoRegisterMcpClients(context, port, token) {
    const serverEntry = resolveMcpServerEntry(context);
    if (!serverEntry) {
        console.error('[grok-code] MCP server entry not found; skip auto-register');
        return;
    }
    const env = {
        VSCODE_MCP_TOKEN: token,
        VSCODE_MCP_PORT: String(port),
        VSCODE_MCP_HOST: '127.0.0.1',
        VSCODE_MCP_URL: `http://127.0.0.1:${port}`
    };
    const serverBlock = {
        command: 'node',
        args: [serverEntry],
        env
    };
    // Prefer Grok CLI config
    await mergeTomlMcp(path.join(os.homedir(), '.grok', 'config.toml'), serverEntry, port, token);
    // Optional Claude Desktop JSON (only if config dir already exists)
    await mergeJsonMcpServer(claudeConfigPath(), 'grok-code', serverBlock);
}
function claudeConfigPath() {
    const home = os.homedir();
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        return path.join(appData, 'Claude', 'claude_desktop_config.json');
    }
    if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    }
    return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}
async function mergeJsonMcpServer(configPath, name, serverBlock) {
    const dir = path.dirname(configPath);
    try {
        if (!fs.existsSync(dir)) {
            return;
        }
        let config = {};
        if (fs.existsSync(configPath)) {
            try {
                config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }
            catch {
                fs.copyFileSync(configPath, configPath + '.bak');
                config = {};
            }
        }
        if (!config.mcpServers || typeof config.mcpServers !== 'object') {
            config.mcpServers = {};
        }
        config.mcpServers[name] = serverBlock;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    }
    catch (err) {
        console.error('Failed to auto-register JSON MCP config:', err);
    }
}
/**
 * Best-effort Grok config.toml registration.
 * Only writes if the file already exists (never creates a full config from scratch).
 */
async function mergeTomlMcp(configPath, serverEntry, port, token) {
    try {
        if (!fs.existsSync(configPath)) {
            return;
        }
        let text = fs.readFileSync(configPath, 'utf8');
        const section = `[mcp_servers.grok-code]
command = "node"
args = [${JSON.stringify(serverEntry)}]
enabled = true
startup_timeout_sec = 15
tool_timeout_sec = 120

[mcp_servers.grok-code.env]
VSCODE_MCP_HOST = "127.0.0.1"
VSCODE_MCP_PORT = "${port}"
VSCODE_MCP_TOKEN = "${token}"
VSCODE_MCP_URL = "http://127.0.0.1:${port}"
`;
        if (/\[mcp_servers\.grok-code\]/.test(text)) {
            // Replace existing grok-code block (section + optional env subsection)
            text = text.replace(/\[mcp_servers\.grok-code\][\s\S]*?(?=\n\[(?!mcp_servers\.grok-code\.env)|$)/, '');
            text = text.replace(/\[mcp_servers\.grok-code\.env\][\s\S]*?(?=\n\[|$)/, '');
            text = text.trimEnd() + '\n\n' + section;
        }
        else {
            text = text.trimEnd() + '\n\n' + section;
        }
        fs.writeFileSync(configPath, text.endsWith('\n') ? text : text + '\n', 'utf8');
    }
    catch (err) {
        console.error('Failed to auto-register Grok MCP config:', err);
    }
}
//# sourceMappingURL=extension.js.map