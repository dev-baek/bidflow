mock_provider "aws" {
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

variables {
  account_id               = "123456789012"
  region                   = "ap-northeast-1"
  github_oidc_provider_arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
}

run "no_msk_policy_without_runtime_cluster_input" {
  command = plan
  module {
    source = "../../modules/iam"
  }
  assert {
    condition     = length(aws_iam_role_policy.application_msk) == 0
    error_message = "An absent runtime cluster must not grant MSK access."
  }
}

run "scope_msk_permissions_to_the_real_cluster_topics_and_groups" {
  command = plan
  module {
    source = "../../modules/iam"
  }
  variables {
    msk = { cluster_arn = "arn:aws:kafka:ap-northeast-1:123456789012:cluster/bidflow-verification-kafka/0123-abc-s1" }
  }
  assert {
    condition = jsondecode(aws_iam_role_policy.application_msk[0].policy).Statement == [
      {
        Effect   = "Allow"
        Action   = ["kafka-cluster:Connect", "kafka-cluster:DescribeCluster", "kafka-cluster:WriteDataIdempotently"]
        Resource = ["arn:aws:kafka:ap-northeast-1:123456789012:cluster/bidflow-verification-kafka/0123-abc-s1"]
      },
      {
        Effect = "Allow"
        Action = ["kafka-cluster:DescribeTopic", "kafka-cluster:ReadData", "kafka-cluster:WriteData"]
        Resource = [for name in ["bid-command", "bid-event", "listing-event", "bid-command.DLT", "bid-event.DLT", "listing-event.DLT"] :
          "arn:aws:kafka:ap-northeast-1:123456789012:topic/bidflow-verification-kafka/0123-abc-s1/${name}"
        ]
      },
      {
        Effect = "Allow"
        Action = ["kafka-cluster:DescribeGroup", "kafka-cluster:AlterGroup"]
        Resource = [for name in ["bid-settlement", "realtime-projection", "auction-finalization", "search-projection"] :
          "arn:aws:kafka:ap-northeast-1:123456789012:group/bidflow-verification-kafka/0123-abc-s1/${name}"
        ]
      },
    ]
    error_message = "Application IAM may use only the specified cluster, six topics and four groups, without administrative actions."
  }
}

run "reject_cluster_from_another_account" {
  command = plan
  module {
    source = "../../modules/iam"
  }
  variables {
    msk = { cluster_arn = "arn:aws:kafka:ap-northeast-1:999999999999:cluster/bidflow-verification-kafka/0123-abc-s1" }
  }
  expect_failures = [var.msk]
}
