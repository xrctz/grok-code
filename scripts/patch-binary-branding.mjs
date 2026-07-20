#!/usr/bin/env node
/**
 * Apply Grok Code branding onto an extracted VS Code app tree.
 * Works on Windows, macOS, and Linux (Ubuntu).
 *
 * Usage:
 *   node scripts/patch-binary-branding.mjs [appDir]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  REPO_ROOT,
  normalizePlatform,
  resourcesAppDir,
} from "./lib/platform.mjs";

const PLATFORM = normalizePlatform();
const APP =
  process.argv[2] ||
  process.env.GROK_CODE_APP ||
  path.join(
    process.env.GROK_CODE_CACHE ||
      path.join(
        process.env.HOME || process.env.USERPROFILE || "",
        ".local",
        "share",
        "grok-code"
      ),
    "app"
  );

const UI = path.join(REPO_ROOT, "vscode-mcp", "grok-code-ui");
const MEDIA = path.join(UI, "media");
const RESOURCES = resourcesAppDir(APP, PLATFORM);

if (!fs.existsSync(RESOURCES)) {
  console.error(`No VS Code resources/app at ${RESOURCES}`);
  process.exit(1);
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// 1. Platform icons
const iconSrc = path.join(MEDIA, "icon-512.png");
if (fs.existsSync(iconSrc)) {
  const iconTargets = [];
  if (PLATFORM === "linux") {
    iconTargets.push(path.join(RESOURCES, "resources", "linux", "code.png"));
  } else if (PLATFORM === "darwin") {
    // Keep png next to resources for any tooling that looks for it; .icns is optional
    iconTargets.push(path.join(RESOURCES, "resources", "darwin", "code.png"));
  } else if (PLATFORM === "win32") {
    iconTargets.push(path.join(RESOURCES, "resources", "win32", "code.png"));
  }
  for (const t of iconTargets) {
    try {
      copyFile(iconSrc, t);
    } catch (err) {
      console.warn(`Warning: could not copy icon to ${t}: ${err.message}`);
    }
  }
}

const letterpress = [
  "letterpress-dark.svg",
  "letterpress-light.svg",
  "letterpress-hcDark.svg",
  "letterpress-hcLight.svg",
  "code-icon.svg",
  "vscode-icon.svg",
];
for (const f of letterpress) {
  const src = path.join(MEDIA, f);
  if (fs.existsSync(src)) {
    copyFile(src, path.join(RESOURCES, "out", "media", f));
  }
}

// 2. Inject grok-code.css into workbench.html (portable — no GNU sed)
const WB = path.join(
  RESOURCES,
  "out",
  "vs",
  "code",
  "electron-browser",
  "workbench"
);
const cssSrc = path.join(UI, "brand", "grok-code.css");
const cssDest = path.join(WB, "grok-code.css");
if (fs.existsSync(cssSrc) && fs.existsSync(WB)) {
  copyFile(cssSrc, cssDest);
  const htmlPath = path.join(WB, "workbench.html");
  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, "utf8");
    if (!html.includes("grok-code.css")) {
      html = html.replace(
        'workbench.desktop.main.css">',
        'workbench.desktop.main.css">\n\t\t<link rel="stylesheet" href="./grok-code.css">\n\t\t<title>Grok Code</title>'
      );
      fs.writeFileSync(htmlPath, html);
    }
  }
}

// 3. Patch product.json + checksums
const productPath = path.join(RESOURCES, "product.json");
const product = JSON.parse(fs.readFileSync(productPath, "utf8"));
Object.assign(product, {
  nameShort: "Grok Code",
  nameLong: "Grok Code",
  applicationName: "grok-code",
  dataFolderName: ".grok-code",
  linuxIconName: "grok-code",
  urlProtocol: "grok-code",
  enableTelemetry: false,
  showTelemetryOptOut: false,
  appCenter: {},
  aiConfig: {},
  msftInternalDomains: [],
  trustedExtensionPublishers: ["grok-labs"],
  trustedExtensionAuthAccess: {},
  documentationUrl: "",
  serverDocumentationUrl: "",
  releaseNotesUrl: "",
  newsletterSignupUrl: "",
  youTubeUrl: "",
  requestFeatureUrl: "",
  reportIssueUrl: "https://grok.x.ai/issues",
  reportMarketplaceIssueUrl: "",
  licenseUrl: "https://grok.x.ai/license",
  serverLicenseUrl: "https://grok.x.ai/license",
  privacyStatementUrl: "",
  npsSurveyUrl: "",
  checksumFailMoreInfoUrl: "",
  settingsSearchUrl: "",
  surveys: [],
  voiceWsUrl: "",
  nodejsArtifactFeed: "",
  electronArtifactFeed: "",
});

function computeChecksum(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto
    .createHash("sha256")
    .update(data)
    .digest("base64")
    .replace(/=+$/, "");
}

if (product.checksums) {
  const wbHtml = path.join(WB, "workbench.html");
  if (fs.existsSync(wbHtml)) {
    product.checksums[
      "vs/code/electron-browser/workbench/workbench.html"
    ] = computeChecksum(wbHtml);
  }
}

fs.writeFileSync(productPath, JSON.stringify(product, null, "\t") + "\n");
console.log("product patched and checksums updated");

// Disable Microsoft and GitHub auth extensions
for (const ext of ["microsoft-authentication", "github-authentication"]) {
  const src = path.join(RESOURCES, "extensions", ext);
  const dest = path.join(RESOURCES, "extensions", `${ext}.DISABLED`);
  if (fs.existsSync(src)) {
    console.log(`Disabling extension: ${ext}`);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(src, dest);
  }
}

console.log(`Branding applied to ${APP}`);
