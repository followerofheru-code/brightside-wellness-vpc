# ─────────────────────────────────────────
# Brightside Wellness — Variables
# ─────────────────────────────────────────

variable "aws_region" {
  description = "AWS region — us-west-2 for this project"
  type        = string
  default     = "us-west-2"
}

variable "admin_ip" {
  description = "Your IP for SSH access — format: x.x.x.x/32"
  type        = string
}
