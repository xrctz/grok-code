const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const os = require("os");

/** Integrated terminal name for the embedded Grok Build TUI */
const GROK_BUILD_TERMINAL_NAME = "Grok Build";

/** Integrated terminal name for the optional Claude Code CLI (button-only, no auto-boot) */
const CLAUDE_TERMINAL_NAME = "Claude Code";

/** Grok Code layout — custom shell, not stock VS Code */
const GROK_LAYOUT = {
  "workbench.colorTheme": "Grok Code Void",
  "workbench.iconTheme": "grok-code-icons",
  "window.title": "Grok Code${separator}${activeEditorShort}${separator}${rootNameShort}",
  "window.titleBarStyle": "custom",
  "window.commandCenter": false,
  "window.autoDetectColorScheme": false,
  "window.density.editorTabHeight": "compact",
  "window.menuBarVisibility": "hidden",

  "workbench.activityBar.location": "top",
  "workbench.sideBar.location": "left",
  "workbench.panel.defaultLocation": "bottom",
  "workbench.statusBar.visible": true,
  "workbench.editor.showTabs": "multiple",
  "workbench.editor.tabSizing": "shrink",
  "workbench.editor.tabActionLocation": "right",
  "workbench.editor.highlightModifiedTabs": true,
  "workbench.tree.indent": 14,
  "workbench.tree.renderIndentGuides": "always",
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "workbench.layoutControl.enabled": false,
  "workbench.navigationControl.enabled": false,
  "workbench.reduceMotion": "off",
  "workbench.welcomePage.walkthroughs.openOnInstall": false,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "workbench.editor.empty.hint": "hidden",

  "chat.commandCenter.enabled": false,
  "chat.agent.enabled": false,
  "chat.agent.maxRequests": 0,
  "chat.detectParticipant.enabled": false,
  "chat.experimental.tools.enabled": false,

  "editor.fontFamily":
    "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'SF Mono', Menlo, Monaco, 'Courier New', monospace",
  "editor.fontSize": 14,
  "editor.lineHeight": 1.65,
  "editor.fontLigatures": true,
  "editor.cursorBlinking": "smooth",
  "editor.cursorSmoothCaretAnimation": "on",
  "editor.cursorStyle": "line",
  "editor.cursorWidth": 2,
  "editor.smoothScrolling": true,
  "editor.minimap.enabled": false,
  "editor.renderLineHighlight": "line",
  "editor.renderWhitespace": "selection",
  "editor.bracketPairColorization.enabled": true,
  "editor.guides.bracketPairs": "active",
  "editor.guides.indentation": true,
  "editor.padding.top": 12,
  "editor.stickyScroll.enabled": true,
  "editor.scrollbar.verticalScrollbarSize": 10,
  "editor.scrollbar.horizontalScrollbarSize": 10,
  "editor.overviewRulerBorder": false,

  "terminal.integrated.fontSize": 13,
  "terminal.integrated.fontFamily":
    "'JetBrains Mono', 'Cascadia Code', 'Fira Code', ui-monospace, monospace",
  "terminal.integrated.cursorBlinking": true,
  "terminal.integrated.smoothScrolling": true,

  "breadcrumbs.enabled": false,
  "explorer.compactFolders": true,
  "explorer.decorations.badges": true,
  "explorer.decorations.colors": true,

  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoUpdate": false,
  "workbench.enableExperiments": false,
  "github.copilot.enable": { "*": false },
  "github.copilot.editor.enableAutoCompletions": false,
  "github.copilot.nextEditSuggestions.enabled": false,
  "github.copilot.chat.agent.autoFix": false,
  "github.copilot.chat.claudeAgent.enabled": false,
  "github.copilot.chat.backgroundAgent.enabled": false,
  "github.copilot.chat.cloudAgent.enabled": false,
  "github.copilot.chat.reviewAgent.enabled": false,
  "github.copilot.chat.exploreAgent.enabled": false,
};

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10000
  );
  status.text = "$(sparkle) Grok Code";
  status.tooltip =
    "Grok Code — open Grok Build terminal (talk to agent · drives this app via MCP)";
  status.command = "grokCode.openGrokTerminal";
  status.show();
  context.subscriptions.push(status);

  // Subtle ready toast once per session
  setTimeout(() => {
    status.text = "$(sparkle) Grok Code · ready";
    setTimeout(() => {
      status.text = "$(sparkle) Grok Build";
    }, 3500);
  }, 1500);

  const provider = new GrokHomeProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("grokCode.homeView", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  const chatProvider = new GrokSidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("grok-code.sidebar-chat", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("grokCode.applyLayout", async () => {
      await applyLayout();
      await closeCopilotChrome();
      // Status bar only — toasts pause the built-in Browser
      vscode.window.setStatusBarMessage(
        "$(sparkle) Grok Code layout applied",
        4000
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("grokCode.openHome", () =>
      openHomePanel(context)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("grokCode.openGrokTerminal", async () => {
      const ok = await openGrokBuildTerminal();
      if (ok) {
        status.text = "$(sparkle) Grok Build · live";
        vscode.window.setStatusBarMessage(
          "$(sparkle) Grok Build terminal — agent can drive this app via vscode_* MCP tools",
          5000
        );
      }
    })
  );

  // Claude Code terminal — button/command only (never auto-boots on startup)
  context.subscriptions.push(
    vscode.commands.registerCommand("grokCode.openClaudeTerminal", async () => {
      const ok = await openClaudeTerminal();
      if (ok) {
        vscode.window.setStatusBarMessage(
          "$(comment-discussion) Claude Code terminal — custom Claude CLI wired to Grok Code MCP bridge",
          5000
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("grokCode.showAbout", () => {
      vscode.window
        .showInformationMessage(
          "Grok Code — custom shell with embedded Grok Build + optional Claude Code terminal. Agents drive the editor via MCP. No Copilot.",
          "Open Grok Build",
          "Open Claude",
          "Open Home",
          "Apply Layout"
        )
        .then((choice) => {
          if (choice === "Open Grok Build") {
            vscode.commands.executeCommand("grokCode.openGrokTerminal");
          } else if (choice === "Open Claude") {
            vscode.commands.executeCommand("grokCode.openClaudeTerminal");
          } else if (choice === "Open Home") {
            vscode.commands.executeCommand("grokCode.openHome");
          } else if (choice === "Apply Layout") {
            vscode.commands.executeCommand("grokCode.applyLayout");
          }
        });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("grokCode.logAction", (payload) => {
      if (homePanel) {
        homePanel.webview.postMessage({
          type: "logAction",
          payload: payload
        });
      }
    })
  );

  const auto = vscode.workspace
    .getConfiguration("grokCode")
    .get("autoApplyLayout", true);
  if (auto) {
    setTimeout(() => {
      applyLayout()
        .then(() => closeCopilotChrome())
        .then(() => focusGrokShell())
        .catch(() => {});
    }, 600);
  }

  const autoHome = vscode.workspace
    .getConfiguration("grokCode")
    .get("openHomeOnStartup", true);
  if (autoHome) {
    setTimeout(() => {
      openHomePanel(context);
      closeCopilotChrome().catch(() => {});
    }, 1400);
  }

  // Embed Grok Build TUI in the integrated terminal so you can talk to the agent
  // and it can work automatically in this app via the grok-code MCP bridge.
  const openAgentEnv =
    process.env.GROK_CODE_OPEN_AGENT === "1" ||
    process.env.GROK_CODE_OPEN_AGENT === "true";
  const autoGrok = vscode.workspace
    .getConfiguration("grokCode")
    .get("openGrokTerminalOnStartup", true);
  if (autoGrok || openAgentEnv) {
    // Wait for bridge extension to bind :7331 and write .vscode-mcp.env
    setTimeout(() => {
      openGrokBuildTerminal().catch(() => {});
    }, openAgentEnv ? 2200 : 2800);
  }
}

/** @type {vscode.WebviewPanel | undefined} */
let homePanel;

async function closeCopilotChrome() {
  for (const id of [
    "workbench.action.closeAuxiliaryBar",
    "workbench.action.chat.close",
  ]) {
    try {
      await vscode.commands.executeCommand(id);
    } catch {
      /* ignore */
    }
  }
}

/** Focus the Grok activity bar container. */
async function focusGrokShell() {
  try {
    await vscode.commands.executeCommand("workbench.view.extension.grokCode");
  } catch {
    /* ignore */
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function openHomePanel(context) {
  if (homePanel) {
    homePanel.reveal(vscode.ViewColumn.One);
    postInit(homePanel, context);
    return;
  }

  homePanel = vscode.window.createWebviewPanel(
    "grokCodeHome",
    "Grok Code",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, "media")),
        vscode.Uri.file(path.join(context.extensionPath, "welcome")),
      ],
    }
  );

  homePanel.iconPath = {
    light: vscode.Uri.file(
      path.join(context.extensionPath, "media", "icon-64.png")
    ),
    dark: vscode.Uri.file(
      path.join(context.extensionPath, "media", "icon-64.png")
    ),
  };

  homePanel.webview.html = getHomeHtml(homePanel.webview, context);

  homePanel.webview.onDidReceiveMessage(async (msg) => {
    if (!msg || msg.type !== "command") return;
    switch (msg.command) {
      case "openFolder":
        await vscode.commands.executeCommand(
          "workbench.action.files.openFolder"
        );
        break;
      case "newFile":
        await vscode.commands.executeCommand(
          "workbench.action.files.newUntitledFile"
        );
        break;
      case "commandPalette":
        await vscode.commands.executeCommand("workbench.action.showCommands");
        break;
      case "openExplorer":
        await vscode.commands.executeCommand("workbench.view.explorer");
        break;
      case "openBridge":
        await vscode.commands.executeCommand("workbench.view.extension.grok-code.sidebar-chat");
        break;
      case "openTerminal":
        await vscode.commands.executeCommand("workbench.action.terminal.toggleTerminal");
        break;
      case "openGrokBuild":
      case "openGrokTerminal":
        await vscode.commands.executeCommand("grokCode.openGrokTerminal");
        break;
      case "openClaude":
      case "openClaudeTerminal":
        await vscode.commands.executeCommand("grokCode.openClaudeTerminal");
        break;
      case "copyBridgeToken":
        try {
          await vscode.commands.executeCommand("vscodeMcpBridge.copyToken");
        } catch {
          vscode.window.showWarningMessage("Bridge extension not running.");
        }
        break;
      case "runDiagnostics": {
        const diags = vscode.languages.getDiagnostics();
        let total = 0;
        diags.forEach(([uri, list]) => { total += list.length; });
        vscode.window.showInformationMessage(`Grok Diagnostics: Found ${total} problems in active workspace.`);
        break;
      }
      case "createDemoFile": {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length) {
          const root = folders[0].uri.fsPath;
          const demoPath = path.join(root, 'demo_grok.js');
          fs.writeFileSync(demoPath, '// Welcome to Grok Code!\nconsole.log("Hello, Grok 4.5!");\n', 'utf8');
          const uri = vscode.Uri.file(demoPath);
          await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
          vscode.window.showInformationMessage('Spawned demo_grok.js in workspace.');
        } else {
          vscode.window.showWarningMessage('Please open a workspace first to spawn a demo file.');
        }
        break;
      }
      case "toggleChat":
        // Intentionally no-op / close — Grok does not use Copilot chat
        await closeCopilotChrome();
        vscode.window.setStatusBarMessage(
          "Copilot chat disabled — use Grok via MCP",
          4000
        );
        break;
      default:
        break;
    }
  });

  setTimeout(() => postInit(homePanel, context), 250);

  homePanel.onDidDispose(() => {
    homePanel = undefined;
  });
}

function getActiveBridgeConfig() {
  const candidates = [];
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length) {
    candidates.push(path.join(folders[0].uri.fsPath, ".vscode-mcp.env"));
  }
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home) {
    candidates.push(path.join(home, ".grok-code-app", ".vscode-mcp.env"));
    candidates.push(path.join(home, ".vscode-mcp.env"));
  }
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    try {
      const text = fs.readFileSync(envPath, "utf8");
      const config = {};
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        config[key] = val;
      }
      if (config.VSCODE_MCP_URL || config.VSCODE_MCP_TOKEN) {
        return config;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * @param {vscode.WebviewPanel} panel
 * @param {vscode.ExtensionContext} context
 */
function postInit(panel, context) {
  const media = path.join(context.extensionPath, "media", "welcome");
  const asWeb = (name) =>
    panel.webview
      .asWebviewUri(vscode.Uri.file(path.join(media, name)))
      .toString();

  const clips = [];
  for (const name of [
    "nebula.mp4",
    "core-orbit.mp4",
    "splash-editor.mp4",
    "caret-pulse.mp4",
  ]) {
    if (fs.existsSync(path.join(media, name))) {
      clips.push(asWeb(name));
    }
  }

  const bridgeCfg = getActiveBridgeConfig();
  const folders = vscode.workspace.workspaceFolders;
  const workspaceName = folders && folders.length ? folders[0].name : null;

  // Never inject the bridge token into webview HTML/JS (security).
  panel.webview.postMessage({
    type: "init",
    logo: asWeb("logo.png"),
    panelArt: fs.existsSync(path.join(media, "panel-art.jpg"))
      ? asWeb("panel-art.jpg")
      : asWeb("logo.png"),
    mascot: fs.existsSync(path.join(media, "mascot.png"))
      ? asWeb("mascot.png")
      : null,
    clips,
    bridgeUrl: bridgeCfg ? bridgeCfg.VSCODE_MCP_URL : null,
    bridgeReady: !!(bridgeCfg && bridgeCfg.VSCODE_MCP_TOKEN),
    workspaceName
  });
}

/**
 * @param {vscode.Webview} webview
 * @param {vscode.ExtensionContext} context
 */
function getHomeHtml(webview, context) {
  const htmlPath = path.join(context.extensionPath, "welcome", "home.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data: blob:`,
    `media-src ${webview.cspSource} blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
  ].join("; ");
  html = html.replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`
  );
  return html;
}

class GrokHomeProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.context = context;
  }

  /**
   * @param {vscode.WebviewView} webviewView
   */
  resolveWebviewView(webviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, "media")),
        vscode.Uri.file(path.join(this.context.extensionPath, "welcome")),
      ],
    };
    webviewView.webview.html = sidebarHtml(webviewView.webview, this.context);
    webviewView.webview.onDidReceiveMessage(() => {
      vscode.commands.executeCommand("grokCode.openHome");
    });
  }
}

/**
 * @param {vscode.Webview} webview
 * @param {vscode.ExtensionContext} context
 */
function sidebarHtml(webview, context) {
  const logo = webview.asWebviewUri(
    vscode.Uri.file(
      path.join(context.extensionPath, "media", "welcome", "logo.png")
    )
  );
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"/>
<style>
  body { margin:0; padding:16px; background:#050508; color:#e8e8ed; font-family: system-ui,sans-serif; }
  img { width:48px; height:48px; border-radius:12px; display:block; margin-bottom:12px; box-shadow:0 0 24px rgba(139,92,246,.4); }
  h2 { font-size:13px; letter-spacing:.14em; text-transform:uppercase; color:#a78bfa; margin:0 0 8px; }
  p { color:#8b8b9a; font-size:12px; line-height:1.45; margin:0 0 14px; }
  button {
    width:100%; border:0; border-radius:8px; padding:10px;
    background:linear-gradient(135deg,#8b5cf6,#6d28d9); color:#fff; cursor:pointer; font-weight:600;
  }
  .pulse { width:8px; height:8px; border-radius:50%; background:#67e8f9; display:inline-block;
    margin-right:6px; box-shadow:0 0 10px #67e8f9; animation:p 1.5s infinite; }
  @keyframes p { 0%,100%{opacity:.4} 50%{opacity:1} }
</style></head>
<body>
  <img src="${logo}" alt="Grok Code"/>
  <h2><span class="pulse"></span>Grok Code</h2>
  <p>Custom AI shell — art, typing stage, motion. Copilot stripped.</p>
  <button id="go">Open Home Stage</button>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('go').onclick = () => vscode.postMessage({type:'open'});
  </script>
</body></html>`;
}

class GrokSidebarProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.context = context;
    /** @type {vscode.WebviewView | undefined} */
    this.view = undefined;
  }

  /**
   * @param {vscode.WebviewView} webviewView
   */
  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, "welcome")),
      ],
    };
    webviewView.webview.html = getSidebarHtml(webviewView.webview, this.context);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case "requestStatus":
          await this.pushStatus();
          break;
        case "copyToken":
          try {
            await vscode.commands.executeCommand("vscodeMcpBridge.copyToken");
            webviewView.webview.postMessage({
              type: "toast",
              message: "Token copy requested (see notification / clipboard).",
            });
          } catch {
            webviewView.webview.postMessage({
              type: "toast",
              message: "Bridge extension not available.",
            });
          }
          break;
        case "showStatus":
          try {
            await vscode.commands.executeCommand("vscodeMcpBridge.showStatus");
          } catch {
            /* ignore */
          }
          break;
        case "openHome":
          await vscode.commands.executeCommand("grokCode.openHome");
          break;
        case "openGrokBuild":
        case "openGrokTerminal":
          await vscode.commands.executeCommand("grokCode.openGrokTerminal");
          break;
        case "openClaude":
        case "openClaudeTerminal":
          await vscode.commands.executeCommand("grokCode.openClaudeTerminal");
          break;
        default:
          break;
      }
    });

    // Initial status shortly after resolve
    setTimeout(() => this.pushStatus().catch(() => {}), 300);
  }

  async pushStatus() {
    if (!this.view) return;
    let info = { running: false, url: null, hasToken: false };
    try {
      const raw = await vscode.commands.executeCommand(
        "vscodeMcpBridge.getBridgeInfo"
      );
      if (raw && typeof raw === "object") {
        info = {
          running: !!raw.running,
          url: raw.url || null,
          hasToken: !!raw.hasToken,
        };
      }
    } catch {
      // Bridge extension may not be installed
      const cfg = getActiveBridgeConfig();
      if (cfg && cfg.VSCODE_MCP_URL) {
        info = {
          running: true,
          url: cfg.VSCODE_MCP_URL,
          hasToken: !!cfg.VSCODE_MCP_TOKEN,
        };
      }
    }
    this.view.webview.postMessage({ type: "bridgeStatus", ...info });
  }
}

function getSidebarHtml(webview, context) {
  const htmlPath = path.join(context.extensionPath, "welcome", "sidebar.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
  ].join("; ");
  html = html.replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`
  );
  return html;
}

async function applyLayout() {
  const config = vscode.workspace.getConfiguration();
  for (const [key, value] of Object.entries(GROK_LAYOUT)) {
    try {
      await config.update(key, value, vscode.ConfigurationTarget.Global);
    } catch {
      /* ignore unknown keys */
    }
  }
}

/**
 * Resolve the real Grok Build binary (not a shell wrapper that re-launches the IDE).
 * @returns {string | undefined}
 */
function resolveGrokBinary() {
  const home = os.homedir();
  const candidates = [
    process.env.GROK_REAL_BIN,
    process.env.GROK_BIN,
    path.join(home, ".grok", "bin", "grok"),
    "/usr/local/bin/grok",
    "/usr/bin/grok",
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c) && fs.statSync(c).isFile()) {
        // Skip our own wrapper if it somehow ends up first
        const text = safeReadHead(c, 400);
        if (text && text.includes("GROK_CODE_LAUNCHER_WRAPPER")) {
          continue;
        }
        return c;
      }
    } catch {
      /* try next */
    }
  }

  // Last resort: PATH lookup via which (may be the wrapper — still usable with GROK_CODE_EMBEDDED=1)
  return "grok";
}

/**
 * @param {string} file
 * @param {number} n
 */
function safeReadHead(file, n) {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(n);
    const read = fs.readSync(fd, buf, 0, n, 0);
    fs.closeSync(fd);
    return buf.slice(0, read).toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Env for the embedded Grok Build process so MCP can reach this editor.
 * @returns {Record<string, string>}
 */
function buildGrokTerminalEnv() {
  /** @type {Record<string, string>} */
  const env = {};
  // Copy process env (VS Code requires string values)
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }

  // Critical: prevent shell wrapper from re-launching Grok Code
  env.GROK_CODE_EMBEDDED = "1";
  env.TERM = env.TERM || "xterm-256color";
  env.COLORTERM = env.COLORTERM || "truecolor";

  const bridge = getActiveBridgeConfig();
  if (bridge) {
    if (bridge.VSCODE_MCP_HOST) env.VSCODE_MCP_HOST = bridge.VSCODE_MCP_HOST;
    if (bridge.VSCODE_MCP_PORT) env.VSCODE_MCP_PORT = bridge.VSCODE_MCP_PORT;
    if (bridge.VSCODE_MCP_TOKEN) env.VSCODE_MCP_TOKEN = bridge.VSCODE_MCP_TOKEN;
    if (bridge.VSCODE_MCP_URL) env.VSCODE_MCP_URL = bridge.VSCODE_MCP_URL;
  } else {
    env.VSCODE_MCP_HOST = env.VSCODE_MCP_HOST || "127.0.0.1";
    env.VSCODE_MCP_PORT = env.VSCODE_MCP_PORT || "7331";
  }

  if (process.env.GROK_CODE_ROOT) {
    env.GROK_CODE_ROOT = process.env.GROK_CODE_ROOT;
  }

  return env;
}

/**
 * Open (or focus) an integrated terminal running Grok Build so the agent
 * can talk to you and drive Grok Code via vscode_* MCP tools.
 * @returns {Promise<boolean>}
 */
async function openGrokBuildTerminal() {
  const existing = vscode.window.terminals.find(
    (t) => t.name === GROK_BUILD_TERMINAL_NAME
  );
  if (existing) {
    existing.show(true);
    return true;
  }

  const grokBin = resolveGrokBinary();
  const cfg = vscode.workspace.getConfiguration("grokCode");
  const alwaysApprove = cfg.get("alwaysApproveAgent", true);
  const extraArgs = cfg.get("grokTerminalArgs", []);
  /** @type {string[]} */
  const shellArgs = [];
  if (alwaysApprove) {
    shellArgs.push("--always-approve");
  }
  if (Array.isArray(extraArgs)) {
    for (const a of extraArgs) {
      if (typeof a === "string" && a.trim()) shellArgs.push(a.trim());
    }
  }

  // Optional one-shot prompt from bare `grok "…"` launcher
  const promptFile = process.env.GROK_CODE_AGENT_PROMPT_FILE;
  if (promptFile && fs.existsSync(promptFile)) {
    try {
      const prompt = fs.readFileSync(promptFile, "utf8").trim();
      if (prompt) shellArgs.push(prompt);
      fs.unlinkSync(promptFile);
    } catch {
      /* ignore */
    }
  }

  const folders = vscode.workspace.workspaceFolders;
  const cwd =
    (folders && folders.length && folders[0].uri.fsPath) ||
    process.env.GROK_CODE_CWD ||
    undefined;

  try {
    const terminal = vscode.window.createTerminal({
      name: GROK_BUILD_TERMINAL_NAME,
      shellPath: grokBin,
      shellArgs,
      cwd,
      env: buildGrokTerminalEnv(),
      message: "Grok Build · agent can edit files, run commands, and drive this window via MCP",
      isTransient: false,
    });
    terminal.show(true);
    return true;
  } catch (err) {
    // Fallback: default shell + sendText (works if shellPath launch fails)
    try {
      const terminal = vscode.window.createTerminal({
        name: GROK_BUILD_TERMINAL_NAME,
        cwd,
        env: buildGrokTerminalEnv(),
      });
      terminal.show(true);
      const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
      const cmd = [q(grokBin), ...shellArgs.map(q)].join(" ");
      terminal.sendText(cmd, true);
      return true;
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2 || err);
      vscode.window.setStatusBarMessage(
        `Could not start Grok Build: ${msg}`,
        8000
      );
      return false;
    }
  }
}

/**
 * Resolve launch-claude.sh (user's custom Claude → Grok Code launcher).
 * @returns {string | undefined}
 */
function resolveClaudeLaunchScript() {
  const cfg = vscode.workspace.getConfiguration("grokCode");
  const configured = cfg.get("claudeLaunchScript", "");
  const home = os.homedir();
  const folders = vscode.workspace.workspaceFolders;
  const workspaceRoot =
    folders && folders.length ? folders[0].uri.fsPath : undefined;

  const candidates = [
    typeof configured === "string" && configured.trim() ? configured.trim() : null,
    process.env.GROK_CODE_CLAUDE_LAUNCH,
    process.env.GROK_CODE_ROOT
      ? path.join(process.env.GROK_CODE_ROOT, "launch-claude.sh")
      : null,
    workspaceRoot ? path.join(workspaceRoot, "launch-claude.sh") : null,
    path.join(home, "Desktop", "Grok Code (Open Source)", "launch-claude.sh"),
    path.join(home, ".grok-code-app", "launch-claude.sh"),
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c) && fs.statSync(c).isFile()) {
        return c;
      }
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/**
 * Resolve claude CLI binary on PATH / common install locations.
 * @returns {string}
 */
function resolveClaudeBinary() {
  const home = os.homedir();
  const candidates = [
    process.env.CLAUDE_BIN,
    path.join(home, ".npm-global", "bin", "claude"),
    path.join(home, ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c) && fs.statSync(c).isFile()) {
        return c;
      }
    } catch {
      /* try next */
    }
  }
  return "claude";
}

/**
 * Resolve mcp-server entry for Claude ↔ Grok Code bridge.
 * @returns {string | undefined}
 */
function resolveMcpServerEntry() {
  const home = os.homedir();
  const folders = vscode.workspace.workspaceFolders;
  const workspaceRoot =
    folders && folders.length ? folders[0].uri.fsPath : undefined;

  const candidates = [
    process.env.GROK_CODE_ROOT
      ? path.join(
          process.env.GROK_CODE_ROOT,
          "vscode-mcp",
          "mcp-server",
          "dist",
          "index.js"
        )
      : null,
    workspaceRoot
      ? path.join(workspaceRoot, "vscode-mcp", "mcp-server", "dist", "index.js")
      : null,
    path.join(
      home,
      "Desktop",
      "Grok Code (Open Source)",
      "vscode-mcp",
      "mcp-server",
      "dist",
      "index.js"
    ),
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c) && fs.statSync(c).isFile()) {
        return c;
      }
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/**
 * Ensure Claude Code's global MCP config points at this Grok Code bridge
 * (token + correct mcp-server path) so Claude can drive the editor.
 * Best-effort; never throws.
 */
function ensureClaudeGrokCodeMcp() {
  try {
    const serverEntry = resolveMcpServerEntry();
    if (!serverEntry) return;

    const bridge = getActiveBridgeConfig() || {};
    const host = bridge.VSCODE_MCP_HOST || "127.0.0.1";
    const port = bridge.VSCODE_MCP_PORT || "7331";
    const token = bridge.VSCODE_MCP_TOKEN || "";
    const url = bridge.VSCODE_MCP_URL || `http://${host}:${port}`;

    const claudeJson = path.join(os.homedir(), ".claude.json");
    let config = {};
    if (fs.existsSync(claudeJson)) {
      try {
        config = JSON.parse(fs.readFileSync(claudeJson, "utf8"));
      } catch {
        return;
      }
    }
    if (!config || typeof config !== "object") config = {};
    if (!config.mcpServers || typeof config.mcpServers !== "object") {
      config.mcpServers = {};
    }

    /** @type {Record<string, string>} */
    const env = {
      VSCODE_MCP_HOST: host,
      VSCODE_MCP_PORT: String(port),
      VSCODE_MCP_URL: url,
    };
    if (token) env.VSCODE_MCP_TOKEN = token;

    config.mcpServers["grok-code"] = {
      type: "stdio",
      command: "node",
      args: [serverEntry],
      env,
    };

    fs.writeFileSync(claudeJson, JSON.stringify(config, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    /* ignore — Claude still launches; MCP may need manual setup */
  }
}

/**
 * Env for the Claude Code integrated terminal (bridge + PATH for custom CLI).
 * Does not hardcode API keys — launch-claude.sh / ~/.claude/settings.json own those.
 * @returns {Record<string, string>}
 */
function buildClaudeTerminalEnv() {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }

  const home = os.homedir();
  const pathParts = [
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".local", "bin"),
    env.PATH || "",
  ].filter(Boolean);
  env.PATH = pathParts.join(path.delimiter);

  env.TERM = env.TERM || "xterm-256color";
  env.COLORTERM = env.COLORTERM || "truecolor";

  const bridge = getActiveBridgeConfig();
  if (bridge) {
    if (bridge.VSCODE_MCP_HOST) env.VSCODE_MCP_HOST = bridge.VSCODE_MCP_HOST;
    if (bridge.VSCODE_MCP_PORT) env.VSCODE_MCP_PORT = bridge.VSCODE_MCP_PORT;
    if (bridge.VSCODE_MCP_TOKEN) env.VSCODE_MCP_TOKEN = bridge.VSCODE_MCP_TOKEN;
    if (bridge.VSCODE_MCP_URL) env.VSCODE_MCP_URL = bridge.VSCODE_MCP_URL;
  } else {
    env.VSCODE_MCP_HOST = env.VSCODE_MCP_HOST || "127.0.0.1";
    env.VSCODE_MCP_PORT = env.VSCODE_MCP_PORT || "7331";
  }

  if (process.env.GROK_CODE_ROOT) {
    env.GROK_CODE_ROOT = process.env.GROK_CODE_ROOT;
  }

  return env;
}

/**
 * Open (or focus) an integrated terminal running the user's custom Claude Code
 * launcher (launch-claude.sh). Never auto-starts — button/command only.
 * @returns {Promise<boolean>}
 */
async function openClaudeTerminal() {
  const existing = vscode.window.terminals.find(
    (t) => t.name === CLAUDE_TERMINAL_NAME
  );
  if (existing) {
    existing.show(true);
    return true;
  }

  // Wire Claude → Grok Code MCP so the agent can use vscode_* tools
  ensureClaudeGrokCodeMcp();

  const folders = vscode.workspace.workspaceFolders;
  const cwd =
    (folders && folders.length && folders[0].uri.fsPath) ||
    process.env.GROK_CODE_CWD ||
    undefined;

  const script = resolveClaudeLaunchScript();
  const env = buildClaudeTerminalEnv();
  const bash = process.env.SHELL && process.env.SHELL.includes("bash")
    ? process.env.SHELL
    : "/bin/bash";

  try {
    if (script) {
      const terminal = vscode.window.createTerminal({
        name: CLAUDE_TERMINAL_NAME,
        shellPath: bash,
        shellArgs: [script, cwd || "."],
        cwd,
        env,
        message:
          "Claude Code · custom CLI → Grok Code MCP bridge (button launch, no auto-boot)",
        isTransient: false,
      });
      terminal.show(true);
      return true;
    }

    // Fallback: claude CLI directly with bypass flags (same spirit as launch-claude.sh)
    const claudeBin = resolveClaudeBinary();
    const terminal = vscode.window.createTerminal({
      name: CLAUDE_TERMINAL_NAME,
      shellPath: claudeBin,
      shellArgs: [
        "--dangerously-skip-permissions",
        "--permission-mode",
        "bypassPermissions",
      ],
      cwd,
      env,
      message:
        "Claude Code · launched without launch-claude.sh (set grokCode.claudeLaunchScript if needed)",
      isTransient: false,
    });
    terminal.show(true);
    return true;
  } catch (err) {
    try {
      const terminal = vscode.window.createTerminal({
        name: CLAUDE_TERMINAL_NAME,
        cwd,
        env,
      });
      terminal.show(true);
      const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
      if (script) {
        terminal.sendText(`${q(bash)} ${q(script)} ${q(cwd || ".")}`, true);
      } else {
        const claudeBin = resolveClaudeBinary();
        terminal.sendText(
          `${q(claudeBin)} --dangerously-skip-permissions --permission-mode bypassPermissions`,
          true
        );
      }
      return true;
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2 || err);
      vscode.window.showWarningMessage(`Could not start Claude Code: ${msg}`);
      return false;
    }
  }
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  openGrokBuildTerminal,
  openClaudeTerminal,
  resolveGrokBinary,
  resolveClaudeLaunchScript,
};
