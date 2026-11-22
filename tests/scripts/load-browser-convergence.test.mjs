import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicJournal, judgeBrowserConvergence } from '../../scripts/load-browser-convergence.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const auctionId=id(1), endsAt='2030-01-01T13:00:00Z';
const final={id:id(2),version:11,price:510000};
const frame={auctionId,eventId:final.id,type:'auction.updated',auctionVersion:11,currentPrice:510000,endsAt};
const fixture=()=>{
  let now=3;
  const journal=createPublicJournal(auctionId,()=>now++);
  for(const role of ['A','B'])journal.frame(role,{...frame,authorization:'private'});
  return {journal,input:{...journal.snapshot(),auctionId,endsAt,final,loadStartedMs:1,loadEndedMs:10,screens:{A:8,B:12}}};
};
test('joins only final domain event and two screens, and keeps evidence allowlisted',()=>{
  const {input}=fixture(),result=judgeBrowserConvergence(input);
  assert.equal(result.valid,true);
  assert.deepEqual(result.samples.map(x=>x.remainingAfterLoadMs),[0,2]);
  assert.deepEqual(result.samples.map(x=>x.frameToScreenMs),[5,8]);
  assert.doesNotMatch(JSON.stringify(input),/authorization|private/);
});
test('fails on wrong identity, partial SQL, missing role, bad order, timeout or disconnect',()=>{
  for(const change of [
    x=>x.final=null,x=>x.frames[0].eventId=id(8),x=>x.frames[0].auctionId=id(8),
    x=>x.frames[0].version++,x=>x.frames[0].price++,x=>x.frames[0].endsAt='2030-01-01T14:00:00Z',
    x=>x.frames.pop(),x=>x.screens.B=2,x=>x.screens.B=60011,x=>x.error='SOCKET_LOST',
    x=>x.frames.push({...x.frames[0],price:12}),
  ]){const {input}=fixture();change(input);assert.equal(judgeBrowserConvergence(input).valid,false);}
});
test('overflow or malformed input fails closed; identical duplicates and snapshot copies are safe',()=>{
  const {journal,input}=fixture();
  journal.frame('A',frame);
  assert.equal(judgeBrowserConvergence({...input,...journal.snapshot()}).valid,true);
  for(let i=0;i<2048;i++)journal.frame('A',frame);
  assert.equal(journal.snapshot().error,'FRAME_LIMIT');
  assert.equal(input.frames.length,2);
  const separate=createPublicJournal(auctionId,()=>1);
  separate.frame('A',{...frame,eventId:undefined});
  assert.equal(separate.snapshot().error,'INVALID_FRAME');
});
