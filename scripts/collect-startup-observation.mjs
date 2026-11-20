import {open,realpath} from 'node:fs/promises';
import {dirname,basename,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {performance} from 'node:perf_hooks';
import {parseStartupLine,summarizeStartup} from './startup-observation.mjs';

async function main() {
  if(process.argv.length!==3)throw Error('usage');
  const output=resolve(process.argv[2]);
  const target=resolve(await realpath(dirname(output)),basename(output));
  const root=await realpath(fileURLToPath(new URL('../',import.meta.url)));
  const rel=relative(root,target);
  if(!rel.startsWith('../')&&!isAbsolute(rel))throw Error('external output required');
  const artifact=await open(target,'wx',0o600);
  const evidence={startedAt:new Date().toISOString(),valid:false,records:[]};
  const origin=performance.now();let lineNumber=0;
  try {
    for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
      lineNumber++;const receivedMs=performance.now()-origin;
      const observation=parseStartupLine(line);
      if(observation)evidence.records.push({source:'stdin',line:lineNumber,receivedMs,...observation});
      if(evidence.records.length>200000)throw Error('observation limit');
    }
    evidence.summary=summarizeStartup(evidence.records);evidence.valid=true;
  } catch {evidence.error='INCOMPLETE_OR_INVALID_OBSERVATION';}
  finally {
    evidence.completedAt=new Date().toISOString();
    await artifact.writeFile(JSON.stringify(evidence,null,2)+'\n');await artifact.close();
  }
  console.log(JSON.stringify({output:target,valid:evidence.valid,testsPassed:evidence.summary?.testsPassed ?? false}));
  if(!evidence.valid)process.exitCode=1;
}
main().catch(()=>{console.error('Startup collector failed: supply a new external output file.');process.exitCode=1;});
