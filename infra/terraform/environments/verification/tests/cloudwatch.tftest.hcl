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
  mock_resource "aws_lb" {
    defaults = {
      arn        = "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:loadbalancer/app/bidflow/0011223344556677"
      arn_suffix = "app/bidflow/0011223344556677"
    }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:targetgroup/bidflow/0011223344556677" }
  }
  mock_resource "aws_msk_serverless_cluster" {
    defaults = {
      arn                        = "arn:aws:kafka:ap-northeast-1:123456789012:cluster/bidflow-verification-kafka/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-1"
      bootstrap_brokers_sasl_iam = "boot-bidflow.c1.kafka-serverless.ap-northeast-1.amazonaws.com:9098"
    }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      address = "db.example.test"
      master_user_secret = [{
        secret_arn = "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:rds-mock"
      }]
    }
  }
  mock_resource "aws_launch_template" {
    defaults = { id = "lt-0011223344556677", latest_version = 1 }
  }
}

mock_provider "random" {}

variables {
  expected_account_id            = "123456789012"
  region                         = "ap-northeast-1"
  owner                          = "mock-only"
  ttl                            = "2030-01-01T00:00:00Z"
  github_oidc_provider_arn       = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
  alb_certificate_arn            = "arn:aws:acm:ap-northeast-1:123456789012:certificate/11111111-2222-4333-8444-555555555555"
  application_ami_id             = "ami-123abc"
  application_image              = "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/bidflow-verification-application@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  application_runtime_secret_arn = "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:mock-only"
  enable_nat_gateway             = true
}

run "default_is_off" {
  command = plan
  assert {
    condition = (
      length(aws_cloudwatch_dashboard.verification) == 0 &&
      length(aws_cloudwatch_log_group.verification) == 0 &&
      length(aws_cloudwatch_metric_alarm.verification) == 0
    )
    error_message = "CloudWatch observation must require explicit opt-in."
  }
}

run "artifact_stage_keeps_observation_off" {
  command = plan
  variables {
    enable_cloudwatch          = true
    enable_application_runtime = false
  }
  assert {
    condition     = length(aws_cloudwatch_log_group.verification) == 0 && length(aws_cloudwatch_metric_alarm.verification) == 0
    error_message = "Repository preparation must not enable runtime telemetry."
  }
}

run "optional_kafka_and_notifications_are_absent" {
  command = plan
  variables {
    enable_cloudwatch = true
  }
  assert {
    condition = (
      aws_cloudwatch_log_group.verification[0].name == "/aws/bidflow-verification" &&
      aws_cloudwatch_log_group.verification[0].retention_in_days == 7 &&
      aws_cloudwatch_log_group.verification[0].log_group_class == "STANDARD" &&
      !aws_cloudwatch_log_group.verification[0].skip_destroy &&
      length(aws_cloudwatch_log_metric_filter.bid) == 3 &&
      alltrue([for filter in aws_cloudwatch_log_metric_filter.bid :
        filter.log_group_name == "/aws/bidflow-verification" &&
        filter.metric_transformation[0].namespace == "BidFlow/Verification" &&
        filter.metric_transformation[0].value == "1" &&
        tonumber(filter.metric_transformation[0].default_value) == 0 &&
        filter.metric_transformation[0].unit == "Count" &&
        length(coalesce(filter.metric_transformation[0].dimensions, tomap({}))) == 0
      ])
    )
    error_message = "Bid metrics must count approved logs without dimensions and allow destruction."
  }
  assert {
    condition = (
      aws_cloudwatch_log_metric_filter.bid["BidRequestsReceived"].pattern == "{ ($.event = \"bid.request.received\") && ($.outcome = \"RECEIVED\") }" &&
      aws_cloudwatch_log_metric_filter.bid["BidSettlementsAccepted"].pattern == "{ ($.event = \"bid.settled\") && ($.outcome = \"ACCEPTED\") }" &&
      aws_cloudwatch_log_metric_filter.bid["BidSettlementsRejected"].pattern == "{ ($.event = \"bid.settled\") && (($.outcome = \"BID_TOO_LOW\") || ($.outcome = \"SELF_BID\") || ($.outcome = \"AUCTION_ENDED\") || ($.outcome = \"AUCTION_NOT_STARTED\") || ($.outcome = \"NOT_ACTIVE\")) }"
    )
    error_message = "Only exact events and allowlisted outcomes may be matched."
  }
  assert {
    condition = (
      length(aws_cloudwatch_metric_alarm.verification) == 1 &&
      !aws_cloudwatch_metric_alarm.verification["target-5xx"].actions_enabled &&
      length(coalesce(aws_cloudwatch_metric_alarm.verification["target-5xx"].alarm_actions, toset([]))) == 0 &&
      aws_cloudwatch_metric_alarm.verification["target-5xx"].treat_missing_data == "missing" &&
      aws_cloudwatch_metric_alarm.verification["target-5xx"].comparison_operator == "GreaterThanOrEqualToThreshold" &&
      aws_cloudwatch_metric_alarm.verification["target-5xx"].threshold == 1
    )
    error_message = "Kafka and notifications are optional; missing target data is not success."
  }
}

run "enabled_cloudwatch_uses_exact_dimensions" {
  command = apply
  variables {
    enable_cloudwatch          = true
    enable_managed_kafka       = true
    cloudwatch_alarm_topic_arn = "arn:aws:sns:ap-northeast-1:123456789012:bidflow-test"
  }
  assert {
    condition = (
      aws_cloudwatch_metric_alarm.verification["settlement-lag"].namespace == "AWS/Kafka" &&
      aws_cloudwatch_metric_alarm.verification["settlement-lag"].metric_name == "SumOffsetLag" &&
      aws_cloudwatch_metric_alarm.verification["settlement-lag"].dimensions == tomap({
        "Cluster Name"   = "bidflow-verification-kafka"
        "Consumer Group" = "bid-settlement"
        "Topic"          = "bid-command"
      }) &&
      aws_cloudwatch_metric_alarm.verification["settlement-lag"].period == 60 &&
      aws_cloudwatch_metric_alarm.verification["settlement-lag"].statistic == "Maximum" &&
      aws_cloudwatch_metric_alarm.verification["settlement-lag"].evaluation_periods == 3 &&
      aws_cloudwatch_metric_alarm.verification["settlement-lag"].datapoints_to_alarm == 3 &&
      aws_cloudwatch_metric_alarm.verification["settlement-lag"].comparison_operator == "GreaterThanThreshold" &&
      aws_cloudwatch_metric_alarm.verification["settlement-lag"].threshold == 0 &&
      alltrue([for alarm in aws_cloudwatch_metric_alarm.verification :
        alarm.treat_missing_data == "missing" && alarm.actions_enabled &&
        contains(alarm.alarm_actions, "arn:aws:sns:ap-northeast-1:123456789012:bidflow-test")
      ])
    )
    error_message = "Lag and notifications must follow the agreed MSK and alarm contracts."
  }
  assert {
    condition = (
      length(jsondecode(aws_cloudwatch_dashboard.verification[0].dashboard_body).widgets) == 3 &&
      jsondecode(aws_cloudwatch_dashboard.verification[0].dashboard_body).widgets[1].properties.metrics[1][1] == "HTTPCode_Target_5XX_Count" &&
      jsondecode(aws_cloudwatch_dashboard.verification[0].dashboard_body).widgets[1].properties.metrics[2][1] == "HTTPCode_ELB_5XX_Count" &&
      aws_cloudwatch_metric_alarm.verification["target-5xx"].dimensions["LoadBalancer"] == "app/bidflow/0011223344556677"
    )
    error_message = "Dashboard must separate target and load balancer errors and alarm on the load balancer suffix."
  }
}

run "reject_notification_in_other_account" {
  command = plan
  variables {
    enable_cloudwatch          = true
    cloudwatch_alarm_topic_arn = "arn:aws:sns:ap-northeast-1:999999999999:bidflow-test"
  }
  expect_failures = [var.cloudwatch_alarm_topic_arn]
}

run "runtime_can_only_write_to_the_verification_streams" {
  command = plan
  module {
    source = "../../modules/iam"
  }
  variables {
    account_id = "123456789012"
  }
  assert {
    condition = one(jsondecode(aws_iam_role_policy.application_runtime.policy).Statement) == {
      Sid      = "WriteApplicationLogs"
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = ["arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws/bidflow-verification:log-stream:*"]
    }
    error_message = "EC2 may write only to verification streams; it must not create groups or read logs."
  }
}
