mock_provider "aws" {}

variables {
  name                              = "bidflow-mock"
  region                            = "ap-northeast-1"
  vpc_id                            = "vpc-1234"
  application_subnet_ids            = ["subnet-1111", "subnet-2222"]
  application_security_group_id     = "sg-1234"
  application_instance_profile_name = "mock"
  target_group_arn                  = "arn:aws:elasticloadbalancing:ap-northeast-1:123456789012:targetgroup/mock/1234567890123456"
  ami_id                            = "ami-123abc"
  application_image                 = "123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/bidflow@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  runtime_secret_arn                = "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:mock-only"
  database_secret_arn               = "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:db-mock-only"
  enable_managed_kafka              = false
  enable_managed_redis              = false
  enable_managed_search             = false
  kafka_bootstrap_brokers           = null
  redis_endpoint                    = null
  redis_secret_arn                  = null
  opensearch_endpoint               = null
  enable_nat_gateway                = true
  min_size                          = 2
  desired_capacity                  = 2
  max_size                          = 2
}

run "images_use_role_credentials_and_managed_storage_env" {
  command = plan
  module {
    source = "../../modules/private_runtime"
  }
  variables {
    verification_image_bucket = "bidflow-verification-123456789012-images"
    verification_auth = {
      issuer_uri = "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_test"
      client_id  = "mockclient123"
      web_origin = "https://d123example.cloudfront.net"
    }
  }

  assert {
    condition     = aws_launch_template.application.metadata_options[0].http_tokens == "required" && aws_launch_template.application.metadata_options[0].http_put_response_hop_limit == 2
    error_message = "Docker must be able to reach IMDSv2 without enabling IMDSv1."
  }
  assert {
    condition = strcontains(
      base64decode(aws_launch_template.application.user_data),
      base64encode("SPRING_PROFILES_ACTIVE=verification\nBIDFLOW_COGNITO_ISSUER_URI=https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_test\nBIDFLOW_COGNITO_CLIENT_ID=mockclient123\nBIDFLOW_VERIFICATION_WEB_ORIGIN=https://d123example.cloudfront.net\nBIDFLOW_STORAGE_VERIFICATION_BUCKET=bidflow-verification-123456789012-images\nBIDFLOW_STORAGE_VERIFICATION_REGION=ap-northeast-1\n")
    )
    error_message = "EC2 must receive the public image bucket and region, not credentials."
  }
}

run "disabled_does_not_change_runtime_env_handling" {
  command = plan
  module {
    source = "../../modules/private_runtime"
  }

  assert {
    condition     = !strcontains(base64decode(aws_launch_template.application.user_data), "check_verification_runtime_env")
    error_message = "The verification guard must not run when Cognito is disabled."
  }
}

run "enabled_launch_template_guards_and_writes_only_the_managed_values" {
  command = plan
  module {
    source = "../../modules/private_runtime"
  }
  variables {
    verification_auth = {
      issuer_uri = "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_test"
      client_id  = "mockclient123"
      web_origin = "https://d123example.cloudfront.net"
    }
  }

  assert {
    condition = can(regex(
      "check_verification_runtime_env /etc/bidflow/runtime\\.env\n+aws secretsmanager",
      base64decode(aws_launch_template.application.user_data)
      )) && strcontains(
      base64decode(aws_launch_template.application.user_data),
      "printf '%s' '${base64encode("SPRING_PROFILES_ACTIVE=verification\nBIDFLOW_COGNITO_ISSUER_URI=https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_test\nBIDFLOW_COGNITO_CLIENT_ID=mockclient123\nBIDFLOW_VERIFICATION_WEB_ORIGIN=https://d123example.cloudfront.net\n")}' | base64 -d >> /etc/bidflow/runtime-complete.env"
    )
    error_message = "The launch script must stop on a Runtime Secret collision before assembling the exact public environment."
  }
}
