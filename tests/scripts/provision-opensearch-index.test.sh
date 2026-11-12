#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
script="$root/scripts/provision-opensearch-index.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
log="$tmp/curl.log"

cat >"$tmp/curl" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >>"$log"
url=""
for argument in "\$@"; do url=\$argument; done
case "\$url" in
  */bidflow-products-v1)
    if [ "\${FAKE_INDEX_EXISTS:-}" = "true" ]; then
      printf '%s' '{"error":{"type":"resource_already_exists_exception"}}'
      exit 22
    fi
    ;;
  */_aliases) ;;
  *) exit 23 ;;
esac
EOF
chmod +x "$tmp/curl"

output=$(env BIDFLOW_CURL_BIN="$tmp/curl" sh "$script")
printf '%s' "$output" | grep -F "OpenSearch 상품 인덱스 적용 완료: bidflow-products-v1" >/dev/null
grep -F -- "-X PUT http://127.0.0.1:9200/bidflow-products-v1" "$log" >/dev/null
grep -F -- "--data-binary @${root}/infra/opensearch/products-v1.json" "$log" >/dev/null
grep -F -- "-X POST http://127.0.0.1:9200/_aliases" "$log" >/dev/null
grep -F -- "--data-binary @${root}/infra/opensearch/products-aliases.json" "$log" >/dev/null

output=$(env BIDFLOW_CURL_BIN="$tmp/curl" FAKE_INDEX_EXISTS=true sh "$script")
printf '%s' "$output" | grep -F "OpenSearch 상품 인덱스 적용 완료: bidflow-products-v1" >/dev/null

set +e
output=$(env BIDFLOW_CURL_BIN="$tmp/curl" FAKE_INDEX_EXISTS=bad sh "$script" 2>&1)
status=$?
set -e
[ "$status" -eq 23 ]
printf '%s' "$output" | grep -F "OpenSearch 인덱스 생성 실패: bidflow-products-v1" >/dev/null
