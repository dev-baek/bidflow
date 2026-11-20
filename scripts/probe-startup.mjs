import {performance} from 'node:perf_hooks';
import {setTimeout as sleep} from 'node:timers/promises';
import {readyForTests} from './startup-observation.mjs';

export async function probeStartup({emit,fetchImpl=fetch,now=()=>performance.now(),wait=sleep,timeoutMs=90000}) {
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>90000)throw Error('invalid probe limit');
  const deadline=now()+timeoutMs;
  while(now()<deadline) {
    for(const endpoint of ['health','readiness']) {
      const remaining=deadline-now();if(remaining<=0)break;
      const observation={startupObservation:'probe',endpoint,httpStatus:null,status:null};
      try {
        const response=await fetchImpl('http://127.0.0.1:8080/actuator/health'+(endpoint==='readiness'?'/readiness':''),
          {signal:AbortSignal.timeout(Math.max(1,Math.floor(Math.min(1000,remaining))))});
        if(Number.isInteger(response.status)&&response.status>=100&&response.status<=599)observation.httpStatus=response.status;
        try {
          const body=await response.json();
          if(!['UP','DOWN','OUT_OF_SERVICE','UNKNOWN'].includes(body?.status)||observation.httpStatus===null)throw Error('invalid response');
          observation.status=body.status;
        } catch {observation.error='INVALID_RESPONSE';}
      } catch(error) {observation.error=error?.name==='TimeoutError'||error?.name==='AbortError'?'TIMEOUT':'CONNECTION_FAILED';}
      if(now()>=deadline)observation.error='TIMEOUT';
      emit(observation);
      if(readyForTests(observation))return true;
    }
    if(now()<deadline)await wait(Math.min(200,deadline-now()));
  }
  emit({startupObservation:'setup.failure',code:'PROBE_TIMEOUT'});return false;
}
