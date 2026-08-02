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
# PolyglotFormFill — one-shot installer for an Oracle Cloud VM.
# Works on Ubuntu/Debian (apt) AND Oracle Linux / RHEL (dnf/yum), x86_64 and ARM64.
# Usage:   sudo bash install-on-vm.sh [domain]
# Default domain: polyglotformfill.com
#
# Automates: open ports 80/443 (firewalld or iptables), install Caddy, deploy the
# embedded site, configure Caddy, start it (Caddy auto-gets a Let's Encrypt cert).
#
# YOU must still do two web-console clicks first (we cannot do these for you):
#   1) FreeDNS: point <domain> A record to THIS VM's public IP.
#   2) Oracle Console: VCN Security List -> Ingress rules for TCP 80 and 443 (0.0.0.0/0).
set -euo pipefail

DOMAIN="\${1:-polyglotformfill.com}"
WEBROOT="/var/www/polyglotformfill"

if [ "\$(id -u)" -ne 0 ]; then echo "Please run with sudo: sudo bash \$0 [domain]"; exit 1; fi
echo "==> Deploying \$DOMAIN"

echo "==> [1/5] Opening ports 80/443 in the OS firewall..."
if systemctl is-active --quiet firewalld 2>/dev/null; then
  firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp || true
  firewall-cmd --reload || true
elif command -v iptables >/dev/null; then
  iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true
  iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT || true
  (netfilter-persistent save 2>/dev/null || (mkdir -p /etc/iptables && iptables-save > /etc/iptables/rules.v4) || service iptables save 2>/dev/null) || true
fi

echo "==> [2/5] Installing Caddy (if needed)..."
if ! command -v caddy >/dev/null; then
  if command -v apt-get >/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy || true
  elif command -v dnf >/dev/null; then
    dnf install -y curl 'dnf-command(copr)' || dnf install -y curl || true
    (dnf install -y epel-release 2>/dev/null || dnf install -y oracle-epel-release-el* 2>/dev/null) || true
    (dnf copr enable -y @caddy/caddy 2>/dev/null && dnf install -y caddy) || true
  elif command -v yum >/dev/null; then
    (yum install -y yum-plugin-copr curl && yum copr enable -y @caddy/caddy && yum install -y caddy) || true
  fi
fi

# Fallback: if no package provided caddy, install the official static binary + service.
if ! command -v caddy >/dev/null; then
  echo "    package install unavailable — using the official static binary..."
  case "\$(uname -m)" in
    x86_64|amd64) ARCH=amd64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) echo "unsupported CPU arch \$(uname -m)"; exit 1 ;;
  esac
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=\${ARCH}" -o /usr/bin/caddy
  chmod +x /usr/bin/caddy
  NOLOGIN="\$(command -v nologin || echo /sbin/nologin)"
  id caddy >/dev/null 2>&1 || useradd --system --home-dir /var/lib/caddy --create-home --shell "\$NOLOGIN" caddy
  mkdir -p /etc/caddy /var/lib/caddy
  cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
Documentation=https://caddyserver.com/docs/
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
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
