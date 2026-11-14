provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project     = "bidflow"
      environment = var.environment
      managed-by  = "terraform"
      owner       = var.owner
      ttl         = var.ttl
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

resource "terraform_data" "verification_guard" {
  input = {
    account_id = data.aws_caller_identity.current.account_id
    region     = data.aws_region.current.region
    ttl        = var.ttl
  }

  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.expected_account_id
      error_message = "The active AWS account is not the approved verification account."
    }

    precondition {
      condition     = data.aws_region.current.region == var.region
      error_message = "The active AWS Region does not match the requested verification Region."
    }

    precondition {
      condition     = var.environment == "verification"
      error_message = "Only the verification environment can be managed from this workspace."
    }
  }
}
