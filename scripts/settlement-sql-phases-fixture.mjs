import {planFocused} from './focused-thousand.mjs';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const auctionId=id(10), productId=id(90), runId='outboxindex19';
const endsAt='2030-01-01T12:30:00Z', when='2030-01-01T12:00:00Z', start='2029-01-01T00:00:00Z';
const receipts=Array.from({length:1000},(_,i)=>({...planFocused(runId,'full',i%20+1,Math.floor(i/20)),
  requestId:id(i+1001),httpStatus:202,receiptStatus:'RECEIVED',durationMs:1}));
const rows=receipts.map(({requestId,actor:bidderId,amount,key},i)=>{
  const accepted=i>=500, decision=accepted?'ACCEPTED':'REJECTED', price=accepted?amount:null;
  const reason=accepted?null:'BID_TOO_LOW';
  return {requestId,key,auctionId,bidderId,amount,decision,
    ledgers:[{id:id(i+3001),bidderId,amount,decision,price,reason}],
    events:[{id:id(i+5001),type:accepted?'BidAccepted':'BidRejected',requestId,auctionId,bidderId,
      version:accepted?i-498:2,price,reason}]};
});
const last=rows.at(-1);
const auction={auctionId,status:'ACTIVE',currentPrice:last.amount,winnerId:last.bidderId,version:501,endsAt};
export const fixture={auctionId,runId,endsAt,receipts,
  snapshot:{auction,requestCount:1000,ledgerCount:1000,resultCount:1000,rows}};

const quote=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+value.replaceAll("'","''")+"'";
const tuple=row=>'('+row.map(quote).join(',')+')';
const insert=(table,columns,data)=>`INSERT INTO ${table}(${columns}) VALUES\n${data.map(tuple).join(',\n')};`;
export function seedSql(background){
  if(background!==2000&&background!==100000)throw Error('invalid fixture scale');
  const targets=rows.map((r,i)=>{
    const e=r.events[0];
    return [e.id,auctionId,e.type,JSON.stringify({bidRequestId:r.requestId,auctionId,bidderId:r.bidderId,
      auctionVersion:e.version,currentPrice:e.price,reason:e.reason}),i%2?when:null];
  });
  return [
    insert('product','product_id,seller_id,title,description,category_id,condition_grade,status,created_at,updated_at',
      [[productId,'synthetic-seller','Synthetic product','Synthetic benchmark only','DIGITAL','GOOD','PUBLISHED',start,start]]),
    insert('auction','auction_id,product_id,seller_id,status,starting_price,current_price,starts_at,ends_at,version,created_at,updated_at,current_winner_id',
      [[auctionId,productId,'synthetic-seller','ACTIVE',10000,auction.currentPrice,start,endsAt,auction.version,start,start,auction.winnerId]]),
    insert('bid_request','bid_request_id,auction_id,bidder_id,bid_kind,amount,status,requested_at,processed_at,correlation_id,idempotency_key',
      rows.map(r=>[r.requestId,auctionId,r.bidderId,'DIRECT',r.amount,r.decision,when,when,'synthetic',r.key])),
    insert('bid_ledger','bid_ledger_id,bid_request_id,auction_id,bidder_id,decision,requested_amount,current_price,rejection_reason,decided_at',
      rows.map(r=>[r.ledgers[0].id,r.requestId,auctionId,r.bidderId,r.decision,r.amount,r.ledgers[0].price,r.ledgers[0].reason,when])),
    `WITH targets(event,auction,kind,data,published) AS (VALUES ${targets.map(tuple).join(',\n')}),
    others AS (SELECT md5('evt'||g) AS event, md5('auction'||(g%487)) AS auction,
      CASE WHEN g%2=0 THEN 'bid-event' WHEN g%4=1 THEN 'bid-command' ELSE 'listing-event' END AS topic,
      CASE WHEN g%2=0 THEN 'BidAccepted' WHEN g%4=1 THEN 'BidRequested' ELSE 'ListingPublished' END AS kind,
      jsonb_build_object('bidRequestId',md5('request'||g),'auctionId',md5('auction'||(g%487)),
        'bidderId','other-'||g,'auctionVersion',2,'currentPrice',20000,'reason',NULL) AS data,
      CASE WHEN g%5=0 THEN NULL ELSE '${when}' END AS published FROM generate_series(1,${background}) g),
    all_events AS (SELECT event,auction,'bid-event' AS topic,kind,data::jsonb,published FROM targets UNION ALL SELECT * FROM others)
    INSERT INTO outbox_event(event_id,aggregate_type,aggregate_id,topic,partition_key,event_type,schema_version,payload,occurred_at,published_at)
    SELECT event::uuid,CASE WHEN topic='listing-event' THEN 'Product' ELSE 'Auction' END,auction::uuid,topic,auction,
      kind,1,data,'${when}',published::timestamptz FROM all_events ORDER BY md5('layout'||event);`
  ].join('\n');
}
