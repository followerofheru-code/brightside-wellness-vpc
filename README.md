[brightside-README.md](https://github.com/user-attachments/files/26169212/brightside-README.md)
# Brightside Wellness — Multi-AZ VPC Infrastructure
**Project 2 | Beginner+ | Cloud Engineer Portfolio**

## Business Scenario
Brightside Wellness is a mental health telehealth startup running a patient portal
and appointment booking system. Patient data is sensitive — the architecture keeps
the application layer public-facing while the database tier is completely isolated.
Private instances need outbound internet access for software updates via NAT Gateway.

## Architecture
```
Internet
    │
    ▼
Internet Gateway
    │
    ▼
Application Load Balancer
    │
    ├─────────────────────┐
    ▼                     ▼
Public Subnet A        Public Subnet B
us-west-2a             us-west-2b
10.1.1.0/24            10.1.2.0/24
[NAT Gateway]
    │                     │
    ▼                     ▼
Private Subnet A       Private Subnet B
us-west-2a             us-west-2b
10.1.3.0/24            10.1.4.0/24
```

## What This Project Adds vs Project 1
| Concept | Project 1 | Project 2 |
|---|---|---|
| Availability Zones | 1 | 2 (Multi-AZ) |
| Subnets | 2 | 4 |
| NAT Gateway | ❌ | ✅ |
| Load Balancer | ❌ | ✅ ALB |
| Resilience | Single AZ | High availability |

## Skills Demonstrated
- Multi-AZ VPC design
- NAT Gateway for private subnet outbound access
- Application Load Balancer across multiple AZs
- Security group chaining (web SG only accepts traffic from ALB SG)
- 4-subnet architecture pattern
- Infrastructure as Code with Terraform

## Files
| File | Purpose |
|---|---|
| `main.tf` | All AWS resources |
| `variables.tf` | Input variable definitions |
| `outputs.tf` | Resource IDs + ALB DNS name |
| `terraform.tfvars` | Your environment values |

## How to Deploy
```bash
aws configure
terraform init
terraform plan
terraform apply
# Test: paste ALB DNS name from outputs into browser
terraform destroy
```

## Cost
- VPC, subnets, IGW, route tables, security groups — **$0**
- NAT Gateway — **$0.045/hr** — destroy immediately after testing
- ALB — **$0.008/hr** — destroy immediately after testing
