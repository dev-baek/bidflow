data "aws_partition" "current" {}

locals {
  resource_prefix = "${var.project_name}-${var.environment}"
  log_group_arn   = "arn:${data.aws_partition.current.partition}:logs:${var.region}:${var.account_id}:log-group:/aws/${local.resource_prefix}"
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
}

resource "aws_iam_role_policy" "application_runtime" {
  name   = "${local.resource_prefix}-application-runtime"
  role   = aws_iam_role.application.id
  policy = data.aws_iam_policy_document.application_runtime.json
}

resource "aws_iam_role_policy" "application_opensearch" {
  count = var.opensearch == null ? 0 : 1

  name = "${local.resource_prefix}-application-opensearch"
  role = aws_iam_role.application.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["es:ESHttpPost"]
        Resource = ["${var.opensearch.domain_arn}/bidflow-products-read/_search"]
      },
      {
        Effect   = "Allow"
        Action   = ["es:ESHttpPut"]
        Resource = ["${var.opensearch.domain_arn}/bidflow-products-write/_doc/*"]
      },
    ]
  })
}

resource "aws_iam_role_policy" "application_msk" {
  count = var.msk == null ? 0 : 1

  name = "${local.resource_prefix}-application-msk"
  role = aws_iam_role.application.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["kafka-cluster:Connect", "kafka-cluster:DescribeCluster", "kafka-cluster:WriteDataIdempotently"]
        Resource = [var.msk.cluster_arn]
      },
      {
        Effect = "Allow"
        Action = ["kafka-cluster:DescribeTopic", "kafka-cluster:ReadData", "kafka-cluster:WriteData"]
        Resource = [for topic in ["bid-command", "bid-event", "listing-event", "bid-command.DLT", "bid-event.DLT", "listing-event.DLT"] :
          "${replace(var.msk.cluster_arn, ":cluster/", ":topic/")}/${topic}"
        ]
      },
      {
        Effect = "Allow"
        Action = ["kafka-cluster:DescribeGroup", "kafka-cluster:AlterGroup"]
        Resource = [for group in ["bid-settlement", "realtime-projection", "auction-finalization", "search-projection"] :
          "${replace(var.msk.cluster_arn, ":cluster/", ":group/")}/${group}"
        ]
      },
    ]
  })
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
