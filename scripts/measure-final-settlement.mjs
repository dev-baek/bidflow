import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { dirname, basename, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { isUuid, measure } from './final-settlement.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const api = 'http://127.0.0.1:8080';
const command = async (program, args, timeout = 5000) => (await exec(program, args, { cwd: root, timeout, maxBuffer: 4_000_000 })).stdout.trim();
const sql = async (query, timeout = 5000) => command('docker', ['exec', 'bidflow-local-postgres-1', 'psql', '-XqAt', '-U', 'bidflow', '-d', 'bidflow', '-v', 'ON_ERROR_STOP=1', '-c', query], timeout);
const readOnly = async (query, timeout) => JSON.parse(await sql(`BEGIN READ ONLY; SET LOCAL statement_timeout = 4000; ${query}; COMMIT;`, timeout));
async function lag() {
  const text = await command('docker', ['exec', 'bidflow-local-kafka-1', '/opt/kafka/bin/kafka-consumer-groups.sh',
    '--bootstrap-server', 'localhost:9092', '--describe', '--group', 'bid-settlement'], 10000);
  const rows = text.split('\n').map(line => line.trim().split(/\s+/)).filter(c => c[0] === 'bid-settlement' && c[1] === 'bid-command');
  if (rows.length !== 3 || rows.some(c => ![c[2], c[3], c[4], c[5]].every(v => /^\d+$/.test(v)))) throw Error('lag unavailable');
  return rows.map(c => ({ partition: Number(c[2]), currentOffset: Number(c[3]), endOffset: Number(c[4]), lag: Number(c[5]) })).sort((a, b) => a.partition - b.partition);
}

async function main() {
  if (process.argv.length !== 3) throw Error('usage');
  const output = resolve(process.argv[2]);
  const target = resolve(await realpath(dirname(output)), basename(output));
  const repo = await realpath(root);
  const rel = relative(repo, target);
  if (!rel.startsWith('..' + '/') && !isAbsolute(rel)) throw Error('output must be outside repository');
  const artifact = await open(target, 'wx', 0o600);
  const evidence = { startedAt: new Date().toISOString(), valid: false };
  try {
    const ready = await fetch(api + '/actuator/health/readiness', { signal: AbortSignal.timeout(3000) });
    if (!ready.ok) throw Error('API not ready');
    const healthy = await command('docker', ['inspect', '--format', '{{.State.Health.Status}}',
      'bidflow-local-postgres-1', 'bidflow-local-kafka-1', 'bidflow-local-redis-1']);
    if (healthy.split('\n').some(status => status !== 'healthy')) throw Error('infrastructure not healthy');
    const auctionId = randomUUID(), productId = randomUUID(), runId = 'final' + randomUUID().replaceAll('-', '');
    Object.assign(evidence, { commit: await command('git', ['rev-parse', 'HEAD']), runId, auctionId, productId,
      environment: { node: process.version, arch: os.arch(), platform: os.platform(), osRelease: os.release(),
        cpus: os.cpus().length, totalMemoryBytes: os.totalmem() }, beforeLag: await lag() });
    if (evidence.beforeLag.some(row => row.lag !== 0)) throw Error('preexisting lag');
    // Only new random UUIDs are inserted. There is no cleanup or overwrite of existing data.
    await sql(`BEGIN;
      INSERT INTO product (product_id,seller_id,title,description,category_id,condition_grade,status,version,created_at,updated_at)
      VALUES ('${productId}','${runId}seller','${runId}','Local final settlement observation fixture','DIGITAL','GOOD','PUBLISHED',1,now(),now());
      INSERT INTO auction (auction_id,product_id,seller_id,status,starting_price,current_price,starts_at,ends_at,version,created_at,updated_at)
      VALUES ('${auctionId}','${productId}','${runId}seller','ACTIVE',10000,10000,now()-interval '1 minute',now()+interval '30 minutes',1,now(),now()); COMMIT;`);

    const measurement = await measure({ auctionId, now: () => performance.now(), wait,
      submit: async (index, timeout) => {
        const response = await fetch(`${api}/api/v1/auctions/${auctionId}/bid-requests`, { method: 'POST', signal: AbortSignal.timeout(Math.max(1, Math.floor(timeout))),
          headers: { 'Content-Type': 'application/json', 'X-Actor-Id': `${runId}user${index}`, 'Idempotency-Key': `${runId}-${index}` },
          body: JSON.stringify({ bidKind: 'DIRECT', amount: 20000 }) });
        return { status: response.status, body: await response.json() };
      },
      read: async (ids, timeout) => {
        if (!ids.every(isUuid)) throw Error('invalid request ID');
        return readOnly(`SELECT coalesce(json_agg(x),'[]'::json) FROM (
          SELECT r.bid_request_id AS id, r.auction_id AS "auctionId", r.status,
            (SELECT count(*) FROM bid_ledger l WHERE l.bid_request_id=r.bid_request_id AND l.auction_id=r.auction_id) AS "ledgerCount",
            (SELECT min(decision) FROM bid_ledger l WHERE l.bid_request_id=r.bid_request_id AND l.auction_id=r.auction_id) AS decision,
            (SELECT count(*) FROM outbox_event o WHERE o.aggregate_id=r.auction_id AND o.topic='bid-event'
              AND o.event_type IN ('BidAccepted','BidRejected') AND o.payload->>'bidRequestId'=r.bid_request_id::text) AS "resultCount",
            (SELECT min(event_type) FROM outbox_event o WHERE o.aggregate_id=r.auction_id AND o.topic='bid-event'
              AND o.event_type IN ('BidAccepted','BidRejected') AND o.payload->>'bidRequestId'=r.bid_request_id::text) AS "eventType",
            extract(epoch FROM r.processed_at-r.requested_at)*1000 AS "processingStartMs"
          FROM bid_request r WHERE r.auction_id='${auctionId}' AND r.bid_request_id IN (${ids.map(id => `'${id}'`).join(',')})
        ) x`, Math.max(1, Math.floor(timeout)));
      } });
    evidence.measurement = measurement;
    evidence.afterLag = await lag();
    evidence.invariants = await readOnly(`SELECT json_build_object(
      'requests',(SELECT count(*) FROM bid_request WHERE auction_id=a.auction_id),
      'ledgerRows',(SELECT count(*) FROM bid_ledger WHERE auction_id=a.auction_id),
      'duplicateLedgers',(SELECT count(*) FROM (SELECT bid_request_id FROM bid_ledger WHERE auction_id=a.auction_id GROUP BY bid_request_id HAVING count(*)>1) d),
      'priceRegressions',(SELECT count(*) FROM (SELECT current_price,lag(current_price) OVER (ORDER BY decided_at,bid_ledger_id) AS previous FROM bid_ledger WHERE auction_id=a.auction_id AND decision='ACCEPTED') prices WHERE current_price<previous),
      'currentPrice',a.current_price,'winnerMatches',(SELECT bidder_id=a.current_winner_id AND current_price=a.current_price FROM bid_ledger WHERE auction_id=a.auction_id AND decision='ACCEPTED' ORDER BY decided_at DESC,bid_ledger_id DESC LIMIT 1))
      FROM auction a WHERE a.auction_id='${auctionId}'`, 5000);
    evidence.valid = measurement.valid && evidence.invariants.requests === 20 && evidence.invariants.ledgerRows === 20
      && evidence.invariants.duplicateLedgers === 0 && evidence.invariants.priceRegressions === 0 && evidence.invariants.winnerMatches === true;
  } catch {
    evidence.error = 'MEASUREMENT_OR_SETUP_FAILED';
  } finally {
    evidence.completedAt = new Date().toISOString();
    await artifact.writeFile(JSON.stringify(evidence, null, 2) + '\n');
    await artifact.close();
  }
  console.log(JSON.stringify({ valid: evidence.valid, observation: evidence.measurement?.finalObservation, output: target }));
  if (!evidence.valid) process.exitCode = 1;
}

main().catch(() => { console.error('Measurement failed. Supply a new external output path and check local services. No automatic retry.'); process.exitCode = 1; });
