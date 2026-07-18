variable "region" {
  description = "OCI region, e.g. us-ashburn-1"
  type        = string
}

variable "tenancy_ocid" {
  description = "Your tenancy OCID (used to list availability domains)"
  type        = string
}

variable "compartment_ocid" {
  description = "Compartment to create resources in (use the tenancy OCID for the root compartment / Always Free)"
  type        = string
}

variable "ssh_public_key" {
  description = "SSH public key CONTENT (e.g. contents of ~/.ssh/id_ed25519.pub) for the 'ubuntu' user"
  type        = string
}

variable "domain" {
  description = "The hostname to serve (must be pointed at the instance's public IP in DNS)"
  type        = string
  default     = "polyglotformfill.mooo.com"
}

variable "instance_shape" {
  description = "Always-Free eligible shape. x86: VM.Standard.E2.1.Micro. ARM: VM.Standard.A1.Flex."
  type        = string
  default     = "VM.Standard.E2.1.Micro"
}

variable "ocpus" {
  description = "OCPUs (only used for Flex shapes like A1.Flex)"
  type        = number
  default     = 1
}

variable "memory_gb" {
  description = "Memory in GB (only used for Flex shapes like A1.Flex)"
  type        = number
  default     = 6
}

# --- Optional explicit API-key auth (otherwise the OCI CLI config file is used) ---
variable "api_user_ocid" {
  type    = string
  default = ""
}
variable "api_fingerprint" {
  type    = string
  default = ""
}
variable "api_private_key_path" {
  type    = string
  default = ""
}
