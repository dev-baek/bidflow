import {open,realpath} from 'node:fs/promises';
import {dirname,basename,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {performance} from 'node:perf_hooks';
import {parseObservation,summarizeWindow} from './outbox-delay-observation.mjs';

async function main() {
  const [label,output]=process.argv.slice(2);
  if (process.argv.length !== 4 || !['A1','B','A2'].includes(label)) throw Error('usage');
  const target=resolve(await realpath(dirname(resolve(output))),basename(output));
  const root=await realpath(fileURLToPath(new URL('../',import.meta.url)));
  const rel=relative(root,target);
  if (!rel.startsWith('../') && !isAbsolute(rel)) throw Error('external output required');
  const artifact=await open(target,'wx',0o600);
  const evidence={label,startedAt:new Date().toISOString(),valid:false,records:[]};
  const origin=performance.now();
  let lineNumber=0;
  try {
    for await (const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
      lineNumber++;
      const receivedMs=performance.now()-origin;
      const observation=parseObservation(line);
      if (observation) evidence.records.push({source:'stdin',line:lineNumber,receivedMs,...observation});
      if (evidence.records.length > 200_000) throw Error('observation limit');
    }
    const markers=evidence.records.filter(row=>row.kind === 'window').map(row=>`${row.data.window}:${row.data.edge}`);
    if (markers.join(',') !== 'idle:open,idle:close,bid:open,bid:close') throw Error('invalid phase order');
    evidence.windows=Object.fromEntries(['idle','bid'].map(window=>[window,summarizeWindow(evidence.records,window)]));
    evidence.valid=Object.values(evidence.windows).every(window=>window.valid);
    evidence.costComparisonReady=Object.values(evidence.windows).every(window=>window.valid && window.cpu.sufficient);
  } catch {
    evidence.error='INCOMPLETE_OR_INVALID_OBSERVATION';
  } finally {
    evidence.completedAt=new Date().toISOString();
    await artifact.writeFile(JSON.stringify(evidence,null,2)+'\n');
    await artifact.close();
  }
  console.log(JSON.stringify({output:target,valid:evidence.valid,costComparisonReady:evidence.costComparisonReady ?? false}));
  if (!evidence.valid) process.exitCode=1;
}
main().catch(()=>{console.error('Collector failed: use A1/B/A2 and a new output path outside the repository.');process.exitCode=1;});
