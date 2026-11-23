import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import { focusedConfig, planFocused, localLoadUrl } from "../../scripts/focused-thousand.mjs";
import { diagnosticCorrelationId } from "../../scripts/bid-ingress-observation.mjs";

const scenario = __ENV.BIDFLOW_LOAD_SCENARIO || "focused";
const baseUrl = required("BIDFLOW_BASE_URL").replace(/\/$/, "");
const runId = __ENV.BIDFLOW_RUN_ID || "local";
const amount = Number(__ENV.BIDFLOW_BID_AMOUNT || "20000");
const focusedAuctionId = __ENV.BIDFLOW_AUCTION_ID;
const distributedAuctionIds = (__ENV.BIDFLOW_AUCTION_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
const mode = __ENV.BIDFLOW_FOCUSED_MODE || "full";
const thousand = scenario === "focused-thousand";

const received = new Counter("bid_request_received");
const applicationDuration = new Trend("bid_request_application_duration", true);

if (!Number.isInteger(amount) || amount < 1000) fail("BIDFLOW_BID_AMOUNT must be an integer of at least 1000");
if (scenario === "focused" && !focusedAuctionId) fail("BIDFLOW_AUCTION_ID is required for focused scenario");
if (scenario === "distributed" && distributedAuctionIds.length === 0) fail("BIDFLOW_AUCTION_IDS is required for distributed scenario");
if (!["focused", "distributed", "focused-thousand"].includes(scenario)) fail("Invalid BIDFLOW_LOAD_SCENARIO");
if (thousand) {
  localLoadUrl(baseUrl);
  planFocused(runId, mode, 1, 0);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(focusedAuctionId || "")) fail("Invalid auction ID");
}

export const options = thousand
  ? { scenarios: { focused_thousand: { executor: "per-vu-iterations", vus: focusedConfig(mode).vus,
      iterations: focusedConfig(mode).iterations, maxDuration: "120s", gracefulStop: "0s", exec: "focusedThousand" } },
      summaryTrendStats: ["med", "p(95)", "p(99)", "max"], thresholds: thresholds() }
  : scenario === "focused"
  ? {
      scenarios: {
        focused_contention: { executor: "per-vu-iterations", vus: 20, iterations: 1, maxDuration: "1m", exec: "focused" },
      },
      thresholds: thresholds(),
    }
  : {
      scenarios: {
        distributed_steady: {
          executor: "ramping-vus",
          startVUs: 0,
          stages: [
            { duration: "30s", target: 5 },
            { duration: "1s", target: 20 },
            { duration: "2m", target: 20 },
            { duration: "10s", target: 0 },
          ],
          exec: "distributed",
        },
      },
      thresholds: thresholds(),
    };

export function focused() {
  submit(focusedAuctionId, __VU);
}

export function distributed() {
  submit(distributedAuctionIds[(__VU + __ITER) % distributedAuctionIds.length], __VU);
  sleep(1); // Pace requests so this local baseline does not become an unbounded saturation run.
}

export function focusedThousand() {
  const plan = planFocused(runId, mode, __VU, __ITER);
  const response = http.post(`${baseUrl}/api/v1/auctions/${focusedAuctionId}/bid-requests`, JSON.stringify({bidKind:"DIRECT", amount:plan.amount}), {
    headers: {"Content-Type":"application/json", "X-Actor-Id":plan.actor, "Idempotency-Key":plan.key},
    tags: {operation:"bid_request", scenario}, timeout:"5s", redirects:0,
  });
  applicationDuration.add(response.timings.duration);
  let body;
  try { body = response.json(); } catch { body = null; }
  const requestId = typeof body?.bidRequestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.bidRequestId) ? body.bidRequestId : null;
  const receiptStatus = body?.status === "RECEIVED" ? "RECEIVED" : null;
  if (check(response, {"valid receipt": () => response.status === 202 && receiptStatus === "RECEIVED" && requestId !== null})) received.add(1);
  const correlationId = diagnosticCorrelationId(response.headers?.["X-Correlation-Id"]);
  console.log(JSON.stringify({...plan, requestId, correlationId, httpStatus:response.status, receiptStatus, durationMs:response.timings.duration}));
  sleep(0.1);
}

function submit(auctionId, actorNumber) {
  const idempotencyKey = `load-${runId}-${scenario}-${__VU}-${__ITER}`;
  const response = http.post(`${baseUrl}/api/v1/auctions/${auctionId}/bid-requests`, JSON.stringify({ bidKind: "DIRECT", amount }), {
    headers: { "Content-Type": "application/json", "X-Actor-Id": `load-user-${actorNumber}`, "Idempotency-Key": idempotencyKey },
    tags: { operation: "bid_request", scenario },
  });
  applicationDuration.add(response.timings.duration);
  const accepted = check(response, {
    "returns 202": (value) => value.status === 202,
    "returns RECEIVED": (value) => value.json("status") === "RECEIVED",
  });
  if (accepted) received.add(1);
}

function thresholds() {
  return {
    "http_req_duration{operation:bid_request}": ["p(95)<300"],
    "http_req_failed{operation:bid_request}": ["rate<0.01"],
  };
}

function required(name) {
  const value = __ENV[name];
  if (!value) fail(`${name} is required`);
  return value;
}

export function handleSummary(data) {
  return { [thousand ? "/results/summary.json" : `reports/k6/${runId}-${scenario}-summary.json`]: JSON.stringify(data, null, 2) };
}
