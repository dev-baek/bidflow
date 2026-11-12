#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
script="$root/scripts/provision-kafka-topics.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
log="$tmp/docker.log"

cat >"$tmp/docker" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >>"$log"
previous=""
topic=""
for argument in "\$@"; do
  if [ "\$previous" = "--topic" ]; then topic=\$argument; fi
  previous=\$argument
done
case "\$*" in
  *--describe*)
    partitions=3
    if [ "\${FAKE_WRONG_TOPIC:-}" = "\$topic" ]; then partitions=2; fi
    printf "Topic: %s PartitionCount:%s ReplicationFactor:1 Configs:retention.ms=604800000\n" "\$topic" "\$partitions"
    ;;
esac
EOF
chmod +x "$tmp/docker"

output=$(env BIDFLOW_DOCKER_BIN="$tmp/docker" sh "$script")
printf '%s' "$output" | grep -F "Kafka 토픽 정책 적용 완료: bid-command,bid-event,listing-event" >/dev/null

for topic in bid-command bid-event listing-event; do
  grep -F -- "--create --if-not-exists --topic $topic --partitions 3 --replication-factor 1 --config retention.ms=604800000" "$log" >/dev/null
  grep -F -- "--describe --topic $topic" "$log" >/dev/null
done

set +e
output=$(env BIDFLOW_DOCKER_BIN="$tmp/docker" FAKE_WRONG_TOPIC=bid-event sh "$script" 2>&1)
status=$?
set -e
[ "$status" -eq 1 ]
printf '%s' "$output" | grep -F "Kafka 토픽 정책 불일치: bid-event" >/dev/null
