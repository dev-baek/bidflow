import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {mkdtempSync,readFileSync,statSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import type {APIResponse,Response,Page,WebSocket,TestInfo} from '@playwright/test';
import {createFailureJournal,captureFailure,validateFailureProbe} from '../../../scripts/failure-correlation.mjs';
import {buildFocusedSql} from '../../../scripts/concurrent-browser-sql.mjs';
import {claimOutput} from '../../../scripts/focused-load-collector.mjs';
import {parseBidResultMessage,parsePublicAuctionMessage} from '../src/features/auction-realtime/auction-realtime-client';

type Role='A'|'B';
const run=promisify(execFile);
export function createDirectFailureDiagnostics(info:TestInfo,web:string,api:string){
  const probe=validateFailureProbe({flag:process.env.BIDFLOW_E2E_FAILURE_PROBE,web,api,title:info.title,workers:info.config.workers,retries:info.project.retries});
  // The same URL guard applies even when the controlled failure is off.
  validateFailureProbe({flag:'direct-bid',web,api,title:info.title,workers:1,retries:0});
  const origin=performance.now();
  const journal=createFailureJournal({runId:randomUUID(),source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),now:()=>performance.now()-origin});
  let auctionId:string|null=null;
  const pages:Partial<Record<Role,Page>>={},off:Array<()=>void>=[];
  const dispose=()=>{const pending=off.splice(0);let failed=false;for(const stop of pending)try{stop();}catch{failed=true;}if(failed)throw Error('DIAGNOSTIC_CLEANUP_FAILED');};
  return {
    probe,
    verified:()=>journal.verified(),
    register:(id:string)=>{auctionId=id;journal.register(id,'2030-01-01T12:30:00Z');},
    page:(role:Role,page:Page,socket:WebSocket)=>{
      pages[role]=page;
      const consoleMessage=(message:{type:()=>string})=>journal.console(role,message.type(),null);
      const frame=({payload}:{payload:string|Buffer})=>{
        const raw=payload.toString(),match=/^MESSAGE\r?\n[\s\S]*?\r?\n\r?\n([^\0]+)\0?$/.exec(raw);
        if(!match){if(raw.startsWith('MESSAGE'))journal.invalidate();return;}
        if(!parseBidResultMessage(match[1])&&!parsePublicAuctionMessage(match[1])){journal.invalidate();return;}
        journal.frame(role,match[1]);
      };
      page.on('console',consoleMessage);socket.on('framereceived',frame);
      off.push(()=>page.off('console',consoleMessage),()=>socket.off('framereceived',frame));
    },
    record:async(role:Role,amount:number,response:APIResponse|Response,key?:string)=>{
      try{
        const actualKey=key??await (response as Response).request().headerValue('idempotency-key');
        let body:unknown=null;
        try{const text=await response.text();if(text.length<=8192)body=JSON.parse(text);}catch{}
        journal.http({role,auctionId,key:actualKey,amount,status:response.status(),body});
      }catch{journal.invalidate();}
    },
    capture:async()=>{
      try{
        const parent=mkdtempSync(join(tmpdir(),'bidflow-direct-failure.'));
        const output=await claimOutput(join(parent,'evidence'));
        const result=await captureFailure(journal,{
          detach:dispose,
          sql:async(id:string)=>{
            const {stdout}=await run('docker',['exec','bidflow-local-postgres-1','psql','-XqAt','-U','bidflow','-d','bidflow','-v','ON_ERROR_STOP=1','-c',buildFocusedSql(id)],{timeout:5000,maxBuffer:1000000});
            return JSON.parse(stdout.trim());
          },
          screenshot:async(role:Role)=>{
            const page=pages[role];if(!page||page.isClosed())throw Error('SCREEN_UNAVAILABLE');
            const path=join(output,`role-${role}.png`);await page.screenshot({path,timeout:2500});
            return {bytes:statSync(path).size,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};
          },
          write:(data:unknown)=>{const path=join(output,'failure-correlation.json');writeFileSync(path+'.tmp',JSON.stringify(data,null,2)+'\n',{mode:0o600});renameSync(path+'.tmp',path);return path;},
          attach:async(path:string)=>{
            for(const role of ['A','B']){const screen=join(output,`role-${role}.png`);if(existsSync(screen))await info.attach(`failure-role-${role}`,{path:screen,contentType:'image/png'});}
            await info.attach('failure-correlation',{path,contentType:'application/json'});
          },
        });
        info.annotations.push({type:'failure-correlation',description:result.diagnosticsComplete?'complete':'partial'});
      }catch{try{dispose();}catch{}info.annotations.push({type:'failure-correlation',description:'partial'});}
    },
    dispose,
  };
}
