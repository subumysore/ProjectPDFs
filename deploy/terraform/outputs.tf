output "public_ip" {
  description = "The instance's public IP — point your DNS A record here."
  value       = oci_core_instance.web.public_ip
}

output "next_steps" {
  value = <<-EOT

    ✅ Instance created. One manual step remains (FreeDNS has no Terraform provider):

      1) In FreeDNS, set the A record for ${var.domain}  ->  ${oci_core_instance.web.public_ip}

    Then, once DNS resolves, the site auto-provisions HTTPS (cloud-init already ran the
    installer on boot). Verify:

      curl -I https://${var.domain}/
      curl -I https://${var.domain}/privacy/

    If HTTPS isn't up within a few minutes of DNS resolving, SSH in and check the log:
      ssh ubuntu@${oci_core_instance.web.public_ip}
      sudo tail -n 50 /var/log/pff-install.log
      sudo systemctl restart caddy
  EOT
}
