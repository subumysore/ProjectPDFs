# Host PolyglotFormFill on your Oracle Cloud Free Tier VM

End result: `https://polyglotformfill.com` serving the landing page, with
`https://polyglotformfill.com/privacy/` for the privacy policy — automatic HTTPS.

You have an Oracle VM already (the one behind `hospital-nexus.mooo.com → 129.80.176.230`).
You can reuse it (add a second site) or spin up another Always-Free VM. Below assumes an
**Ubuntu** VM; note its **public IP** (call it `<VM_IP>`).

---

## Step 1 — Point the subdomain at your Oracle VM (FreeDNS)
In FreeDNS → **Subdomains**, edit `polyglotformfill.com`:
- Change the **A** record from `45.37.194.118` to **`<VM_IP>`** (your Oracle VM's public IP).
- Save. (Propagation: minutes.) Verify from your PC: `nslookup polyglotformfill.com`.

## Step 2 — Open ports 80 and 443 (Oracle has TWO firewalls — do both)
**(a) Cloud firewall — Security List / NSG:** Oracle Console → Networking → your VCN →
**Security Lists** (or the VM's NSG) → **Add Ingress Rules**:
- Source `0.0.0.0/0`, IP Protocol **TCP**, Destination port **80**
- Source `0.0.0.0/0`, IP Protocol **TCP**, Destination port **443**

**(b) OS firewall on the VM (Oracle Ubuntu images block by default):**
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save     # persist across reboots
```
(If your VM uses `firewalld`/`ufw` instead, open 80/443 there.)

## Step 3 — Get the site files onto the VM
From your **Windows PC** (in the repo folder), copy the built `site/` folder up via SCP
(use your Oracle SSH key):
```bash
scp -r -i <your-key.pem> docs/marketing/site ubuntu@<VM_IP>:/tmp/pff-site
```
> The files are `index.html`, `privacy/index.html`, `404.html`, `Caddyfile`. (Regenerate
> anytime with `node docs/marketing/build-site.mjs`.)

Then on the VM:
```bash
sudo mkdir -p /var/www/polyglotformfill
sudo cp -r /tmp/pff-site/index.html /tmp/pff-site/privacy /tmp/pff-site/404.html /var/www/polyglotformfill/
sudo chown -R caddy:caddy /var/www/polyglotformfill   # (after installing Caddy, below)
```

## Step 4 — Install Caddy (automatic HTTPS) and point it at the site
On the VM:
```bash
sudo apt update
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# Install our Caddyfile (from /tmp/pff-site/Caddyfile)
sudo cp /tmp/pff-site/Caddyfile /etc/caddy/Caddyfile
sudo chown -R caddy:caddy /var/www/polyglotformfill
sudo systemctl restart caddy
sudo systemctl status caddy --no-pager
```
Caddy will automatically obtain a Let's Encrypt certificate for `polyglotformfill.com`
(this needs Steps 1–2 done first, so port 80/443 reach the VM and DNS resolves).

## Step 5 — Verify
From your PC:
```bash
curl -I https://polyglotformfill.com/
curl -I https://polyglotformfill.com/privacy/
```
Both should return `HTTP/2 200`. Open the site in a browser — HTTPS padlock, landing page,
and the privacy link working. That privacy URL is what you give the Chrome Web Store.

---

### If you already run a web server on that VM (for hospital-nexus)
- If **Caddy** already serves hospital-nexus: just append this repo's `Caddyfile` block to the
  existing `/etc/caddy/Caddyfile` (Caddy handles multiple sites) and `systemctl reload caddy`.
- If **nginx/apache** owns ports 80/443: either add a vhost there (and use certbot for the cert),
  or run this on a second VM. Don't run two servers on the same port.

### Reminders before public launch
- Fill the privacy-policy placeholders (`[DATE]`, entity, Grievance Officer, provider, age) and get
  **legal review** (banner on the page).
- Wire the landing page's store/download buttons (currently `href="#"`).
