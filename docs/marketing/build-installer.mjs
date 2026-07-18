// Generate a SINGLE self-contained installer script for the Oracle VM.
// It embeds the built site files (base64) so the user only transfers ONE file and
// runs it. Everything OS-side is automated: firewall (iptables), Caddy install,
// site deploy, Caddy config, service start. (DNS + Oracle Security List remain
// web-console actions we cannot perform for the user.)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const site = join(dir, "site");
const b64 = (p) => readFileSync(join(site, p)).toString("base64").replace(/(.{100})/g, "$1\n");

const script = `#!/usr/bin/env bash
# PolyglotFormFill — one-shot installer for an Ubuntu Oracle Cloud VM.
# Usage:   sudo bash install-on-vm.sh [domain]
# Default domain: polyglotformfill.mooo.com
#
# Automates: open ports 80/443 (iptables), install Caddy, deploy the embedded site,
# configure Caddy, start it (Caddy auto-gets a Let's Encrypt HTTPS cert).
#
# YOU must still do two web-console clicks first (we cannot do these for you):
#   1) FreeDNS: point <domain> A record to THIS VM's public IP.
#   2) Oracle Console: VCN Security List -> Ingress rules for TCP 80 and 443 (0.0.0.0/0).
set -euo pipefail

DOMAIN="\${1:-polyglotformfill.mooo.com}"
WEBROOT="/var/www/polyglotformfill"

if [ "\$(id -u)" -ne 0 ]; then echo "Please run with sudo: sudo bash \$0 [domain]"; exit 1; fi
echo "==> Deploying \$DOMAIN"

echo "==> [1/5] Opening ports 80/443 in the OS firewall (iptables)..."
if command -v iptables >/dev/null; then
  iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true
  iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT || true
  (netfilter-persistent save 2>/dev/null || (mkdir -p /etc/iptables && iptables-save > /etc/iptables/rules.v4)) || true
fi

echo "==> [2/5] Installing Caddy (if needed)..."
if ! command -v caddy >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> [3/5] Writing the website to \$WEBROOT..."
mkdir -p "\$WEBROOT/privacy"
base64 -d > "\$WEBROOT/index.html" <<'PFF_INDEX'
${b64("index.html")}
PFF_INDEX
base64 -d > "\$WEBROOT/privacy/index.html" <<'PFF_PRIVACY'
${b64("privacy/index.html")}
PFF_PRIVACY
base64 -d > "\$WEBROOT/404.html" <<'PFF_404'
${b64("404.html")}
PFF_404

echo "==> [4/5] Configuring Caddy for \$DOMAIN..."
cat > /etc/caddy/Caddyfile <<EOF
\$DOMAIN {
	root * \$WEBROOT
	file_server
	encode gzip
}
EOF
chown -R caddy:caddy "\$WEBROOT"

echo "==> [5/5] Starting Caddy..."
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy
sleep 2
systemctl --no-pager --full status caddy | head -n 6 || true

echo ""
echo "=================================================================="
echo " Done on the VM side."
echo " If DNS (step 1) and the Oracle Security List (step 2) are set,"
echo " Caddy will fetch an HTTPS certificate within ~30s."
echo ""
echo " Verify:"
echo "   curl -I https://\$DOMAIN/"
echo "   curl -I https://\$DOMAIN/privacy/"
echo " Both should return HTTP/2 200."
echo "=================================================================="
`;

writeFileSync(join(site, "install-on-vm.sh"), script);
console.log("wrote site/install-on-vm.sh (", (script.length / 1024).toFixed(1), "KB, site embedded )");
