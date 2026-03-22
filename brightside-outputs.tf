# ─────────────────────────────────────────
# Brightside Wellness — Outputs
# ─────────────────────────────────────────

output "vpc_id" {
  value = aws_vpc.brightside_vpc.id
}
output "public_subnet_a_id" {
  value = aws_subnet.public_a.id
}
output "public_subnet_b_id" {
  value = aws_subnet.public_b.id
}
output "private_subnet_a_id" {
  value = aws_subnet.private_a.id
}
output "private_subnet_b_id" {
  value = aws_subnet.private_b.id
}
output "alb_dns_name" {
  description = "ALB DNS — paste this in browser to test"
  value       = aws_lb.brightside_alb.dns_name
}
output "nat_gateway_id" {
  value = aws_nat_gateway.brightside_nat.id
}
