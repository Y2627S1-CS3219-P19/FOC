# aws-infra-plan.txt NETWORK. One VPC over 2 AZs:
#   public subnets  - only the ALB and the NAT instance (they need public IPs)
#   private subnets - every Fargate task (incl. RabbitMQ) and RDS (no public IPs, not reachable from the internet)

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true # RDS / MQ endpoints are DNS names

  tags = { Name = "foc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "foc" }
}

# 10.0.0.0/24, 10.0.1.0/24
resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true # the NAT instance gets its public IP from this

  tags = { Name = "foc-public-${local.azs[count.index]}" }
}

# 10.0.10.0/24, 10.0.11.0/24
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, 10 + count.index)
  availability_zone = local.azs[count.index]

  tags = { Name = "foc-private-${local.azs[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "foc-public" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# One per private subnet. Their 0.0.0.0/0 route (-> NAT instance) is added by the fck-nat module.
resource "aws_route_table" "private" {
  count  = 2
  vpc_id = aws_vpc.main.id
  tags   = { Name = "foc-private-${local.azs[count.index]}" }
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# Outbound internet for the private tasks (ECR, CloudWatch Logs, SSM, Gmail SMTP). A t4g.nano NAT
# instance (~US$5/month) instead of a NAT Gateway (~US$32/month). ha_mode = an Auto Scaling group of 1
# that replaces the instance if it dies, keeping the same network interface (so routes stay valid).
module "nat" {
  source  = "RaJiska/fck-nat/aws"
  version = "~> 1.3"

  name          = "foc-nat"
  vpc_id        = aws_vpc.main.id
  subnet_id     = aws_subnet.public[0].id
  instance_type = "t4g.nano"
  ha_mode       = true

  update_route_tables = true
  route_tables_ids = {
    "private-0" = aws_route_table.private[0].id
    "private-1" = aws_route_table.private[1].id
  }
}

# Free. ECR image layers are stored in S3, so most of an image pull skips the NAT instance.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.private[*].id

  tags = { Name = "foc-s3" }
}

# ---- Security groups -------------------------------------------------------------------------
# Only the ALB accepts traffic from outside, and only from CloudFront.

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "foc-alb"
  description = "ALB: HTTP from CloudFront only"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  security_group_id = aws_security_group.alb.id
  description       = "CloudFront origin-facing IPs"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_to_vpc" {
  security_group_id = aws_security_group.alb.id
  description       = "To the gateway and keycloak tasks (and their health checks)"
  cidr_ipv4         = aws_vpc.main.cidr_block
  ip_protocol       = "-1"
}

# One group shared by every ECS task (simpler than one per service; the service-to-service rules
# that matter - DB per service, /v1/internal auth - are enforced by DB users and the shared secret).
resource "aws_security_group" "tasks" {
  name        = "foc-tasks"
  description = "ECS tasks: from each other and from the ALB"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_tasks" {
  security_group_id            = aws_security_group.tasks.id
  description                  = "Service Connect traffic between tasks"
  referenced_security_group_id = aws_security_group.tasks.id
  ip_protocol                  = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  for_each = { gateway = 80, keycloak = 8080, keycloak-health = 9000 }

  security_group_id            = aws_security_group.tasks.id
  description                  = "ALB to ${each.key}"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
}

resource "aws_vpc_security_group_egress_rule" "tasks_all" {
  security_group_id = aws_security_group.tasks.id
  description       = "Other tasks, RDS, and the internet via the NAT instance"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "rds" {
  name        = "foc-rds"
  description = "Postgres from ECS tasks only"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_tasks" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.tasks.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
