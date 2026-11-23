import {chromium} from '@playwright/test';
import {setTimeout as wait} from 'node:timers/promises';
import {createPublicJournal,judgeBrowserConvergence} from '../../../scripts/load-browser-convergence.mjs';
import {focusedConfig,planFocused} from '../../../scripts/focused-thousand.mjs';

const roles=['A','B'];
const api='http://127.0.0.1:8080';
const socketUrl='ws://127.0.0.1:8080/ws';
const priceText=price=>price.toLocaleString('ko-KR')+'원';

export function createBrowserObserver(web,now) {
  if(!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(web)||Number(new URL(web).port)>65535)
    throw Error('explicit loopback Vite origin required');
  let browser,journal,fixture,closing=false;
  const screens={A:new Map(),B:new Map()},detach=[];
  return {
    error:()=>journal?.error(),
    async prepare(value,mode){
      fixture=value;
      journal=createPublicJournal(fixture.auctionId,now);
      const deadline=now()+20000;
      const timeout=()=>Math.max(1,deadline-now());
      const {vus,iterations}=focusedConfig(mode);
      const expected=planFocused(fixture.runId,mode,vus,iterations-1).amount;
      browser=await chromium.launch({timeout:timeout()});
      browser.on('disconnected',()=>{if(!closing)journal.fail('BROWSER_LOST');});
      await Promise.all(roles.map(async role=>{
        const context=await browser.newContext({locale:'ko-KR',serviceWorkers:'block'});
        await context.route('**/*',route=>{
          const r=route.request();
          return [web,api].includes(new URL(r.url()).origin)&&!r.redirectedFrom()?route.continue():route.abort();
        });
        await context.routeWebSocket('**/*',ws=>{
          if(ws.url()===socketUrl)ws.connectToServer();
          else void ws.close();
        });
        const page=await context.newPage();
        await page.goto(web+'/login',{timeout:timeout()});
        await page.getByLabel('로컬 개발자 ID').fill(`${fixture.runId}-observer-${role}`,{timeout:timeout()});
        await page.getByRole('button',{name:'로컬 로그인'}).click({timeout:timeout()});
        await page.waitForURL(web+'/',{timeout:timeout()});
        const locator=page.locator('.auction-summary dd').first();
        const detailUrl=web+'/auctions/'+fixture.auctionId;
        const topic='/topic/auctions/'+fixture.auctionId;
        let socket,ready=false,navigate=false;
        const lose=()=>{if(!closing)journal.fail('OBSERVER_LOST');};
        const receive=({payload})=>{
          const raw=payload.toString();
          const boundary=/\r?\n\r?\n/.exec(raw);
          if(!boundary||!raw.startsWith('MESSAGE')||!raw.slice(0,boundary.index).split(/\r?\n/).includes('destination:'+topic))return;
          if(Buffer.byteLength(raw)>8192)return journal.fail('FRAME_LIMIT');
          let body;
          try{body=JSON.parse(raw.slice(boundary.index+boundary[0].length).replace(/\0$/,''));}
          catch{return journal.fail('INVALID_FRAME');}
          const frame=journal.frame(role,body);
          if(frame?.price!==expected||screens[role].has(frame.eventId))return;
          const check=locator.and(page.getByText(priceText(expected),{exact:true})).waitFor({state:'visible',timeout:60000})
            .then(()=>journal.screen(frame),()=>null);
          screens[role].set(frame.eventId,check);
        };
        const onSocket=ws=>{
          if(ws.url()!==socketUrl)return;
          if(socket){lose();return;}
          socket=ws;
          const sent=({payload})=>{
            if(/^SUBSCRIBE\r?\n/.test(payload.toString())&&payload.toString().split(/\r?\n/).includes('destination:'+topic))ready=true;
          };
          ws.on('framesent',sent);ws.on('framereceived',receive);ws.on('close',lose);ws.on('socketerror',lose);
          detach.push(()=>{ws.off('framesent',sent);ws.off('framereceived',receive);ws.off('close',lose);ws.off('socketerror',lose);});
        };
        page.on('websocket',onSocket);page.on('close',lose);page.on('crash',lose);
        page.on('request',r=>{if(navigate&&r.isNavigationRequest()&&r.frame()===page.mainFrame())lose();});
        page.on('framenavigated',frame=>{if(navigate&&frame===page.mainFrame()&&frame.url()!==detailUrl)lose();});
        await page.evaluate(id=>{
          history.pushState({},'', '/auctions/'+id);
          window.dispatchEvent(new PopStateEvent('popstate'));
        },fixture.auctionId);
        navigate=true;
        await page.waitForURL(detailUrl,{timeout:timeout()});
        await locator.and(page.getByText('10,000원',{exact:true})).waitFor({timeout:timeout()});
        await page.locator('.auction-summary dd').nth(1).and(page.getByText('ACTIVE',{exact:true})).waitFor({timeout:timeout()});
        while(!ready&&!journal.error()&&now()<deadline)await wait(25);
        if(!ready||journal.error()||now()>=deadline){journal.fail('BROWSER_NOT_READY');throw Error('observer not ready');}
      }));
    },
    async finish(e,deadline){
      const final=e.snapshot.rows.find(row=>row.decision==='ACCEPTED'&&row.events[0].version===e.snapshot.auction.version)?.events[0];
      let observations={};
      while(!journal.error()&&final&&now()<deadline){
        if(roles.every(role=>screens[role].has(final.id))){
          let timer;
          try{
            const values=await Promise.race([Promise.all(roles.map(role=>screens[role].get(final.id))),
              new Promise(resolve=>{timer=setTimeout(()=>resolve([]),Math.max(1,deadline-now()));})]);
            observations=Object.fromEntries(roles.map((role,i)=>[role,values[i]??null]));
          }finally{clearTimeout(timer);}
          break;
        }
        await wait(25);
      }
      return {...judgeBrowserConvergence({...journal.snapshot(),...fixture,final,screens:observations,
        loadStartedMs:e.loadStartedMs,loadEndedMs:e.loadEndedMs}),screens:observations};
    },
    freeze(deadline){
      closing=true;
      return journal?.freeze(deadline)??{frames:[],screenChecks:[],error:null};
    },
    async close(){
      try{for(const stop of detach)stop();}
      finally{await browser?.close();}
    },
  };
}
