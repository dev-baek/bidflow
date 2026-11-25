import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {buildFocusedSql} from './concurrent-browser-sql.mjs';
import {judgeFocused} from './focused-thousand.mjs';
import {fixture} from './settlement-sql-phases-fixture.mjs';

export const phaseRounds=[['PLAIN','NONE','TEXT'],['NONE','TEXT','PLAIN'],['TEXT','PLAIN','NONE']];
export function phaseStatements(auctionId){
  const plain=buildFocusedSql(auctionId), marker='\nWITH requests AS MATERIALIZED (';
  if(!plain.includes(marker))throw Error('unrecognized scoped SELECT boundary');
  const explain=mode=>plain.replace(marker,`\nEXPLAIN (ANALYZE, BUFFERS, SERIALIZE ${mode}, FORMAT JSON)${marker}`);
  return {PLAIN:plain,NONE:explain('NONE'),TEXT:explain('TEXT')};
}

export function failureCode(result){
  if(result.error?.code==='ETIMEDOUT')return 'SQL_PROCESS_TIMEOUT';
  if(result.error?.code==='ENOBUFS')return 'SQL_OUTPUT_INVALID';
  if(result.error||result.status!==0||result.signal)
    return /^ERROR:[ \t]+57014:/m.test(result.stderr??'')?'SQL_QUERY_CANCELED':'SQL_CALL_FAILED';
  return null;
}

const invalid=()=>Error('SQL_OUTPUT_INVALID');
const number=value=>{
  if(!Number.isFinite(value)||value<0)throw invalid();
  return value;
};
export function readPlan(value,mode){
  const statement=Array.isArray(value)&&value.length===1&&value[0];
  if(!statement?.Plan||!['TEXT','NONE'].includes(mode))throw invalid();
  const {Serialization:serialization}=statement;
  if(mode==='TEXT'?serialization?.Format!=='text':serialization!==undefined)throw invalid();
  const blocks=n=>({
    sharedHit:number(n['Shared Hit Blocks']??0),sharedRead:number(n['Shared Read Blocks']??0),
    tempRead:number(n['Temp Read Blocks']??0),tempWritten:number(n['Temp Written Blocks']??0),
  });
  const nodes=[];
  const walk=n=>{
    const type=n['Node Type'],relation=n['Relation Name'];
    if(typeof type!=='string')throw invalid();
    if(relation==='outbox_event'||/Aggregate|Join|Nested Loop/.test(type)){
      nodes.push({type,relation:relation==='outbox_event'?'outbox_event':null,
        rows:number(n['Actual Rows']),loops:number(n['Actual Loops']),
        removedByFilter:number(n['Rows Removed by Filter']??0),...blocks(n)});
    }
    for(const child of n.Plans??[])walk(child);
  };
  walk(statement.Plan);
  if(!nodes.some(n=>n.relation==='outbox_event'))throw invalid();
  return {planningMs:number(statement['Planning Time']),executionMs:number(statement['Execution Time']),
    blocks:blocks(statement.Plan),nodes,serialization:mode==='TEXT'?{ms:number(serialization.Time),kB:number(serialization['Output Volume'])}:null};
}

function normalize(snapshot) {
  const order=(rows,key)=>[...rows].sort((a,b)=>a[key].localeCompare(b[key]));
  return {...snapshot,auction:{...snapshot.auction,endsAt:new Date(snapshot.auction.endsAt).toISOString()},
    rows:order(snapshot.rows,'requestId').map(r=>({...r,ledgers:order(r.ledgers,'id'),events:order(r.events,'id')}))};
}
export function verifySnapshot(snapshot){
  const {auctionId,runId,endsAt,receipts}=fixture;
  if(!judgeFocused({auctionId,runId,endsAt,receipts,mode:'full',snapshot}).valid)throw invalid();
  const actual=normalize(snapshot),expected=normalize(fixture.snapshot);
  if(!isDeepStrictEqual(actual,expected))throw invalid();
  return createHash('sha256').update(JSON.stringify(expected)).digest('hex');
}
