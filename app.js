(()=>{'use strict';
/* =====================================================================
   Machining Plant Performance Sim
   Time: planned production minutes. 1 s on screen = 1 floor minute at 1×.
   Floor units: 1 unit ≈ 0.5 m.
   ===================================================================== */
const W=120,H=64;
const $=s=>document.querySelector(s);
const rnd=Math.random,pick=a=>a[Math.floor(rnd()*a.length)];
const pad=(n,l=2)=>String(n).padStart(l,'0');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const n0=v=>isFinite(v)?Math.round(v).toLocaleString('en-US'):'–';
const pct=(v,d=1)=>isFinite(v)?(v*100).toFixed(d)+'%':'–';
const usd=(v,d=2)=>isFinite(v)?(v<0?'−$':'$')+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'–';
const usdK=v=>{if(!isFinite(v))return'–';const a=Math.abs(v),s=v<0?'−$':'$';return a>=1e6?s+(a/1e6).toFixed(2)+'M':a>=1e3?s+Math.round(a/1e3)+'k':s+Math.round(a);};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- planning assumptions (edit here) ---------- */
const SHIFT_MIN=450;            // planned production minutes per shift (8 h less breaks)
const COST={
  mat:18.40,                    // casting, $ per unit started
  price:62,                     // selling price, $ per good unit
  dl:34,                        // direct labor, $ per hour fully loaded
  cnc:48, weld:22,              // variable machine overhead, $ per run hour
  tool:140,                     // $ per CNC tool change
  fixedDay:20000,               // fixed overhead per day at 2 shifts
  fixedShift:3000,              // added fixed overhead per extra shift or line
  stdScrap:0.02, stdCT:58, stdCrew:4, targetOEE:0.85, days:250};
const PROC={batch:300, bufCap:3, binStart:60, binRefill:60, binROP:15, toolLife:400, toolMin:6,
  reworkMin:12, walk:144, fork:300, respMin:8, pfd:0.70};  // walk/fork in floor units per min (72 and 150 m/min); pfd: PF&D + walking allowance
const ST=[
  {k:'LOAD',short:'LOAD',name:'Load & saw',type:'man',ct:38},
  {k:'CNC1',short:'CNC-1',name:'CNC-1 · Op 10 turning',type:'mc',ct:55,load:8,mtbf:960,mttr:25,scrap:0.010,defect:'dim'},
  {k:'CNC2',short:'CNC-2',name:'CNC-2 · Op 20 milling',type:'mc',ct:58,load:8,mtbf:960,mttr:25,scrap:0.012,defect:'dim'},
  {k:'DEB',short:'DEBURR',name:'Deburr & wash',type:'man',ct:40},
  {k:'WELD',short:'WELD',name:'Robotic weld',type:'mc',ct:58,load:12,mtbf:1440,mttr:20,scrap:0.010,defect:'por'},
  {k:'INSP',short:'INSPECT',name:'Leak test & inspect',type:'man',ct:36},
  {k:'PACK',short:'PACK',name:'Pack & label',type:'man',ct:32}];
/* Line 3 runs an older CNC-2: slower, less reliable, more scrap */
const LINE_OVR={2:{CNC2:{ct:71,mtbf:300,mttr:45,scrap:0.026,name:'CNC-2 · Op 20 milling (2009 machine)'}}};
const DEFECT={dim:{name:'Dimensional out-of-tolerance',scrapP:0.7},por:{name:'Weld porosity',scrapP:0.4}};
const FAIL={CNC1:['spindle overload alarm','tool changer fault','coolant pump low pressure','axis servo alarm'],
  CNC2:['spindle bearing temperature alarm','tool changer fault','axis servo alarm','chip conveyor jam'],
  WELD:['wire feed jam','torch collision','shielding gas flow fault']};
const PROJ=[
  {k:'pm',name:'PM program + spare spindle, L3 CNC-2',cost:75000,opex:true,desc:'MTBF 5 h → 14 h, MTTR 45 → 30 min'},
  {k:'smed',name:'SMED kit, all CNC cells',cost:90000,desc:'CNC changeover 45 → 20 min, weld 15 → 8 min'},
  {k:'tool',name:'Tool-wear monitoring',cost:140000,desc:'Halves dimensional defects on every CNC'},
  {k:'cnc',name:'Replace L3 CNC-2',cost:1200000,desc:'71 s → 56 s cycle, MTBF 24 h, standard scrap'},
  {k:'line4',name:'Add Line 4 in the expansion bay',cost:2800000,desc:'Standard line, needs its own crew and +$3k/day fixed'}];
const NAMES=['Maya','Luis','Priya','Dante','Keisha','Tomás','Hannah','Omar','Grace','Andre','Lena','Marcus','Yuki','Rosa','Ben','Aisha','Carlos','Nina','Theo','Fatima','Jamal','Ivy','Sam','Elena','Raj','Owen','Zara','Diego','Mei','Kofi','Ana','Victor'];
const STATES=['work','waitop','starved','blocked','setup','down'];
const SLABEL={work:'Working',waitop:'Waiting for operator',starved:'Starved',blocked:'Blocked',setup:'Changeover / tool change',down:'Down',idle:'Idle'};
const CATS={prod:'PROD',mnt:'ANDN',qual:'QUAL',mat:'MATL',labor:'LABR',capex:'PLAN'};

/* ---------- layout ---------- */
const LY=[9,19.5,30,40.5], AI=4, SX=[29,39,49,59,69,79,89], VA=[21,96.5], BOTTOM=47.8;
const ROOMS=[[22,50,34,62,'Maint. crib'],[34,50,44,62,'Tool crib'],[44,50,56,62,'Quality lab'],[56,50,72,62,'Rework & MRB'],[72,50,95,62,'Offices & break room'],[99,50,116,62,'Shipping docks']];
const BENCH={x:64,y:56.5};

/* ---------- state ---------- */
const U={speed:15,demand:2000,shifts:2,crew:4,brk:true,paused:false,proj:{pm:false,smed:false,tool:false,cnc:false,line4:false},
  balLine:2,filter:'all',only:false,sel:null,tour:-1};
let S;

function effSt(li,j,P=U.proj){const b=ST[j];const o=Object.assign({},b,(LINE_OVR[li]||{})[b.k]||{});
  if(li===2&&b.k==='CNC2'){if(P.cnc){Object.assign(o,{ct:56,mtbf:1440,mttr:25,scrap:0.010,name:'CNC-2 · Op 20 milling (new 5-axis)'});}
    else if(P.pm){o.mtbf=840;o.mttr=30;}}
  if(P.tool&&o.defect==='dim')o.scrap*=0.5;
  return o;}
const coMin=(p,P=U.proj)=>p.k==='WELD'?(P.smed?8:15):(P.smed?20:45);
const nLines=(P=U.proj)=>P.line4?4:3;
const dayLen=()=>U.shifts*SHIFT_MIN;
const fixedDay=(P=U.proj)=>COST.fixedDay+(U.shifts-2)*COST.fixedShift+(P.line4?COST.fixedShift:0);
const VAROH=(55+58)/3600*COST.cnc+58/3600*COST.weld+2*COST.tool/PROC.toolLife;
const manualSec=li=>ST.reduce((a,_,j)=>{const p=effSt(li,j);return a+(p.type==='man'?p.ct:p.load);},0);
const taktSec=()=>dayLen()*60/(U.demand/nLines());

/* ---------- analytical capacity model (the planning view) ---------- */
function capLine(li,P=U.proj){const sts=ST.map((_,j)=>effSt(li,j,P));
  let bn=sts[0];sts.forEach(s=>{if(s.ct>bn.ct)bn=s;});
  let A=1;sts.forEach(s=>{if(s.type==='mc')A*=s.mtbf/(s.mtbf+s.mttr+PROC.respMin);});
  const avail=U.shifts*SHIFT_MIN, gross=avail*60/bn.ct;
  const coLoss=gross/PROC.batch*coMin(bn.type==='mc'?bn:sts[2],P);
  const toolLoss=bn.defect==='dim'?gross/PROC.toolLife*PROC.toolMin:0;
  let sP=0;sts.forEach(s=>{if(s.scrap)sP+=s.scrap*DEFECT[s.defect].scrapP;});
  const run=Math.max(0,avail-coLoss-toolLoss);
  const cap=run*60/bn.ct*A*0.95*(1-sP);
  return{bn,A,cap,scrap:sP,run,avail};}
function plantValue(P){const n=nLines(P);let cap=0,scr=0;const c=[];
  for(let i=0;i<n;i++){const x=capLine(i,P);c.push(x);cap+=x.cap;scr+=x.cap*x.scrap/(1-x.scrap);}
  const sold=Math.min(cap,U.demand),f=cap>0?sold/cap:0;
  let v=sold*(COST.price-COST.mat-VAROH)-scr*f*COST.mat;
  if(P.line4)v-=U.crew*U.shifts*8*COST.dl+COST.fixedShift;
  return v*COST.days;}
function benefit(k){return plantValue({...U.proj,[k]:true})-plantValue({...U.proj,[k]:false});}

/* ---------- build ---------- */
function mkLine(i){const L={i,id:'L'+(i+1),y:LY[i],bin:PROC.binStart,pending:false,variant:rnd()<.5?'A':'B',batchLeft:Math.floor(PROC.batch*(0.2+0.8*rnd())),
    good:0,scrap:0,started:0,elapsed:0,loss:{brk:0,co:0,tool:0,mat:0,op:0,flow:0},stations:[],bn:0};
  ST.forEach((b,j)=>L.stations.push({L,j,id:`${L.id} ${b.short}`,x:SX[j],y:L.y,p:effSt(i,j),unit:null,ph:'idle',rem:0,inq:[],state:'idle',
    down:false,downAt:0,setup:0,why:'',variant:L.variant,sinceTool:Math.floor(rnd()*PROC.toolLife),op:null,t:{},done:0,defects:0,downMin:0,fails:0,waitSince:null}));
  setBn(L);S.lines.push(L);for(let k=0;k<U.crew;k++)addOp(L);setZones(L);return L;}
function setZones(L){const ops=S.agents.filter(a=>a.role==='op'&&a.L===L),k=ops.length;if(!k)return;
  const c=L.stations.map(s=>s.p.type==='man'?s.p.ct:s.p.load),n=c.length,m=Math.min(k,n);
  /* contiguous partition of stations into m zones minimizing the heaviest zone */
  const pre=[0];c.forEach(v=>pre.push(pre[pre.length-1]+v));const best=Array.from({length:m+1},()=>Array(n+1).fill(1e9)),cut=Array.from({length:m+1},()=>Array(n+1).fill(0));best[0][0]=0;
  for(let g=1;g<=m;g++)for(let j=1;j<=n;j++)for(let i=g-1;i<j;i++){const v=Math.max(best[g-1][i],pre[j]-pre[i]);if(v<best[g][j]){best[g][j]=v;cut[g][j]=i;}}
  const zones=[];let j=n;for(let g=m;g>0;g--){const i=cut[g][j];zones.unshift([i,j-1]);j=i;}
  ops.forEach((o,q)=>{o.zone=zones[q%zones.length];});L.zones=zones;}
function setBn(L){let b=0;L.stations.forEach((s,j)=>{if(s.p.ct>L.stations[b].p.ct)b=j;});L.bn=b;}
let nameIx=0;
function addOp(L){const w={id:S.agents.length,role:'op',L,name:NAMES[nameIx++%NAMES.length],x:SX[0]+rnd()*60,y:L.y+AI,path:[],task:null,at:null,t:{}};S.agents.push(w);return w;}
function init(){nameIx=0;
  S={now:0,lines:[],agents:[],maintQ:[],log:[],seq:1,rw:{q:[],cur:null,rem:0},pallet:0,pallets:0,hist:[{t:0,g:0}],
    c:{started:0,good:0,scrap:0,rework:0,insp1:0,pass1:0,co:0,tool:0,cncRun:0,weldRun:0,dlMin:0,opMin:0,indMin:0,defects:{dim:0,por:0},scrapBy:{}}};
  for(let i=0;i<nLines();i++)mkLine(i);
  ['Rick','Joy'].forEach((n,k)=>S.agents.push({id:S.agents.length,role:'tech',name:n,x:27+k*3,y:BOTTOM,home:{x:27+k*3,y:BOTTOM},path:[],job:null,rem:null,t:{}}));
  S.agents.push({id:S.agents.length,role:'fork',name:'Hector',x:VA[0],y:BOTTOM,home:{x:VA[0],y:BOTTOM},path:[],job:null,stage:null,wait:0,t:{}});
  S.agents.push({id:S.agents.length,role:'rw',name:'Marisol',x:BENCH.x,y:BENCH.y,path:[],t:{}});
  U.sel=null;logEl.innerHTML='';
  log('capex',`Run started: demand ${n0(U.demand)}/day, ${U.shifts} shifts, crew ${U.crew} per line, ${nLines()} lines`);
  renderAll();}

/* ---------- event log ---------- */
const logEl=$('#log');
const refOf=o=>o?(o.role?'a'+o.id:o.id):null;
function clockTxt(m){const dl=dayLen(),d=Math.floor(m/dl),w=m-d*dl,sh=Math.min(U.shifts-1,Math.floor(w/SHIFT_MIN)),ins=w-sh*SHIFT_MIN,t=360+sh*480+ins*480/SHIFT_MIN;
  return{day:d+1,sh:sh+1,hm:pad(Math.floor(t/60)%24)+':'+pad(Math.floor(t%60))};}
function passes(e){if(U.only&&(!U.sel||e.ref!==refOf(U.sel)))return false;return U.filter==='all'||e.cat===U.filter;}
function rowEl(e){const d=document.createElement('div');d.className='row'+(e.lvl?' '+e.lvl:'');const c=clockTxt(e.t);
  d.innerHTML=`<span class="t">D${c.day} ${c.hm}</span><span class="c">${CATS[e.cat]}</span><span class="m">${esc(e.msg)}</span>`;return d;}
function log(cat,msg,o,lvl){const e={t:S.now,cat,msg,ref:refOf(o),lvl:lvl||''};S.log.unshift(e);if(S.log.length>500)S.log.pop();
  if(passes(e)){logEl.prepend(rowEl(e));while(logEl.childElementCount>160)logEl.lastChild.remove();}}
function renderLog(){logEl.innerHTML='';const f=document.createDocumentFragment();let n=0;for(const e of S.log){if(passes(e)){f.appendChild(rowEl(e));if(++n>=160)break;}}logEl.appendChild(f);}

/* ---------- movement ---------- */
function route(a,b){if(Math.abs(a.y-b.y)<0.05)return[{x:b.x,y:b.y}];
  const v=Math.abs(a.x-VA[0])+Math.abs(b.x-VA[0])<=Math.abs(a.x-VA[1])+Math.abs(b.x-VA[1])?VA[0]:VA[1];
  return[{x:v,y:a.y},{x:v,y:b.y},{x:b.x,y:b.y}];}
function moveAlong(o,dt,sp){let d=sp*dt;while(d>0&&o.path.length){const t=o.path[0],dx=t.x-o.x,dy=t.y-o.y,di=Math.hypot(dx,dy);
  if(di<=d){o.x=t.x;o.y=t.y;d-=di;o.path.shift();}else{o.x+=dx/di*d;o.y+=dy/di*d;d=0;}}}
const decay=(o,k,dt)=>{const f=1-dt/240;for(const q in o.t)o.t[q]*=f;o.t[k]=(o.t[k]||0)+dt;};

/* ---------- stations ---------- */
function newUnit(L){L.started++;S.c.started++;
  if(--L.batchLeft<=0){L.variant=L.variant==='A'?'B':'A';L.batchLeft=PROC.batch;log('prod',`${L.id} schedule switches to variant ${L.variant} (batch of ${PROC.batch})`,L.stations[0]);}
  return{sn:`VB-${pad(S.seq++,6)}`,variant:L.variant,defect:null,src:null,L,insp:false,born:S.now};}
function oldUpstream(L,s){for(let j=0;j<s.j;j++){const t=L.stations[j];if(t.unit&&t.unit.variant===s.variant)return true;if(t.inq.some(u=>u.variant===s.variant))return true;}return false;}
function releaseOp(s){const o=s.op;if(o){o.task=null;o.at=null;}s.op=null;}
function stStep(s,dt){const L=s.L,p=s.p;let st='idle';
  if(s.down){st='down';s.downMin+=dt;}
  else if(s.setup>0){st='setup';s.setup-=dt;if(s.setup<=0){s.setup=0;log('prod',`${s.id}: ${s.why==='co'?'changeover':'tool change'} complete`,s);}}
  else{
    if(!s.unit){let u=null;
      if(s.j===0){if(L.bin>0){L.bin--;u=newUnit(L);}}
      else if(s.inq.length)u=s.inq.shift();
      if(u){s.unit=u;s.ph='op';
        if(p.type==='mc'){
          if(u.variant!==s.variant){s.variant=u.variant;s.setup=coMin(p);s.why='co';S.c.co++;log('prod',`${s.id}: changeover to variant ${u.variant}, ${Math.round(s.setup)} min`,s);}
          else if(p.defect==='dim'&&s.sinceTool>=PROC.toolLife){s.sinceTool=0;s.setup=PROC.toolMin;s.why='tool';S.c.tool++;log('prod',`${s.id}: scheduled tool change`,s);}
        }}}
    /* pre-stage: a machine that has run out of the old variant changes over while the new batch is still upstream */
    if(!s.unit&&s.setup<=0&&p.type==='mc'&&L.variant!==s.variant&&!s.inq.length&&!oldUpstream(L,s)){s.variant=L.variant;s.setup=coMin(p);s.why='co';S.c.co++;log('prod',`${s.id}: pre-staged changeover to variant ${s.variant}, ${Math.round(s.setup)} min`,s);}
    if(s.setup>0)st='setup';
    else if(!s.unit)st='starved';
    else{
      if(s.ph==='op'){if(s.op&&s.op.at===s){s.ph='load';s.rem=s.keep!=null?s.keep:p.type==='mc'?p.load/60:p.ct/60*(0.94+rnd()*0.14);s.keep=null;s.waitSince=null;}
        else{st='waitop';if(s.waitSince==null)s.waitSince=S.now;else if(S.now-s.waitSince>6&&!s.waitLogged){s.waitLogged=true;log('labor',`${s.id} has waited ${Math.round(S.now-s.waitSince)} min for an operator`,s);}}}
      if(s.ph==='load'){st='work';s.rem-=dt;if(s.rem<=0){if(p.type==='mc'){s.ph='run';s.rem=(p.ct-p.load)/60*(0.97+rnd()*0.08);}else{s.ph='done';s.done++;}releaseOp(s);s.waitLogged=false;}}
      else if(s.ph==='run'){st='work';
        if(U.brk&&rnd()<dt/p.mtbf){s.down=true;s.downAt=S.now;s.fails++;S.maintQ.push(s);st='down';log('mnt',`ANDON ${s.id}: ${pick(FAIL[p.k])}. Maintenance called.`,s,'crit');}
        else{s.rem-=dt;if(p.k==='WELD')S.c.weldRun+=dt;else S.c.cncRun+=dt;
          if(s.rem<=0){s.ph='done';s.done++;if(p.defect==='dim')s.sinceTool++;if(!s.unit.defect&&rnd()<p.scrap){s.unit.defect=p.defect;s.unit.src=s.id;s.defects++;}}}}
      if(s.ph==='done'){if(!push(s))st='blocked';}
    }}
  s.state=st;decay(s,st,dt);return st;}
function push(s){const u=s.unit,L=s.L;
  if(s.p.k==='INSP'&&!u.insp){u.insp=true;S.c.insp1++;
    if(u.defect){const D=DEFECT[u.defect];
      if(rnd()<D.scrapP){S.c.scrap++;L.scrap++;S.c.defects[u.defect]++;S.c.scrapBy[u.src]=(S.c.scrapBy[u.src]||0)+1;
        log('qual',`${u.sn} scrapped at ${s.id}: ${D.name.toLowerCase()} from ${u.src}`,s,'crit');}
      else{S.rw.q.push(u);log('qual',`${u.sn} failed ${s.id} (${D.name.toLowerCase()}), sent to rework`,s);}
      s.unit=null;s.ph='idle';return true;}
    S.c.pass1++;}
  if(s.j===L.stations.length-1){finishGood(u,L);s.unit=null;s.ph='idle';return true;}
  const nx=L.stations[s.j+1];if(nx.inq.length<PROC.bufCap){nx.inq.push(u);s.unit=null;s.ph='idle';return true;}
  return false;}
function finishGood(u,L){S.c.good++;L.good++;if(++S.pallet>=48){S.pallet=0;S.pallets++;log('prod',`Pallet PL-${pad(S.pallets,4)} (48 valve bodies) staged to finished goods`,null,'good');}}

/* ---------- people ---------- */
const ready=s=>s.unit&&s.ph==='op'&&!s.op&&s.setup<=0&&!s.down;
function assign(o,s){s.op=o;o.task=s;o.at=null;o.path=[{x:s.x,y:o.L.y+AI}];}
function opStep(o,dt){const L=o.L,z=o.zone||[0,L.stations.length-1],inZ=s=>s.j>=z[0]&&s.j<=z[1],near=s=>s.j>=z[0]-1&&s.j<=z[1]+1;
  /* a machine waiting to be loaded in my zone pre-empts manual work: keep machines, and above all the constraint, fed */
  if(o.task&&o.at===o.task&&o.task.p.type==='man'&&o.task.ph==='load'){const m=L.stations.find(s=>inZ(s)&&s.p.type==='mc'&&ready(s));
    if(m){const t=o.task;t.keep=t.rem;t.ph='op';t.op=null;assign(o,m);}}
  if(!o.task){let best=null,bv=-1e9;
    for(const s of L.stations){if(!ready(s))continue;const own=inZ(s);if(!own&&!near(s))continue;
      const v=(own?1000:0)+(s.p.type==='mc'?300:0)+(s.j===L.bn?200:0)-Math.abs(s.x-o.x);if(v>bv){bv=v;best=s;}}
    if(best)assign(o,best);}
  if(o.task&&o.at!==o.task){if(o.path.length){moveAlong(o,dt,PROC.walk);decay(o,'walk',dt);return;}o.at=o.task;}
  decay(o,o.task&&o.at?'work':'idle',dt);}
function techStep(w,dt){
  if(!w.job&&!w.path.length){const s=S.maintQ.shift();if(s){w.job=s;w.path=route(w,{x:s.x,y:s.L.y+AI});log('mnt',`${w.name} dispatched to ${s.id}`,s);}}
  if(w.path.length){moveAlong(w,dt,PROC.walk);decay(w,'walk',dt);return;}
  if(w.job){const s=w.job;if(w.rem==null)w.rem=s.p.mttr*(0.5+rnd());w.rem-=dt;decay(w,'work',dt);
    if(w.rem<=0){s.down=false;const m=S.now-s.downAt;log('mnt',`${s.id} back up after ${Math.round(m)} min (${w.name})`,s,'good');w.job=null;w.rem=null;w.path=route(w,w.home);}
    return;}
  decay(w,'idle',dt);}
function forkStep(f,dt){
  if(f.wait>0){f.wait-=dt;decay(f,'work',dt);return;}
  if(f.path.length){moveAlong(f,dt,PROC.fork);decay(f,'walk',dt);return;}
  if(f.job&&!S.lines.includes(f.job)){f.job=null;f.stage=null;}
  if(f.stage==='rack'){f.wait=1;f.stage='line';f.path=route(f,{x:VA[0],y:f.job.y});return;}
  if(f.stage==='line'){f.wait=0.6;f.stage='drop';return;}
  if(f.stage==='drop'){const L=f.job;L.bin+=PROC.binRefill;L.pending=false;log('mat',`Castings delivered to ${L.id}: +${PROC.binRefill}, bin at ${L.bin}`,L.stations[0]);f.job=null;f.stage=null;f.path=route(f,f.home);return;}
  const L=S.lines.filter(L=>L.bin<=PROC.binROP&&!L.pending).sort((a,b)=>a.bin-b.bin)[0];
  if(L){L.pending=true;f.job=L;f.stage='rack';f.path=route(f,{x:VA[0],y:5+rnd()*38});log('mat',`${L.id} castings bin at ${L.bin}: forklift pulling a tote from the raw store`,L.stations[0]);return;}
  decay(f,'idle',dt);}
function rwStep(dt){const r=S.rw,a=S.agents.find(a=>a.role==='rw');
  if(!r.cur&&r.q.length){r.cur=r.q.shift();r.rem=PROC.reworkMin*(0.8+rnd()*0.4);}
  if(r.cur){r.rem-=dt;decay(a,'work',dt);if(r.rem<=0){S.c.rework++;finishGood(r.cur,r.cur.L);log('qual',`${r.cur.sn} reworked, retested and packed`,null,'good');r.cur=null;}}
  else decay(a,'idle',dt);}

/* ---------- tick ---------- */
function tick(dt){S.now+=dt;
  for(const L of S.lines){L.elapsed+=dt;const bn=L.stations[L.bn];
    for(let j=L.stations.length-1;j>=0;j--){const s=L.stations[j],st=stStep(s,dt);
      if(s===bn){if(st==='down')L.loss.brk+=dt;else if(st==='setup')L.loss[s.why==='co'?'co':'tool']+=dt;
        else if(st==='waitop')L.loss.op+=dt;else if(st==='starved'){if(L.bin<=0||L.stations.slice(0,L.bn).some(x=>x.j===0&&x.state==='starved'))L.loss.mat+=dt;else L.loss.flow+=dt;}
        else if(st==='blocked')L.loss.flow+=dt;}}}
  for(const a of S.agents){if(a.role==='op')opStep(a,dt);else if(a.role==='tech')techStep(a,dt);else if(a.role==='fork')forkStep(a,dt);}
  rwStep(dt);
  const ops=S.agents.filter(a=>a.role==='op').length;S.c.opMin+=ops*dt;S.c.dlMin+=(ops+1)*dt;S.c.indMin+=3*dt;
  const last=S.hist[S.hist.length-1];if(S.now-last.t>=5){S.hist.push({t:S.now,g:S.c.good});while(S.hist.length>2&&S.now-S.hist[1].t>120)S.hist.shift();}}

/* ---------- metrics ---------- */
function lineOEE(L){const ideal=L.stations[L.bn].p.ct,el=L.elapsed;if(el<1)return null;
  const oee=L.good*ideal/60/el,q=L.good+L.scrap?L.good/(L.good+L.scrap):1,a=(el-L.loss.brk-L.loss.co-L.loss.tool-L.loss.mat)/el;
  return{oee,a,q,p:a*q>0?clamp(oee/(a*q),0,1):0,ideal};}
function plantOEE(){let n=0,d=0;for(const L of S.lines){n+=L.good*L.stations[L.bn].p.ct/60;d+=L.elapsed;}return d>0?n/d:NaN;}
function costs(){const g=S.c.good,D=U.demand,n=nLines();
  const act={mat:S.c.started*COST.mat,dl:S.c.dlMin/60*COST.dl,var:S.c.cncRun/60*COST.cnc+S.c.weldRun/60*COST.weld+S.c.tool*COST.tool,fix:fixedDay()*S.now/dayLen()};
  const std={mat:COST.mat/(1-COST.stdScrap),dl:(COST.stdCrew*n+1)*dayLen()/60*COST.dl/D,var:VAROH,fix:fixedDay()/D};
  const per={};for(const k in act)per[k]=g>0?act[k]/g:NaN;
  per.tot=per.mat+per.dl+per.var+per.fix;std.tot=std.mat+std.dl+std.var+std.fix;return{per,std,act};}
function constraint(){const n=nLines(),share=U.demand/n;let worst=null,wr=1e9;
  for(let i=0;i<n;i++){const c=capLine(i);const r=c.cap/share;if(r<wr){wr=r;worst={i,c};}}return worst;}
function wip(){let n=S.rw.q.length+(S.rw.cur?1:0);for(const L of S.lines)for(const s of L.stations)n+=(s.unit?1:0)+s.inq.length;return n;}

/* ---------- canvas ---------- */
const cv=$('#floor'),ctx=cv.getContext('2d');let scale=8,dpr=1;const C={};
const TOK=['bg','panel','panel-2','ink','ink-2','ink-3','line','floor','floor-grid','rack','lane-fork','lane-walk','conv','accent','good','bad','work','starved','blocked','down','setup','waitop','idle','varA','varB','hl'];
function readColors(){const cs=getComputedStyle(document.documentElement);TOK.forEach(k=>C[k]=cs.getPropertyValue('--'+k).trim());}
function rgba(hex,a){if(!hex||hex[0]!=='#')return hex;const n=parseInt(hex.slice(1),16);return`rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;}
function resize(){const wrap=cv.parentElement;const w=Math.max(wrap.clientWidth,760);const h=w*H/W;dpr=window.devicePixelRatio||1;cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);cv.style.height=h+'px';scale=w/W;}
const FD="'Barlow Condensed','Arial Narrow',sans-serif",FB="'IBM Plex Sans',system-ui,sans-serif",FM="'IBM Plex Mono',ui-monospace,monospace";
function txt(s,x,y,o={}){const fs=Math.max(o.size||1.2,(o.min||9.5)/scale);ctx.font=`${o.w||600} ${fs}px ${o.f||FD}`;ctx.fillStyle=o.c||C['ink-2'];ctx.textAlign=o.a||'left';ctx.textBaseline=o.b||'alphabetic';ctx.fillText(s,x,y);}
function rr(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function area(x,y,w,h,label,o={}){ctx.fillStyle=o.fill||rgba(C.panel,0.45);ctx.fillRect(x,y,w,h);ctx.setLineDash(o.dash||[0.5,0.4]);ctx.strokeStyle=o.stroke||C['ink-3'];ctx.lineWidth=1/scale;ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);
  if(label)txt(label.toUpperCase(),x+0.8,y+1.9,{size:1.3,min:9,c:C['ink-3']});}
const SC=st=>C[st]||C.idle;
function drawUnit(u,x,y,sz=0.9){ctx.fillStyle=u.variant==='A'?C.varA:C.varB;ctx.fillRect(x-sz/2,y-sz/2,sz,sz);}
function draw(){const px=1/scale;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,cv.width,cv.height);ctx.setTransform(dpr*scale,0,0,dpr*scale,0,0);
  ctx.fillStyle=C.floor;ctx.fillRect(0,0,W,H);
  ctx.strokeStyle=C['floor-grid'];ctx.lineWidth=px;ctx.beginPath();for(let x=0;x<=W;x+=5){ctx.moveTo(x,0);ctx.lineTo(x,H);}for(let y=0;y<=H;y+=5){ctx.moveTo(0,y);ctx.lineTo(W,y);}ctx.stroke();
  ctx.strokeStyle=C.ink;ctx.lineWidth=2.5*px;ctx.strokeRect(1,1,W-2,H-2);
  /* receiving + raw store */
  area(2,3,4.5,44,'',{fill:rgba(C.panel,0.3)});txt('RECEIVING',4.25,25,{size:1.2,min:8.5,a:'center',c:C['ink-3']});
  for(let k=0;k<4;k++){ctx.fillStyle=C['ink-3'];ctx.fillRect(1,6+k*10,1.2,5);}
  area(7.5,3,11.5,44,'Raw store');
  for(let r=0;r<6;r++){ctx.fillStyle=rgba(C.rack,0.55);ctx.fillRect(9,6+r*6.8,8.5,2.6);ctx.strokeStyle=C.rack;ctx.lineWidth=px;ctx.strokeRect(9,6+r*6.8,8.5,2.6);
    for(let c=0;c<5;c++){ctx.fillStyle=rgba(C['ink-3'],0.45);ctx.fillRect(9.4+c*1.65,6.4+r*6.8,1.2,1.8);}}
  /* aisles */
  ctx.strokeStyle=rgba(C['lane-fork'],0.7);ctx.lineWidth=2*px;ctx.setLineDash([1,0.6]);ctx.beginPath();
  VA.forEach(x=>{ctx.moveTo(x,3);ctx.lineTo(x,BOTTOM);});ctx.moveTo(VA[0],BOTTOM);ctx.lineTo(VA[1],BOTTOM);ctx.stroke();
  ctx.strokeStyle=rgba(C['lane-walk'],0.55);ctx.beginPath();LY.forEach((y,i)=>{if(i<nLines()||i<3){ctx.moveTo(VA[0],y+AI);ctx.lineTo(VA[1],y+AI);}});ctx.stroke();ctx.setLineDash([]);
  /* expansion bay */
  if(!U.proj.line4){area(23,LY[3]-3.4,70,7,'Expansion bay · reserved for Line 4',{fill:rgba(C.panel,0.25),dash:[0.8,0.6]});}
  /* lines */
  for(const L of S.lines){const y=L.y;
    txt(L.id,22.2,y-3.6,{size:1.9,min:12,w:700,c:C.ink});
    /* castings bin */
    const bf=clamp(L.bin/(PROC.binStart+PROC.binRefill),0,1);ctx.fillStyle=rgba(C.rack,0.25);ctx.fillRect(22.6,y-1.6,2.6,3.2);ctx.fillStyle=L.bin<=PROC.binROP?C.starved:C.rack;ctx.fillRect(22.6,y+1.6-3.2*bf,2.6,3.2*bf);
    ctx.strokeStyle=C['ink-3'];ctx.lineWidth=px;ctx.strokeRect(22.6,y-1.6,2.6,3.2);
    /* conveyor */
    ctx.strokeStyle=C.conv;ctx.lineWidth=0.9;ctx.beginPath();ctx.moveTo(25.2,y);ctx.lineTo(SX[6]+3,y);ctx.moveTo(SX[6]+3,y);ctx.lineTo(93,y);ctx.stroke();
    for(const s of L.stations){const bn=s.j===L.bn;
      s.inq.forEach((u,k)=>drawUnit(u,s.x-3.9-k*1.15,y));
      ctx.fillStyle=C.panel;rr(s.x-3,y-2.5,6,5,0.5);ctx.fill();
      ctx.fillStyle=rgba(SC(s.state),0.22);rr(s.x-3,y-2.5,6,5,0.5);ctx.fill();
      ctx.strokeStyle=SC(s.state);ctx.lineWidth=(bn?2.4:1.4)*px;rr(s.x-3,y-2.5,6,5,0.5);ctx.stroke();
      if(bn){ctx.strokeStyle=C.bad;ctx.lineWidth=1.2*px;ctx.setLineDash([0.4,0.3]);rr(s.x-3.5,y-3,7,6,0.7);ctx.stroke();ctx.setLineDash([]);}
      ctx.fillStyle=SC(s.state);ctx.fillRect(s.x-3,y-2.5,0.7,5);
      if(s.unit)drawUnit(s.unit,s.x+0.6,y-0.2,1.3);
      /* progress */
      let prog=0;if(s.ph==='load')prog=s.p.type==='mc'?0.1:1-s.rem/(s.p.ct/60);else if(s.ph==='run')prog=1-s.rem/((s.p.ct-s.p.load)/60);else if(s.ph==='done')prog=1;
      if(s.setup>0)prog=0;ctx.fillStyle=rgba(C['ink-3'],0.25);ctx.fillRect(s.x-2,y+1.5,4.6,0.45);ctx.fillStyle=C.ink;ctx.fillRect(s.x-2,y+1.5,4.6*clamp(prog,0,1),0.45);
      if(U.sel===s){ctx.strokeStyle=C.accent;ctx.lineWidth=2.5*px;rr(s.x-3.8,y-3.3,7.6,6.6,0.8);ctx.stroke();}
      txt(s.p.short||ST[s.j].short,s.x,y-3.1,{size:1.05,min:8,a:'center',c:C['ink-2'],f:FM,w:500});
      if(s.down){txt('DOWN',s.x+0.3,y+0.5,{size:1.1,min:8,a:'center',c:C.down,f:FM,w:700});}
      else if(s.setup>0){txt(s.why==='co'?'C/O':'TOOL',s.x+0.3,y+0.5,{size:1.1,min:8,a:'center',c:C.setup,f:FM,w:700});}}}
  /* finished goods */
  area(99,3,17,44,'Finished goods');
  const full=Math.min(S.pallets,24);for(let k=0;k<24;k++){const cx=101+(k%4)*3.6,cy=7+Math.floor(k/4)*6.2;ctx.fillStyle=k<full?rgba(C.good,0.55):rgba(C['ink-3'],0.12);ctx.fillRect(cx,cy,2.8,3.6);}
  txt(`${S.pallets} pallets · ${S.pallet}/48 on current`,107.5,45.2,{size:1.05,min:8,a:'center',c:C['ink-2'],f:FM,w:500});
  /* rooms */
  for(const r of ROOMS)area(r[0],r[1],r[2]-r[0],r[3]-r[1],r[4],{fill:rgba(C.panel,0.5)});
  ctx.fillStyle=rgba(C.rack,0.5);ctx.fillRect(BENCH.x-3,BENCH.y-1.2,6,1);S.rw.q.slice(0,8).forEach((u,k)=>drawUnit(u,58+k*1.2,59.5,0.8));
  txt(`queue ${S.rw.q.length}`,70.5,60.8,{size:1,min:8,a:'right',c:C['ink-2'],f:FM,w:500});
  for(let k=0;k<4;k++){ctx.fillStyle=C['ink-3'];ctx.fillRect(101+k*4,62,2.6,1);}
  /* people */
  for(const a of S.agents)drawAgent(a);
  /* tour highlight */
  const t=TOUR[U.tour];if(t&&t.area){const[a,b,c,d]=t.area;ctx.fillStyle=C.hl;ctx.beginPath();ctx.rect(0,0,W,H);ctx.rect(a,b,c,d);ctx.fill('evenodd');ctx.strokeStyle=C.accent;ctx.lineWidth=3*px;ctx.strokeRect(a,b,c,d);}}
function drawAgent(a){const px=1/scale;let col,l;
  if(a.role==='op'){col=C.accent;l='O';}else if(a.role==='tech'){col=C.down;l='M';}else if(a.role==='fork'){col=C['lane-fork'];l='F';}else{col=C.setup;l='R';}
  ctx.beginPath();if(a.role==='fork'){ctx.rect(a.x-0.9,a.y-0.9,1.8,1.8);}else ctx.arc(a.x,a.y,0.85,0,7);ctx.fillStyle=col;ctx.fill();
  ctx.strokeStyle=U.sel===a?C.ink:C.floor;ctx.lineWidth=(U.sel===a?3:1.5)*px;ctx.stroke();
  txt(l,a.x,a.y+0.05,{size:1,min:7,a:'center',b:'middle',c:'#fff',f:FB,w:700});}
function legend(){const items=[['work','Working'],['waitop','Waiting for operator'],['starved','Starved'],['blocked','Blocked'],['setup','Changeover / tool'],['down','Down']];
  $('#legend').innerHTML=items.map(([k,l])=>`<span><i style="background:var(--${k})"></i>${l}</span>`).join('')+
  `<span><i style="background:var(--varA)"></i>Variant A</span><span><i style="background:var(--varB)"></i>Variant B</span>`+
  `<span><i class="o" style="background:var(--accent)"></i>Operator</span><span><i class="o" style="background:var(--down)"></i>Maintenance</span><span><i style="background:var(--lane-fork)"></i>Forklift</span><span><i class="o" style="background:var(--setup)"></i>Rework tech</span>`+
  `<span><i style="border:2px dashed var(--bad);background:transparent"></i>Line constraint</span>`;}

/* ---------- hit testing ---------- */
function hit(mx,my){for(const a of S.agents)if(Math.hypot(a.x-mx,a.y-my)<1.3)return a;
  for(const L of S.lines)for(const s of L.stations)if(Math.abs(mx-s.x)<3.2&&Math.abs(my-s.y)<2.8)return s;return null;}
function evPos(e){const r=cv.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*W,y:(e.clientY-r.top)/r.height*H};}
function describe(o){if(!o)return'Hover a station or person for detail. Click to inspect.';
  if(o.role){if(o.role==='op')return`${o.name}, ${o.L.id} operator · ${o.task?(o.at?'working at ':'walking to ')+o.task.id:'idle, waiting for work'}`;
    if(o.role==='tech')return`${o.name}, maintenance tech · ${o.job?'repairing '+o.job.id:'available at the crib'}`;
    if(o.role==='fork')return`${o.name}, forklift · ${o.job?'castings for '+o.job.id:'idle'}`;return`${o.name}, rework tech · queue ${S.rw.q.length}`;}
  return`${o.id} · ${o.p.name} · ${SLABEL[o.state]} · ${o.p.ct} s cycle${o.p.type==='mc'?` · MTBF ${(o.p.mtbf/60).toFixed(0)} h`:''}${o.j===o.L.bn?' · line constraint':''}`;}
cv.addEventListener('mousemove',e=>{const p=evPos(e);$('#hover').textContent=describe(hit(p.x,p.y));});
cv.addEventListener('mouseleave',()=>{$('#hover').textContent=describe(null);});
cv.addEventListener('click',e=>{const p=evPos(e);U.sel=hit(p.x,p.y);if(U.sel&&!U.sel.role){U.balLine=U.sel.L.i;}renderInsp();renderBalance();if(U.only)renderLog();});

/* ---------- panels ---------- */
function stackHTML(t){const tot=STATES.reduce((a,k)=>a+(t[k]||0),0)||1;return STATES.map(k=>`<i style="height:${((t[k]||0)/tot*100).toFixed(1)}%;background:var(--${k})" title="${SLABEL[k]}"></i>`).join('');}
function renderBalance(){const segs=S.lines.map(L=>`<button type="button" data-v="${L.i}" aria-pressed="${U.balLine===L.i}">${L.id}</button>`).join('');
  const segEl=$('#balLine');if(segEl.dataset.n!==String(S.lines.length)+U.balLine){segEl.innerHTML=segs;segEl.dataset.n=String(S.lines.length)+U.balLine;}
  const L=S.lines[U.balLine]||S.lines[0];if(!L)return;const takt=taktSec();
  const mx=Math.max(takt,...L.stations.map(s=>s.p.ct))*1.18;
  const bars=L.stations.map((s,j)=>`<div class="col"><div class="bar${j===L.bn?' bn':''}" style="height:${(s.p.ct/mx*100).toFixed(1)}%"><b>${s.p.ct}</b></div></div>`).join('');
  const sum=L.stations.reduce((a,s)=>a+s.p.ct,0),bnct=L.stations[L.bn].p.ct,eff=sum/(L.stations.length*bnct);
  const over=bnct-takt;
  $('#balance').innerHTML=`<div class="bal" role="img" aria-label="Station cycle times for ${L.id} against takt ${takt.toFixed(0)} seconds">${bars}<div class="takt" style="bottom:${(takt/mx*100).toFixed(1)}%"><span>Takt ${takt.toFixed(0)} s</span></div></div>
  <div class="balx">${L.stations.map(s=>`<span>${ST[s.j].short}</span>`).join('')}</div>
  <div class="states">${L.stations.map(s=>`<div class="stk" title="${esc(s.id)}">${stackHTML(s.t)}</div>`).join('')}</div>
  <div class="mini-leg">${STATES.map(k=>`<span><i style="background:var(--${k})"></i>${SLABEL[k]}</span>`).join('')}</div>
  <div class="balnote"><span>Balance efficiency <strong>${pct(eff)}</strong></span><span>Constraint <strong>${ST[L.bn].short} ${bnct} s</strong></span><span>${over>0?`<span class="bad">${over.toFixed(0)} s over takt</span>`:`<span class="good">${(-over).toFixed(0)} s under takt</span>`}</span></div>
  <p class="note">Bars are design cycle time in seconds. Stacks below show each station's time over the last ~4 hours.</p>`;}
function renderInsp(){const el=$('#insp'),o=U.sel;
  if(!o){el.innerHTML='<p class="empty">Click a station, operator, maintenance tech or the forklift on the floor.</p>';return;}
  if(o.role){const t=o.t,tot=(t.work||0)+(t.walk||0)+(t.idle||0)||1;
    const role={op:`${o.L&&o.L.id} line operator`,tech:'Maintenance technician',fork:'Forklift driver, raw store',rw:'Rework technician'}[o.role];
    const task=o.role==='op'?(o.task?(o.at?'At ':'Walking to ')+o.task.id:'Idle'):o.role==='tech'?(o.job?'Repairing '+o.job.id:'Available'):o.role==='fork'?(o.job?'Castings for '+o.job.id:'Idle'):(S.rw.cur?'Reworking '+S.rw.cur.sn:'Idle');
    el.innerHTML=`<h4>${esc(o.name)}</h4><div style="color:var(--ink-2);margin-bottom:8px">${esc(role)}</div><dl>
    <dt>Now</dt><dd>${esc(task)}</dd><dt>Working</dt><dd>${pct((t.work||0)/tot,0)}</dd><dt>Walking</dt><dd>${pct((t.walk||0)/tot,0)}</dd><dt>Idle</dt><dd>${pct((t.idle||0)/tot,0)}</dd></dl>
    <p class="note">Shares cover roughly the last 4 hours. Walking is non-value-added time that the labor standard allows for.</p>`;return;}
  const s=o,p=s.p,tot=STATES.reduce((a,k)=>a+(s.t[k]||0),0)||1;
  el.innerHTML=`<h4>${esc(s.id)}</h4><div style="color:var(--ink-2)">${esc(p.name)}</div><span class="st" style="background:var(--${s.state==='idle'?'idle':s.state})">${SLABEL[s.state]}</span>
  <dl><dt>Cycle time</dt><dd>${p.ct} s${p.type==='mc'?` (load ${p.load} s)`:' manual'}</dd>
  ${p.type==='mc'?`<dt>MTBF / MTTR</dt><dd>${(p.mtbf/60).toFixed(1)} h / ${p.mttr} min</dd><dt>Failures</dt><dd>${s.fails} · ${n0(s.downMin)} min down</dd><dt>Defect rate</dt><dd>${pct(p.scrap)} ${p.defect?DEFECT[p.defect].name.split(' ')[0].toLowerCase():''}</dd><dt>Defects made</dt><dd>${s.defects}</dd>`:''}
  <dt>Parts done</dt><dd>${n0(s.done)}</dd><dt>Unit</dt><dd>${s.unit?s.unit.sn+' · '+s.unit.variant:'–'}</dd><dt>Input buffer</dt><dd>${s.j===0?'bin '+s.L.bin:s.inq.length+' / '+PROC.bufCap}</dd>
  <dt>Operator</dt><dd>${s.op?esc(s.op.name):'–'}</dd>
  ${STATES.map(k=>`<dt>${SLABEL[k]}</dt><dd>${pct((s.t[k]||0)/tot,0)}</dd>`).join('')}</dl>`;}
function hb(label,v,max,col,txtv){return`<div class="hb"><span class="l">${label}</span><span class="tr"><i style="width:${max>0?clamp(v/max*100,0,100):0}%;background:${col}"></i></span><span class="v">${txtv}</span></div>`;}
function renderOEE(){let rows='',tot={brk:0,co:0,tool:0,mat:0,op:0,flow:0};
  for(const L of S.lines){const m=lineOEE(L);for(const k in tot)tot[k]+=L.loss[k];
    if(!m){rows+=`<tr><td>${L.id}</td><td colspan="5">–</td></tr>`;continue;}
    rows+=`<tr><td>${L.id} <span style="color:var(--ink-3);font-size:11px">${ST[L.bn].short}</span></td><td class="${m.a<0.85?'bad':''}">${pct(m.a)}</td><td>${pct(m.p)}</td><td class="${m.q<0.97?'bad':''}">${pct(m.q)}</td><td class="${m.oee<0.7?'bad':m.oee>=COST.targetOEE?'good':''}">${pct(m.oee)}</td><td>${n0(L.good)}</td></tr>`;}
  const po=plantOEE();const mx=Math.max(1,...Object.values(tot));
  const lab={brk:'Breakdowns',co:'Changeovers',tool:'Tool changes',mat:'Material shortage',op:'Waiting operator',flow:'Starved / blocked'};
  $('#oee').innerHTML=`<table class="t"><thead><tr><th>Line</th><th>Avail.</th><th>Perf.</th><th>Quality</th><th>OEE</th><th>Good</th></tr></thead><tbody>${rows}
  <tr class="tot"><td>Plant</td><td colspan="3"></td><td>${pct(po)}</td><td>${n0(S.c.good)}</td></tr></tbody></table>
  <div class="h3">Loss minutes at the constraints</div><div class="hbars">
  ${['brk','co','tool','mat'].map(k=>hb(lab[k],tot[k],mx,'var(--bad)',n0(tot[k]))).join('')}
  ${['op','flow'].map(k=>hb(lab[k],tot[k],mx,'var(--blocked)',n0(tot[k]))).join('')}</div>
  <p class="note">Orange losses cut availability; blue ones show up as performance loss. OEE = good units × ideal cycle ÷ planned time, so A × P × Q multiplies back to it exactly.</p>`;}
function renderCost(){const{per,std}=costs();const lab={mat:'Material incl. scrap',dl:'Direct labor',var:'Variable overhead',fix:'Fixed overhead',tot:'Total'};
  const rows=['mat','dl','var','fix','tot'].map(k=>{const v=per[k]-std[k];return`<tr class="${k==='tot'?'tot':''}"><td>${lab[k]}</td><td>${usd(std[k])}</td><td>${usd(per[k])}</td><td class="${v>0.005?'bad':v<-0.005?'good':''}">${isFinite(v)?(v>=0?'+':'−')+usd(Math.abs(v)):'–'}</td></tr>`;}).join('');
  const scrapCost=S.c.scrap*COST.mat,g=S.c.good;
  const vol=g>0?per.fix-std.fix:NaN;
  const sb=Object.entries(S.c.scrapBy).sort((a,b)=>b[1]-a[1]).slice(0,4);const smx=sb.length?sb[0][1]:1;
  $('#cost').innerHTML=`<table class="t"><thead><tr><th>$ / good unit</th><th>Standard</th><th>Actual</th><th>Variance</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="note">Standard assumes ${COST.stdCrew} operators per line, ${pct(COST.stdScrap,0)} scrap and the full ${n0(U.demand)}/day plan. Missing the plan spreads fixed cost over fewer units: that volume variance is ${isFinite(vol)?usd(vol):'–'} per unit right now.</p>
  <div class="h3">Scrap by source · ${n0(S.c.scrap)} units · ${usdK(scrapCost)} material</div><div class="hbars">
  ${sb.length?sb.map(([k,v])=>hb(k,v,smx,'var(--bad)',n0(v))).join(''):'<p class="empty" style="font-size:12.5px">No scrap yet.</p>'}</div>`;}
function renderCap(){const n=nLines(),share=U.demand/n;let cap=0,rows='',hc='';
  for(let i=0;i<n;i++){const c=capLine(i);cap+=c.cap;const load=share/c.cap;
    rows+=`<tr><td>L${i+1}</td><td>${c.bn.short||ST.find(s=>s.k===c.bn.k).short} ${c.bn.ct} s</td><td>${pct(c.A)}</td><td>${n0(c.cap)}</td><td class="${load>1?'bad':load>0.92?'':'good'}">${pct(load,0)}</td></tr>`;
    const req=Math.ceil(manualSec(i)*share/(dayLen()*60*PROC.pfd));const L=S.lines[i];const act=L?S.agents.filter(a=>a.role==='op'&&a.L===L).length:U.crew;
    hc+=`<span>L${i+1} <b class="${act<req?'bad':''}">${act}</b> / ${req}</span>`;}
  const gap=cap-U.demand;
  const proj=PROJ.map(p=>{const on=U.proj[p.k],b=benefit(p.k);const pb=p.opex?(b>0?`net ${usdK(b-p.cost)}/yr`:'–'):(b>0?(p.cost/b).toFixed(1)+' yrs':'no payback');
    return`<div class="pr${on?' on':''}"><div><div class="pn">${esc(p.name)}</div><div class="pd">${esc(p.desc)}</div></div>
    <button class="btn sm" type="button" data-proj="${p.k}" aria-pressed="${on}">${on?'Installed':'Install'}</button>
    <div class="pf"><span>${p.opex?'Opex':'Capex'} <b>${usdK(p.cost)}${p.opex?'/yr':''}</b></span><span>Benefit <b>${usdK(b)}/yr</b></span><span>${p.opex?'':'Payback '}<b class="${b>0&&(p.opex?b>p.cost:p.cost/b<=3)?'good':'bad'}">${pb}</b></span></div></div>`;}).join('');
  $('#cap').innerHTML=`<table class="t"><thead><tr><th>Line</th><th>Constraint</th><th>Avail.</th><th>Cap / day</th><th>Load</th></tr></thead><tbody>${rows}
  <tr class="tot"><td>Plant</td><td colspan="2">demand ${n0(U.demand)}</td><td>${n0(cap)}</td><td class="${gap<0?'bad':'good'}">${gap<0?'gap '+n0(-gap):'+'+n0(gap)}</td></tr></tbody></table>
  <div class="balnote" style="margin-top:8px">Operators actual / required: ${hc}</div>
  <div class="h3">Improvement projects</div><div class="proj">${proj}</div>
  <p class="note">Benefit = extra margin from demand you could not ship before, plus scrap material saved, less any added labor and fixed cost, over ${COST.days} days. Install a project to change the floor live.</p>`;}
function kpi(id,v,sub,cls,subId){$(id).textContent=v;if(subId)$(subId).textContent=sub;if(cls!==undefined){const k=$(id).closest('.kpi');k.classList.remove('bad','good');if(cls)k.classList.add(cls);}}
function updKPI(){const c=clockTxt(S.now);$('#clock').textContent=`Day ${c.day} · ${c.hm}`;$('#clock-s').textContent=`shift ${c.sh} of ${U.shifts} · 1 s on screen = 1 min on the floor at 1×`;
  const plan=U.demand*S.now/dayLen(),g=S.c.good;kpi('#k-good',n0(g),`plan ${n0(plan)}`,undefined,'#k-good-s');
  const att=plan>5?g/plan:NaN;kpi('#k-att',pct(att),'',isFinite(att)?(att<0.97?'bad':'good'):'');
  const h0=S.hist[0],rate=S.now-h0.t>=20?(g-h0.g)/(S.now-h0.t)*dayLen():NaN;kpi('#k-rate',n0(rate),`plan ${n0(U.demand)}/day`,undefined,'#k-rate-s');
  const po=plantOEE();kpi('#k-oee',pct(po),'',isFinite(po)?(po<0.75?'bad':po>=COST.targetOEE?'good':''):'');
  const{per,std}=costs();const cv_=per.tot/std.tot-1;kpi('#k-cost',usd(per.tot),isFinite(cv_)?`std ${usd(std.tot)} ${cv_>=0?'+':''}${pct(cv_,0)}`:`std ${usd(std.tot)}`,isFinite(cv_)?(cv_>0.01?'bad':'good'):'','#k-cost-s');
  const sr=S.c.good+S.c.scrap?S.c.scrap/(S.c.good+S.c.scrap):NaN;kpi('#k-scrap',pct(sr),'',isFinite(sr)?(sr>COST.stdScrap?'bad':'good'):'');
  kpi('#k-fpy',pct(S.c.insp1?S.c.pass1/S.c.insp1:NaN));
  const paid=S.c.opMin/60,earned=g*COST.stdCrew*(COST.stdCT/COST.targetOEE)/3600,le=paid>0?earned/paid:NaN,uplh=(S.c.dlMin+S.c.indMin)>0?g/((S.c.dlMin+S.c.indMin)/60):NaN;
  kpi('#k-lab',pct(le,0),`${isFinite(uplh)?uplh.toFixed(1):'–'} units / labor hr`,isFinite(le)?(le<0.9?'bad':'good'):'','#k-lab-s');
  const w=wip(),thr=S.now-h0.t>=20?(g-h0.g)/(S.now-h0.t):NaN;kpi('#k-wip',n0(w),isFinite(thr)&&thr>0?`${Math.round(w/thr)} min flow time`:'units on the floor',undefined,'#k-wip-s');
  const k=constraint();if(k){const t=taktSec();kpi('#k-con',`L${k.i+1} ${k.c.bn.short||''}`,`${k.c.bn.ct} s vs ${t.toFixed(0)} s takt`,k.c.bn.ct>t?'bad':'','#k-con-s');}}
function renderAll(){updKPI();renderBalance();renderInsp();renderOEE();renderCost();renderCap();}

/* ---------- controls ---------- */
function seg(id,fn){const el=$(id);el.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;el.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b?'true':'false'));fn(b.dataset.v);});}
seg('#speed',v=>{U.speed=+v;});
seg('#demand',v=>{U.demand=+v;log('capex',`Demand plan set to ${n0(U.demand)}/day, takt ${taktSec().toFixed(0)} s per line`);renderAll();});
seg('#shifts',v=>{U.shifts=+v;log('capex',`Running ${U.shifts} shifts: ${n0(dayLen())} planned min/day, takt ${taktSec().toFixed(0)} s`);renderAll();});
seg('#crew',v=>{U.crew=+v;setCrew();log('labor',`Crew set to ${U.crew} operators per line`);renderAll();});
seg('#brk',v=>{U.brk=v==='on';});
$('#balLine').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;U.balLine=+b.dataset.v;renderBalance();});
$('#pause').addEventListener('click',()=>{U.paused=!U.paused;$('#pause').textContent=U.paused?'Resume':'Pause';});
$('#restart').addEventListener('click',()=>{init();});
$('#lfilter').addEventListener('change',e=>{U.filter=e.target.value;renderLog();});
$('#lonly').addEventListener('change',e=>{U.only=e.target.checked;renderLog();});
$('#cap').addEventListener('click',e=>{const b=e.target.closest('button[data-proj]');if(!b)return;toggleProj(b.dataset.proj);});
function setCrew(){for(const L of S.lines){const ops=S.agents.filter(a=>a.role==='op'&&a.L===L);
  for(let k=ops.length;k<U.crew;k++)addOp(L);
  for(let k=ops.length-1;k>=U.crew;k--){const o=ops[k];if(o.task)o.task.op=null;S.agents.splice(S.agents.indexOf(o),1);if(U.sel===o)U.sel=null;}setZones(L);}
  S.agents.forEach((a,i)=>a.id=i);}
function toggleProj(k){U.proj[k]=!U.proj[k];const p=PROJ.find(x=>x.k===k);
  if(k==='line4'){if(U.proj.line4){mkLine(3);}else{const L=S.lines[3];if(L){S.agents=S.agents.filter(a=>a.L!==L);S.maintQ=S.maintQ.filter(s=>s.L!==L);S.agents.forEach(a=>{if(a.job&&a.job.L===L){a.job=null;a.rem=null;a.path=route(a,a.home);}});S.lines.pop();if(U.balLine>2)U.balLine=2;if(U.sel&&(U.sel.L===L))U.sel=null;}S.agents.forEach((a,i)=>a.id=i);}}
  for(const L of S.lines){L.stations.forEach(s=>{s.p=effSt(L.i,s.j);});setBn(L);setZones(L);}
  log('capex',`${U.proj[k]?'Installed':'Removed'}: ${p.name}`);renderAll();}

/* ---------- guided tour ---------- */
const TOUR=[
  {h:'Material flow',p:'Castings come off the raw store, get sawn and loaded, then turned (CNC-1), milled (CNC-2), deburred, welded, leak tested and packed. Small conveyors between stations hold 3 parts, so a slow or stopped station quickly starves or blocks its neighbors.',area:[20,3,76,43]},
  {h:'Find the constraint',p:'Line 3 runs a 2009 CNC-2: 71 s cycle, about 5 h between failures and twice the scrap. It sits above takt, so Line 3 cannot make its share. Look at the line balance panel: everything upstream spends time blocked, everything downstream starved.',area:[43,26,12,8],card:'#card-balance',line:2},
  {h:'OEE and the loss tree',p:'OEE is good units × ideal cycle ÷ planned time, split into availability, performance and quality. The loss bars show where Line 3 loses its minutes: breakdowns and changeovers first.',card:'#card-oee'},
  {h:'From OEE to dollars',p:'Unit cost vs. standard turns the same losses into money. Material variance is scrap; the fixed-overhead variance is volume: the plant carries a full day of fixed cost but ships fewer units.',card:'#card-cost'},
  {h:'Labor planning',p:'Required operators = manual work content × units ÷ (available time × 70% allowance). Drop the crew to 3 per line and watch "Waiting for operator" appear at the constraint and labor efficiency move.',card:'#card-cap'},
  {h:'Justify the fix',p:'Each project shows its annual benefit and payback from the capacity model at the current plan. Try the $75k PM program before the $1.2M machine, and compare paybacks. Install one and the floor changes immediately.',card:'#card-cap'},
  {h:'Scenario and sensitivity',p:'Raise demand to 2,800/day. The gap and every payback move. Adding a third shift or Line 4 closes it at very different costs. That is the capacity-expansion conversation, with numbers.',card:'#card-cap'}];
function renderTour(){const t=TOUR[U.tour];document.querySelectorAll('.card.focus').forEach(c=>c.classList.remove('focus'));
  $('#t-prev').hidden=U.tour<=0;$('#t-close').hidden=U.tour<0;
  if(!t){$('#t-n').textContent=`Tour · ${TOUR.length} steps`;$('#t-h').textContent='From the floor to the P&L';$('#t-p').textContent='Follow one story from an executive cost variance down to a single machine, then test the fixes and see which ones pay back.';$('#t-next').textContent='Start tour';return;}
  $('#t-n').textContent=`Step ${U.tour+1} of ${TOUR.length}`;$('#t-h').textContent=t.h;$('#t-p').textContent=t.p;$('#t-next').textContent=U.tour===TOUR.length-1?'Finish':'Next';
  if(t.line!=null){U.balLine=t.line;U.sel=S.lines[t.line].stations[2];renderBalance();renderInsp();}
  if(t.card){const c=$(t.card);c.classList.add('focus');if(U.tour>1)c.scrollIntoView({behavior:reduce?'auto':'smooth',block:'nearest'});}}
$('#t-next').addEventListener('click',()=>{U.tour=U.tour>=TOUR.length-1?-1:U.tour+1;renderTour();});
$('#t-prev').addEventListener('click',()=>{U.tour=Math.max(0,U.tour-1);renderTour();});
$('#t-close').addEventListener('click',()=>{U.tour=-1;renderTour();});

/* ---------- loop ---------- */
let last=performance.now(),acc=0,panelT=0;
function frame(ms){const real=Math.min(0.1,(ms-last)/1000);last=ms;
  if(!U.paused){acc+=real*U.speed;const h=1/60;let n=0;while(acc>=h&&n<4000){tick(h);acc-=h;n++;}if(n>=4000)acc=0;}
  panelT+=real;if(panelT>0.3){panelT=0;updKPI();renderBalance();renderOEE();renderCost();if(U.sel)renderInsp();}
  draw();requestAnimationFrame(frame);}
const mq=matchMedia('(prefers-color-scheme: dark)');mq.addEventListener&&mq.addEventListener('change',readColors);
window.addEventListener('resize',resize);
readColors();resize();legend();init();renderTour();
if(reduce)U.speed=5;
requestAnimationFrame(frame);
})();
