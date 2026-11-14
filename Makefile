COMPOSE = docker compose --env-file .env.example -f infra/local/compose.yaml

.PHONY: local-up local-up-search local-down local-reset local-topics local-search-index load-focused load-distributed
local-up:
	$(COMPOSE) up -d --wait postgres kafka redis object-storage
	BIDFLOW_EXPECTED_SERVICES=postgres,kafka,redis,object-storage sh scripts/check-local-health.sh
	sh scripts/provision-kafka-topics.sh

local-up-search:
	$(COMPOSE) --profile search up -d --wait
	BIDFLOW_EXPECTED_SERVICES=postgres,kafka,redis,object-storage,opensearch sh scripts/check-local-health.sh
	sh scripts/provision-kafka-topics.sh
	sh scripts/provision-opensearch-index.sh

local-topics:
	sh scripts/provision-kafka-topics.sh

local-search-index:
	sh scripts/provision-opensearch-index.sh

load-focused:
	BIDFLOW_LOAD_SCENARIO=focused sh scripts/run-k6-bid-load.sh

load-distributed:
	BIDFLOW_LOAD_SCENARIO=distributed sh scripts/run-k6-bid-load.sh

local-down:
	$(COMPOSE) --profile search down

local-reset:
	sh scripts/reset-local-services.sh
