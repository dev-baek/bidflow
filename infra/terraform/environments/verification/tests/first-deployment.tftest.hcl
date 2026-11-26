mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_region" {
    defaults = { region = "ap-northeast-1" }
  }
  mock_data "aws_availability_zones" {
    defaults = { names = ["ap-northeast-1a", "ap-northeast-1c"] }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_resource "aws_ecr_repository" {
    defaults = { repository_url = "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/bidflow-verification-application" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:loadbalancer/app/bidflow/0011223344556677" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:targetgroup/bidflow/0011223344556677" }
  }
  mock_resource "aws_launch_template" {
    defaults = { id = "lt-0011223344556677", latest_version = 1 }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      master_user_secret = [{
        secret_arn = "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:rds-mock"
      }]
    }
  }
}

mock_provider "random" {}

variables {
  expected_account_id      = "123456789012"
  region                   = "ap-northeast-1"
  owner                    = "mock-only"
  ttl                      = "2030-01-01T00:00:00Z"
  github_oidc_provider_arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
  alb_certificate_arn      = "arn:aws:acm:ap-northeast-1:123456789012:certificate/11111111-2222-4333-8444-555555555555"
}

run "first_plan_needs_no_runtime_inputs" {
  command = plan
  variables {
    enable_application_runtime = false
  }

  assert {
    condition     = length(module.private_runtime) == 0 && output.application_autoscaling_group_name == null
    error_message = "The first plan must omit the entire runtime module (ASG and Launch Template)."
  }
}

run "prepare_repository_without_instances" {
  command = apply
  variables {
    enable_application_runtime = false
  }

  assert {
    condition     = output.application_ecr_repository_url == "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/bidflow-verification-application" && output.application_autoscaling_group_name == null
    error_message = "The artifact stage must publish the ECR repository URL without creating instances."
  }
}

run "default_runtime_requires_inputs" {
  command         = plan
  expect_failures = [var.application_ami_id, var.application_image, var.application_runtime_secret_arn]
}

run "runtime_rejects_image_tag" {
  command = plan
  variables {
    application_ami_id             = "ami-123abc"
    application_image              = "${run.prepare_repository_without_instances.application_ecr_repository_url}:latest"
    application_runtime_secret_arn = "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:mock-only"
    enable_nat_gateway             = true
  }
  expect_failures = [var.application_image]
}

run "runtime_rejects_other_repository_and_secret_account" {
  command = plan
  variables {
    application_ami_id             = "ami-123abc"
    application_image              = "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/another@sha256:${sha256("mock image")}"
    application_runtime_secret_arn = "arn:aws:secretsmanager:ap-northeast-1:999999999999:secret:mock-only"
    enable_nat_gateway             = true
  }
  expect_failures = [var.application_image, var.application_runtime_secret_arn]
}

run "activate_instances_in_the_same_state" {
  command = apply
  variables {
    application_ami_id             = "ami-123abc"
    application_image              = "${run.prepare_repository_without_instances.application_ecr_repository_url}@sha256:${sha256("mock image")}"
    application_runtime_secret_arn = "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:mock-only"
    enable_nat_gateway             = true
  }

  assert {
    condition     = length(module.private_runtime) == 1 && output.application_autoscaling_group_name == "bidflow-verification-application" && output.application_ecr_repository_url == run.prepare_repository_without_instances.application_ecr_repository_url
    error_message = "Activation must create the runtime using the previously prepared repository in the same state."
  }
}
