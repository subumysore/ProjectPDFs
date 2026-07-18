# Hosting the desktop installer on Oracle Object Storage

The Windows installer is too big for the surge static host, so it's served from an
Oracle Cloud **Object Storage** bucket via a **pre-authenticated request (PAR)** — a
public read URL with no login. Done entirely with the OCI CLI (already configured).

- **Namespace:** `idlqdkwlstnb` · **Region:** `us-ashburn-1` · **Bucket:** `polyglotformfill-dl`
- **Objects:** `PolyglotFormFill_0.1.0_x64-setup.exe`, `PolyglotFormFill_0.1.0_x64_en-US.msi`
- The PAR URLs are wired into `landing.html` + `site/install/index.html`.

## Update the installer later (URL stays the same)
Re-upload the SAME object name — the existing PAR keeps working:
```bash
oci os object put --namespace idlqdkwlstnb --bucket-name polyglotformfill-dl \
  --name PolyglotFormFill_0.1.0_x64-setup.exe \
  --file target/release/bundle/nsis/PolyglotFormFill_0.1.0_x64-setup.exe --force
```

## Re-create a PAR (e.g. after expiry — set to 2035)
```bash
oci os preauth-request create --namespace idlqdkwlstnb --bucket-name polyglotformfill-dl \
  --name pff-setup --object-name PolyglotFormFill_0.1.0_x64-setup.exe \
  --access-type ObjectRead --time-expires 2035-01-01T00:00:00Z --query 'data."access-uri"' --raw-output
# Full URL = https://objectstorage.us-ashburn-1.oraclecloud.com<access-uri>
```

## Tear down
```bash
oci os object bulk-delete --namespace idlqdkwlstnb --bucket-name polyglotformfill-dl --force
oci os bucket delete --namespace idlqdkwlstnb --name polyglotformfill-dl --force
```
