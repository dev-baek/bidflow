variable "enable_cloudwatch" {
  description = "Enable observability only during an approved runtime verification window."
  type        = bool
  default     = false
  nullable    = false
}

variable "cloudwatch_alarm_topic_arn" {
  description = "Existing approved SNS standard topic in the verification account and Region; null disables actions."
  type        = string
  default     = null

  validation {
    condition = var.cloudwatch_alarm_topic_arn == null ? true : can(regex(
      "^arn:aws:sns:${var.region}:${var.expected_account_id}:[A-Za-z0-9_-]{1,256}$",
      var.cloudwatch_alarm_topic_arn,
    ))
    error_message = "Use an SNS standard topic ARN in the approved verification account and Region."
  }
}

locals {
  cloudwatch_enabled = var.enable_cloudwatch && var.enable_application_runtime
  bid_namespace      = "BidFlow/Verification"
  bid_filters = {
    BidRequestsReceived    = "{ ($.event = \"bid.request.received\") && ($.outcome = \"RECEIVED\") }"
    BidSettlementsAccepted = "{ ($.event = \"bid.settled\") && ($.outcome = \"ACCEPTED\") }"
    BidSettlementsRejected = "{ ($.event = \"bid.settled\") && (($.outcome = \"BID_TOO_LOW\") || ($.outcome = \"SELF_BID\") || ($.outcome = \"AUCTION_ENDED\") || ($.outcome = \"AUCTION_NOT_STARTED\") || ($.outcome = \"NOT_ACTIVE\")) }"
  }
  target_5xx = {
    namespace  = "AWS/ApplicationELB"
    metric     = "HTTPCode_Target_5XX_Count"
    dimensions = { LoadBalancer = module.application_edge.alb_arn_suffix }
    statistic  = "Sum"
    operator   = "GreaterThanOrEqualToThreshold"
    threshold  = 1
    periods    = 1
  }
  settlement_lag = {
    namespace = "AWS/Kafka"
    metric    = "SumOffsetLag"
    dimensions = {
      "Cluster Name"   = module.managed_kafka.cluster_name
      "Consumer Group" = "bid-settlement"
      "Topic"          = "bid-command"
    }
    statistic = "Maximum"
    operator  = "GreaterThanThreshold"
    threshold = 0
    periods   = 3
  }
}

resource "aws_cloudwatch_log_group" "verification" {
  count = local.cloudwatch_enabled ? 1 : 0

  name              = "/aws/${local.verification_name}"
  log_group_class   = "STANDARD"
  retention_in_days = 7
  skip_destroy      = false

  depends_on = [terraform_data.verification_guard]
}

resource "aws_cloudwatch_log_metric_filter" "bid" {
  for_each = local.cloudwatch_enabled ? local.bid_filters : {}

  name           = each.key
  log_group_name = aws_cloudwatch_log_group.verification[0].name
  pattern        = each.value

  metric_transformation {
    name          = each.key
    namespace     = local.bid_namespace
    value         = "1"
    default_value = 0
    unit          = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "verification" {
  for_each = merge(
    local.cloudwatch_enabled ? { "target-5xx" = local.target_5xx } : {},
    local.cloudwatch_enabled && var.enable_managed_kafka ? { "settlement-lag" = local.settlement_lag } : {},
  )

  alarm_name          = "${local.verification_name}-${each.key}"
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  statistic           = each.value.statistic
  period              = 60
  comparison_operator = each.value.operator
  threshold           = each.value.threshold
  evaluation_periods  = each.value.periods
  datapoints_to_alarm = each.value.periods
  treat_missing_data  = "missing"
  actions_enabled     = var.cloudwatch_alarm_topic_arn != null
  alarm_actions       = var.cloudwatch_alarm_topic_arn == null ? [] : [var.cloudwatch_alarm_topic_arn]

  depends_on = [terraform_data.verification_guard]
}

resource "aws_cloudwatch_dashboard" "verification" {
  count = local.cloudwatch_enabled ? 1 : 0

  dashboard_name = local.verification_name
  dashboard_body = jsonencode({
    start          = "-PT3H"
    periodOverride = "inherit"
    widgets = [for idx, widget in concat([
      {
        title   = "Bid receipts and settlement outcomes"
        metrics = [for name in keys(local.bid_filters) : [local.bid_namespace, name]]
        stat    = "Sum"
      },
      {
        title   = "ALB requests and HTTP 5xx"
        metrics = [for name in ["RequestCount", local.target_5xx.metric, "HTTPCode_ELB_5XX_Count"] : [local.target_5xx.namespace, name, "LoadBalancer", local.target_5xx.dimensions.LoadBalancer]]
        stat    = local.target_5xx.statistic
      },
      ], var.enable_managed_kafka ? [{
        title   = "Bid settlement consumer lag"
        metrics = [concat([local.settlement_lag.namespace, local.settlement_lag.metric], flatten([for k, v in local.settlement_lag.dimensions : [k, v]]))]
        stat    = local.settlement_lag.statistic
      }] : []) : {
      type   = "metric"
      x      = (idx % 2) * 12
      y      = floor(idx / 2) * 6
      width  = 12
      height = 6
      properties = merge(widget, {
        region = var.region
        period = 60
        view   = "timeSeries"
      })
    }]
  })

  depends_on = [terraform_data.verification_guard]
}
