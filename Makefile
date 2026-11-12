COMPOSE = docker compose --env-file .env.example -f infra/local/compose.yaml

.PHONY: local-up local-up-search local-down local-reset local-topics
local-up:
	$(COMPOSE) up -d --wait postgres kafka redis object-storage
	BIDFLOW_EXPECTED_SERVICES=postgres,kafka,redis,object-storage sh scripts/check-local-health.sh
	sh scripts/provision-kafka-topics.sh

local-up-search:
	$(COMPOSE) --profile search up -d --wait
	BIDFLOW_EXPECTED_SERVICES=postgres,kafka,redis,object-storage,opensearch sh scripts/check-local-health.sh
	sh scripts/provision-kafka-topics.sh

local-topics:
	sh scripts/provision-kafka-topics.sh

local-down:
	$(COMPOSE) --profile search down

local-reset:
	sh scripts/reset-local-services.sh
