#!/bin/sh
set -eu

docker_bin=${BIDFLOW_DOCKER_BIN:-docker}
topics="bid-command bid-event listing-event"
partitions=3
replication_factor=1
retention_ms=604800000

compose() {
  "$docker_bin" compose --env-file .env.example -f infra/local/compose.yaml "$@"
}

create_topic() {
  topic=$1
  compose exec -T kafka /opt/kafka/bin/kafka-topics.sh \
    --bootstrap-server localhost:9092 \
    --create --if-not-exists \
    --topic "$topic" \
    --partitions "$partitions" \
    --replication-factor "$replication_factor" \
    --config "retention.ms=$retention_ms"
}

verify_topic() {
  topic=$1
  description=$(compose exec -T kafka /opt/kafka/bin/kafka-topics.sh \
    --bootstrap-server localhost:9092 \
    --describe --topic "$topic")

  if ! printf '%s\n' "$description" | grep -E "PartitionCount:[[:space:]]*$partitions" >/dev/null ||
    ! printf '%s\n' "$description" | grep -E "ReplicationFactor:[[:space:]]*$replication_factor" >/dev/null ||
    ! printf '%s\n' "$description" | grep -F "retention.ms=$retention_ms" >/dev/null; then
    printf '%s\n' "Kafka 토픽 정책 불일치: $topic" >&2
    exit 1
  fi
}

for topic in $topics; do
  create_topic "$topic"
  verify_topic "$topic"
done

printf '%s\n' "Kafka 토픽 정책 적용 완료: bid-command,bid-event,listing-event"
