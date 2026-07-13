#!/usr/bin/env node
/**
 * Grok Code MCP server
 *
 * Talks to a live Grok Code window via the companion
 * Grok Code bridge extension (HTTP on localhost:7331).
 *
 * Wire protocol (ports, tokens, tool names) unchanged so existing layouts keep working.
 *
 * Configure in ~/.grok/config.toml:
 *
 *   [mcp_servers.grok-code]
 *   command = "node"
 *   args = ["/path/to/vscode-mcp/mcp-server/dist/index.js"]
 *   enabled = true
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BridgeClient, errorResult, loadBridgeConfig, textResult } from './client.js';
const config = loadBridgeConfig(process.env.VSCODE_MCP_CWD || process.cwd());
const bridge = new BridgeClient(config);
const server = new McpServer({
    name: 'grok-code',
    version: '0.1.3'
});
// ─── Read tools ─────────────────────────────────────────────────────────────
server.tool('vscode_ping', 'Check whether the Grok Code bridge is reachable and report status.', {}, async () => {
    try {
        const health = await bridge.health();
        let status = null;
        try {
            status = await bridge.get('/status');
        }
        catch {
            // health is public; status needs token — still useful
        }
        return textResult({
            connected: true,
            bridge: bridge.settings.baseUrl,
            health,
            status
        });
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_status', 'Get live Grok Code status: app name, workspace folders, active file, dirty editors.', {}, async () => {
    try {
        return textResult(await bridge.get('/status'));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_workspace', 'List workspace folders currently open in VS Code.', {}, async () => {
    try {
        return textResult(await bridge.get('/workspace'));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_list_editors', 'List active and visible text editors plus open tab count.', {}, async () => {
    try {
        return textResult(await bridge.get('/editors'));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_get_selection', 'Read the current selection (or cursor position) in the active editor.', {}, async () => {
    try {
        return textResult(await bridge.get('/selection'));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_get_document', 'Read the full text of a document. Omit path to use the active editor.', {
    path: z
        .string()
        .optional()
        .describe('Absolute or workspace-relative file path. Defaults to active editor.')
}, async ({ path }) => {
    try {
        return textResult(await bridge.get('/document', { path }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_read_lines', 'Read a 1-based, inclusive line range of a document. Cheaper than vscode_get_document for large files — page through a file without reading it all. Omit path to use the active editor.', {
    path: z
        .string()
        .optional()
        .describe('Absolute or workspace-relative path. Defaults to active editor.'),
    startLine: z.number().int().positive().describe('First line to read (1-based, inclusive).'),
    endLine: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Last line to read (1-based, inclusive). Defaults to end of file.')
}, async ({ path, startLine, endLine }) => {
    try {
        return textResult(await bridge.post('/document/lines', { path, startLine, endLine }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_get_diagnostics', 'Get problems/diagnostics (errors, warnings) from VS Code. Optionally filter by path.', {
    path: z.string().optional().describe('Filter diagnostics to this file path.')
}, async ({ path }) => {
    try {
        return textResult(await bridge.get('/diagnostics', { path }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_search_files', 'Search workspace files by glob or substring via VS Code findFiles.', {
    query: z
        .string()
        .describe('Glob (e.g. **/*.ts) or substring (e.g. package.json). Max 100 results.')
}, async ({ query }) => {
    try {
        return textResult(await bridge.get('/search-files', { query }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_search_text', 'Search file contents across the workspace (substring). Returns path, line, column, preview.', {
    query: z.string().describe('Text to search for inside files.'),
    include: z
        .string()
        .optional()
        .describe('Glob of files to include (default common source extensions).'),
    maxResults: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Max matches to return (default 50, max 200).'),
    caseSensitive: z.boolean().optional().describe('Case-sensitive match. Default false.')
}, async ({ query, include, maxResults, caseSensitive }) => {
    try {
        return textResult(await bridge.post('/search-text', { query, include, maxResults, caseSensitive }));
    }
    catch (err) {
        return errorResult(err);
    }
});
// ─── Write / action tools ───────────────────────────────────────────────────
server.tool('vscode_open_file', 'Open a file in VS Code and optionally jump to a line/column (1-based).', {
    path: z.string().describe('Absolute or workspace-relative path to open.'),
    line: z.number().int().positive().optional().describe('1-based line number.'),
    column: z.number().int().positive().optional().describe('1-based column number.')
}, async ({ path, line, column }) => {
    try {
        return textResult(await bridge.post('/open', { path, line, column }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_insert_text', 'Insert text at the cursor in the active editor (or a given path).', {
    text: z.string().describe('Text to insert at the cursor.'),
    path: z.string().optional().describe('File to target; opens it if needed.')
}, async ({ text, path }) => {
    try {
        return textResult(await bridge.post('/insert', { text, path }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_replace_selection', 'Replace the current selection with new text (or insert at cursor if empty selection).', {
    text: z.string().describe('Replacement text.'),
    path: z.string().optional().describe('Optional file path to focus first.')
}, async ({ text, path }) => {
    try {
        return textResult(await bridge.post('/replace-selection', { text, path }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_edit', 'Apply one or more range edits to a file (1-based line/column). Optionally save.', {
    path: z.string().describe('File path to edit.'),
    save: z.boolean().optional().describe('Save after applying edits.'),
    edits: z
        .array(z.object({
        startLine: z.number().int().positive(),
        startColumn: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        endColumn: z.number().int().positive().optional(),
        newText: z.string()
    }))
        .min(1)
        .describe('List of range replacements.')
}, async (args) => {
    try {
        return textResult(await bridge.post('/edit', args));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_save', 'Save the active document, a specific path, or all dirty editors.', {
    path: z.string().optional().describe('File to save. Defaults to active editor.'),
    all: z.boolean().optional().describe('If true, save all dirty editors.')
}, async ({ path, all }) => {
    try {
        return textResult(await bridge.post('/save', { path, all }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_run_command', 'Execute a VS Code command by id (e.g. workbench.action.files.save, editor.action.formatDocument).', {
    command: z.string().describe('Command identifier from the Command Palette.'),
    args: z.array(z.unknown()).optional().describe('Optional command arguments.')
}, async ({ command, args }) => {
    try {
        return textResult(await bridge.post('/command', { command, args }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_show_message', 'Show a short message in Grok Code. Info goes to the status bar by default (avoids pausing the built-in Browser). Set toast=true only if you need a real notification.', {
    message: z.string().describe('Message text to show.'),
    type: z
        .enum(['info', 'warning', 'error'])
        .optional()
        .describe('Message severity. Defaults to info.'),
    toast: z
        .boolean()
        .optional()
        .describe('If true, also show a notification toast (pauses Browser). Default false for info.')
}, async ({ message, type, toast }) => {
    try {
        return textResult(await bridge.post('/show-message', { message, type, toast }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_tabs', 'List all open editor tabs including Grok Code Browser / webview tabs (not just text editors).', {}, async () => {
    try {
        return textResult(await bridge.get('/tabs'));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_browser', 'Inspect whether the Grok Code built-in Browser is open and which browser tabs are active.', {}, async () => {
    try {
        return textResult(await bridge.get('/browser'));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_browser_open', 'Open a URL in the Grok Code built-in Browser (not an external Chrome window) and clear pausing notifications.', {
    url: z.string().describe('URL to open, e.g. http://127.0.0.1:8765/')
}, async ({ url }) => {
    try {
        return textResult(await bridge.post('/browser/open', { url }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_notifications_clear', 'Hide/clear notification toasts so the Grok Code Browser is not paused ("Paused due to Notification").', {}, async () => {
    try {
        return textResult(await bridge.post('/notifications/clear', {}));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_browser_screenshot', 'Capture what is on the Grok Code Browser right now. Returns a file path + base64 image and HUD/meta when the page streams frames (e.g. 3D Zombie Game). Falls back to headless Chrome of the page URL.', {
    force: z
        .boolean()
        .optional()
        .describe('If true, skip cached frame and re-capture (headless fallback if no live stream).'),
    maxAgeMs: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Maximum cached frame age in milliseconds. Defaults to 2500; use 0 to require a fresh capture.'),
    url: z
        .string()
        .optional()
        .describe('Optional URL for headless fallback screenshot.')
}, async ({ force, maxAgeMs, url }) => {
    try {
        return textResult(await bridge.post('/browser/screenshot', { force: !!force, maxAgeMs, url }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_reveal_line', 'Jump the cursor to a line/column and reveal it in the editor.', {
    line: z.number().int().positive().describe('1-based line number.'),
    column: z.number().int().positive().optional().describe('1-based column.'),
    path: z.string().optional().describe('Optional file to open first.')
}, async ({ line, column, path }) => {
    try {
        return textResult(await bridge.post('/reveal-line', { line, column, path }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_create_file', 'Create a new file in the workspace with optional initial content.', {
    path: z.string().describe('Absolute or workspace-relative path of the file to create.'),
    content: z.string().optional().describe('Initial content of the file.'),
    overwrite: z.boolean().optional().describe('Overwrite the file if it already exists. Default is true.')
}, async ({ path, content, overwrite }) => {
    try {
        return textResult(await bridge.post('/create-file', { path, content, overwrite }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_delete_file', 'Delete a file in the workspace.', {
    path: z.string().describe('Absolute or workspace-relative path of the file to delete.'),
    recursive: z.boolean().optional().describe('If true, delete folder recursively. Default is false.'),
    trash: z.boolean().optional().describe('Move to trash instead of permanent delete. Default is true.')
}, async ({ path, recursive, trash }) => {
    try {
        return textResult(await bridge.post('/delete-file', { path, recursive, trash }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_rename_file', 'Rename or move a file in the workspace.', {
    oldPath: z.string().describe('Source path.'),
    newPath: z.string().describe('Destination path.'),
    overwrite: z.boolean().optional().describe('Overwrite destination if it exists. Default is false.')
}, async ({ oldPath, newPath, overwrite }) => {
    try {
        return textResult(await bridge.post('/rename-file', { oldPath, newPath, overwrite }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_terminal_create', 'Create and open a new VS Code integrated terminal.', {
    name: z.string().optional().describe('Optional name for the terminal.'),
    shellPath: z.string().optional().describe('Optional path to the shell executable.'),
    cwd: z.string().optional().describe('Optional working directory path.')
}, async ({ name, shellPath, cwd }) => {
    try {
        return textResult(await bridge.post('/terminal/create', { name, shellPath, cwd }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_terminal_send_text', 'Send command text / run command in a VS Code integrated terminal.', {
    text: z.string().describe('Command text or input to send to the terminal.'),
    name: z.string().optional().describe('Target terminal name. Defaults to active or first terminal.'),
    addNewLine: z.boolean().optional().describe('Whether to execute the command immediately. Default is true.')
}, async ({ text, name, addNewLine }) => {
    try {
        return textResult(await bridge.post('/terminal/send-text', { text, name, addNewLine }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_terminal_list', 'List all open VS Code integrated terminals.', {}, async () => {
    try {
        return textResult(await bridge.get('/terminal/list'));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_terminal_close', 'Close/dispose a specific VS Code integrated terminal by name.', {
    name: z.string().describe('Name of the terminal to close.')
}, async ({ name }) => {
    try {
        return textResult(await bridge.post('/terminal/close', { name }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_terminal_output', 'Read recently captured integrated-terminal output (best-effort). Prefer vscode_shell_exec for reliable stdout/exit codes.', {
    name: z.string().optional().describe('Terminal name. Defaults to active/first terminal.'),
    maxChars: z.number().int().positive().optional().describe('Max characters to return (default 8000).'),
    clear: z.boolean().optional().describe('If true, clear the buffer after reading.')
}, async ({ name, maxChars, clear }) => {
    try {
        return textResult(await bridge.post('/terminal/output', { name, maxChars, clear }));
    }
    catch (err) {
        return errorResult(err);
    }
});
server.tool('vscode_shell_exec', 'Run a shell command with captured stdout, stderr, and exit code. Preferred for agent coding loops (tests, builds, git status). Optionally mirrors into the integrated terminal.', {
    command: z.string().describe('Shell command to run (via user shell -lc).'),
    cwd: z.string().optional().describe('Working directory. Defaults to first workspace folder.'),
    timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Timeout in milliseconds (default 60000, max 300000).'),
    showInTerminal: z
        .boolean()
        .optional()
        .describe('Also echo the command into the integrated terminal. Default true.'),
    terminalName: z.string().optional().describe('Terminal tab name when mirroring.')
}, async (args) => {
    try {
        return textResult(await bridge.post('/shell/exec', args));
    }
    catch (err) {
        return errorResult(err);
    }
});
// ─── Resources ──────────────────────────────────────────────────────────────
server.resource('vscode-status', 'vscode://status', { description: 'Live VS Code bridge status snapshot', mimeType: 'application/json' }, async () => {
    try {
        const status = await bridge.get('/status');
        return {
            contents: [
                {
                    uri: 'vscode://status',
                    mimeType: 'application/json',
                    text: JSON.stringify(status, null, 2)
                }
            ]
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            contents: [
                {
                    uri: 'vscode://status',
                    mimeType: 'application/json',
                    text: JSON.stringify({ error: message }, null, 2)
                }
            ]
        };
    }
});
// ─── Boot ───────────────────────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Log to stderr only — stdout is the MCP channel
    console.error(`[grok-code] ready → bridge ${config.baseUrl} (token ${config.token ? 'set' : 'MISSING'})`);
}
main().catch((err) => {
    console.error('[grok-code] fatal:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map