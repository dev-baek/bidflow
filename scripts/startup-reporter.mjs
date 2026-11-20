import {basename} from 'node:path';
import {parseStartupLine,startupCaseId} from './startup-observation.mjs';

// Explicit --reporter selection only; does not change the normal Playwright configuration.
export default class StartupReporter {
  constructor(options={}) {this.write=options.write ?? (line=>process.stdout.write(line));this.buffer='';}
  emit(event,data) {this.write(JSON.stringify({startupObservation:event,...data})+'\n');}
  fail(code) {this.emit('setup.failure',{code});}
  onBegin(config,suite) {
    if(config.workers!==1){this.fail('INVALID_WORKERS');return;}
    const tests=suite.allTests();
    if(tests.length!==2 || tests.map(t=>this.caseId(t)).join(',')!=='unsold,auto-finalization')this.fail('INVALID_SELECTION');
  }
  caseId(test) {return basename(test.location.file)==='listing-registration.spec.ts'?startupCaseId(test.title):null;}
  onTestBegin(test,result) {
    const caseId=this.caseId(test);
    if(!caseId){this.fail('INVALID_SELECTION');return;}
    if(result.retry!==0 || test.retries!==0){this.fail('UNEXPECTED_RETRY');return;}
    this.emit('test.begin',{caseId});
  }
  onTestEnd(test,result) {
    const caseId=this.caseId(test);
    if(!caseId){this.fail('INVALID_SELECTION');return;}
    this.emit('test.end',{caseId,status:result.status,durationMs:result.duration});
  }
  onStdOut(chunk) {
    this.buffer+=chunk.toString();
    if(this.buffer.length>65536){this.buffer='';this.fail('PROCESS_FAILED');return;}
    let end;
    while((end=this.buffer.indexOf('\n'))>=0) {
      const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);
      try {
        const observation=parseStartupLine(line);
        if(observation?.kind==='auction')this.emit('auction',observation.data);
      } catch {this.fail('PROCESS_FAILED');}
    }
  }
  onError() {this.fail('PROCESS_FAILED');}
  onEnd() {if(this.buffer.trim())this.onStdOut('\n');}
  printsToStdio() {return true;}
}
