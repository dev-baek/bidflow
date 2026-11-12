#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
curl_bin=${BIDFLOW_CURL_BIN:-curl}
endpoint=${BIDFLOW_OPENSEARCH_ENDPOINT:-http://127.0.0.1:9200}
index=bidflow-products-v1
response=$(mktemp)
trap 'rm -f "$response"' EXIT

if ! response_status=$("$curl_bin" -sS -o "$response" -w '%{http_code}' -X PUT "$endpoint/$index" \
  -H 'Content-Type: application/json' \
  --data-binary "@$root/infra/opensearch/products-v1.json"); then
  printf '%s\n' "OpenSearch 인덱스 생성 실패: $index" >&2
  exit 1
fi

case "$response_status" in
  200|201) ;;
  400)
    if ! grep -F 'resource_already_exists_exception' "$response" >/dev/null 2>&1; then
      printf '%s\n' "OpenSearch 인덱스 생성 실패: $index" >&2
      exit 1
    fi
    ;;
  *)
    printf '%s\n' "OpenSearch 인덱스 생성 실패: $index" >&2
    exit 1
    ;;
esac

"$curl_bin" -fsS -X POST "$endpoint/_aliases" \
  -H 'Content-Type: application/json' \
  --data-binary "@$root/infra/opensearch/products-aliases.json" >/dev/null

printf '%s\n' "OpenSearch 상품 인덱스 적용 완료: $index"
