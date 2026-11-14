#!/bin/sh
set -eu

docker_bin=${BIDFLOW_DOCKER_BIN:-docker}
group=${BIDFLOW_CONSUMER_GROUP:-}

if [ -z "$group" ]; then
  printf '%s\n' 'BIDFLOW_CONSUMER_GROUP is required' >&2
  exit 2
fi

exec "$docker_bin" compose --env-file .env.example -f infra/local/compose.yaml exec -T kafka \
  /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group "$group"
