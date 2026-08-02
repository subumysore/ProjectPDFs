# Deploy PolyglotFormFill's site to Oracle Cloud — Terraform (IaC)

One `terraform apply` provisions the network + an **Always-Free** Ubuntu VM and, via
cloud-init, installs Caddy and deploys the site with **automatic HTTPS**. It replaces all
the console clicking. FreeDNS is the only manual step (no Terraform provider exists for it).

## What it creates
- VCN + internet gateway + public route table + public subnet
- Security list: ingress **22, 80, 443**; egress all
- One compute instance (Ubuntu 22.04, image auto-selected for the shape/arch), public IP
- cloud-init runs [`docs/marketing/site/install-on-vm.sh`](../../docs/marketing/site/install-on-vm.sh)
  on first boot → Caddy serves `polyglotformfill.com` with a Let's Encrypt cert.

## Prereqs
- **Terraform** installed.
- **OCI CLI configured** (`~/.oci/config`, DEFAULT profile) — the same auth you use for
  hospital-nexus. (Or fill the `api_*` vars in `terraform.tfvars` and uncomment the fields
  in `versions.tf`.)
- An **SSH key pair** (`ssh-keygen -t ed25519`).

## Use
```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: region, tenancy_ocid, compartment_ocid (root = tenancy OCID),
# ssh_public_key (contents of your .pub)

terraform init
terraform plan      # review
terraform apply     # type 'yes'
```
`apply` prints the **public IP** and next steps.

## The one manual step (DNS)
In FreeDNS, set the **A record** for `polyglotformfill.com` → the **public IP** from
the output. Within a few minutes of it resolving, HTTPS comes up automatically. Verify:
```bash
curl -I https://polyglotformfill.com/
curl -I https://polyglotformfill.com/privacy/
```

## Notes
- Default shape is **`VM.Standard.E2.1.Micro`** (x86, Always Free). For ARM Ampere, set
  `instance_shape = "VM.Standard.A1.Flex"` (+ `ocpus`/`memory_gb`) in `terraform.tfvars`.
- To update the site later: re-run `node ../../docs/marketing/build-installer.mjs` (rebuilds
  the embedded installer), then `terraform apply -replace=oci_core_instance.web` to reprovision,
  or just SSH in and re-run the installer.
- **Tear down:** `terraform destroy`.
- If HTTPS doesn't appear: SSH in and `sudo tail -n 50 /var/log/pff-install.log`. Almost always
  it's DNS not resolving yet or the A record still pointing elsewhere.
