# ─────────────────────────────────────────
# Brightside Wellness — VPC Infrastructure
# Project 2 · Beginner+
# Multi-AZ · NAT Gateway · ALB
# ─────────────────────────────────────────

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# ── PROVIDER ──────────────────────────────
provider "aws" {
  region = var.aws_region
}

# ── VPC ───────────────────────────────────
resource "aws_vpc" "brightside_vpc" {
  cidr_block           = "10.1.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name    = "brightside-vpc"
    Project = "Brightside Wellness"
  }
}

# ── SUBNETS ───────────────────────────────

# Public Subnet A — us-west-2a
resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.brightside_vpc.id
  cidr_block              = "10.1.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name    = "brightside-public-a"
    Project = "Brightside Wellness"
    Tier    = "Public"
  }
}

# Public Subnet B — us-west-2b
resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.brightside_vpc.id
  cidr_block              = "10.1.2.0/24"
  availability_zone       = "${var.aws_region}b"
  map_public_ip_on_launch = true

  tags = {
    Name    = "brightside-public-b"
    Project = "Brightside Wellness"
    Tier    = "Public"
  }
}

# Private Subnet A — us-west-2a
resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.brightside_vpc.id
  cidr_block        = "10.1.3.0/24"
  availability_zone = "${var.aws_region}a"

  tags = {
    Name    = "brightside-private-a"
    Project = "Brightside Wellness"
    Tier    = "Private"
  }
}

# Private Subnet B — us-west-2b
resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.brightside_vpc.id
  cidr_block        = "10.1.4.0/24"
  availability_zone = "${var.aws_region}b"

  tags = {
    Name    = "brightside-private-b"
    Project = "Brightside Wellness"
    Tier    = "Private"
  }
}

# ── INTERNET GATEWAY ──────────────────────
resource "aws_internet_gateway" "brightside_igw" {
  vpc_id = aws_vpc.brightside_vpc.id

  tags = {
    Name    = "brightside-igw"
    Project = "Brightside Wellness"
  }
}

# ── ELASTIC IP FOR NAT GATEWAY ────────────
resource "aws_eip" "nat_eip" {
  domain = "vpc"

  tags = {
    Name    = "brightside-nat-eip"
    Project = "Brightside Wellness"
  }
}

# ── NAT GATEWAY ───────────────────────────
# Lives in public subnet A — allows private
# instances outbound internet access only
resource "aws_nat_gateway" "brightside_nat" {
  allocation_id = aws_eip.nat_eip.id
  subnet_id     = aws_subnet.public_a.id

  tags = {
    Name    = "brightside-nat"
    Project = "Brightside Wellness"
  }

  depends_on = [aws_internet_gateway.brightside_igw]
}

# ── ROUTE TABLES ──────────────────────────

# Public route table — routes to IGW
resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.brightside_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.brightside_igw.id
  }

  tags = {
    Name    = "brightside-public-rt"
    Project = "Brightside Wellness"
  }
}

# Private route table A — routes to NAT Gateway
resource "aws_route_table" "private_rt_a" {
  vpc_id = aws_vpc.brightside_vpc.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.brightside_nat.id
  }

  tags = {
    Name    = "brightside-private-rt-a"
    Project = "Brightside Wellness"
  }
}

# Private route table B — routes to NAT Gateway
resource "aws_route_table" "private_rt_b" {
  vpc_id = aws_vpc.brightside_vpc.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.brightside_nat.id
  }

  tags = {
    Name    = "brightside-private-rt-b"
    Project = "Brightside Wellness"
  }
}

# ── ROUTE TABLE ASSOCIATIONS ──────────────
resource "aws_route_table_association" "public_a_assoc" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public_rt.id
}

resource "aws_route_table_association" "public_b_assoc" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public_rt.id
}

resource "aws_route_table_association" "private_a_assoc" {
  subnet_id      = aws_subnet.private_a.id
  route_table_id = aws_route_table.private_rt_a.id
}

resource "aws_route_table_association" "private_b_assoc" {
  subnet_id      = aws_subnet.private_b.id
  route_table_id = aws_route_table.private_rt_b.id
}

# ── SECURITY GROUPS ───────────────────────

# ALB security group — accepts public traffic
resource "aws_security_group" "alb_sg" {
  name        = "brightside-alb-sg"
  description = "Allow HTTP HTTPS from internet to ALB"
  vpc_id      = aws_vpc.brightside_vpc.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP from internet"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS from internet"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "brightside-alb-sg"
    Project = "Brightside Wellness"
  }
}

# Web server security group — only accepts traffic FROM ALB
resource "aws_security_group" "web_sg" {
  name        = "brightside-web-sg"
  description = "Allow traffic only from ALB to web servers"
  vpc_id      = aws_vpc.brightside_vpc.id

  ingress {
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
    description     = "HTTP from ALB only"
  }

  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
    description     = "HTTPS from ALB only"
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_ip]
    description = "SSH admin access"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "brightside-web-sg"
    Project = "Brightside Wellness"
  }
}

# ── APPLICATION LOAD BALANCER ─────────────
resource "aws_lb" "brightside_alb" {
  name               = "brightside-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = [aws_subnet.public_a.id, aws_subnet.public_b.id]

  tags = {
    Name    = "brightside-alb"
    Project = "Brightside Wellness"
  }
}

# ── TARGET GROUP ──────────────────────────
resource "aws_lb_target_group" "brightside_tg" {
  name     = "brightside-tg"
  port     = 80
  protocol = "HTTP"
  vpc_id   = aws_vpc.brightside_vpc.id

  health_check {
    path                = "/"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }

  tags = {
    Name    = "brightside-tg"
    Project = "Brightside Wellness"
  }
}

# ── ALB LISTENER ──────────────────────────
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.brightside_alb.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.brightside_tg.arn
  }
}
