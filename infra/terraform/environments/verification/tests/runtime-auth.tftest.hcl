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
  database_host                     = "db.example.test"
  database_port                     = 6543
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
  assert {
    condition     = strcontains(base64decode(aws_launch_template.application.user_data), "jdbc:postgresql://db.example.test:6543/bidflow") && strcontains(base64decode(aws_launch_template.application.user_data), "docker login --username AWS --password-stdin '123456789012.dkr.ecr.ap-northeast-1.amazonaws.com'")
    error_message = "Launch data must use the RDS endpoint and port and only the registry host for login."
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
      "check_verification_runtime_env /etc/bidflow/runtime\\.env false false false\n+aws secretsmanager",
      base64decode(aws_launch_template.application.user_data)
      )) && strcontains(
      base64decode(aws_launch_template.application.user_data),
      "printf '%s' '${base64encode("SPRING_PROFILES_ACTIVE=verification\nBIDFLOW_COGNITO_ISSUER_URI=https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_test\nBIDFLOW_COGNITO_CLIENT_ID=mockclient123\nBIDFLOW_VERIFICATION_WEB_ORIGIN=https://d123example.cloudfront.net\n")}' | base64 -d >> /etc/bidflow/runtime-complete.env"
    )
    error_message = "The launch script must stop on a Runtime Secret collision before assembling the exact public environment."
  }
}

run "msk_enables_only_its_profile_and_uses_imdsv2" {
  command = plan
  module {
    source = "../../modules/private_runtime"
  }
  variables {
    enable_managed_kafka    = true
    kafka_bootstrap_brokers = "boot-mock.kafka-serverless.ap-northeast-1.amazonaws.com:9098"
  }
  assert {
    condition     = aws_launch_template.application.metadata_options[0].http_tokens == "required" && aws_launch_template.application.metadata_options[0].http_put_response_hop_limit == 2
    error_message = "MSK alone needs the container IMDSv2 hop limit."
  }
  assert {
    condition = (
      strcontains(base64decode(aws_launch_template.application.user_data), "check_verification_runtime_env /etc/bidflow/runtime.env true") &&
      strcontains(base64decode(aws_launch_template.application.user_data), base64encode("SPRING_PROFILES_ACTIVE=msk\nBIDFLOW_MSK_BOOTSTRAP_SERVERS=boot-mock.kafka-serverless.ap-northeast-1.amazonaws.com:9098\n")) &&
      !strcontains(base64decode(aws_launch_template.application.user_data), "SPRING_KAFKA_PROPERTIES_SECURITY_PROTOCOL")
    )
    error_message = "The Terraform-managed MSK profile and actual IAM bootstrap must replace hardcoded Spring security env variables."
  }
}

run "msk_and_cognito_compose_one_profile_setting" {
  command = plan
  module {
    source = "../../modules/private_runtime"
  }
  variables {
    enable_managed_kafka    = true
    kafka_bootstrap_brokers = "boot-mock.kafka-serverless.ap-northeast-1.amazonaws.com:9098"
    verification_auth = {
      issuer_uri = "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_test"
      client_id  = "mockclient123"
      web_origin = "https://d123example.cloudfront.net"
    }
  }
  assert {
    condition = strcontains(
      base64decode(aws_launch_template.application.user_data),
      base64encode("SPRING_PROFILES_ACTIVE=verification,msk\nBIDFLOW_COGNITO_ISSUER_URI=https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_test\nBIDFLOW_COGNITO_CLIENT_ID=mockclient123\nBIDFLOW_VERIFICATION_WEB_ORIGIN=https://d123example.cloudfront.net\nBIDFLOW_MSK_BOOTSTRAP_SERVERS=boot-mock.kafka-serverless.ap-northeast-1.amazonaws.com:9098\n")
    )
    error_message = "Cognito and MSK require one combined profile value and both sets of configuration."
  }
}

run "msk_rejects_missing_iam_bootstrap" {
  command = plan
  module {
    source = "../../modules/private_runtime"
  }
  variables {
    enable_managed_kafka = true
  }
  expect_failures = [var.kafka_bootstrap_brokers]
}

run "managed_search_alone_injects_only_its_signed_endpoint_configuration" {
  command = plan
  module {
    source = "../../modules/private_runtime"
  }
  variables {
    enable_managed_search = true
    opensearch_endpoint   = "vpc-bidflow-verification-search-mock.ap-northeast-1.es.amazonaws.com"
  }
  assert {
    condition     = aws_launch_template.application.metadata_options[0].http_tokens == "required" && aws_launch_template.application.metadata_options[0].http_put_response_hop_limit == 2
    error_message = "The search container must use the EC2 role via IMDSv2."
  }
  assert {
    condition = (
      strcontains(base64decode(aws_launch_template.application.user_data), "check_verification_runtime_env /etc/bidflow/runtime.env false true") &&
      strcontains(base64decode(aws_launch_template.application.user_data), base64encode("BIDFLOW_SEARCH_MODE=aws\nBIDFLOW_SEARCH_AWS_ENDPOINT=https://vpc-bidflow-verification-search-mock.ap-northeast-1.es.amazonaws.com\nBIDFLOW_SEARCH_AWS_REGION=ap-northeast-1\n"))
    )
    error_message = "Search alone must guard and inject its three values without forcing Cognito or MSK profiles."
  }
}

run "managed_search_rejects_a_public_endpoint" {
  command = plan
  module {
    source = "../../modules/private_runtime"
  }
  variables {
    enable_managed_search = true
    opensearch_endpoint   = "search-bidflow-verification-search-mock.ap-northeast-1.es.amazonaws.com"
  }
  expect_failures = [var.opensearch_endpoint]
}
