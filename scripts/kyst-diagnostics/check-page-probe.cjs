const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync(__dirname+'/page-probe.js','utf8');let cases=[];
function make(opts={}){
 let y=0,t=0,listeners=new Set(),raf=new Map(),next=0;
 const target={isConnected:true,scrollHeight:1200,clientHeight:400,get scrollTop(){return y},set scrollTop(v){y=v},scrollTo({top}){if(!opts.noScroll)y=top;},contains:()=>true,addEventListener(n,f){listeners.add(f)},removeEventListener(n,f){listeners.delete(f)}};
 const names=['Calendar','Clock','Weather','Tasks','Chores','Points','Family Messages'];
 const cards=names.map(name=>({dataset:{widget:name},getBoundingClientRect:()=>({x:0,y:0,width:100,height:100}),querySelectorAll:()=>opts.ambiguous?[target,target]:[target]}));
 const root={isConnected:true,querySelectorAll:()=>cards};
 const context={window:{},location:{origin:opts.origin||'https://kyst-wall-proxy.fly.dev'},document:{hidden:!!opts.hidden,documentElement:{dataset:{}},querySelector:()=>root},innerWidth:2560,innerHeight:1440,devicePixelRatio:1.5,getComputedStyle:()=>({overflowY:'auto'}),console:{info(){}},performance:{now:()=>t},Date,Promise,setTimeout:(f,ms)=>setTimeout(f,ms===15000?1000:ms===60000?50:1),clearTimeout,requestAnimationFrame:f=>{let id=++next;if(!opts.noFrames)raf.set(id,setImmediate(()=>{raf.delete(id);t+=opts.interval||16.6667;f(t)}));return id},cancelAnimationFrame:id=>{clearImmediate(raf.get(id));raf.delete(id)}};
 vm.createContext(context);return {context,target,root,listeners,run:()=>vm.runInContext(code,context),probe:()=>context.window.__nox11625AcceptanceProbe};
}
async function acknowledge(h) {
 for(let n=0;n<40 && h.probe().output.scroll?.phase!=='scrolled_capture_window';n++) await new Promise(r=>setTimeout(r,1));
 h.probe().acknowledgeCapture({commandId:'nox11625-final-scroll-frame',sha256:'a'.repeat(64),width:3840,height:2160});
}
async function check(name,f){await f();cases.push({name,passed:true});}
(async()=>{
 await check('wrong origin refuses before installation',()=>assert.throws(()=>make({origin:'https://example.com'}).run(),/Wrong document/));
 await check('hidden document refuses',()=>assert.throws(()=>make({hidden:true}).run(),/Visible NOX/));
 await check('ambiguous scroller refuses',()=>assert.throws(()=>make({ambiguous:true}).run(),/ambiguous/));
 await check('existing installation cannot replay',()=>{let h=make();h.run();assert.throws(h.run,/already installed/)});
 await check('actual scroll function restores original numeric offset',async()=>{let h=make();h.run();let promise=h.probe().scrollAndRestore();await acknowledge(h);let r=await promise;assert.equal(r.ok,true);assert.equal(r.observed,240);assert.equal(r.restored,0);await assert.rejects(h.probe().scrollAndRestore(),/consumed/)});
 await check('no movement cannot pass',async()=>{let h=make({noScroll:true});h.run();let r=await h.probe().scrollAndRestore();assert.equal(r.ok,false);assert.match(r.error,/No meaningful/);assert.equal(r.restoreVerified,true)});
 await check('detached original target prevents alternate-node restore',async()=>{let h=make();h.run();h.target.scrollTo=()=>{h.target.isConnected=false;};let r=await h.probe().scrollAndRestore();assert.equal(r.restoreVerified,false);assert.equal(r.ok,false)});
 await check('actual measurement reports nominal60Hz and removes listeners',async()=>{let h=make();h.run();let r=await h.probe().measure();assert.equal(r.ok,true);assert.ok(r.samples>=599);assert.ok(r.rafHz>59&&r.rafHz<61);assert.equal(r.trustedTouchEvents.length,0);assert.equal(h.listeners.size,0);await assert.rejects(h.probe().measure(),/consumed/)});
 await check('slow cadence measured honestly below50Hz',async()=>{let h=make({interval:25});h.run();let r=await h.probe().measure();assert.equal(r.ok,true);assert.equal(r.cadenceAtLeast50Hz,false);assert.equal(r.rafHz,40)});
 await check('missing rAF times out, cannot read as pass',async()=>{let h=make({noFrames:true});h.run();let r=await h.probe().measure();assert.equal(r.ok,false);assert.match(r.error,/deadline/);assert.equal(h.listeners.size,0)});
 await check('viewport drift refuses measurement before listeners',async()=>{let h=make();h.run();h.context.innerWidth=2000;await assert.rejects(h.probe().measure(),/viewport/);assert.equal(h.listeners.size,0)});
 await check('missing capture acknowledgement fails and restores',async()=>{let h=make();h.run();let r=await h.probe().scrollAndRestore();assert.equal(r.ok,false);assert.match(r.error,/acknowledgement timed out/);assert.equal(r.restored,0);assert.equal(r.restoreVerified,true)});
 await check('wrong native capture ID cannot release hold',async()=>{let h=make();h.run();let promise=h.probe().scrollAndRestore();for(let n=0;n<40 && h.probe().output.scroll?.phase!=='scrolled_capture_window';n++)await new Promise(r=>setTimeout(r,1));assert.throws(()=>h.probe().acknowledgeCapture({commandId:'other',sha256:'a'.repeat(64),width:3840,height:2160}),/Wrong native/);let r=await promise;assert.equal(r.ok,false);assert.equal(r.restoreVerified,true)});
 await check('acknowledgement after terminal is refused',async()=>{let h=make();h.run();await h.probe().scrollAndRestore();assert.throws(()=>h.probe().acknowledgeCapture({}),/No open/)});
 await check('touch-window scroll restores original offset after measurement',async()=>{let h=make();h.run();h.target.scrollTop=123;let pending=h.probe().measure();h.target.scrollTop=321;let r=await pending;assert.equal(r.ok,true);assert.equal(r.scrollBefore,123);assert.equal(r.restoredScroll,123);assert.equal(r.restoreVerified,true);assert.equal(r.trustedTouchSampleCount,0);assert.match(r.touchAssessment,/separate attended observer/)});
 await check('measurement with detached target cannot report restored success',async()=>{let h=make();h.run();let pending=h.probe().measure();h.target.isConnected=false;let r=await pending;assert.equal(r.ok,false);assert.equal(r.restoreVerified,false);assert.match(r.restoreError,/Original node detached/);assert.equal(h.listeners.size,0)});
 await check('restoration exception after capture success still records terminal',async()=>{let h=make();h.run();let calls=0,original=h.target.scrollTo;h.target.scrollTo=(x)=>{if(++calls===2)throw new Error('restore exploded');original(x);};let pending=h.probe().scrollAndRestore();await acknowledge(h);let r=await pending;assert.equal(r.phase,'terminal');assert.ok(r.completedAt);assert.equal(r.ok,false);assert.equal(r.restoreVerified,false);assert.match(r.restoreError,/restore exploded/);assert.equal(r.error,undefined)});
 await check('capture failure and restoration exception are both retained',async()=>{let h=make();h.run();let calls=0,original=h.target.scrollTo;h.target.scrollTo=(x)=>{if(++calls===2)throw new Error('restore exploded');original(x);};let r=await h.probe().scrollAndRestore();assert.equal(r.phase,'terminal');assert.ok(r.completedAt);assert.equal(r.restoreVerified,false);assert.match(r.error,/acknowledgement timed out/);assert.match(r.restoreError,/restore exploded/)});
 const result={passed:cases.length,total:18,cases,scope:'Actual supplied JavaScript functions in Node VM; DOM, clock, rAF and scroll boundaries mocked. No browser/device or physical touch execution.'};fs.writeFileSync(__dirname+'/page-probe-checks.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(e=>{console.error(e);process.exit(1)});
