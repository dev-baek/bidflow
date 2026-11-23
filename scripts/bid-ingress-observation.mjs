import {isUuid} from './final-settlement.mjs';

export const diagnosticCorrelationId=value=>value?.length===36&&isUuid(value)?value:null;

function nanos(value) {
  if(typeof value!=='string'||!/^[0-9]{1,16}$/.test(value))return null;
  const n=Number(value);
  return Number.isSafeInteger(n)?n:null;
}

export function joinBidIngress(receipts,logs) {
  if(!Array.isArray(receipts)||!Array.isArray(logs)||receipts.length===0)return {complete:false,samples:[]};
  const calls=new Map();
  for(const receipt of receipts){
    const id=diagnosticCorrelationId(receipt?.correlationId);
    if(id)calls.set(id,calls.has(id)?null:{receipt,received:[],timing:[]});
  }
  for(const log of logs){
    const call=calls.get(log?.correlationId);
    if(!call)continue;
    if(log.event==='bid.request.received')call.received.push(log);
    if(log.event==='bid.ingress.timing')call.timing.push(log);
  }
  const samples=[];
  for(const [correlationId,call] of calls){
    if(!call||call.received.length!==1||call.timing.length!==1)continue;
    const {requestId,httpStatus,receiptStatus,durationMs}=call.receipt;
    const [received]=call.received,[timing]=call.timing;
    if(requestId?.length!==36||!isUuid(requestId)||httpStatus!==202||receiptStatus!=='RECEIVED'
      ||!Number.isFinite(durationMs)||durationMs<0||received.bidRequestId!==requestId||timing.bidRequestId!==requestId
      ||received.outcome!=='RECEIVED'||timing.outcome!=='HTTP_RETURNED'
      ||timing.receiveOutcome!=='RETURNED'||timing.httpStatus!=='202')continue;
    const http=nanos(timing.httpNanos),start=nanos(timing.receiveStartNanos),end=nanos(timing.receiveEndNanos);
    if(http===null||start===null||end===null||start>end||end>http)continue;
    samples.push({correlationId,requestId,clientDurationMs:durationMs,serverDurationMs:http/1e6,receiveDurationMs:(end-start)/1e6});
  }
  return {complete:samples.length===receipts.length,samples};
}
