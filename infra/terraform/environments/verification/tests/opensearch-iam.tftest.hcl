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

run "opensearch_permissions_are_opt_in" {
  command = plan
  module {
    source = "../../modules/iam"
  }
  assert {
    condition     = length(aws_iam_role_policy.application_opensearch) == 0
    error_message = "A disabled or deferred search runtime must not have OpenSearch permissions."
  }
}

run "only_the_actual_domain_and_two_alias_routes_are_allowed" {
  command = plan
  module {
    source = "../../modules/iam"
  }
  variables {
    opensearch = { domain_arn = "arn:aws:es:ap-northeast-1:123456789012:domain/bidflow-verification-search" }
  }
  assert {
    condition = jsondecode(aws_iam_role_policy.application_opensearch[0].policy).Statement == [
      {
        Effect   = "Allow"
        Action   = ["es:ESHttpPost"]
        Resource = ["arn:aws:es:ap-northeast-1:123456789012:domain/bidflow-verification-search/bidflow-products-read/_search"]
      },
      {
        Effect   = "Allow"
        Action   = ["es:ESHttpPut"]
        Resource = ["arn:aws:es:ap-northeast-1:123456789012:domain/bidflow-verification-search/bidflow-products-write/_doc/*"]
      },
    ]
    error_message = "App IAM must not have alias, index, delete or domain management access."
  }
}

run "reject_domain_from_another_account" {
  command = plan
  module {
    source = "../../modules/iam"
  }
  variables {
    opensearch = { domain_arn = "arn:aws:es:ap-northeast-1:999999999999:domain/bidflow-verification-search" }
  }
  expect_failures = [var.opensearch]
}
