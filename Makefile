COMPOSE = docker compose --env-file .env.example -f infra/local/compose.yaml

.PHONY: local-up local-up-search local-down local-reset
local-up:
	$(COMPOSE) up -d --wait postgres kafka redis
	BIDFLOW_EXPECTED_SERVICES=postgres,kafka,redis sh scripts/check-local-health.sh

local-up-search:
	$(COMPOSE) --profile search up -d --wait
	BIDFLOW_EXPECTED_SERVICES=postgres,kafka,redis,opensearch sh scripts/check-local-health.sh

local-down:
	$(COMPOSE) --profile search down

local-reset:
	sh scripts/reset-local-services.sh
