import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isUuid } from './final-settlement.mjs';
import { judgeConcurrentRound } from './concurrent-browser-observation.mjs';

export function buildConcurrentSql(auctionId, requestIds) {
  if (!isUuid(auctionId) || !Array.isArray(requestIds) || requestIds.length !== 2
    || !requestIds.every(isUuid) || new Set(requestIds).size !== 2) throw Error('invalid SQL scope');
  return `BEGIN READ ONLY; SET LOCAL statement_timeout = 4000;
SELECT jsonb_build_object(
  'auction', jsonb_build_object('auctionId',a.auction_id,'status',a.status,'currentPrice',a.current_price,
    'winnerId',a.current_winner_id,'version',a.version,'endsAt',a.ends_at),
  'requestCount',(SELECT count(*) FROM bid_request WHERE auction_id=a.auction_id),
  'ledgerCount',(SELECT count(*) FROM bid_ledger WHERE auction_id=a.auction_id),
  'resultCount',(SELECT count(*) FROM outbox_event WHERE aggregate_id=a.auction_id AND topic='bid-event'
    AND event_type IN ('BidAccepted','BidRejected')),
  'rows',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'requestId',r.bid_request_id,'auctionId',r.auction_id,'bidderId',r.bidder_id,'amount',r.amount,'decision',r.status,
    'ledgers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.bid_ledger_id,'bidderId',l.bidder_id,
      'amount',l.requested_amount,'decision',l.decision,'price',l.current_price,'reason',l.rejection_reason)),'[]'::jsonb)
      FROM bid_ledger l WHERE l.auction_id=r.auction_id AND l.bid_request_id=r.bid_request_id),
    'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.event_id,'type',o.event_type,
      'requestId',o.payload->>'bidRequestId','auctionId',o.payload->>'auctionId','bidderId',o.payload->>'bidderId',
      'version',(o.payload->>'auctionVersion')::bigint,'price',(o.payload->>'currentPrice')::bigint,'reason',o.payload->>'reason')),'[]'::jsonb)
      FROM outbox_event o WHERE o.aggregate_id=r.auction_id AND o.topic='bid-event'
        AND o.event_type IN ('BidAccepted','BidRejected') AND o.payload->>'bidRequestId'=r.bid_request_id::text)
  )),'[]'::jsonb) FROM bid_request r WHERE r.auction_id=a.auction_id
    AND r.bid_request_id IN (${requestIds.map(id => `'${id}'`).join(',')}))
) FROM auction a WHERE a.auction_id='${auctionId}'; COMMIT;`;
}

export async function readConcurrentSql(auctionId, requestIds, command = promisify(execFile)) {
  const query = buildConcurrentSql(auctionId, requestIds);
  const { stdout } = await command('docker', ['exec', 'bidflow-local-postgres-1', 'psql', '-XqAt',
    '-U', 'bidflow', '-d', 'bidflow', '-v', 'ON_ERROR_STOP=1', '-c', query], { timeout: 5000, maxBuffer: 1_000_000 });
  return JSON.parse(stdout.trim());
}

export function judgeConcurrentSql(input, snapshot, actors, initialEndsAt) {
  const failure = () => ({ valid: false, error: 'SQL_AGREEMENT_FAILED' });
  const observed = judgeConcurrentRound(input);
  if (!observed.valid || !snapshot || !actors || typeof actors.A !== 'string' || typeof actors.B !== 'string'
    || !actors.A || !actors.B || actors.A === actors.B || !Number.isFinite(Date.parse(initialEndsAt))
    || snapshot.requestCount !== 2 || snapshot.ledgerCount !== 2 || snapshot.resultCount !== 2
    || !Array.isArray(snapshot.rows) || snapshot.rows.length !== 2) return failure();
  const auction = snapshot.auction;
  if (!auction || auction.auctionId !== input.auctionId || auction.status !== 'ACTIVE'
    || auction.currentPrice !== 12000 || auction.winnerId !== actors.B
    || Date.parse(auction.endsAt) !== Date.parse(initialEndsAt)) return failure();
  const events = [], ledgerIds = [], settlements = [];
  const bothAccepted = observed.samples[0].decision === 'ACCEPTED';
  for (const sample of observed.samples) {
    const rows = snapshot.rows.filter(r => r?.requestId === sample.requestId);
    if (rows.length !== 1) return failure();
    const row = rows[0], rejected = sample.decision === 'REJECTED';
    if (row.auctionId !== input.auctionId || row.bidderId !== actors[sample.bidder] || row.amount !== sample.amount
      || row.decision !== sample.decision || !Array.isArray(row.ledgers) || row.ledgers.length !== 1
      || !Array.isArray(row.events) || row.events.length !== 1) return failure();
    const ledger = row.ledgers[0], event = row.events[0];
    if (!ledger || !event || !isUuid(ledger.id) || !isUuid(event.id)
      || ledger.bidderId !== row.bidderId || ledger.amount !== sample.amount || ledger.decision !== sample.decision
      || ledger.price !== (rejected ? null : sample.amount) || ledger.reason !== sample.reason
      || event.requestId !== sample.requestId || event.auctionId !== input.auctionId || event.bidderId !== row.bidderId
      || event.type !== (rejected ? 'BidRejected' : 'BidAccepted') || event.reason !== sample.reason
      || event.price !== (rejected ? null : sample.amount)
      || event.version !== (sample.bidder === 'A' || !bothAccepted ? 2 : 3)) return failure();
    ledgerIds.push(ledger.id); events.push(event);
    settlements.push({ bidder: sample.bidder, requestId: sample.requestId, decision: sample.decision,
      settlementVersion: event.version, ledgerPrice: ledger.price, eventPrice: event.price,
      snapshotVersion: sample.snapshotVersion, snapshotPrice: sample.snapshotPrice });
  }
  const accepted = events.filter(e => e.type === 'BidAccepted').sort((a, b) => a.version - b.version);
  if (new Set(ledgerIds).size !== 2 || new Set(events.map(e => e.id)).size !== 2
    || accepted.some((e, i) => e.version !== i + 2 || (i && e.price <= accepted[i - 1].price))
    || auction.version !== 1 + accepted.length || accepted.at(-1)?.price !== auction.currentPrice
    || accepted.at(-1)?.bidderId !== auction.winnerId) return failure();
  if (settlements.some(s => s.snapshotVersion < s.settlementVersion || s.snapshotVersion > auction.version
    || !accepted.some(event => event.version === s.snapshotVersion && event.price === s.snapshotPrice))) return failure();
  return { valid: true, accepted: accepted.length, rejected: 2 - accepted.length,
    requestCount: 2, ledgerCount: 2, resultCount: 2, settlements };
}
