terraform {
  required_version = ">= 1.3.0"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 5.0.0"
    }
  }
}

# Auth: uses your OCI CLI config (~/.oci/config, DEFAULT profile) by default — the
# same setup you already use for hospital-nexus. To use explicit API-key auth
# instead, set the api_* variables and uncomment the fields below.
provider "oci" {
  region = var.region
  # tenancy_ocid     = var.tenancy_ocid
  # user_ocid        = var.api_user_ocid
  # fingerprint      = var.api_fingerprint
  # private_key_path = var.api_private_key_path
}
