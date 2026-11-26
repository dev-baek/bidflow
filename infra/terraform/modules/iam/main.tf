data "aws_partition" "current" {}

locals {
  resource_prefix   = "${var.project_name}-${var.environment}"
  log_group_arn     = "arn:${data.aws_partition.current.partition}:logs:${var.region}:${var.account_id}:log-group:/aws/${local.resource_prefix}"
  kafka_cluster_arn = "arn:${data.aws_partition.current.partition}:kafka:${var.region}:${var.account_id}:cluster/${local.resource_prefix}/*"
  kafka_topic_arn   = "arn:${data.aws_partition.current.partition}:kafka:${var.region}:${var.account_id}:topic/${local.resource_prefix}/*"
  kafka_group_arn   = "arn:${data.aws_partition.current.partition}:kafka:${var.region}:${var.account_id}:group/${local.resource_prefix}/*"
}

data "aws_iam_policy_document" "github_actions_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:verification"]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "${local.resource_prefix}-github-actions"
  assume_role_policy = data.aws_iam_policy_document.github_actions_trust.json
}

data "aws_iam_policy_document" "application_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "application" {
  name               = "${local.resource_prefix}-application"
  assume_role_policy = data.aws_iam_policy_document.application_trust.json
}

resource "aws_iam_instance_profile" "application" {
  name = "${local.resource_prefix}-application"
  role = aws_iam_role.application.name
}

data "aws_iam_policy_document" "application_runtime" {
  statement {
    sid       = "WriteApplicationLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${local.log_group_arn}:log-stream:*"]
  }

  statement {
    sid    = "ConnectToBidFlowKafka"
    effect = "Allow"
    actions = [
      "kafka-cluster:Connect",
      "kafka-cluster:DescribeCluster",
    ]
    resources = [local.kafka_cluster_arn]
  }

  statement {
    sid    = "ReadAndWriteBidFlowKafkaTopics"
    effect = "Allow"
    actions = [
      "kafka-cluster:DescribeTopic",
      "kafka-cluster:ReadData",
      "kafka-cluster:WriteData",
    ]
    resources = [local.kafka_topic_arn]
  }

  statement {
    sid    = "ManageBidFlowKafkaGroups"
    effect = "Allow"
    actions = [
      "kafka-cluster:AlterGroup",
      "kafka-cluster:DescribeGroup",
    ]
    resources = [local.kafka_group_arn]
  }

  dynamic "statement" {
    for_each = var.opensearch_domain_arn == null ? [] : [var.opensearch_domain_arn]

    content {
      sid    = "QueryBidFlowOpenSearch"
      effect = "Allow"
      actions = [
        "es:ESHttpDelete",
        "es:ESHttpGet",
        "es:ESHttpHead",
        "es:ESHttpPost",
        "es:ESHttpPut",
      ]
      resources = ["${statement.value}/*"]
    }
  }
}

resource "aws_iam_role_policy" "application_runtime" {
  name   = "${local.resource_prefix}-application-runtime"
  role   = aws_iam_role.application.id
  policy = data.aws_iam_policy_document.application_runtime.json
}

resource "aws_iam_role_policy" "application_bootstrap" {
  count = var.runtime_bootstrap == null ? 0 : 1

  name = "${local.resource_prefix}-application-bootstrap"
  role = aws_iam_role.application.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = ["*"] },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
        Resource = [var.runtime_bootstrap.ecr_repository_arn]
      },
      {
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = distinct(compact([
          var.runtime_bootstrap.runtime_secret_arn,
          var.runtime_bootstrap.rds_secret_arn,
          var.runtime_bootstrap.redis_secret_arn,
        ]))
      },
    ]
  })
}

resource "aws_iam_role_policy" "application_image_storage" {
  count = var.image_storage == null ? 0 : 1

  name = "${local.resource_prefix}-image-storage"
  role = aws_iam_role.application.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = [var.image_storage.bucket_arn] },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = ["${var.image_storage.bucket_arn}/products/*"] },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "application_ssm" {
  role       = aws_iam_role.application.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
