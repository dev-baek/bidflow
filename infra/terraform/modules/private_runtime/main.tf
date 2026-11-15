locals {
  image_registry = split("@", var.application_image)[0]
}

resource "aws_launch_template" "application" {
  name_prefix   = "${var.name}-application-"
  image_id      = var.ami_id
  instance_type = var.instance_type
  user_data = base64encode(templatefile("${path.module}/user-data.sh.tftpl", {
    application_image       = var.application_image
    database_secret_arn     = var.database_secret_arn
    enable_managed_redis    = var.enable_managed_redis
    enable_managed_kafka    = var.enable_managed_kafka
    enable_managed_search   = var.enable_managed_search
    image_registry          = local.image_registry
    kafka_bootstrap_brokers = var.kafka_bootstrap_brokers
    region                  = var.region
    redis_endpoint          = var.redis_endpoint
    redis_secret_arn        = var.redis_secret_arn
    opensearch_endpoint     = var.opensearch_endpoint
    runtime_secret_arn      = var.runtime_secret_arn
  }))

  iam_instance_profile {
    name = var.application_instance_profile_name
  }

  monitoring {
    enabled = true
  }

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  network_interfaces {
    associate_public_ip_address = false
    delete_on_termination       = true
    security_groups             = [var.application_security_group_id]
  }

  block_device_mappings {
    device_name = "/dev/xvda"

    ebs {
      delete_on_termination = true
      encrypted             = true
      volume_size           = 20
      volume_type           = "gp3"
    }
  }

  tag_specifications {
    resource_type = "instance"

    tags = {
      Name = "${var.name}-application"
      role = "spring-boot-runtime"
    }
  }
}

resource "aws_autoscaling_group" "application" {
  name                      = "${var.name}-application"
  min_size                  = var.min_size
  max_size                  = var.max_size
  desired_capacity          = var.desired_capacity
  health_check_type         = "ELB"
  health_check_grace_period = 300
  target_group_arns         = [var.target_group_arn]
  vpc_zone_identifier       = var.application_subnet_ids

  launch_template {
    id      = aws_launch_template.application.id
    version = tostring(aws_launch_template.application.latest_version)
  }

  instance_refresh {
    strategy = "Rolling"

    preferences {
      instance_warmup        = 180
      min_healthy_percentage = 50
    }

  }

  lifecycle {
    precondition {
      condition     = var.enable_nat_gateway
      error_message = "Private runtime needs enable_nat_gateway=true until ECR, Secrets and logging VPC endpoints are implemented."
    }

    precondition {
      condition     = var.min_size >= 2 && var.desired_capacity >= 2 && var.max_size >= var.desired_capacity
      error_message = "Use at least two instances so a rolling refresh retains one healthy ALB target."
    }
  }
}
