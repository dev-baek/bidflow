import {isUuid} from './final-settlement.mjs';
import {parseObservation} from './outbox-delay-observation.mjs';

const groups=['bid-settlement','realtime-projection','auction-finalization','search-projection'];
const topics=['bid-command','bid-event','listing-event'];
const states=['UP','DOWN','OUT_OF_SERVICE','UNKNOWN'];
const cases=['unsold','auto-finalization'];
const statuses=['passed','failed','timedOut','skipped','interrupted'];
const requireValue=(valid)=>{if(!valid)throw Error('invalid startup observation');};
const positiveInt=n=>Number.isSafeInteger(n)&&n>0;

export function startupCaseId(title) {
  if(title==='등록한 경매에 입찰이 없으면 마감에 공개 유찰로 바뀐다')return 'unsold';
  if(title==='자동 입찰로 확정된 낙찰은 마감 이후 새 입찰로 바뀌지 않는다')return 'auto-finalization';
  return null;
}

export function readyForTests(probe) {
  return probe?.endpoint==='readiness' && probe.httpStatus===200 && probe.status==='UP' && !probe.error;
}

function marker(row) {
  const kind=row.startupObservation;
  let data;
  if(['old.exited','api.started','api.stopped','restored'].includes(kind)) {
    requireValue(positiveInt(row.pid)); data={pid:row.pid};
  } else if(kind==='probe') {
    requireValue(['health','readiness'].includes(row.endpoint));
    requireValue(row.httpStatus===null || (Number.isInteger(row.httpStatus)&&row.httpStatus>=100&&row.httpStatus<=599));
    requireValue(row.status===null || states.includes(row.status));
    requireValue(row.error===undefined || ['TIMEOUT','CONNECTION_FAILED','INVALID_RESPONSE'].includes(row.error));
    requireValue(row.httpStatus!==null || row.error!==undefined);
    data={endpoint:row.endpoint,httpStatus:row.httpStatus,status:row.status};
    if(row.error!==undefined)data.error=row.error;
  } else if(['test.begin','test.end'].includes(kind)) {
    requireValue(cases.includes(row.caseId));data={caseId:row.caseId};
    if(kind==='test.end') {
      requireValue(statuses.includes(row.status)&&Number.isFinite(row.durationMs)&&row.durationMs>=0);
      Object.assign(data,{status:row.status,durationMs:row.durationMs});
    }
  } else if(kind==='auction') {
    requireValue(isUuid(row.auctionId));data={auctionId:row.auctionId};
  } else if(kind==='runner.exit') {
    requireValue(Number.isInteger(row.code)&&row.code>=0&&row.code<=255);data={code:row.code};
  } else if(kind==='setup.failure') {
    requireValue(['INVALID_SELECTION','INVALID_WORKERS','UNEXPECTED_RETRY','PROBE_TIMEOUT','PROCESS_FAILED'].includes(row.code));data={code:row.code};
  } else throw Error('unknown startup marker');
  return {kind,data};
}

function kafkaData(data) {
  requireValue(groups.includes(data.group)&&['assigned','revoked'].includes(data.action)&&Array.isArray(data.partitions));
  const seen=new Set();
  for(const p of data.partitions) {
    requireValue(topics.includes(p.topic)&&Number.isSafeInteger(p.partition)&&p.partition>=0);
    const key=`${p.topic}:${p.partition}`;requireValue(!seen.has(key));seen.add(key);
  }
  return {group:data.group,action:data.action,partitions:data.partitions.map(p=>({topic:p.topic,partition:p.partition}))};
}

export function parseStartupLine(line) {
  let row;try{row=JSON.parse(line);}catch{return null;}
  if(!row || typeof row!=='object')return null;
  if(Object.hasOwn(row,'startupObservation'))return marker(row);
  if(row.logger_name==='org.springframework.kafka.listener.KafkaMessageListenerContainer') {
    if(typeof row.message!=='string' || !/partitions (assigned|revoked)/.test(row.message))return null;
    const match=/^([a-z-]+): partitions (assigned|revoked): \[(.*)\]$/.exec(row.message);
    try {
      requireValue(Boolean(match));
      const partitions=match[3] ? match[3].split(',').map(value=>{
        const part=/^\s*([a-z-]+)-(\d+)\s*$/.exec(value);requireValue(Boolean(part));
        return {topic:part[1],partition:Number(part[2])};
      }):[];
      return {kind:'kafka',data:kafkaData({group:match[1],action:match[2],partitions})};
    } catch {return {kind:'kafka.unparsed',data:{reason:'UNRECOGNIZED_ASSIGNMENT'}};}
  }
  if(row.logger_name==='com.bidflow.runtime.OutboxTimingLog') {
    const parsed=parseObservation(line);
    requireValue(isUuid(parsed.data.eventId));
    requireValue(Object.values(parsed.data).every(v=>typeof v==='string' || (typeof v==='number'&&Number.isFinite(v))));
    return {kind:'outbox',data:parsed.data};
  }
  if(row.logger_name==='com.bidflow.runtime.DirectBidCommandKafkaListener' && row.event==='bid.settled') {
    requireValue([row.eventId,row.bidRequestId,row.auctionId].every(isUuid));
    requireValue(typeof row.outcome==='string'&&/^[A-Z_]{1,64}$/.test(row.outcome));
    return {kind:'settlement',data:{eventId:row.eventId,bidRequestId:row.bidRequestId,auctionId:row.auctionId,outcome:row.outcome}};
  }
  return null;
}

export function summarizeStartup(records) {
  let previous=-1,stage='old',apiPid,active=null,ready=false,exitCode;
  const seen=new Set(),auctionIds=new Set(),completed=[];
  for(const r of records) {
    requireValue(typeof r.source==='string'&&r.source.length>0&&positiveInt(r.line));
    const key=JSON.stringify([r.source,r.line]);requireValue(!seen.has(key));seen.add(key);
    requireValue(Number.isFinite(r.receivedMs)&&r.receivedMs>=0&&r.receivedMs>=previous);previous=r.receivedMs;
    if(r.kind==='kafka'){requireValue(stage==='tests'||stage==='stop');kafkaData(r.data);continue;}
    if(r.kind==='kafka.unparsed'){requireValue(stage==='tests'||stage==='stop');requireValue(r.data.reason==='UNRECOGNIZED_ASSIGNMENT');continue;}
    if(['outbox','settlement'].includes(r.kind)) {
      requireValue(stage==='tests'||stage==='stop');
      const parsed=parseStartupLine(JSON.stringify({...r.data,logger_name:r.kind==='outbox'?'com.bidflow.runtime.OutboxTimingLog':'com.bidflow.runtime.DirectBidCommandKafkaListener',...(r.kind==='settlement'?{event:'bid.settled'}:{})}));
      requireValue(Boolean(parsed));continue;
    }
    const data=marker({startupObservation:r.kind,...r.data}).data;
    if(r.kind==='setup.failure')throw Error('setup failure');
    if(r.kind==='old.exited'){requireValue(stage==='old');stage='start';}
    else if(r.kind==='api.started'){requireValue(stage==='start');apiPid=data.pid;stage='tests';}
    else if(r.kind==='probe'){
      requireValue(stage==='tests');if(readyForTests(data))ready=true;
    } else if(r.kind==='test.begin') {
      requireValue(stage==='tests'&&ready&&!active&&data.caseId===cases[completed.length]);
      active={caseId:data.caseId,beginMs:r.receivedMs,auctionIds:[]};
    } else if(r.kind==='auction') {
      requireValue(Boolean(active)&&!auctionIds.has(data.auctionId));auctionIds.add(data.auctionId);active.auctionIds.push(data.auctionId);
    } else if(r.kind==='test.end') {
      requireValue(active?.caseId===data.caseId);
      completed.push({...active,endMs:r.receivedMs,status:data.status,runnerDurationMs:data.durationMs});active=null;
    } else if(r.kind==='runner.exit') {
      requireValue(stage==='tests'&&!active&&completed.length===2);
      const failed=completed.some(c=>['failed','timedOut','interrupted'].includes(c.status));
      requireValue(failed?data.code!==0:data.code===0);exitCode=data.code;stage='stop';
    } else if(r.kind==='api.stopped') {requireValue(stage==='stop'&&data.pid===apiPid);stage='restore';}
    else if(r.kind==='restored') {requireValue(stage==='restore'&&data.pid!==apiPid);stage='done';}
  }
  requireValue(stage==='done');
  const firstUp=endpoint=>records.find(r=>r.kind==='probe'&&r.data.endpoint===endpoint&&r.data.httpStatus===200&&r.data.status==='UP'&&!r.data.error)?.receivedMs ?? null;
  return {testsPassed:completed.every(c=>c.status==='passed'),allCasesExecuted:completed.every(c=>c.status!=='skipped'),
    firstHealthUpMs:firstUp('health'),firstReadinessUpMs:firstUp('readiness'),cases:completed,exitCode,
    unparsedAssignments:records.filter(r=>r.kind==='kafka.unparsed').length,
    kafka:Object.fromEntries(groups.map(group=>{
      const events=records.filter(r=>r.kind==='kafka'&&r.data.group===group).map(r=>({receivedMs:r.receivedMs,...r.data}));
      return [group,{firstNonEmptyAssignmentMs:events.find(e=>e.action==='assigned'&&e.partitions.length)?.receivedMs ?? null,events}];
    }))};
}
