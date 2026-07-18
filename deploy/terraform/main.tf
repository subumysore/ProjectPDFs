# PolyglotFormFill marketing site — one `terraform apply` provisions the network +
# an Always-Free Ubuntu VM and deploys the site (Caddy + auto HTTPS) via cloud-init.

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

# Auto-select the newest Canonical Ubuntu 22.04 image that matches the chosen shape
# (this also picks the correct CPU architecture for x86 vs ARM shapes).
data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = var.instance_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

# --- Network: VCN + internet gateway + public route + public subnet + firewall ---
resource "oci_core_vcn" "vcn" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = ["10.0.0.0/16"]
  display_name   = "pff-vcn"
  dns_label      = "pff"
}

resource "oci_core_internet_gateway" "igw" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "pff-igw"
}

resource "oci_core_route_table" "rt" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "pff-rt"
  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.igw.id
  }
}

resource "oci_core_security_list" "sl" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.vcn.id
  display_name   = "pff-sl"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  # SSH
  ingress_security_rules {
    protocol = "6" # TCP
    source   = "0.0.0.0/0"
    tcp_options {
      min = 22
      max = 22
    }
  }
  # HTTP (needed for the Let's Encrypt challenge + redirect)
  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 80
      max = 80
    }
  }
  # HTTPS
  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 443
      max = 443
    }
  }
}

resource "oci_core_subnet" "subnet" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.vcn.id
  cidr_block                 = "10.0.1.0/24"
  display_name               = "pff-public-subnet"
  dns_label                  = "pub"
  route_table_id             = oci_core_route_table.rt.id
  security_list_ids          = [oci_core_security_list.sl.id]
  prohibit_public_ip_on_vnic = false # public subnet
}

# --- cloud-init: write the installer to the box and run it with the domain ---
locals {
  installer = file("${path.module}/../../docs/marketing/site/install-on-vm.sh")
  # gzip-compressed so it stays under OCI's 32 KB instance-metadata limit;
  # cloud-init detects the gzip magic bytes and decompresses before running it.
  user_data = base64gzip(join("\n", [
    "#!/bin/bash",
    "set -e",
    "cat > /root/install-on-vm.sh <<'PFF_INSTALLER_EOF'",
    local.installer,
    "PFF_INSTALLER_EOF",
    "bash /root/install-on-vm.sh ${var.domain} > /var/log/pff-install.log 2>&1",
  ]))
}

resource "oci_core_instance" "web" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_ocid
  display_name        = "polyglotformfill-web"
  shape               = var.instance_shape

  # shape_config is required only for Flex shapes (e.g. A1.Flex); skipped otherwise.
  dynamic "shape_config" {
    for_each = can(regex("Flex", var.instance_shape)) ? [1] : []
    content {
      ocpus         = var.ocpus
      memory_in_gbs = var.memory_gb
    }
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.subnet.id
    assign_public_ip = true
  }

  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ubuntu.images[0].id
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data           = local.user_data
  }
}
