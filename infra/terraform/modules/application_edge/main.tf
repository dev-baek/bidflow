resource "aws_ecr_repository" "application" {
  name                 = "${var.name}-application"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "application" {
  repository = aws_ecr_repository.application.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the five newest untagged verification images."
      selection = {
        tagStatus   = "untagged"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_lb" "application" {
  name                       = "${var.name}-alb"
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [var.alb_security_group_id]
  subnets                    = var.public_subnet_ids
  drop_invalid_header_fields = true
  enable_deletion_protection = false
}

resource "aws_lb_target_group" "application" {
  name        = "${var.name}-app"
  port        = 8080
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = var.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 2
    interval            = 15
    timeout             = 5
    matcher             = "200"
    path                = "/actuator/health/readiness"
    protocol            = "HTTP"
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.application.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.application.arn
  }
}
