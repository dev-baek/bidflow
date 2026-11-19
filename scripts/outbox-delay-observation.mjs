import {percentiles} from './final-settlement.mjs';

const windows = ['idle','bid'];
const number = value => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value))) throw Error('invalid number');
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw Error('invalid number');
  return n;
};

export function windowMarker(window, edge) {
  if (!windows.includes(window) || !['open','close'].includes(edge)) throw Error('invalid window marker');
  return JSON.stringify({bidflowObservation:'window',window,edge});
}

// Ignore unrelated output, but fail closed on malformed recognized observations.
export function parseObservation(line) {
  let row;
  try { row = JSON.parse(line); } catch { return null; }
  if (!row || typeof row !== 'object') return null;
  if (row.bidflowObservation === 'window') {
    windowMarker(row.window,row.edge);
    return {kind:'window',data:{window:row.window,edge:row.edge}};
  }
  if (row.bidflowObservation === 'cpu') {
    if (row.container !== 'bidflow-local-postgres-1' || typeof row.cpu !== 'string' || !/^\d+(?:\.\d+)?%$/.test(row.cpu)) throw Error('invalid CPU sample');
    return {kind:'cpu',data:{cpuPercent:number(row.cpu.slice(0,-1))}};
  }
  if (row.logger_name === 'com.bidflow.runtime.OutboxTimingLog') {
    const fields=['@timestamp','event','eventId','correlationId','topic','eventType','pendingAgeStatus','pendingAgeMs','batchWaitMs','sendAckMs','sendAttemptMs','outcome','partition','offset'];
    if (!['event.acknowledged','event.published','event.send.failed','event.publish.failed'].includes(row.event)) throw Error('invalid event observation');
    return {kind:'event',data:Object.fromEntries(fields.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]))};
  }
  if (row.logger_name !== 'com.bidflow.runtime.OutboxScheduler' || row.event !== 'outbox.poll.completed') return null;
  if (!['SUCCEEDED','FAILED'].includes(row.outcome)) throw Error('invalid poll outcome');
  const data = {outcome:row.outcome};
  if (row.outcome === 'SUCCEEDED') {
    data.publishedCount = number(row.publishedCount);
    if (!Number.isSafeInteger(data.publishedCount)) throw Error('invalid count');
  } else if (Object.hasOwn(row,'publishedCount')) throw Error('failed poll has count');
  if (Object.hasOwn(row,'durationMs')) data.durationMs = number(row.durationMs);
  return {kind:'poll',data};
}

export function summarizeWindow(records, window) {
  if (!windows.includes(window)) throw Error('invalid window');
  let previous = -1;
  const seen = new Set();
  for (const record of records) {
    if (typeof record.source !== 'string' || !record.source || !Number.isSafeInteger(record.line) || record.line < 1) throw Error('invalid source');
    const key = JSON.stringify([record.source,record.line]);
    if (seen.has(key)) throw Error('duplicate source row');
    seen.add(key);
    if (!Number.isFinite(record.receivedMs) || record.receivedMs < 0 || record.receivedMs < previous) throw Error('invalid observation clock');
    previous = record.receivedMs;
    // Validate stored records too, not only freshly parsed input.
    if (record.kind === 'window') windowMarker(record.data.window,record.data.edge);
    else if (record.kind === 'cpu') number(record.data.cpuPercent);
    else if (record.kind === 'poll') {
      parseObservation(JSON.stringify({...record.data,logger_name:'com.bidflow.runtime.OutboxScheduler',event:'outbox.poll.completed'}));
    } else if (record.kind === 'event') {
      const sanitized=parseObservation(JSON.stringify({...record.data,logger_name:'com.bidflow.runtime.OutboxTimingLog'}));
      if (JSON.stringify(sanitized.data) !== JSON.stringify(record.data)) throw Error('unsanitized event');
    } else throw Error('invalid observation kind');
  }
  const bounds = records.filter(r=>r.kind === 'window' && r.data.window === window);
  if (bounds.length !== 2 || bounds[0].data.edge !== 'open' || bounds[1].data.edge !== 'close' || bounds[1].receivedMs <= bounds[0].receivedMs) throw Error('invalid window boundaries');
  const inside = records.slice(records.indexOf(bounds[0])+1,records.indexOf(bounds[1]));
  if (inside.some(r=>r.kind === 'window')) throw Error('overlapping windows');
  const polls = inside.filter(r=>r.kind === 'poll').map(r=>r.data);
  const cpus = inside.filter(r=>r.kind === 'cpu').map(r=>r.data.cpuPercent).sort((a,b)=>a-b);
  const failures = polls.filter(p=>p.outcome === 'FAILED').length;
  const published = polls.filter(p=>p.outcome === 'SUCCEEDED').reduce((sum,p)=>sum+p.publishedCount,0);
  const empty = polls.filter(p=>p.outcome === 'SUCCEEDED' && p.publishedCount === 0).length;
  const durations = polls.flatMap(p=>p.durationMs === undefined ? [] : [p.durationMs]);
  const durationMs = bounds[1].receivedMs-bounds[0].receivedMs;
  return {valid:polls.length > 0 && failures === 0 && durations.length === polls.length && (window !== 'idle' || published === 0),
    durationMs,completedPolls:polls.length,failedPolls:failures,emptyPolls:empty,
    publishedCount:failures ? null : published,emptyRatio:failures || !polls.length ? null : empty/polls.length,
    pollsPerSecond:polls.length/(durationMs/1000),missingDuration:polls.length-durations.length,duration:percentiles(durations),
    cpu:{count:cpus.length,sufficient:cpus.length >= 5,
      median:cpus.length ? (cpus[Math.floor((cpus.length-1)/2)]+cpus[Math.floor(cpus.length/2)])/2 : null,
      max:cpus.length ? cpus.at(-1) : null}};
}
