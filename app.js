/* ============================================================================
 * SmartMelt Digital Twin — frontend (HTML + CSS + Three.js).
 *
 * The browser is a thin client. ALL physics, advisories, charge-mix, the Kalman
 * soft-sensor, the ML endpoint model and the drift monitor are computed by the
 * validated SmartMelt Python engine and delivered over a small JSON API. This
 * file renders the 3D furnace, plays back the engine's frames, draws every tab,
 * and turns the operator's controls into new engine runs.
 *
 *   A. API CLIENT + CHART HELPERS + STATE
 *   B. THREE.JS FURNACE + lil-gui + TAB ROUTER
 *   C. CONSOLE OVERLAY + HEAT LOG + SETTINGS + PANEL DISPATCH
 *   D. DATA PANELS (trajectory, physics, ekf, ml, drift, charge-mix, economics, validation)
 *   E. PLAYBACK RENDER LOOP + EVENTS
 * ==========================================================================*/
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';

/* ===================== A1. API CLIENT ==================================== */
// ★ SPLIT-DEPLOY: backend runs on a different origin (Render). All calls use an
// absolute base URL provided by config.js. Empty string => same-origin (local combined mode).
const API_BASE=(window.SMARTMELT_API_BASE||'').replace(/\/+$/,'');
const API = {
  async config(){return (await fetch(API_BASE+'/api/config')).json();},
  async simulate(body){return (await fetch(API_BASE+'/api/simulate',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();},
  async mixOpt(body){return (await fetch(API_BASE+'/api/chargemix/optimize',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();},
  async mixEval(body){return (await fetch(API_BASE+'/api/chargemix/evaluate',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();},
  async ekf(){return (await fetch(API_BASE+'/api/ekf')).json();},
  async ml(){return (await fetch(API_BASE+'/api/ml')).json();},
  async drift(){return (await fetch(API_BASE+'/api/drift')).json();},
  async econ(body){return (await fetch(API_BASE+'/api/economics',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();},
  async validation(){return (await fetch(API_BASE+'/api/validation')).json();},
};

/* ===================== A2. CHART HELPERS (labelled 2-D canvas) =========== */
const COL={molten:'#ff6a34',hi:'#ffd166',steel:'#4fa8d8',green:'#33d17a',
  amber:'#f0a83c',red:'#e5484d',mut:'#7c8994',grid:'#1c242b',text:'#c8d0d6',scrap:'#9aa3ad'};
function fitCanvas(c){const r=c.getBoundingClientRect();
  c.width=Math.max(r.width*devicePixelRatio,300);c.height=Math.max(r.height*devicePixelRatio,120);}
function fmt(v){if(v==null||isNaN(v))return'—';const a=Math.abs(v);
  if(a>=1000)return(v/1000).toFixed(1)+'k';if(a>=10)return v.toFixed(0);if(a>=1)return v.toFixed(1);return v.toFixed(2);}
/* cfg:{series:[{name,color,axis:'L'|'R',dash,data:[[x,y]]}],xlabel,ylabelR,aimL,markers:[x]} */
function drawChart(canvas,cfg){
  const g=canvas.getContext('2d'),W=canvas.width,H=canvas.height,dpr=devicePixelRatio;
  g.clearRect(0,0,W,H);const padL=46*dpr,padR=(cfg.ylabelR?46:14)*dpr,padT=10*dpr,padB=26*dpr;
  const series=(cfg.series||[]).filter(s=>s.data&&s.data.length);
  if(!series.length){g.fillStyle=COL.mut;g.font=`${12*dpr}px sans-serif`;g.textAlign='center';
    g.fillText(cfg.empty||'waiting for data…',W/2,H/2);return;}
  let xmin=Infinity,xmax=-Infinity;series.forEach(s=>s.data.forEach(p=>{xmin=Math.min(xmin,p[0]);xmax=Math.max(xmax,p[0]);}));
  if(xmax-xmin<1e-6)xmax=xmin+1;
  const axes={L:{min:Infinity,max:-Infinity},R:{min:Infinity,max:-Infinity}};
  series.forEach(s=>{const ax=s.axis||'L';s.data.forEach(p=>{axes[ax].min=Math.min(axes[ax].min,p[1]);axes[ax].max=Math.max(axes[ax].max,p[1]);});});
  if(cfg.aimL!=null){axes.L.min=Math.min(axes.L.min,cfg.aimL);axes.L.max=Math.max(axes.L.max,cfg.aimL);}
  ['L','R'].forEach(ax=>{if(axes[ax].min===Infinity){axes[ax].min=0;axes[ax].max=1;}
    if(axes[ax].max-axes[ax].min<1e-6)axes[ax].max=axes[ax].min+1;
    const pad=(axes[ax].max-axes[ax].min)*0.08;axes[ax].min-=pad;axes[ax].max+=pad;});
  const X=x=>padL+(x-xmin)/(xmax-xmin)*(W-padL-padR);
  const Y=(v,ax)=>H-padB-(v-axes[ax].min)/(axes[ax].max-axes[ax].min)*(H-padT-padB);
  g.strokeStyle=COL.grid;g.lineWidth=dpr;g.fillStyle=COL.mut;g.font=`${9.5*dpr}px monospace`;g.textAlign='right';g.textBaseline='middle';
  for(let i=0;i<=4;i++){const v=axes.L.min+(axes.L.max-axes.L.min)*i/4,y=Y(v,'L');
    g.beginPath();g.moveTo(padL,y);g.lineTo(W-padR,y);g.stroke();g.fillText(fmt(v),padL-5*dpr,y);}
  if(cfg.ylabelR){g.textAlign='left';g.fillStyle=COL.steel;
    for(let i=0;i<=4;i++){const v=axes.R.min+(axes.R.max-axes.R.min)*i/4,y=Y(v,'R');g.fillText(fmt(v),W-padR+5*dpr,y);}}
  g.textAlign='center';g.textBaseline='top';g.fillStyle=COL.mut;
  for(let i=0;i<=5;i++){const x=xmin+(xmax-xmin)*i/5;g.fillText(x.toFixed(0),X(x),H-padB+5*dpr);}
  if(cfg.xlabel){g.fillText(cfg.xlabel,W/2,H-11*dpr);}
  if(cfg.aimL!=null){g.strokeStyle='rgba(51,209,122,.55)';g.setLineDash([5*dpr,3*dpr]);g.lineWidth=dpr;
    g.beginPath();g.moveTo(padL,Y(cfg.aimL,'L'));g.lineTo(W-padR,Y(cfg.aimL,'L'));g.stroke();g.setLineDash([]);}
  if(cfg.markers)cfg.markers.forEach(mx=>{if(mx>=xmin&&mx<=xmax){g.strokeStyle='rgba(240,168,60,.5)';g.lineWidth=dpr;
    g.beginPath();g.moveTo(X(mx),padT);g.lineTo(X(mx),H-padB);g.stroke();}});
  series.forEach(s=>{const ax=s.axis||'L';g.strokeStyle=s.color;g.lineWidth=1.8*dpr;
    if(s.dash)g.setLineDash([5*dpr,3*dpr]);else g.setLineDash([]);g.beginPath();
    s.data.forEach((p,i)=>{const x=X(p[0]),y=Y(p[1],ax);i?g.lineTo(x,y):g.moveTo(x,y);});g.stroke();g.setLineDash([]);});
  g.textAlign='left';g.textBaseline='middle';g.font=`${9.5*dpr}px sans-serif`;let lx=padL+4*dpr,ly=padT+8*dpr;
  series.forEach(s=>{const label=s.name+(s.axis==='R'?' →':'');const wpx=g.measureText(label).width+18*dpr;
    if(lx+wpx>W-padR){lx=padL+4*dpr;ly+=13*dpr;}
    g.strokeStyle=s.color;g.lineWidth=2*dpr;g.beginPath();g.moveTo(lx,ly);g.lineTo(lx+11*dpr,ly);g.stroke();
    g.fillStyle=COL.text;g.fillText(label,lx+14*dpr,ly);lx+=wpx+6*dpr;});
}
function drawScatter(canvas,pts,line,xlabel){const g=canvas.getContext('2d'),W=canvas.width,H=canvas.height,dpr=devicePixelRatio;
  g.clearRect(0,0,W,H);if(!pts||!pts.length){g.fillStyle=COL.mut;g.font=`${12*dpr}px sans-serif`;g.textAlign='center';g.fillText('no data',W/2,H/2);return;}
  const pad=34*dpr;let lo=Infinity,hi=-Infinity;pts.forEach(p=>{lo=Math.min(lo,p[0],p[1]);hi=Math.max(hi,p[0],p[1]);});
  if(hi-lo<1e-6)hi=lo+1;const X=v=>pad+(v-lo)/(hi-lo)*(W-2*pad),Y=v=>H-pad-(v-lo)/(hi-lo)*(H-2*pad);
  g.strokeStyle=COL.grid;g.lineWidth=dpr;g.strokeRect(pad,pad,W-2*pad,H-2*pad);
  if(line){g.strokeStyle='rgba(51,209,122,.6)';g.setLineDash([5*dpr,3*dpr]);g.beginPath();g.moveTo(X(lo),Y(lo));g.lineTo(X(hi),Y(hi));g.stroke();g.setLineDash([]);}
  g.fillStyle=COL.steel;pts.forEach(p=>{g.beginPath();g.arc(X(p[0]),Y(p[1]),2.8*dpr,0,7);g.fill();});
  g.fillStyle=COL.mut;g.font=`${9*dpr}px monospace`;g.textAlign='center';g.fillText(xlabel||'actual →',W/2,H-8*dpr);}
function drawBars(canvas,items){const g=canvas.getContext('2d'),W=canvas.width,H=canvas.height,dpr=devicePixelRatio;
  g.clearRect(0,0,W,H);if(!items||!items.length){g.fillStyle=COL.mut;g.font=`${12*dpr}px sans-serif`;g.textAlign='center';g.fillText('no data',W/2,H/2);return;}
  const pad=8*dpr,bh=(H-2*pad)/items.length,max=Math.max(...items.map(i=>Math.abs(i.v)),1e-6);
  items.forEach((it,i)=>{const y=pad+i*bh,w=(Math.abs(it.v)/max)*(W*0.5);
    g.fillStyle=it.color||COL.steel;g.fillRect(W*0.42,y+bh*0.2,w,bh*0.55);
    g.fillStyle=COL.text;g.font=`${9.5*dpr}px sans-serif`;g.textAlign='right';g.textBaseline='middle';g.fillText(it.label,W*0.4,y+bh*0.5);
    g.textAlign='left';g.fillStyle=COL.mut;g.fillText(it.disp??fmt(it.v),W*0.42+w+4*dpr,y+bh*0.5);});}

/* ===================== A3. STATE ======================================== */
const state={
  cfg:null, defaults:null, scrap:[], materials:[],
  charge_t:12,power_kW:5200,C_pct:0.30,Cu_pct:0.20,tap_aim:1620,
  clo:0.05,chi:0.25,tariff:7.0,gridEF:0.712,baseline:600,rated:6000,floor_sec:381,
  speed:100,material:'Lime (92% CaO)',mass:48,autoRotate:true,showCoil:true,showSlag:true,
  frames:[],idx:0,playTime:0,frameDtSec:5,running:false,tapped:false,additions:[],heatLog:[],activeTab:'console',
  cmMode:'opt',cmWeights:{},cmPrices:{},
  ekf:null,ml:null,drift:null,
};
const el=id=>document.getElementById(id);
const cur=()=>state.frames.length?state.frames[Math.min(Math.floor(state.idx),state.frames.length-1)]:null;
const upto=()=>state.frames.slice(0,Math.min(Math.floor(state.idx)+1,state.frames.length));

/* ===================== B1. THREE.JS SETUP + FURNACE ===================== */
const webgl=el('webgl');
const scene=new THREE.Scene();scene.background=new THREE.Color(0x0a0d10);
scene.fog=new THREE.FogExp2(0x0a0d10,0.028);
const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,0.1,200);
camera.position.set(7.5,6,9.5);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
webgl.appendChild(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=0.06;controls.target.set(0,1.4,0);
controls.minDistance=5;controls.maxDistance=30;controls.maxPolarAngle=Math.PI*0.52;
scene.add(new THREE.HemisphereLight(0x8899aa,0x0a0d10,0.55));
const key=new THREE.DirectionalLight(0xffffff,0.6);key.position.set(6,12,8);scene.add(key);
const rimL=new THREE.DirectionalLight(0x4fa8d8,0.25);rimL.position.set(-8,4,-6);scene.add(rimL);
scene.add(new THREE.GridHelper(60,60,0x1a2228,0x141a1f));
const R_IN=2.0,R_OUT=2.35,WALL_H=4.0;
const furnace=new THREE.Group();scene.add(furnace);
const shellMat=new THREE.MeshStandardMaterial({color:0x2a2320,roughness:0.9,metalness:0.05,side:THREE.DoubleSide});
const outer=new THREE.Mesh(new THREE.CylinderGeometry(R_OUT,R_OUT*1.02,WALL_H,64,1,true),shellMat);outer.position.y=WALL_H/2;furnace.add(outer);
const inner=new THREE.Mesh(new THREE.CylinderGeometry(R_IN,R_IN,WALL_H,64,1,true),new THREE.MeshStandardMaterial({color:0x1c1815,roughness:1,side:THREE.BackSide}));inner.position.y=WALL_H/2;furnace.add(inner);
const baseDisc=new THREE.Mesh(new THREE.CylinderGeometry(R_OUT,R_OUT,0.4,64),shellMat);baseDisc.position.y=-0.2;furnace.add(baseDisc);
furnace.add(new THREE.Mesh(new THREE.CylinderGeometry(R_IN,R_IN,0.05,64),new THREE.MeshStandardMaterial({color:0x120d0a,roughness:1})));
const coil=new THREE.Group();
const coilMat=new THREE.MeshStandardMaterial({color:0xb87333,roughness:0.35,metalness:0.9,emissive:0x2a1200,emissiveIntensity:0.2});
for(let i=0;i<9;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(R_OUT*1.06,0.09,12,64),coilMat);ring.rotation.x=Math.PI/2;ring.position.y=0.5+i*(WALL_H-1)/8;coil.add(ring);}
furnace.add(coil);
const metalMat=new THREE.MeshStandardMaterial({color:0x3a0a04,roughness:0.35,metalness:0.6,emissive:0x2a0800,emissiveIntensity:0.4});
const metal=new THREE.Mesh(new THREE.CylinderGeometry(R_IN*0.98,R_IN*0.98,1,64),metalMat);furnace.add(metal);
const surfMat=new THREE.MeshStandardMaterial({color:0xff6a34,emissive:0xff6a34,emissiveIntensity:1.2,roughness:0.4});
const surface=new THREE.Mesh(new THREE.CircleGeometry(R_IN*0.97,64),surfMat);surface.rotation.x=-Math.PI/2;furnace.add(surface);
const slagMat=new THREE.MeshStandardMaterial({color:0x6b6438,roughness:0.8,metalness:0.1,transparent:true,opacity:0.85,emissive:0x1a1200,emissiveIntensity:0.3});
const slag=new THREE.Mesh(new THREE.CylinderGeometry(R_IN*0.99,R_IN*0.99,0.12,64),slagMat);furnace.add(slag);
const scrapGroup=new THREE.Group();furnace.add(scrapGroup);const scrapChunks=[];
for(let i=0;i<26;i++){const s=0.28+Math.random()*0.34;
  const geo=Math.random()<0.5?new THREE.BoxGeometry(s,s*0.7,s):new THREE.DodecahedronGeometry(s*0.6,0);
  const m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x5a6068,roughness:0.7,metalness:0.6}));
  const ang=Math.random()*Math.PI*2,rad=Math.random()*R_IN*0.8;m.position.set(Math.cos(ang)*rad,0,Math.sin(ang)*rad);
  m.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);
  m.userData={baseY:0.6+Math.random()*(WALL_H-1.4),spin:(Math.random()-0.5)*0.01};scrapGroup.add(m);scrapChunks.push(m);}
const bathLight=new THREE.PointLight(0xff6a34,0,14,2);bathLight.position.set(0,1.2,0);furnace.add(bathLight);
function radialTex(){const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');
  const gr=g.createRadialGradient(64,64,4,64,64,64);gr.addColorStop(0,'rgba(255,200,120,1)');gr.addColorStop(0.4,'rgba(255,120,60,0.5)');gr.addColorStop(1,'rgba(255,80,40,0)');
  g.fillStyle=gr;g.fillRect(0,0,128,128);return new THREE.CanvasTexture(c);}
const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:radialTex(),color:0xff8040,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
glow.scale.set(6,6,1);glow.position.set(0,2.6,0);furnace.add(glow);
const cCold=new THREE.Color(0x3a0a04),cWarm=new THREE.Color(0xff6a34),cHot=new THREE.Color(0xffd166),cWhite=new THREE.Color(0xfff3d0);
function metalColour(T){const c=new THREE.Color();
  if(T<800)c.copy(cCold).lerp(cWarm,THREE.MathUtils.clamp((T-200)/600,0,1));
  else if(T<1500)c.copy(cWarm).lerp(cHot,THREE.MathUtils.clamp((T-800)/700,0,1));
  else c.copy(cHot).lerp(cWhite,THREE.MathUtils.clamp((T-1500)/300,0,1));return c;}

/* ===================== B2. lil-gui ===================================== */
const gui=new GUI({title:'SmartMelt controls',width:290});
const fS=gui.addFolder('Heat setup');
fS.add(state,'charge_t',4,14,0.5).name('Charge (t)');
fS.add(state,'power_kW',1000,8000,100).name('Power (kW)');
fS.add(state,'C_pct',0.05,1.5,0.01).name('Charge C (%)');
fS.add(state,'Cu_pct',0.05,0.5,0.01).name('Charge Cu (%)');
fS.add(state,'tap_aim',1550,1700,5).name('Tap aim (°C)').onChange(syncSettingsInputs);
const fO=gui.addFolder('Operation');
fO.add({start:()=>startHeat()},'start').name('▶ Start heat');
fO.add({tap:()=>tapHeat()},'tap').name('⏏ Tap heat');
fO.add(state,'speed',{'Pause ⏸':0,'Real-time 1×':1,'10× real-time':10,'100× real-time':100,'1000× real-time':1000}).name('Playback speed');
const fA=gui.addFolder('Add material (during heat)');
fA.add(state,'material',[]).name('Material'); // options filled after config loads
fA.add(state,'mass',5,500,1).name('Mass (kg)');
fA.add({add:()=>addNow()},'add').name('＋ Add to bath now');
const fV=gui.addFolder('View');
fV.add(state,'autoRotate').name('Auto-rotate');
fV.add(state,'showCoil').name('Show coil').onChange(v=>coil.visible=v);
fV.add(state,'showSlag').name('Show slag').onChange(v=>slag.visible=v);
fV.close();
let materialCtl=fA.controllers[0];

/* ===================== B3. TAB ROUTER ================================== */
const panels={};document.querySelectorAll('.panel').forEach(p=>panels[p.id.replace('panel-','')]=p);
const tabButtons=document.querySelectorAll('.tab');
function showTab(name){state.activeTab=name;
  tabButtons.forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  Object.entries(panels).forEach(([k,p])=>p.classList.toggle('active',k===name));
  gui.domElement.style.display=(name==='console')?'':'none';
  requestAnimationFrame(()=>{fitPanelCharts(name);renderPanel(name);});
}
tabButtons.forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));

/* ===================== C1. CONSOLE OVERLAY ============================= */
function setKPI(id,val,sub){el('k-'+id).textContent=val;if(sub!=null)el('k-'+id+'-sub').textContent=sub;}
function refreshConsole(f){
  if(!f){['T','C','melt','sec','feo','b2','pow','energy'].forEach(k=>setKPI(k,'—',''));
    el('clock').textContent='00:00';el('adv-list').innerHTML='';return;}
  const mm=Math.floor(f.t_min),ss=Math.round((f.t_min-mm)*60);
  el('clock').textContent=`${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  setKPI('T',f.T_bath_C!=null?f.T_bath_C.toFixed(0):'—',`solid ${f.T_solid_C!=null?f.T_solid_C.toFixed(0):'—'}`);
  setKPI('C',f.pct_C!=null?f.pct_C.toFixed(3):'—',`aim ${state.clo.toFixed(2)}–${state.chi.toFixed(2)}`);
  setKPI('melt',f.melted_pct!=null?f.melted_pct.toFixed(1):'—',`${(f.M_liquid_t||0).toFixed(1)} t liq`);
  setKPI('sec',f.SEC_kWh_t!=null?f.SEC_kWh_t.toFixed(0):'—',`floor ${Math.round(state.floor_sec)}`);
  setKPI('feo',f.slag_FeO_pct!=null?f.slag_FeO_pct.toFixed(1):'—',`${(f.slag_total_kg||0).toFixed(0)} kg slag`);
  setKPI('b2',f.B2!=null?f.B2.toFixed(2):'—');
  setKPI('pow',state.running?state.power_kW.toFixed(0):'0',state.running?'melting':(state.tapped?'tapped':'idle'));
  setKPI('energy',f.E_kWh!=null?fmt(f.E_kWh):'—',`₹${Math.round((f.E_kWh||0)*state.tariff).toLocaleString('en-IN')}`);
  // advisories (from the engine, attached per frame)
  const box=el('adv-list');box.innerHTML='';
  (f.advisories||[]).forEach(([lvl,title,msg])=>{const d=document.createElement('div');d.className='adv '+lvl;
    d.innerHTML=`<div class="badge">${lvl==='ok'?'OK':lvl==='warn'?'!':'✕'}</div><div><div class="t">${title}</div><div class="m">${msg}</div></div>`;box.appendChild(d);});
  drawMini();
}
function drawMini(){const c=el('ch-mini');fitCanvas(c);const fr=upto();
  drawChart(c,{xlabel:'min',ylabelR:true,aimL:state.tap_aim,
    series:[{name:'Bath °C',color:COL.molten,axis:'L',data:fr.map(f=>[f.t_min,f.T_bath_C])},
            {name:'Melt %',color:COL.steel,axis:'R',data:fr.map(f=>[f.t_min,f.melted_pct])}]});}

/* ===================== C2. HEAT LOG =================================== */
function nowClock(){const d=new Date();return d.toTimeString().slice(0,8);}
function logEvent(type,detail){const f=cur();
  state.heatLog.push({clock:nowClock(),tmin:f?f.t_min.toFixed(1):'0.0',type,detail});renderHeatLog();}
function logAddition(mat,mass,tmin){logEvent('addition',`${mass} kg ${mat} @ ${tmin.toFixed(1)} min`);}
function renderHeatLog(){const tb=el('hl-tbody');if(!tb)return;tb.innerHTML='';
  [...state.heatLog].reverse().forEach(e=>{const tr=document.createElement('tr');
    const tag=e.type==='start'?'start':e.type==='addition'?'add':e.type==='tap'?'tap':'set';
    tr.innerHTML=`<td>${e.clock}</td><td>${e.tmin}</td><td><span class="tag ${tag}">${e.type}</span></td><td>${e.detail}</td>`;tb.appendChild(tr);});}
el('hl-clear').addEventListener('click',()=>{state.heatLog=[];renderHeatLog();});
el('hl-export').addEventListener('click',()=>{
  const rows=[['clock','heat_min','event','detail'],...state.heatLog.map(e=>[e.clock,e.tmin,e.type,e.detail])];
  const csv=rows.map(r=>r.map(x=>`"${x}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download='smartmelt_heatlog.csv';a.click();});

/* ===================== C3. SETTINGS ================================== */
function syncSettingsInputs(){
  el('set-tap').value=state.tap_aim;el('set-clo').value=state.clo;el('set-chi').value=state.chi;
  el('set-rated').value=state.rated;el('set-tariff').value=state.tariff;el('set-ef').value=state.gridEF;el('set-base').value=state.baseline;}
function renderSettingsActive(){el('set-active').innerHTML=
  [['Furnace type',state.cfg?.['Furnace type']||'IF'],['Config','if_msme_12t'],
   ['Tap aim (°C)',state.tap_aim],['Carbon window (%)',`${state.clo.toFixed(2)}–${state.chi.toFixed(2)}`],
   ['Rated power (kW)',state.rated],['Tariff (₹/kWh)',state.tariff],
   ['Grid EF (tCO₂/MWh)',state.gridEF],['Baseline SEC (kWh/t)',state.baseline],
   ['Theoretical floor (kWh/t)',Math.round(state.floor_sec)]]
  .map(([k,v])=>`<div class="k">${k}</div><div class="v">${v}</div>`).join('');}
el('set-apply').addEventListener('click',async()=>{
  state.tap_aim=+el('set-tap').value;state.clo=+el('set-clo').value;state.chi=+el('set-chi').value;
  state.rated=+el('set-rated').value;state.tariff=+el('set-tariff').value;state.gridEF=+el('set-ef').value;state.baseline=+el('set-base').value;
  el('set-status').textContent='applied ✓';renderSettingsActive();logEvent('setting',`tap ${state.tap_aim}°C · C ${state.clo}-${state.chi} · baseline ${state.baseline}`);
  if(state.running||state.frames.length){await rerunHeat(true);}  // re-score with new thresholds
  setTimeout(()=>el('set-status').textContent='',1800);});

/* ===================== C4. PANEL DISPATCH ============================= */
function fitPanelCharts(name){const p=panels[name];if(!p)return;p.querySelectorAll('canvas').forEach(fitCanvas);}
function renderPanel(name){switch(name){
  case 'trajectory':renderTrajectory();break;
  case 'physics':renderPhysics();break;
  case 'ekf':renderEKF();break;
  case 'ml':renderML();break;
  case 'drift':renderDrift();break;
  case 'chargemix':renderChargeMix();break;
  case 'economics':renderEconomics();break;
  case 'validation':renderValidation();break;
  case 'heatlog':renderHeatLog();break;
  case 'settings':syncSettingsInputs();renderSettingsActive();break;}}

/* ===================== D1. TRAJECTORY & PHYSICS ======================= */
function renderTrajectory(){const fr=upto();if(!fr.length){el('traj-banner').textContent='No heat yet — start one on the Operator Console.';}
  else el('traj-banner').textContent='Live process trajectories of the running heat — the same state the operator sees.';
  const mk=state.additions.map(a=>a.t_min);
  drawChart(el('tj-temp'),{xlabel:'min',aimL:state.tap_aim,markers:mk,series:[
    {name:'Bath °C',color:COL.molten,data:fr.map(f=>[f.t_min,f.T_bath_C])},
    {name:'Solid °C',color:COL.scrap,data:fr.map(f=>[f.t_min,f.T_solid_C])}]});
  drawChart(el('tj-inv'),{xlabel:'min',ylabelR:true,markers:mk,series:[
    {name:'Solid t',color:COL.scrap,data:fr.map(f=>[f.t_min,f.M_solid_t])},
    {name:'Liquid t',color:COL.molten,data:fr.map(f=>[f.t_min,f.M_liquid_t])},
    {name:'Undiss. kg',color:COL.amber,axis:'R',data:fr.map(f=>[f.t_min,f.undissolved_kg])}]});
  drawChart(el('tj-comp'),{xlabel:'min',markers:mk,series:[
    {name:'C %',color:COL.hi,data:fr.map(f=>[f.t_min,f.pct_C])},
    {name:'Si %',color:COL.steel,data:fr.map(f=>[f.t_min,f.pct_Si])},
    {name:'Mn %',color:COL.green,data:fr.map(f=>[f.t_min,f.pct_Mn])},
    {name:'S %',color:COL.red,data:fr.map(f=>[f.t_min,f.pct_S])}]});
  drawChart(el('tj-slag'),{xlabel:'min',ylabelR:true,markers:mk,series:[
    {name:'FeO kg',color:COL.molten,data:fr.map(f=>[f.t_min,f.slag_FeO_kg])},
    {name:'CaO kg',color:COL.steel,data:fr.map(f=>[f.t_min,f.slag_CaO_kg])},
    {name:'SiO₂ kg',color:COL.amber,data:fr.map(f=>[f.t_min,f.slag_SiO2_kg])},
    {name:'B2',color:COL.green,axis:'R',data:fr.map(f=>[f.t_min,f.B2])}]});
  drawChart(el('tj-pow'),{xlabel:'min',markers:mk,series:[
    {name:'Useful kW',color:COL.green,data:fr.map(f=>[f.t_min,f.Q_useful_kW])},
    {name:'Wall loss',color:COL.amber,data:fr.map(f=>[f.t_min,f.Q_wall_kW])},
    {name:'Rad loss',color:COL.red,data:fr.map(f=>[f.t_min,f.Q_rad_kW])},
    {name:'Chem kW',color:COL.steel,data:fr.map(f=>[f.t_min,f.Q_chem_kW])}]});
  drawChart(el('tj-ener'),{xlabel:'min',ylabelR:true,markers:mk,series:[
    {name:'Energy kWh',color:COL.hi,data:fr.map(f=>[f.t_min,f.E_kWh])},
    {name:'SEC kWh/t',color:COL.molten,axis:'R',data:fr.map(f=>[f.t_min,f.SEC_kWh_t])}],
    aimL:null});
}
function renderPhysics(){const fr=upto();const mk=state.additions.map(a=>a.t_min);
  drawChart(el('ph-flow'),{xlabel:'min',markers:mk,series:[
    {name:'Useful kW',color:COL.green,data:fr.map(f=>[f.t_min,f.Q_useful_kW])},
    {name:'Wall loss',color:COL.amber,data:fr.map(f=>[f.t_min,f.Q_wall_kW])},
    {name:'Rad loss',color:COL.red,data:fr.map(f=>[f.t_min,f.Q_rad_kW])}]});
  drawChart(el('ph-split'),{xlabel:'min',series:[
    {name:'Cumulative kWh',color:COL.hi,data:fr.map(f=>[f.t_min,f.E_kWh])}]});
  drawChart(el('ph-rate'),{xlabel:'min',markers:mk,series:[
    {name:'Chemical kW (FeO+C)',color:COL.steel,data:fr.map(f=>[f.t_min,f.Q_chem_kW])}]});
  const floorLine=fr.length?[[fr[0].t_min,state.floor_sec],[fr[fr.length-1].t_min,state.floor_sec]]:[];
  drawChart(el('ph-cum'),{xlabel:'min',ylabelR:true,series:[
    {name:'SEC kWh/t',color:COL.molten,data:fr.map(f=>[f.t_min,f.SEC_kWh_t])},
    {name:'Floor',color:COL.green,dash:true,data:floorLine},
    {name:'Energy kWh',color:COL.hi,axis:'R',data:fr.map(f=>[f.t_min,f.E_kWh])}]});
}

/* ===================== D2. EKF / ML / DRIFT (from API) ================ */
async function renderEKF(){if(!state.ekf){const r=await API.ekf();state.ekf=r;}
  const d=state.ekf;if(!d||!d.available){el('ekf-stats').innerHTML='<div class="k">status</div><div class="v">unavailable</div>';return;}
  const t=d.df.t_min,Tt=d.df.T_true_C,Te=d.df.T_est_C,sg=d.df.sigma_T;
  const up=t.map((x,i)=>[x,Te[i]+sg[i]]),dn=t.map((x,i)=>[x,Te[i]-sg[i]]);
  const dips=d.dips.t_min.map((x,i)=>[x,d.dips.T_meas_C[i]]);
  drawChart(el('ekf-T'),{xlabel:'min',series:[
    {name:'True °C',color:COL.molten,data:t.map((x,i)=>[x,Tt[i]])},
    {name:'EKF est',color:COL.steel,data:t.map((x,i)=>[x,Te[i]])},
    {name:'+σ',color:'rgba(79,168,216,.5)',dash:true,data:up},
    {name:'−σ',color:'rgba(79,168,216,.5)',dash:true,data:dn},
    {name:'Immersion dip',color:COL.hi,dash:true,data:dips}]});
  drawChart(el('ekf-theta'),{xlabel:'min',ylabelR:true,series:[
    {name:'η electrical',color:COL.green,data:d.theta.t_min.map((x,i)=>[x,d.theta.eta_electrical[i]])},
    {name:'UA scale',color:COL.amber,axis:'R',data:d.theta.t_min.map((x,i)=>[x,d.theta.UA_lining_scale[i]])}]});
  el('ekf-stats').innerHTML=[['Assimilation steps',t.length],['Immersion dips',dips.length],
    ['Final estimate error (°C)',(d.final_error_C).toFixed(2)],
    ['Converged η',d.theta.eta_electrical.at(-1).toFixed(3)],
    ['Converged UA scale',d.theta.UA_lining_scale.at(-1).toFixed(3)]]
    .map(([k,v])=>`<div class="k">${k}</div><div class="v">${v}</div>`).join('');
}
async function renderML(){if(!state.ml){state.ml=await API.ml();}
  const d=state.ml;if(!d||!d.available){el('ml-pills').innerHTML='<span class="pill">dataset unavailable</span>';return;}
  const P=d.pred,m=d.metrics;
  const Tpts=P.heat.map((_,i)=>[P.T_true_C[i],P.T_pred_C[i]]).filter(p=>p[0]!=null&&p[1]!=null);
  const Cpts=P.heat.map((_,i)=>[P.C_true[i],P.C_pred[i]]).filter(p=>p[0]!=null&&p[1]!=null);
  drawScatter(el('ml-scatter'),Tpts,true,'actual tap °C →');
  drawScatter(el('ml-cscatter'),Cpts,true,'actual C % →');
  const pill=(k,v)=>`<span class="pill">${k}: ${v}</span>`;
  el('ml-pills').innerHTML=[
    pill('maturity',m.maturity),pill('n train',m.n_train),pill('n test',m.n_test),
    pill('T MAE °C',m.T_MAE_C?.toFixed(1)??'—'),pill('T hit ±15°C %',m.T_hit_15C?.toFixed(0)??'—'),
    pill('C MAE',m.C_MAE?.toFixed(3)??'—'),pill('C hit ±0.02 %',m.C_hit_002?.toFixed(0)??'—'),
    pill('ML-T active',m.ml_T_active?'yes':'no'),pill('ML-C active',m.ml_C_active?'yes':'no')].join('');
}
async function renderDrift(){if(!state.drift){state.drift=await API.drift();}
  const d=state.drift;if(!d||!d.available){el('dr-kv').innerHTML='<div class="k">status</div><div class="v">unavailable</div>';return;}
  const feats=d.psi.feature.slice(0,10),vals=d.psi.PSI.slice(0,10);
  drawBars(el('dr-chart'),feats.map((f,i)=>({label:f,v:vals[i],
    color:vals[i]>0.25?COL.red:vals[i]>0.1?COL.amber:COL.green,disp:vals[i].toFixed(3)})));
  el('dr-kv').innerHTML=[['PSI max',d.psi_max.toFixed(3)],['Alarm',d.alarm?'⚠ YES':'no'],
    ['Reference heats',d.n_ref],['Recent heats',d.n_recent],['MAPE',d.mape!=null?d.mape.toFixed(1)+' %':'—']]
    .map(([k,v])=>`<div class="k">${k}</div><div class="v">${v}</div>`).join('');
  el('dr-note').textContent=d.alarm?('Drift flagged: '+(d.reasons||[]).join('; ')+
    '. PSI>0.25 (red) indicates a materially shifted feature — investigate feedstock or furnace change.'):
    'No significant drift. PSI below 0.1 on all features means the recent population matches the reference window.';
}

/* ===================== D3. CHARGE-MIX (from API) ====================== */
function buildChargeMixTable(){const tb=el('cm-tbody');tb.innerHTML='';
  state.scrap.forEach(m=>{const name=m.name;if(state.cmPrices[name]==null)state.cmPrices[name]=m.price;
    const tr=document.createElement('tr');
    tr.innerHTML=`<td style="font-family:var(--sans)">${name}</td>
      <td><input data-price="${name}" type="number" value="${state.cmPrices[name]}" style="width:64px;padding:3px 5px"></td>
      <td>${(m.C*100).toFixed(2)}</td><td>${(m.Cu*100).toFixed(3)}</td>
      <td><input data-w="${name}" type="number" value="${state.cmWeights[name]||0}" style="width:64px;padding:3px 5px" ${state.cmMode==='opt'?'disabled':''}></td>`;
    tb.appendChild(tr);});
  tb.querySelectorAll('input[data-price]').forEach(inp=>inp.addEventListener('change',e=>{state.cmPrices[e.target.dataset.price]=+e.target.value;}));
  tb.querySelectorAll('input[data-w]').forEach(inp=>inp.addEventListener('change',e=>{state.cmWeights[e.target.dataset.w]=+e.target.value;}));
}
async function renderChargeMix(){el('cm-target-lbl').textContent=state.charge_t;
  el('cm-mode-opt').classList.toggle('on',state.cmMode==='opt');el('cm-mode-man').classList.toggle('on',state.cmMode==='man');
  if(!el('cm-tbody').children.length||el('cm-tbody').querySelector('input[data-w]')?.disabled!==(state.cmMode==='opt'))buildChargeMixTable();
  await runChargeMix();
}
async function runChargeMix(){let res;
  if(state.cmMode==='opt'){
    res=await API.mixOpt({target_t:state.charge_t,cu_max:0.25,sn_max:0.03,c_lo:state.clo,c_hi:state.chi,prices:state.cmPrices});
    if(!res.feasible){el('cm-result').innerHTML='<div class="k">status</div><div class="v">infeasible</div>';
      el('cm-note').textContent=res.message||'No blend satisfies the tramp ceilings and carbon window from this library. Loosen Cu/Sn limits or widen the carbon aim.';
      drawBars(el('cm-bars'),[]);return;}
    el('cm-result').innerHTML=[['Feasible','yes'],['Liquid (t)',res.liquid_t?.toFixed(2)],
      ['Blended cost (₹/t liq)',Math.round(res.cost_per_t).toLocaleString('en-IN')],
      ['Charge cost (₹)',Math.round(res.cost_INR).toLocaleString('en-IN')],
      ['Melt energy (kWh)',Math.round(res.energy_kWh)],
      ['Bath C %',res.bath?.C?.toFixed(3)],['Bath Cu %',res.bath?.Cu?.toFixed(4)],['Bath Sn %',res.bath?.Sn?.toFixed(4)]]
      .map(([k,v])=>`<div class="k">${k}</div><div class="v">${v??'—'}</div>`).join('');
    el('cm-note').textContent='Least-cost blend (LP) meeting Cu ≤ 0.25 %, Sn ≤ 0.03 % and the carbon window. Shadow prices indicate which constraint is binding.';
    drawBars(el('cm-bars'),(res.rows||[]).map(r=>({label:r.Material,v:r.kg,disp:r.kg+' kg',color:COL.steel})));
  }else{
    res=await API.mixEval({weights:state.cmWeights,prices:state.cmPrices});
    if(!res.feasible){el('cm-result').innerHTML='<div class="k">status</div><div class="v">no material</div>';
      el('cm-note').textContent='Enter kg for one or more scrap streams in the table.';drawBars(el('cm-bars'),[]);return;}
    el('cm-result').innerHTML=[['Liquid (t)',res.liquid_t?.toFixed(2)],
      ['Charge (kg)',Math.round(res.charge_kg)],
      ['Blended cost (₹/t liq)',Math.round(res.cost_INR_per_t_liquid).toLocaleString('en-IN')],
      ['Melt energy (kWh)',Math.round(res.energy_kWh)],
      ['Bath C %',res.predicted_bath_pct?.C?.toFixed(3)],['Bath Cu %',res.predicted_bath_pct?.Cu?.toFixed(4)],
      ['Bath Mn %',res.predicted_bath_pct?.Mn?.toFixed(3)]]
      .map(([k,v])=>`<div class="k">${k}</div><div class="v">${v??'—'}</div>`).join('');
    el('cm-note').textContent='Manual blend evaluated at fixed weights — compare its cost and tramp levels against the optimiser.';
    drawBars(el('cm-bars'),(res.rows||[]).map(r=>({label:r.Material,v:r.kg,disp:r.kg+' kg',color:COL.amber})));
  }
}
el('cm-mode-opt').addEventListener('click',()=>{state.cmMode='opt';buildChargeMixTable();runChargeMix();
  el('cm-mode-opt').classList.add('on');el('cm-mode-man').classList.remove('on');});
el('cm-mode-man').addEventListener('click',()=>{state.cmMode='man';buildChargeMixTable();runChargeMix();
  el('cm-mode-man').classList.add('on');el('cm-mode-opt').classList.remove('on');});
el('cm-run').addEventListener('click',()=>runChargeMix());

/* ===================== D4. ECONOMICS & VALIDATION ==================== */
async function renderEconomics(){const f=cur();
  const sec=f?f.SEC_kWh_t:null,E=f?f.E_kWh:null;
  const cost=E!=null?E*state.tariff:null;const co2=E!=null?E/1000*state.gridEF*1000:null; // kg CO2
  el('ec-kv').innerHTML=[['Heat energy (kWh)',E!=null?Math.round(E).toLocaleString('en-IN'):'—'],
    ['Specific energy (kWh/t)',sec!=null?sec.toFixed(0):'—'],
    ['Energy cost (₹)',cost!=null?Math.round(cost).toLocaleString('en-IN'):'—'],
    ['CO₂ this heat (kg)',co2!=null?Math.round(co2).toLocaleString('en-IN'):'—'],
    ['Baseline SEC (kWh/t)',state.baseline],['Theoretical floor (kWh/t)',Math.round(state.floor_sec)],
    ['Δ vs baseline (kWh/t)',sec!=null?(sec-state.baseline).toFixed(0):'—']]
    .map(([k,v])=>`<div class="k">${k}</div><div class="v">${v}</div>`).join('');
  drawBars(el('ec-chart'),[
    {label:'This heat',v:sec||0,disp:(sec||0).toFixed(0),color:sec>state.baseline?COL.amber:COL.green},
    {label:'Baseline',v:state.baseline,disp:state.baseline+'',color:COL.mut},
    {label:'Floor',v:state.floor_sec,disp:Math.round(state.floor_sec)+'',color:COL.steel}]);
  // annualised savings from the real economics model when we have an on-aim heat
  if(sec!=null&&state.tapped){try{const ec=await API.econ({sec_before:state.baseline,sec_after:sec,tonnes_per_year:60000});
    const save=ec.annual_saving_INR||ec.saving_INR_per_year||ec.annual_cost_saving_INR;
    if(save!=null){el('ec-kv').innerHTML+=`<div class="k">Annual saving (₹, 60 kt/yr)</div><div class="v">${Math.round(save).toLocaleString('en-IN')}</div>`;}
  }catch(e){}}
}
async function renderValidation(){const v=await API.validation();const f=cur();
  el('val-const').innerHTML=[['Latent heat of fusion (kJ/kg)',v.L_fusion_kJ_kg],
    ['Grid emission factor (tCO₂/MWh)',v.grid_EF],['Theoretical melt floor (kWh/t)',Math.round(v.floor_sec)],
    ['Tap aim (°C)',v.tap_aim],['Baseline SEC (kWh/t)',v.baseline],['Config',v.config]]
    .map(([k,val])=>`<div class="k">${k}</div><div class="v">${val}</div>`).join('');
  el('val-heat').innerHTML=f?[['Heat time (min)',f.t_min.toFixed(1)],['Tap temperature (°C)',f.T_bath_C.toFixed(0)],
    ['Final carbon (%)',f.pct_C.toFixed(3)],['Slag FeO (%)',f.slag_FeO_pct.toFixed(1)],['Basicity B2',f.B2.toFixed(2)],
    ['Specific energy (kWh/t)',f.SEC_kWh_t.toFixed(0)],['Melted (%)',f.melted_pct.toFixed(1)]]
    .map(([k,val])=>`<div class="k">${k}</div><div class="v">${val}</div>`).join(''):
    '<div class="k">status</div><div class="v">run a heat on the Console</div>';
}

/* ===================== E1. FURNACE VISUAL FROM FRAME ================== */
const H_BATH_MAX=3.0;
function driveFurnace(f,tSec){
  const melt=f?Math.max(f.melted_pct,0)/100:0;
  const T=f?f.T_bath_C:25;
  const h=0.15+melt*(H_BATH_MAX-0.15);
  metal.scale.y=h;metal.position.y=h/2;
  const col=metalColour(T);metalMat.color.copy(col).multiplyScalar(0.5);
  metalMat.emissive.copy(col);metalMat.emissiveIntensity=0.25+melt*0.7;
  surface.position.y=h+0.01;surface.visible=melt>0.03;
  surfMat.color.copy(col);surfMat.emissive.copy(col);surfMat.emissiveIntensity=0.7+melt*0.9;
  slag.position.y=h+0.07;slag.visible=state.showSlag&&melt>0.15;
  const feo=f?f.slag_FeO_pct:0;slagMat.color.setHSL(0.09,0.5,0.28+Math.min(feo/60,0.25));
  // scrap: fewer visible as melt proceeds; bob gently
  const solidN=Math.ceil(26*(1-melt));
  scrapChunks.forEach((c,i)=>{c.visible=i<solidN;
    if(c.visible){c.position.y=c.userData.baseY*(1-melt*0.6)+Math.sin(tSec*0.8+i)*0.04;
      c.rotation.y+=c.userData.spin;
      const sc=metalColour(Math.min(T,900));c.material.emissive.copy(sc).multiplyScalar(melt*0.3);}});
  const glowI=melt*(0.25+THREE.MathUtils.clamp((T-1000)/800,0,1)*0.55);
  glow.material.opacity=glowI;glow.position.y=h+0.4;
  bathLight.intensity=melt*(1.2+THREE.MathUtils.clamp((T-800)/1000,0,1)*2.4);
  bathLight.color.copy(col);bathLight.position.y=h*0.6+0.3;
  if(state.running){coilMat.emissiveIntensity=0.2+0.25*(0.5+0.5*Math.sin(tSec*3));}
  else coilMat.emissiveIntensity=0.12;
}

/* ===================== E2. RENDER LOOP =============================== */
let lastOverlay=0,lastPanel=0,lastTick=performance.now();
function animate(){requestAnimationFrame(animate);const now=performance.now();
  const dtReal=Math.min((now-lastTick)/1000,0.25);lastTick=now;   // real seconds since last frame (capped to avoid jumps after a stall)
  if(state.running&&!state.tapped&&state.frames.length){
    state.playTime+=dtReal*state.speed;                           // speed = sim-seconds advanced per real second (1 = true real-time)
    let idx=state.playTime/(state.frameDtSec||5);
    if(idx>=state.frames.length-1){idx=state.frames.length-1;state.running=false;
      el('navstatus').textContent='heat complete — melt finished';el('navstatus').className='ok';}
    state.idx=idx;
  }
  const f=cur();driveFurnace(f,now/1000);
  if(now-lastOverlay>120){lastOverlay=now;refreshConsole(f);updateNavStatus(f);}
  if(now-lastPanel>350){lastPanel=now;
    if(['trajectory','physics','economics','validation'].includes(state.activeTab))renderPanel(state.activeTab);}
  if(state.autoRotate&&!state.running)furnace.rotation.y+=0.0016;
  controls.update();renderer.render(scene,camera);}

function updateNavStatus(f){if(!f){el('navstatus').textContent='ready — configure & start a heat';el('navstatus').className='warn';return;}
  if(state.tapped){el('navstatus').textContent=`tapped @ ${f.t_min.toFixed(1)} min · ${f.T_bath_C.toFixed(0)}°C · ${f.SEC_kWh_t.toFixed(0)} kWh/t`;el('navstatus').className='ok';return;}
  if(state.running){const worst=(f.advisories||[]).reduce((a,x)=>x[0]==='bad'?'bad':(x[0]==='warn'&&a!=='bad')?'warn':a,'ok');
    el('navstatus').textContent=`melting · ${f.melted_pct.toFixed(0)}% · bath ${f.T_bath_C.toFixed(0)}°C`;el('navstatus').className=worst;}
}

/* ===================== E3. OPERATOR EVENTS =========================== */
function simBody(){return {charge_t:state.charge_t,power_kW:state.power_kW,C_pct:state.C_pct,Cu_pct:state.Cu_pct,
  tap_aim:state.tap_aim,clo:state.clo,chi:state.chi,baseline:state.baseline,dt:5.0,t_end_min:92.0,additions:state.additions};}
async function startHeat(){
  state.additions=[];state.tapped=false;state.ml=state.drift=null;
  el('navstatus').textContent='running heat…';el('navstatus').className='warn';
  const r=await API.simulate(simBody());state.frames=r.frames||[];state.floor_sec=r.floor_sec||state.floor_sec;
  state.frameDtSec=state.frames.length>1?(state.frames[1].t_min-state.frames[0].t_min)*60:5;
  state.idx=0;state.playTime=0;state.running=true;furnace.rotation.y=0;
  logEvent('start',`${state.charge_t} t · ${state.power_kW} kW · C ${state.C_pct}% · aim ${state.tap_aim}°C`);
  if(state.activeTab!=='console')renderPanel(state.activeTab);
}
async function rerunHeat(keepIdx){const keepT=state.playTime;
  const r=await API.simulate(simBody());state.frames=r.frames||[];
  state.frameDtSec=state.frames.length>1?(state.frames[1].t_min-state.frames[0].t_min)*60:5;
  state.playTime=keepIdx?keepT:0;
  state.idx=Math.min(Math.floor(state.playTime/(state.frameDtSec||5)),state.frames.length-1);
  if(state.activeTab!=='console')renderPanel(state.activeTab);}
async function addNow(){const f=cur();if(!f||!state.frames.length){el('navstatus').textContent='start a heat before adding material';el('navstatus').className='warn';return;}
  const t=f.t_min;state.additions.push({material:state.material,mass:state.mass,t_min:t});
  logAddition(state.material,state.mass,t);
  await rerunHeat(true);   // deterministic re-simulation with the new addition
}
function tapHeat(){const f=cur();if(!f){return;}state.running=false;state.tapped=true;
  logEvent('tap',`T ${f.T_bath_C.toFixed(0)}°C · C ${f.pct_C.toFixed(3)}% · ${f.SEC_kWh_t.toFixed(0)} kWh/t · B2 ${f.B2.toFixed(2)}`);
  if(['economics','validation'].includes(state.activeTab))renderPanel(state.activeTab);}

/* ===================== E4. INIT ===================================== */
async function init(){
  try{
    const c=await API.config();state.cfg=c.summary;const d=c.defaults;
    Object.assign(state,{charge_t:d.charge_t,power_kW:d.power_kW,C_pct:d.C_pct,Cu_pct:d.Cu_pct,
      tap_aim:d.tap_aim,clo:d.clo,chi:d.chi,tariff:d.tariff,gridEF:d.gridEF,baseline:d.baseline,
      rated:d.rated_kW,floor_sec:d.floor_sec});
    state.materials=c.materials;state.scrap=c.scrap;state.material=c.materials[0];
    materialCtl=materialCtl.options(c.materials);materialCtl.setValue(c.materials[0]);
    materialCtl.onChange(v=>state.material=v);
    gui.controllersRecursive().forEach(ct=>ct.updateDisplay());
    syncSettingsInputs();renderSettingsActive();
    el('navstatus').textContent='ready — configure & start a heat';el('navstatus').className='ok';
  }catch(e){console.error(e);el('offline').style.display='flex';
    el('navstatus').textContent='backend offline';el('navstatus').className='bad';}
  showTab('console');animate();
}
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);fitPanelCharts(state.activeTab);});
init();
