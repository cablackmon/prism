// Generated; edit scripts/kyst-diagnostics/page-probe.js.
export function installProbe(expectedOrigin){
/* REVIEW ONLY. Execute only in the existing, approved kiosk board document context.
 * No context-entry mechanism is supplied or enabled by this file.
 * No fetch, storage write, navigation, synthetic OS input or settings change.
 */
(() => {
  'use strict';
  const KEY = '__nox11625AcceptanceProbe';
  if (window[KEY]) throw new Error('Probe already installed; preserve result, no replay');
  const allowed = ['https://kyst-wall-proxy.fly.dev', 'https://kyst-board.fly.dev'];
  if (!allowed.includes(location.origin) && !(typeof expectedOrigin === 'string' && location.origin === expectedOrigin)) throw new Error('Wrong document origin');
  const root = document.querySelector('[data-kyst-theme="nox"]');
  if (!root || document.hidden || document.documentElement.dataset.kystScreensaver === 'active') throw new Error('Visible NOX board required');
  const expected = ['Calendar', 'Clock', 'Weather', 'Tasks', 'Chores', 'Points', 'Family Messages'];
  const cards = [...root.querySelectorAll('.kyst-widget')];
  const labels = cards.map(el => el.dataset.widget);
  if (expected.some(name => labels.filter(x => x === name).length !== 1)) throw new Error('Seven unique widgets required');
  const calendar = cards.find(el => el.dataset.widget === 'Calendar');
  const scrollers = [...calendar.querySelectorAll('[data-radix-scroll-area-viewport],.overflow-auto,.overflow-y-auto,[data-board-scroll]')].filter(el => el.scrollHeight > el.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(el).overflowY));
  if (scrollers.length !== 1) throw new Error('Calendar scroll target ambiguous or not overflowing');
  const target = scrollers[0];
  const initial = {width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scroll: target.scrollTop};
  const rect = el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
  const output = {version:1,origin:location.origin,startedAt:new Date().toISOString(),initial,calendar:rect(calendar),claims:{},events:[],limitations:['rAF callback cadence is not compositor-present FPS','programmatic scroll is not physical touch','event-to-rAF delay is not hardware touch-to-photon latency'],status:'installed'};
  function valid() {
    if (document.hidden || !root.isConnected || !target.isConnected || document.documentElement.dataset.kystScreensaver === 'active' || innerWidth !== initial.width || innerHeight !== initial.height || devicePixelRatio !== initial.dpr) throw new Error('Visibility, node identity, viewport or DPR changed');
  }
  function claim(name) { if (output.claims[name]) throw new Error(name+' already consumed'); output.claims[name]=new Date().toISOString(); valid(); }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let pendingCapture = null;
  function acknowledgeCapture(receipt) {
    if (!pendingCapture || output.scroll?.phase !== 'scrolled_capture_window') throw new Error('No open scroll capture window');
    if (Date.now() >= pendingCapture.until) throw new Error('Capture deadline expired');
    if (receipt?.commandId !== 'nox11625-final-scroll-frame' || !/^[a-f0-9]{64}$/.test(receipt.sha256 || '') || receipt.width !== 3840 || receipt.height !== 2160) throw new Error('Wrong native capture receipt');
    // The future fixed collector must authenticate issuer and verify native receipt timing.
    // This function alone does not establish origin/authenticity of an acknowledgement.
    output.scroll.captureReceipt = receipt;
    pendingCapture.resolve();
    pendingCapture = null;
  }
  async function scrollAndRestore() {
    claim('scroll'); const before=target.scrollTop; const beforeMax=target.scrollHeight-target.clientHeight;
    if(beforeMax<64) throw new Error('Insufficient scrolling range');
    const desired=before+Math.min(240,beforeMax-before) > before+32 ? before+Math.min(240,beforeMax-before) : Math.max(0,before-240);
    const result=output.scroll={before,desired,beforeMax,phase:'moving',ok:false};
    try {
      target.scrollTo({top:desired,behavior:'instant'});await sleep(250);valid();result.observed=target.scrollTop;
      if(Math.abs(result.observed-before)<32) throw new Error('No meaningful scroll observed');
      result.phase='scrolled_capture_window';result.captureFrom=new Date().toISOString();
      // Restore after a correlated native capture acknowledgement or at a hard60s limit.
      await new Promise((resolve, reject) => {
        const until = Date.now() + 60000;
        const timer = setTimeout(() => { pendingCapture = null; reject(new Error('Native scroll capture acknowledgement timed out; no retry')); }, 60000);
        pendingCapture = {until, resolve: () => {clearTimeout(timer);resolve();}};
        result.captureDeadline = new Date(until).toISOString();
      });
      valid();
    } catch(e) { result.error=String(e); }
    finally {
      pendingCapture = null;
      // Restore only the retained same node, even after visibility change.
      // Never search for and modify a replacement node after a remount.
      try {
        if(!target.isConnected)throw new Error('Original node detached; no alternate target changed');
        target.scrollTo({top:before,behavior:'instant'});await sleep(250);
        result.restored=target.scrollTop;result.restoreVerified=Math.abs(target.scrollTop-before)<=1;
      }catch(error){result.restoreVerified=false;result.restoreError=String(error);}
      result.phase='terminal';result.completedAt=new Date().toISOString();result.ok=!result.error && result.restoreVerified;
    }
    return result;
  }
  async function measure() {
    claim('performance');const scrollBefore=target.scrollTop;const result=output.performance={phase:'measuring',frames:0,ok:false,scrollBefore,trustedTouchEvents:[]};
    const gaps=[];let frame=0,stopped=false,last=null,first=null;const started=performance.now();
    const touch=e=>{if(!e.isTrusted || e.pointerType!=='touch' || !target.contains(e.target))return;const t=performance.now();const row={type:e.type,receivedAt:t,eventTimestamp:e.timeStamp};result.trustedTouchEvents.push(row);requestAnimationFrame(now=>{row.nextRafDelay=now-t;});};
    target.addEventListener('pointerdown',touch,{passive:true});target.addEventListener('pointerup',touch,{passive:true});
    let wallTimeout;
    try {
      await new Promise((resolve,reject)=>{
        wallTimeout=setTimeout(()=>reject(new Error('Measurement wall deadline / missing rAF')),15000);
        const tick=t=>{if(stopped)return;try{valid();if(first===null)first=t;if(last!==null)gaps.push(t-last);last=t;result.frames++;if(t-first>=10000){resolve();return;}frame=requestAnimationFrame(tick);}catch(e){reject(e);}};
        frame=requestAnimationFrame(tick);
      });
      const sorted=[...gaps].sort((a,b)=>a-b);result.elapsedMs=last-first;result.samples=gaps.length;
      if(!gaps.length || result.elapsedMs<10000)throw new Error('Empty/short sample');
      result.meanIntervalMs=result.elapsedMs/gaps.length;result.rafHz=1000*gaps.length/result.elapsedMs;result.p95IntervalMs=sorted[Math.ceil(sorted.length*.95)-1];result.maxIntervalMs=sorted.at(-1);result.intervalsOver20Ms=gaps.filter(x=>x>20).length;result.cadenceAtLeast50Hz=result.rafHz>=50;result.ok=true;
    } catch(e){result.error=String(e);}
    finally{stopped=true;cancelAnimationFrame(frame);clearTimeout(wallTimeout);target.removeEventListener('pointerdown',touch);target.removeEventListener('pointerup',touch);
      result.trustedTouchSampleCount=result.trustedTouchEvents.length;
      result.touchAssessment='Requires trusted samples AND a separate attended observer report; no automatic pass';
      try {
        if(!target.isConnected)throw new Error('Original node detached; no alternate target changed');
        target.scrollTo({top:scrollBefore,behavior:'instant'});await sleep(250);
        result.restoredScroll=target.scrollTop;result.restoreVerified=Math.abs(target.scrollTop-scrollBefore)<=1;
      }catch(error){result.restoreVerified=false;result.restoreError=String(error);}
      if(!result.restoreVerified)result.ok=false;
      result.phase='terminal';result.wallElapsedMs=performance.now()-started;result.completedAt=new Date().toISOString();}
    return result;
  }
  Object.defineProperty(window,KEY,{value:{output,scrollAndRestore,measure,acknowledgeCapture},configurable:false,writable:false});
  console.info('NOX-11625 probe installed; no scrolling or measurement started',output);
  return output;
})();

}
