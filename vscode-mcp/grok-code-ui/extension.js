const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

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
  status.tooltip = "Grok Code — custom AI editor shell · open home stage";
  status.command = "grokCode.openHome";
  status.show();
  context.subscriptions.push(status);

  // Subtle ready toast once per session
  setTimeout(() => {
    status.text = "$(sparkle) Grok Code · ready";
    setTimeout(() => {
      status.text = "$(sparkle) Grok Code";
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
    vscode.commands.registerCommand("grokCode.showAbout", () => {
      vscode.window
        .showInformationMessage(
          "Grok Code — fully custom shell. Art, motion, typing stage. No Copilot.",
          "Open Home",
          "Apply Layout"
        )
        .then((choice) => {
          if (choice === "Open Home") {
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

function deactivate() {}

module.exports = { activate, deactivate };
