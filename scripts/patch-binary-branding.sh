#!/usr/bin/env bash
# Apply Grok Code branding onto an extracted VS Code app tree
set -euo pipefail
APP="${1:-/tmp/vscode-extract/usr/share/code}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UI="$ROOT/vscode-mcp/grok-code-ui"
MEDIA="$UI/media"

# 1. Rebrand icons & letters
cp "$MEDIA/icon-512.png" "$APP/resources/app/resources/linux/code.png"
for f in letterpress-dark.svg letterpress-light.svg letterpress-hcDark.svg letterpress-hcLight.svg code-icon.svg vscode-icon.svg; do
  cp "$MEDIA/$f" "$APP/resources/app/out/media/$f"
done

# 2. Inject grok-code.css and update workbench.html
WB="$APP/resources/app/out/vs/code/electron-browser/workbench"
cp "$UI/brand/grok-code.css" "$WB/grok-code.css"
if ! grep -q 'grok-code.css' "$WB/workbench.html"; then
  sed -i 's|workbench.desktop.main.css">|workbench.desktop.main.css">\n\t\t<link rel="stylesheet" href="./grok-code.css">\n\t\t<title>Grok Code</title>|' "$WB/workbench.html"
fi

# 3. Patch product.json & update modified file checksums
python3 - <<PY
import json, hashlib, base64, os

app_dir = "$APP"
path = f"{app_dir}/resources/app/product.json"
with open(path) as f:
    p = json.load(f)

# Update branding and telemetry keys
p.update({
  "nameShort": "Grok Code",
  "nameLong": "Grok Code",
  "applicationName": "grok-code",
  "dataFolderName": ".grok-code",
  "linuxIconName": "grok-code",
  "urlProtocol": "grok-code",
  "enableTelemetry": False,
  "showTelemetryOptOut": False,
  "appCenter": {},
  "aiConfig": {},
  "msftInternalDomains": [],
  "trustedExtensionPublishers": ["grok-labs"],
  "trustedExtensionAuthAccess": {},
  "documentationUrl": "",
  "serverDocumentationUrl": "",
  "releaseNotesUrl": "",
  "newsletterSignupUrl": "",
  "youTubeUrl": "",
  "requestFeatureUrl": "",
  "reportIssueUrl": "https://grok.x.ai/issues",
  "reportMarketplaceIssueUrl": "",
  "licenseUrl": "https://grok.x.ai/license",
  "serverLicenseUrl": "https://grok.x.ai/license",
  "privacyStatementUrl": "",
  "npsSurveyUrl": "",
  "checksumFailMoreInfoUrl": "",
  "settingsSearchUrl": "",
  "surveys": [],
  "voiceWsUrl": "",
  "nodejsArtifactFeed": "",
  "electronArtifactFeed": ""
})

# Calculate new checksum for the modified workbench.html
def compute_checksum(file_path):
    with open(file_path, "rb") as f:
        data = f.read()
    sha = hashlib.sha256(data).digest()
    return base64.b64encode(sha).decode("utf-8").replace("=", "")

if "checksums" in p:
    wb_html_path = f"{app_dir}/resources/app/out/vs/code/electron-browser/workbench/workbench.html"
    if os.path.exists(wb_html_path):
        new_chk = compute_checksum(wb_html_path)
        p["checksums"]["vs/code/electron-browser/workbench/workbench.html"] = new_chk

with open(path, "w") as f:
    json.dump(p, f, indent="\t")
    f.write("\n")

print("product patched and checksums updated")
PY

# Disable Microsoft and GitHub auth extensions to strip upstream auth services
for ext in microsoft-authentication github-authentication; do
  if [[ -d "$APP/resources/app/extensions/$ext" ]]; then
    echo "Disabling extension: $ext"
    rm -rf "$APP/resources/app/extensions/$ext.DISABLED"
    mv "$APP/resources/app/extensions/$ext" "$APP/resources/app/extensions/$ext.DISABLED"
  fi
done

echo "Branding applied to $APP"
