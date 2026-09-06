/* SmartMelt Studio — HTML+CSS+Plotly.js+Three.js frontend.
   Faithful web rendering of run_gui.py / streamlit_app.py (app/exact_tabs.py):
   same 12 tabs, controls, shared heat, operator actions, plots and numbers.
   Every computation calls the validated engine via the backend API. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const P = window.Plotly;

/* palette (gui/theme.py) */
const C = { molt:'#ff6a34', moltHi:'#ffd166', steel:'#4fa8d8', green:'#33d17a',
  amber:'#f0a83c', red:'#e5484d', slag:'#a08a5a', scrap:'#8792a0', mut:'#9aa4af',
  grid:'#20262c', text:'#c6ccd4', bg:'#0f1418' };

function layout(over){
  const base={ paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:C.bg, template:'plotly_dark',
    font:{family:'Segoe UI, DejaVu Sans, system-ui, sans-serif', size:14, color:C.text},
    margin:{l:66,r:20,t:34,b:52}, showlegend:true,
    legend:{orientation:'h', yanchor:'bottom', y:1.0, x:0, font:{size:12.5}, bgcolor:'rgba(0,0,0,0)'},
    title:{font:{size:15, color:'#e9edf0'}, x:0.01, xanchor:'left'},
    xaxis:{gridcolor:C.grid, zeroline:false, tickfont:{size:12.5}, title:{font:{size:14}}},
    yaxis:{gridcolor:C.grid, zeroline:false, tickfont:{size:12.5}, title:{font:{size:14}}} };
  return Object.assign(base, over||{});
}
function plot(div, traces, over){ if(typeof div==='string') div=el(div); if(!div) return;
  P.react(div, traces, layout(over), {responsive:true, displayModeBar:false}); }
const el = id => document.getElementById(id);
function h(html){ const t=document.createElement('template'); t.innerHTML=html.trim();
  return t.content.childElementCount>1 ? t.content : t.content.firstChild; }
function fmtIN(n){ return Math.round(n).toLocaleString('en-IN'); }
const vline=(x,color,dash)=>({type:'line',x0:x,x1:x,yref:'paper',y0:0,y1:1,line:{color:color,dash:dash||'dot',width:1}});
const hline=(y,color,ref)=>({type:'line',xref:'paper',x0:0,x1:1,y0:y,y1:y,yref:ref||'y',line:{color:color,dash:'dash',width:1}});

/* state */
const state = { plant:'if_msme_12t', page:'console', cfg:null, ctrl:{}, busy:false,
  heat:null, schedule:[], idx:0, playing:false, speed:10, started:false, tapped:false,
  addLog:[], heatLog:[], heatSpec:null,
  traj:null, physics:null, ekf:null, ml:null, drift:null, mix:null, econ:null, valid:null };

const API_BASE = (window.SMARTMELT_API_BASE||'').replace(/\/+$/,'');
async function req(path, body){ let r;
  try{ r=await fetch(API_BASE+path, body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined); }
  catch(e){ throw new Error('Cannot reach backend '+(API_BASE||'(same origin)')+path+' — if free-hosted it may be asleep (~30–60 s). ('+e.message+')'); }
  if(!r.ok){ let x=''; try{x=(await r.text()).slice(0,200);}catch(_){}
    throw new Error('Backend '+r.status+' on '+path+(x?(' — '+x):'')); }
  return r.json(); }
function setStatus(txt,cls){ const s=el('status'); if(s){s.textContent=txt; s.className=cls||'';} }
function showFatal(t,m){ const o=el('offline'),b=o&&o.querySelector('.box'); if(b){b.innerHTML='<h3>'+t+'</h3><div class="note" style="white-space:pre-wrap;word-break:break-word">'+String(m)+'</div>'; o.style.display='flex';} }

/* control builders */
function sbClear(){ el('sidebar').innerHTML=''; }
function sbHead(t){ el('sidebar').appendChild(h(`<div class="sb-h">${t}</div>`)); }
function slider(key,label,min,max,step,def,hint,fmt){
  if(state.ctrl[key]===undefined) state.ctrl[key]=def;
  const w=h(`<div class="ctl"><label>${label}: <span class="val"></span></label><input type="range" min="${min}" max="${max}" step="${step}"/>${hint?`<div class="hint">${hint}</div>`:''}</div>`);
  const inp=w.querySelector('input'),v=w.querySelector('.val'); const show=x=>v.textContent=fmt?fmt(x):x;
  inp.value=state.ctrl[key]; show(state.ctrl[key]);
  inp.addEventListener('input',()=>{ state.ctrl[key]=parseFloat(inp.value); show(state.ctrl[key]); onChange(key); });
  el('sidebar').appendChild(w); }
function numberIn(key,label,min,max,def,step){
  if(state.ctrl[key]===undefined) state.ctrl[key]=def;
  const w=h(`<div class="ctl"><label>${label}</label><input type="number" min="${min}" max="${max}" step="${step||1}"/></div>`);
  const inp=w.querySelector('input'); inp.value=state.ctrl[key];
  inp.addEventListener('change',()=>{ state.ctrl[key]=parseFloat(inp.value); onChange(key); });
  el('sidebar').appendChild(w); }
function selectIn(key,label,options,def){
  if(state.ctrl[key]===undefined) state.ctrl[key]=def;
  const w=h(`<div class="ctl"><label>${label}</label><select>${options.map(o=>`<option ${o===state.ctrl[key]?'selected':''}>${o}</option>`).join('')}</select></div>`);
  const s=w.querySelector('select'); s.addEventListener('change',()=>{ state.ctrl[key]=s.value; onChange(key); });
  el('sidebar').appendChild(w); return w; }
function button(label,cb,primary){ const b=h(`<button class="act ${primary?'primary':''}" style="margin-bottom:10px">${label}</button>`); b.addEventListener('click',cb); el('sidebar').appendChild(b); return b; }
function caption(t){ el('sidebar').appendChild(h(`<div class="hint" style="margin-bottom:12px">${t}</div>`)); }

/* reactivity */
let runTimer=null;
function onChange(key){ const pg=PAGES[state.page]; if(pg.onCtrl){pg.onCtrl(key);return;} scheduleRun(); }
function scheduleRun(){ clearTimeout(runTimer); runTimer=setTimeout(()=>runPage(),300); }
async function runPage(){ const pg=PAGES[state.page]; if(!pg||!pg.run) return;
  try{ state.busy=true; setStatus('computing…','busy'); await pg.run(); setStatus('ready','ok'); }
  catch(e){ console.error(e); setStatus('error','bad'); showFatal('Error on '+state.page,(e&&(e.stack||e.message))||e); }
  finally{ state.busy=false; } }

/* ---- build_advisories ported from smartmelt engine (exact thresholds) ---- */
function advisories(s){
  const aim=state.cfg.tap_aim, clo=state.cfg.aim_C_lo, chi=state.cfg.aim_C_hi, base=state.cfg.base_sec;
  const out=[]; const T=s._proj!=null?s._proj:s.T_bath_C, dT=T-aim;
  if(Math.abs(dT)<=15) out.push(['ok','Bath temperature',`Tap T ${T.toFixed(0)} °C on aim (±15)`]);
  else if(dT>15) out.push([dT>30?'bad':'warn','Bath temperature',`Tap T ${T.toFixed(0)} °C is +${dT.toFixed(0)} above aim — step power down / tap earlier`]);
  else out.push([dT<-30?'bad':'warn','Bath temperature',`Tap T ${T.toFixed(0)} °C is ${dT.toFixed(0)} below aim — hold power / delay tap`]);
  const Cc=s.pct_C;
  if(Cc>chi) out.push([Cc>chi+0.05?'bad':'warn','Carbon',`C ${Cc.toFixed(3)}% above ${chi.toFixed(2)} — add mill scale / iron ore to decarburise`]);
  else if(Cc<clo) out.push(['warn','Carbon',`C ${Cc.toFixed(3)}% below ${clo.toFixed(2)} — add carburiser / recarburise`]);
  else out.push(['ok','Carbon',`C ${Cc.toFixed(3)}% inside aim ${clo.toFixed(2)}–${chi.toFixed(2)}`]);
  const b2=s.B2;
  if(b2<1.0) out.push(['warn','Basicity B2',`B2 ${b2.toFixed(2)} low — add lime to raise basicity (target ≥ 1.5)`]);
  else if(b2>3.0) out.push(['warn','Basicity B2',`B2 ${b2.toFixed(2)} high — slag stiff, check fluidity / add fluorspar`]);
  else out.push(['ok','Basicity B2',`B2 ${b2.toFixed(2)} in range (CaO/SiO₂)`]);
  const feo=s.slag_FeO_pct;
  if(feo>25) out.push(['bad','Slag FeO level',`FeO ${feo.toFixed(1)}% very high — over-oxidised bath, Fe yield loss; add carbon / reduce O₂`]);
  else if(feo>15) out.push(['warn','Slag FeO level',`FeO ${feo.toFixed(1)}% high — check oxidation, recover Fe with carbon`]);
  else out.push(['ok','Slag FeO level',`FeO ${feo.toFixed(1)}% acceptable`]);
  if(b2>=1.5&&feo<=15) out.push(['ok','B2 / FeO health',`B2 ${b2.toFixed(2)}, FeO ${feo.toFixed(1)}% — well-conditioned slag`]);
  else out.push(['warn','B2 / FeO health',`B2 ${b2.toFixed(2)}, FeO ${feo.toFixed(1)}% — adjust lime / oxidation balance`]);
  const sec=s.SEC_kWh_t;
  if(sec>base) out.push(['warn','Specific energy',`${sec.toFixed(0)} kWh/t above baseline ${base.toFixed(0)} — check power taper & lid time`]);
  else out.push(['ok','Specific energy',`${sec.toFixed(0)} kWh/t vs baseline ${base.toFixed(0)}`]);
  return out;
}

/* heat fetch (console live model + trajectory/physics operator heat) */
const col=(d,name)=>(d&&d.df&&d.df[name])||[];
async function fetchHeatSpec(spec){
  return req('/api/heat',{plant:state.plant,charge_t:spec.charge_t,power_kW:spec.power_kW,
    c_pct:spec.c_pct,cu_pct:spec.cu_pct,dt:2.0,additions:spec.schedule||[]}); }
function defaultSpec(){ return {charge_t:12.0,power_kW:5200.0,c_pct:0.30,cu_pct:0.20,
  schedule:[{material:'Lime (92% CaO)',time_min:8,mass:48},{material:'FeSi75',time_min:42,mass:15},
    {material:'Carburiser',time_min:48,mass:12},{material:'Mill scale (FeO)',time_min:58,mass:120}]}; }
function logEvent(event,detail,simMin){ state.heatLog.push({clock:new Date().toLocaleTimeString('en-GB'),
  sim_min:simMin!=null?simMin.toFixed(1):'',event,detail}); }

/* ================= 3D FURNACE ================= */
let fscene,fcam,frenderer,fcontrols,metal,metalMat,surface,surfMat,slag,slagMat,scrapG=[],glow,bathLight,furnaceReady=false;
const HB=3.0,R_IN=2.0,R_OUT=2.35,WALL=4.0;
function initFurnace(){ if(furnaceReady) return;
  fscene=new THREE.Scene(); fscene.background=new THREE.Color(0x0e1216); fscene.fog=new THREE.FogExp2(0x0e1216,0.03);
  fcam=new THREE.PerspectiveCamera(45,1,0.1,200); fcam.position.set(7,5.5,9);
  frenderer=new THREE.WebGLRenderer({antialias:true}); frenderer.setPixelRatio(Math.min(devicePixelRatio,2));
  frenderer.toneMapping=THREE.ACESFilmicToneMapping; frenderer.toneMappingExposure=1.15; frenderer.domElement.id='furnace-canvas';
  fcontrols=new OrbitControls(fcam,frenderer.domElement); fcontrols.enableDamping=true; fcontrols.target.set(0,1.4,0);
  fcontrols.minDistance=5; fcontrols.maxDistance=26; fcontrols.maxPolarAngle=Math.PI*0.52;
  fscene.add(new THREE.HemisphereLight(0x8899aa,0x0a0d10,0.55));
  const kl=new THREE.DirectionalLight(0xffffff,0.6); kl.position.set(6,12,8); fscene.add(kl);
  fscene.add(new THREE.GridHelper(50,50,0x1a2228,0x141a1f));
  const shell=new THREE.MeshStandardMaterial({color:0x4a3527,roughness:0.9,side:THREE.DoubleSide});
  const outer=new THREE.Mesh(new THREE.CylinderGeometry(R_OUT,R_OUT*1.02,WALL,60,1,true),shell); outer.position.y=WALL/2; fscene.add(outer);
  const inner=new THREE.Mesh(new THREE.CylinderGeometry(R_IN,R_IN,WALL,60,1,true),new THREE.MeshStandardMaterial({color:0x1a1410,roughness:1,side:THREE.BackSide})); inner.position.y=WALL/2; fscene.add(inner);
  fscene.add(new THREE.Mesh(new THREE.CylinderGeometry(R_OUT,R_OUT,0.4,60),shell)).position.y=-0.2;
  const coilMat=new THREE.MeshStandardMaterial({color:0xc8802f,roughness:0.35,metalness:0.9,emissive:0x2a1200,emissiveIntensity:0.2});
  for(let i=0;i<9;i++){const r=new THREE.Mesh(new THREE.TorusGeometry(R_OUT*1.06,0.09,10,50),coilMat); r.rotation.x=Math.PI/2; r.position.y=0.5+i*(WALL-1)/8; fscene.add(r);}
  metalMat=new THREE.MeshStandardMaterial({color:0x3a0a04,roughness:0.35,metalness:0.6,emissive:0x2a0800,emissiveIntensity:0.4});
  metal=new THREE.Mesh(new THREE.CylinderGeometry(R_IN*0.98,R_IN*0.98,1,60),metalMat); fscene.add(metal);
  surfMat=new THREE.MeshStandardMaterial({color:0xff6a34,emissive:0xff6a34,emissiveIntensity:1.2,roughness:0.4});
  surface=new THREE.Mesh(new THREE.CircleGeometry(R_IN*0.97,60),surfMat); surface.rotation.x=-Math.PI/2; fscene.add(surface);
  slagMat=new THREE.MeshStandardMaterial({color:0xa08a5a,roughness:0.8,transparent:true,opacity:0.85,emissive:0x1a1200,emissiveIntensity:0.3});
  slag=new THREE.Mesh(new THREE.CylinderGeometry(R_IN*0.99,R_IN*0.99,0.12,60),slagMat); fscene.add(slag);
  for(let i=0;i<24;i++){const sz=0.3+Math.random()*0.3;
    const m=new THREE.Mesh(Math.random()<0.5?new THREE.BoxGeometry(sz,sz*0.7,sz):new THREE.DodecahedronGeometry(sz*0.6,0),new THREE.MeshStandardMaterial({color:0x8792a0,roughness:0.7,metalness:0.6}));
    const a=Math.random()*6.28,r=Math.random()*R_IN*0.8; m.position.set(Math.cos(a)*r,0,Math.sin(a)*r);
    m.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3); m.userData={by:0.6+Math.random()*(WALL-1.4),sp:(Math.random()-0.5)*0.01}; fscene.add(m); scrapG.push(m);}
  bathLight=new THREE.PointLight(0xff6a34,0,14,2); bathLight.position.set(0,1.2,0); fscene.add(bathLight);
  const cnv=document.createElement('canvas'); cnv.width=cnv.height=128; const g=cnv.getContext('2d');
  const gr=g.createRadialGradient(64,64,4,64,64,64); gr.addColorStop(0,'rgba(255,200,120,1)'); gr.addColorStop(.4,'rgba(255,120,60,.5)'); gr.addColorStop(1,'rgba(255,80,40,0)'); g.fillStyle=gr; g.fillRect(0,0,128,128);
  glow=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cnv),color:0xff8040,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false})); glow.scale.set(6,6,1); glow.position.set(0,2.6,0); fscene.add(glow);
  furnaceReady=true; animate(); }
function metalColour(T){ const aim=(state.cfg&&state.cfg.tap_aim)||1620;
  const frac=Math.max(0,Math.min(1,(T-1150)/(aim+40-1150)));
  return new THREE.Color((196+59*frac)/255,(46+130*frac)/255,(12+26*frac)/255); }
function updateFurnace(f){ if(!furnaceReady) return;
  const melt=f?Math.max(f.melted_pct,0)/100:0,T=f?f.T_bath_C:25,feo=f?f.slag_FeO_pct:0;
  const hh=0.15+melt*(HB-0.15); metal.scale.y=hh; metal.position.y=hh/2;
  const cc=metalColour(T); metalMat.color.copy(cc).multiplyScalar(0.5); metalMat.emissive.copy(cc); metalMat.emissiveIntensity=0.25+melt*0.7;
  surface.position.y=hh+0.01; surface.visible=melt>0.03; surfMat.color.copy(cc); surfMat.emissive.copy(cc); surfMat.emissiveIntensity=0.7+melt*0.9;
  slag.position.y=hh+0.07; slag.visible=melt>0.15; slagMat.color.setHSL(0.09,0.5,0.28+Math.min(feo/60,0.25));
  const solidN=Math.ceil(24*(1-melt));
  scrapG.forEach((c,i)=>{c.visible=i<solidN; if(c.visible){c.position.y=c.userData.by*(1-melt*0.6); c.rotation.y+=c.userData.sp;}});
  glow.material.opacity=melt*(0.25+THREE.MathUtils.clamp((T-1000)/800,0,1)*0.55); glow.position.y=hh+0.4;
  bathLight.intensity=melt*(1.2+THREE.MathUtils.clamp((T-800)/1000,0,1)*2.4); bathLight.color.copy(cc); bathLight.position.y=hh*0.6+0.3; }
function animate(){ requestAnimationFrame(animate); if(state.page!=='console'||!furnaceReady) return;
  const slot=el('furnace-canvas'); if(!slot||!slot.clientWidth) return;
  if(frenderer.domElement.width!==slot.clientWidth*devicePixelRatio){ frenderer.setSize(slot.clientWidth,slot.clientHeight,false); fcam.aspect=slot.clientWidth/slot.clientHeight; fcam.updateProjectionMatrix(); }
  fcontrols.update(); frenderer.render(fscene,fcam); }

/* ---- shared render helpers ---- */
function kpiRow(items,cols){ return `<div class="krow" style="grid-template-columns:repeat(${cols||items.length},1fr)">`+
  items.map(([l,v,s])=>`<div class="kpi"><div class="lab">${l}</div><div class="v">${v}</div><div class="sub">${s||''}</div></div>`).join('')+`</div>`; }
function tbl(headers,rows){ return `<table class="tbl"><thead><tr>${headers.map(x=>`<th>${x}</th>`).join('')}</tr></thead>`+
  `<tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }
function pageHead(t,s){ el('main').innerHTML=''; el('main').appendChild(h(`<h2 class="page">${t}</h2><span class="muted">${s}</span>`)); }
const FPT={0:0,1:1,5:3,10:6,60:30};
function framesPerTick(sp){ return FPT[sp]!=null?FPT[sp]:6; }
function projectTap(frames,i){ const s=frames[i]; if(i<6||s.melted_pct>99) return s.T_bath_C;
  const r=frames.slice(Math.max(0,i-5),i+1); const dT=r[r.length-1].T_bath_C-r[0].T_bath_C; const dt=Math.max(r[r.length-1].t_min-r[0].t_min,.1);
  const rate=dT/dt; const dm=r[r.length-1].melted_pct-r[0].melted_pct;
  if(dm>.5){ const mins=(100-s.melted_pct)/(dm/dt); return s.T_bath_C+rate*Math.min(mins,40);} return s.T_bath_C+rate*5; }
function framesArr(){ const d=state.heat; if(!d) return []; const t=col(d,'t_min'); return t.map((_,i)=>{const o={}; for(const k in d.df) o[k]=d.df[k][i]; return o;}); }

/* ================= CONSOLE ================= */
let _frames=[];
function renderPhase(snap){
  const p=el('cons-phase'); if(!p) return;
  if(!snap){ p.innerHTML='<div class="note" style="margin-top:0">Press START HEAT to begin.</div>'; return; }
  const liq=snap.M_liquid_t||0, sol=snap.M_solid_t||0, tot=(liq+sol)||1;
  const slag=snap.slag_total_kg||0, und=snap.undissolved_kg||0;
  const metalHex='#'+metalColour(snap.T_bath_C).getHexString();
  const bar=(sw,name,val,pct)=>`<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:12px">`+
    `<i style="width:12px;height:12px;border-radius:3px;background:${sw};display:inline-block;flex:0 0 auto"></i>`+
    `<span style="flex:1">${name}</span><b style="font-family:var(--mono)">${val}</b>`+
    `<span style="color:var(--mut);width:52px;text-align:right;font-family:var(--mono)">${pct!=null?pct:''}</span></div>`;
  const sc=k=>snap['slag_'+k+'_kg']||0; const sf=k=> slag>0?((sc(k)/slag)*100).toFixed(0)+'%':'—';
  let out = bar(metalHex,'Liquid steel', liq.toFixed(2)+' t', (100*liq/tot).toFixed(0)+'%')
    + bar('#8792a0','Solid charge', sol.toFixed(2)+' t', (100*sol/tot).toFixed(0)+'%')
    + bar('#a08a5a','Slag', slag.toFixed(0)+' kg', (snap.slag_FeO_pct!=null?('FeO '+snap.slag_FeO_pct.toFixed(0)+'%'):''))
    + bar('#ece6d4','Undissolved add.', und.toFixed(0)+' kg', und>0?((100*und/(liq*1000+und)).toFixed(1)+'%'):'0%');
  if(slag>0) out+=`<div class="note" style="margin-top:5px">Slag: FeO ${sf('FeO')} · CaO ${sf('CaO')} · SiO₂ ${sf('SiO2')} · MnO ${sf('MnO')} · MgO ${sf('MgO')} · Al₂O₃ ${sf('Al2O3')} · B2 ${(snap.B2||0).toFixed(2)}</div>`;
  if(state.schedule&&state.schedule.length) out+=`<div class="note" style="margin-top:4px">Additions applied: ${state.schedule.map(a=>a.mass+'kg '+a.material.split(' (')[0]+'@'+a.time_min.toFixed(0)+'m').join(' · ')}</div>`;
  p.innerHTML=out;
}
function drawConsole(){
  pageHead('🔥 Operator Console','Start a heat, pick a speed, inject flux/ferro-alloys/recarburiser at the live time, watch the furnace & KPIs, then tap. Advisory-only.');
  el('main').appendChild(h(`<div class="grid2" style="grid-template-columns:0.42fr 0.58fr">
    <div><div id="furnace-slot" style="height:340px"><canvas id="furnace-canvas"></canvas></div>
      <div class="legend"><span><i style="background:#ff7a1a"></i>metal</span><span><i style="background:#a08a5a"></i>slag</span><span><i style="background:#8792a0"></i>scrap</span><span><i style="background:#c8802f"></i>coil</span><span><i style="background:#4a3527"></i>refractory</span></div>
      <div class="card" style="margin-top:12px;padding:10px 12px"><h3 style="margin-bottom:6px">Phase &amp; mass balance</h3><div id="cons-phase"></div></div></div>
    <div><div style="display:flex;gap:14px;align-items:center;margin-bottom:10px"><span id="cons-clock" class="clock">00:00</span><span id="cons-status"></span></div><div id="cons-kpi"></div></div>
  </div>
  <div class="card"><h3>Advisory — live verdicts</h3><div id="cons-adv" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px"></div></div>
  <div class="card"><h3>Live trend — temperature, melt &amp; chemistry</h3><div id="cons-tt" style="height:300px"></div><div id="cons-tb" style="height:240px"></div></div>
  <div id="cons-end" class="note"></div>`));
  initFurnace(); const slot=el('furnace-slot'); slot.innerHTML=''; slot.appendChild(frenderer.domElement);
  frenderer.domElement.style.width='100%'; frenderer.domElement.style.height='100%';
  tickConsoleFast(); drawConsoleTrend(); _needTrend=false;
}
function tickConsoleFast(){
  _frames=framesArr(); const aim=state.cfg.tap_aim; const n=_frames.length;
  const snap = n? _frames[Math.max(0,Math.min(state.idx,n-1))] : null;
  const clk=el('cons-clock'), stx=el('cons-status'), kp=el('cons-kpi'), ad=el('cons-adv');
  if(!clk||!stx||!kp||!ad) return;
  if(snap){ snap._proj=projectTap(_frames,Math.min(state.idx,n-1)); clk.textContent=`${String(Math.floor(snap.t_min)).padStart(2,'0')}:${String(Math.floor((snap.t_min%1)*60)).padStart(2,'0')}`; }
  else clk.textContent='00:00';
  // status
  let txt,kind;
  if(!snap){ txt='press START HEAT'; kind='warn'; }
  else if(state.tapped){ const hit=Math.abs(snap.T_bath_C-aim)<=15; txt='TAPPED — '+(hit?'on aim':`${(snap.T_bath_C-aim>=0?'+':'')}${(snap.T_bath_C-aim).toFixed(0)}°C off aim`); kind=hit?'ok':'warn'; }
  else if(!state.playing && state.idx>=n-1){ txt='heat complete — press TAP HEAT'; kind='ok'; }
  else if(snap.melted_pct>99 && snap.T_bath_C>=aim-5){ txt='READY TO TAP — on temperature & fully melted'; kind='ok'; }
  else if(snap.melted_pct<2){ txt='heating solid charge'; kind='warn'; }
  else { txt=`melting — ${(aim-snap.T_bath_C).toFixed(0)} °C below tap aim`; kind='warn'; }
  stx.innerHTML=`<span class="pill ${kind}">${txt}</span>`;
  // 12 KPIs
  const g=k=>snap?snap[k]:null; const kv=(l,v,s)=>[l,v,s];
  const V= snap?[
    kv('Bath °C',g('T_bath_C').toFixed(0),`aim ${aim.toFixed(0)}`),
    kv('Carbon %',g('pct_C').toFixed(3),''),
    kv('Melted %',g('melted_pct').toFixed(0),`${g('M_liquid_t').toFixed(1)} t liq`),
    kv('SEC kWh/t',g('SEC_kWh_t').toFixed(0),`${g('E_kWh').toFixed(0)} kWh`),
    kv('Slag FeO %',g('slag_FeO_pct').toFixed(1),`P ${g('pct_P').toFixed(4)}`),
    kv('Basicity B2',g('B2').toFixed(2),'CaO/SiO₂'),
    kv('Silicon %',g('pct_Si').toFixed(3),''),
    kv('Manganese %',g('pct_Mn').toFixed(3),`S ${g('pct_S').toFixed(4)}`),
    kv('Power kW',state.ctrl.power_kW.toFixed(0),state.tapped?'off':'grid'),
    kv('Total kWh',g('E_kWh').toFixed(0),'cumulative'),
    kv('Expected tap °C',snap._proj.toFixed(0),`aim ${aim.toFixed(0)}`),
    kv('Actual bath °C',g('T_bath_C').toFixed(0),'measured'),
  ]:Array(12).fill(0).map((_,i)=>kv(['Bath °C','Carbon %','Melted %','SEC kWh/t','Slag FeO %','Basicity B2','Silicon %','Manganese %','Power kW','Total kWh','Expected tap °C','Actual bath °C'][i],'—',''));
  kp.innerHTML=kpiRow(V,4);
  // 6 advisories
  const A= snap? advisories(snap) : Array(6).fill(['warn','—','']);
  ad.innerHTML=A.map(([lv,ti,ms])=>`<div class="adv ${lv}"><div class="t">${ti}</div><div class="m">${ms}</div></div>`).join('');
  updateFurnace(snap||{melted_pct:0,T_bath_C:25,slag_FeO_pct:0}); renderPhase(snap);
  const et=el('cons-end'); if(et) et.textContent=state.tapped&&snap?
    `Tapped at ${snap.t_min.toFixed(0)} min · ${snap.T_bath_C.toFixed(0)} °C · C ${snap.pct_C.toFixed(3)}% · SEC ${snap.SEC_kWh_t.toFixed(0)} kWh/t · slag FeO ${snap.slag_FeO_pct.toFixed(1)}% · B2 ${snap.B2.toFixed(2)}. Additions: `+(state.schedule.map(a=>`${a.mass}kg ${a.material.split(' (')[0]}@${a.time_min.toFixed(0)}min`).join(', ')||'none'):'';
}
function drawConsoleTrend(){
  const n=_frames.length, upto=_frames.slice(0,Math.max(1,Math.min(state.idx+1,n))); const aim=state.cfg.tap_aim;
  const t=upto.map(r=>r.t_min); const addv=state.schedule.map(a=>vline(a.time_min,C.amber,'dot'));
  plot('cons-tt',[
    {x:t,y:upto.map(r=>r.T_bath_C),name:'bath',line:{color:C.molt,width:2.4}},
    {x:t,y:upto.map(r=>r.T_solid_C),name:'solid',line:{color:C.scrap,width:1.6}},
    {x:t,y:upto.map(r=>r.melted_pct),name:'melted %',yaxis:'y2',line:{color:C.steel,width:1.8}},
  ],{title:'Temperature & melt progress',xaxis:{title:'min'},yaxis:{title:'°C'},
     yaxis2:{title:'melted %',overlaying:'y',side:'right',range:[0,105],gridcolor:'rgba(0,0,0,0)'},
     shapes:[hline(aim,C.green),...addv],margin:{l:66,r:60,t:34,b:30}});
  plot('cons-tb',[
    {x:t,y:upto.map(r=>r.pct_C),name:'C',line:{color:C.molt,width:2}},
    {x:t,y:upto.map(r=>r.pct_Si),name:'Si',line:{color:C.steel,width:1.8}},
    {x:t,y:upto.map(r=>r.pct_Mn),name:'Mn',line:{color:C.green,width:1.8}},
    {x:t,y:upto.map(r=>r.pct_S),name:'S',line:{color:C.slag,width:1.8}},
  ],{title:'Bath chemistry',xaxis:{title:'min'},yaxis:{title:'wt %'},shapes:addv});
}
async function startHeat(){
  state.schedule=[]; state.tapped=false; state.started=true; state.playing=true; state.idx=0; if(!state.speed||state.speed<=0) state.speed=10;
  state.addLog=[`Heat started · ${state.ctrl.charge_t.toFixed(1)} t · ${state.ctrl.power_kW.toFixed(0)} kW`];
  logEvent('HEAT START',`${state.ctrl.charge_t.toFixed(1)} t, ${state.ctrl.power_kW.toFixed(0)} kW, C ${state.ctrl.c_pct.toFixed(2)}%`,0);
  setStatus('simulating heat','busy');
  state.heat=await fetchHeatSpec({charge_t:state.ctrl.charge_t,power_kW:state.ctrl.power_kW,c_pct:state.ctrl.c_pct,cu_pct:state.ctrl.cu_pct,schedule:[]});
  state.heatSpec={charge_t:state.ctrl.charge_t,power_kW:state.ctrl.power_kW,c_pct:state.ctrl.c_pct,cu_pct:state.ctrl.cu_pct,schedule:[]};
  state.frameDt=frameDtOf(state.heat); reanchor();
  setStatus('heat running','ok'); renderSidebar(); drawConsole();
}
async function addMaterialNow(mat,mass){
  if(!state.started||state.tapped||!state.heat) { state.addLog.push('start the heat first'); renderSidebar(); return; }
  _frames=framesArr(); const cur=_frames[Math.min(state.idx,_frames.length-1)]; const tmin=cur.t_min;
  state.schedule.push({material:mat,time_min:tmin,mass}); 
  state.addLog.push(`${tmin.toFixed(1)} min · +${mass.toFixed(0)} kg ${mat.split(' (')[0]} @ ${cur.T_bath_C.toFixed(0)}°C`);
  logEvent('ADDITION',`+${mass.toFixed(0)} kg ${mat} @ ${cur.T_bath_C.toFixed(0)}°C`,tmin);
  state._recomputing=true; setStatus('addition — updating trajectory','busy');
  state.heat=await fetchHeatSpec({charge_t:state.ctrl.charge_t,power_kW:state.ctrl.power_kW,c_pct:state.ctrl.c_pct,cu_pct:state.ctrl.cu_pct,schedule:state.schedule});
  state.heatSpec.schedule=state.schedule.slice();
  const nt=col(state.heat,'t_min'); let j=nt.findIndex(x=>x>=tmin); if(j<0)j=nt.length-1; state.idx=Math.max(0,j);
  if(state.idx>=nt.length-1) state.playing=false;
  state.frameDt=frameDtOf(state.heat); reanchor(); state._recomputing=false;
  setStatus(state.playing?'heat running':'heat complete','ok'); renderSidebar(); drawConsole();
}
function tapHeat(){ if(!state.heat) return; state.playing=false; state.tapped=true;
  const snap=_frames[Math.min(state.idx,_frames.length-1)];
  logEvent('TAP',`${snap.T_bath_C.toFixed(0)}°C, C ${snap.pct_C.toFixed(3)}%, SEC ${snap.SEC_kWh_t.toFixed(0)} kWh/t`,snap.t_min);
  setStatus('heat tapped','ok'); renderSidebar(); tickConsoleFast(); }
function setSpeed(v){ const n=state.heat?col(state.heat,'t_min').length:0; state.speed=v;
  if(v===0){ state.playing=false; }
  else if(state.started && !state.tapped && state.idx<n-1){ state.playing=true; }
  reanchor(); _needTrend=true;
  document.querySelectorAll('#speedrow button').forEach(b=>b.classList.toggle('on',+b.dataset.sp===v)); }
let _recomputeTimer=null;
async function recomputeHeat(){
  if(!state.started||state.tapped) return;
  if(state._recomputing){ clearTimeout(_recomputeTimer); _recomputeTimer=setTimeout(recomputeHeat,300); return; }
  const fr=framesArr(); const curT=fr.length? fr[Math.min(state.idx,fr.length-1)].t_min : 0;
  state._recomputing=true; setStatus('applying change — updating heat','busy');
  state.heat=await fetchHeatSpec({charge_t:state.ctrl.charge_t,power_kW:state.ctrl.power_kW,c_pct:state.ctrl.c_pct,cu_pct:state.ctrl.cu_pct,schedule:state.schedule});
  state.heatSpec={charge_t:state.ctrl.charge_t,power_kW:state.ctrl.power_kW,c_pct:state.ctrl.c_pct,cu_pct:state.ctrl.cu_pct,schedule:state.schedule.slice()};
  const nt=col(state.heat,'t_min'); let j=nt.findIndex(x=>x>=curT); if(j<0)j=nt.length-1; state.idx=Math.max(0,j);
  if(state.idx>=nt.length-1) state.playing=false;
  state.frameDt=frameDtOf(state.heat); reanchor(); state._recomputing=false;
  setStatus(state.playing?'heat running':'heat complete','ok'); drawConsole();
}
/* playback loop — wall-clock, true real-time multiples, throttled plots */
function frameDtOf(d){ const t=col(d,'t_min'); return (t&&t.length>1)?(t[1]-t[0])*60:2; }
function reanchor(){ state.pi=state.idx; state.pw=performance.now(); }
let _lastPlot=0, _needTrend=false;
setInterval(()=>{
  if(!state.heat) return;
  const n=col(state.heat,'t_min').length; if(!n) return;
  if(state.playing && !state.tapped && state.speed>0 && !state._recomputing){
    const elapsed=(performance.now()-(state.pw||performance.now()))/1000;
    state.idx=Math.min((state.pi||0)+Math.floor(elapsed*state.speed/(state.frameDt||2)), n-1);
    if(state.idx>=n-1){ state.idx=n-1; state.playing=false; _needTrend=true; }
  }
  const now=performance.now();
  if(state.page==='console'){
    tickConsoleFast();
    if(_needTrend || (state.playing && now-_lastPlot>200)){ _lastPlot=now; _needTrend=false; drawConsoleTrend(); }
  } else if(state.page==='trajectory' && state.started){
    if(_needTrend || (state.playing && now-_lastPlot>450)){ _lastPlot=now; _needTrend=false; trajPlot(state.traj||state.heat); }
  }
}, 80);

function consoleControls(){
  sbHead('Heat setup — live during the heat');
  slider('charge_t','Charge (t)',4,14,.1,12.0,null,x=>x.toFixed(1));
  slider('power_kW','Power (kW)',1000,8000,100,5200,null,x=>x.toFixed(0));
  slider('c_pct','Charge C (%)',.05,1.5,.01,.30,null,x=>x.toFixed(2));
  slider('cu_pct','Charge Cu (%)',.05,.5,.01,.20,null,x=>x.toFixed(2));
  const pending=state.busy;
  const b1=button(state.playing&&!state.tapped?'▶ RUNNING':'▶ START HEAT',()=>startHeat(),true);
  const b2=button('⏏ TAP HEAT',()=>tapHeat()); if(!state.started||state.tapped) b2.disabled=true;
  const sb=h(`<div class="speedbtns" id="speedrow"></div>`);
  [['⏸',0],['1×',1],['5×',5],['10×',10],['60×',60]].forEach(([lab,v])=>{ const b=h(`<button class="act ${state.speed===v?'on':''}" data-sp="${v}">${lab}</button>`); b.addEventListener('click',()=>setSpeed(v)); sb.appendChild(b); });
  el('sidebar').appendChild(h(`<div class="sb-h">Playback speed</div>`)); el('sidebar').appendChild(sb);
  sbHead('Add material NOW (during heat)');
  selectIn('op_mat','Material',state.cfg.materials,state.cfg.materials[0]);
  numberIn('op_mass','Mass (kg)',0,2000,48,1);
  const ab=button('＋ Add to bath now',()=>addMaterialNow(state.ctrl.op_mat,state.ctrl.op_mass)); if(!state.started||state.tapped) ab.disabled=true;
  const q=h(`<div class="qadd"></div>`);
  [['Lime','Lime (92% CaO)',48],['FeSi75','FeSi75',15],['Carburiser','Carburiser',12],['Mill scale','Mill scale (FeO)',120]].forEach(([lab,mat,kg])=>{ const b=h(`<button class="act">${lab}</button>`); b.addEventListener('click',()=>addMaterialNow(mat,kg)); if(!state.started||state.tapped)b.disabled=true; q.appendChild(b); });
  el('sidebar').appendChild(q);
  el('sidebar').appendChild(h(`<div class="logbox">${(state.addLog.slice(-5).join('\n'))||'&nbsp;'}</div>`));
}
function renderSidebar(){ sbClear(); PAGES[state.page].controls(); }

/* ================= TRAJECTORY ================= */
async function trajRun(){
  let d;
  if(state.started && state.heat) d=state.heat;              /* live: reuse the console heat, no refetch */
  else { const spec=state.heatSpec||defaultSpec(); d=await fetchHeatSpec(spec); }
  state.traj=d;
  pageHead('📈 Process Trajectory', (state.started&&!state.tapped)
      ? 'Live — generated and updated as the heat runs on the Operator Console.'
      : "The operator's heat in six panels (last tapped, or the default schedule).");
  el('main').appendChild(h(`<div id="tj-kpi"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">`+
    ['Temperatures','Inventories & dissolution','Bath composition','Slag chemistry & basicity','Heat-flow breakdown','Energy & specific consumption']
      .map((t,i)=>`<div class="card"><h3>${t}</h3><div id="tj${i+1}" style="height:340px"></div></div>`).join('')+`</div>`));
  trajPlot(d); _needTrend=false;
}
function trajPlot(d){
  if(!d||!el('tj1')) return;
  const live = state.started && !state.tapped;
  const N=col(d,'t_min').length, hi = live? Math.min(state.idx+1,N) : N;
  const cut=a=>a.slice(0,hi);
  const t=cut(col(d,'t_min')), aim=d.tap_aim, floor=d.floor, last=t.length-1;
  const sc=((state.started?state.schedule:(state.heatSpec&&state.heatSpec.schedule))||[]);
  const av=sc.filter(a=>a.time_min<=(t[last]||1e9)).map(a=>vline(a.time_min,C.amber,'dot'));
  const g=k=>{const a=cut(col(d,k)); return a.length?a[a.length-1]:0;};
  const kp=el('tj-kpi'); if(kp) kp.innerHTML=kpiRow([
    ['Tap °C',g('T_bath_C').toFixed(0),`aim ${aim}`],['Carbon %',g('pct_C').toFixed(3),''],
    [live?'Elapsed min':'Tap min',(t[last]||0).toFixed(0),live?'running':''],
    ['SEC kWh/t',g('SEC_kWh_t').toFixed(0),`floor ${floor.toFixed(0)}`],
    ['Ledger %',live?'live':d.ledger_max_pct.toFixed(2),live?'running':'closure'],
  ],5);
  plot('tj1',[{x:t,y:cut(col(d,'T_bath_C')),name:'bath',line:{color:C.molt}},{x:t,y:cut(col(d,'T_solid_C')),name:'solid charge',line:{color:C.scrap}},{x:t,y:cut(col(d,'T_hotface_C')),name:'lining hot face',line:{color:C.slag,dash:'dot'}}],{xaxis:{title:'min'},yaxis:{title:'°C'},shapes:[hline(aim,C.green),...av]});
  plot('tj2',[{x:t,y:cut(col(d,'M_solid_t')),name:'solid',line:{color:C.scrap}},{x:t,y:cut(col(d,'M_liquid_t')),name:'liquid',line:{color:C.molt}},{x:t,y:cut(col(d,'undissolved_kg')),name:'undissolved kg',yaxis:'y2',line:{color:C.steel}}],{xaxis:{title:'min'},yaxis:{title:'metal (t)'},yaxis2:{title:'kg',overlaying:'y',side:'right',gridcolor:'rgba(0,0,0,0)'},shapes:av});
  plot('tj3',[{x:t,y:cut(col(d,'pct_C')),name:'C',line:{color:C.molt}},{x:t,y:cut(col(d,'pct_Si')),name:'Si',line:{color:C.steel}},{x:t,y:cut(col(d,'pct_Mn')),name:'Mn',line:{color:C.green}},{x:t,y:cut(col(d,'pct_S')),name:'S',line:{color:C.slag}}],{xaxis:{title:'min'},yaxis:{title:'wt %'},shapes:av});
  plot('tj4',[{x:t,y:cut(col(d,'slag_FeO_pct')),name:'FeO',line:{color:C.molt}},{x:t,y:cut(col(d,'B2')),name:'B2',yaxis:'y2',line:{color:C.steel}}],{xaxis:{title:'min'},yaxis:{title:'FeO %'},yaxis2:{title:'B2',overlaying:'y',side:'right',gridcolor:'rgba(0,0,0,0)'}});
  plot('tj5',[{x:t,y:cut(col(d,'Q_wall_kW')),name:'lining loss',line:{color:C.slag}},{x:t,y:cut(col(d,'Q_rad_kW')),name:'radiation',line:{color:C.red}},{x:t,y:cut(col(d,'Q_bath_to_scrap_kW')),name:'bath→scrap',line:{color:C.scrap}},{x:t,y:cut(col(d,'Q_chem_kW')),name:'chemical',line:{color:C.green}}],{xaxis:{title:'min'},yaxis:{title:'kW'}});
  plot('tj6',[{x:t,y:cut(col(d,'E_kWh')),name:'cumulative kWh',line:{color:C.scrap}},{x:t,y:cut(col(d,'SEC_kWh_t')),name:'SEC kWh/t',yaxis:'y2',line:{color:C.molt}}],{xaxis:{title:'min'},yaxis:{title:'kWh'},yaxis2:{title:'kWh/t',overlaying:'y',side:'right',gridcolor:'rgba(0,0,0,0)'},shapes:[hline(floor,C.green,'y2')]});
}

/* ================= PHYSICS ================= */
async function physicsRun(){
  let d; if(state.started && state.heat){ d=state.heat; } else { const spec=state.heatSpec||defaultSpec(); d=await fetchHeatSpec(spec); }
  state.physics=d; const t=col(d,'t_min'), en=d.energy, floor=d.floor;
  const clo=en.residual_pct??0, finalSEC=col(d,'SEC_kWh_t').slice(-1)[0], uf=100*(en.useful_fraction||0);
  pageHead('⚡ Physics & Energy','Heat-flow ledger, first-law audit and the energy split from grid input to tapped steel.');
  el('main').appendChild(h(kpiRow([
    ['Element ledger %',d.ledger_max_pct.toFixed(2),'worst species'],['First-law closure %',(clo>=0?'+':'')+clo.toFixed(1),'in − out'],
    ['Final SEC',finalSEC.toFixed(0),`floor ${floor.toFixed(0)}`],['Useful fraction %',uf.toFixed(0),'of grid input'],
  ],4)));
  el('main').appendChild(h(`<div class="grid2">
    <div class="card"><h3>Heat-flow breakdown through the heat</h3><div id="ph1" style="height:400px"></div></div>
    <div class="card"><h3>Energy split — grid input to tapped steel</h3><div id="ph2" style="height:400px"></div></div>
    <div class="card"><h3>Element reaction rates</h3><div id="ph3" style="height:360px"></div></div>
    <div class="card"><h3>Cumulative energy: input vs useful</h3><div id="ph4" style="height:360px"></div></div></div>`));
  const flows=[['Q_useful_kW',C.molt,'useful (to metal)'],['Q_wall_kW',C.slag,'lining loss'],['Q_rad_kW',C.red,'radiation'],['Q_chem_kW',C.green,'chemical'],['Q_offgas_kW',C.steel,'off-gas']];
  plot('ph1',flows.filter(f=>col(d,f[0]).length).map(([k,c,nm])=>({x:t,y:col(d,k),name:nm,line:{color:c,width:1.8}})),{xaxis:{title:'min'},yaxis:{title:'kW'}});
  const tot=en.grid_kWh, parts=[['converter',en.converter_loss_kWh||0],['coil water',en.coil_water_loss_kWh||0],['lining',en.lining_loss_kWh||0],['radiation',en.radiation_loss_kWh||0],['off-gas',en.offgas_loss_kWh||0]], useful=en.useful_melt_kWh||0;
  plot('ph2',[{type:'waterfall',orientation:'v',measure:['absolute',...parts.map(()=>'relative'),'total'],
    x:['grid in',...parts.map(p=>p[0]),'to steel'], y:[tot,...parts.map(p=>-p[1]),null],
    text:[tot,...parts.map(p=>-p[1]),useful].map(v=>v.toFixed(0)),textposition:'outside',textfont:{size:12},
    connector:{line:{color:'#3a444d'}},decreasing:{marker:{color:C.red}},increasing:{marker:{color:C.steel}},totals:{marker:{color:C.molt}}}],{yaxis:{title:'kWh'},showlegend:false,margin:{l:66,r:20,t:20,b:70}});
  const rates=[['rate_C',C.molt,'C'],['rate_Si',C.steel,'Si'],['rate_Mn',C.green,'Mn'],['rate_P',C.slag,'P']].filter(r=>col(d,r[0]).length);
  plot('ph3',rates.map(([k,c,nm])=>({x:t,y:col(d,k),name:nm,line:{color:c,width:1.6}})),{xaxis:{title:'min'},yaxis:{title:'rate (wt %/min)'},shapes:[hline(0,'#6b757f')]});
  const dt=t.map((v,i)=> i?(t[i]-t[i-1])/60:0); let cum=0; const useCum=col(d,'Q_useful_kW').map((q,i)=>{cum+=Math.max(q||0,0)*dt[i]; return cum;});
  plot('ph4',[{x:t,y:col(d,'E_kWh'),name:'grid input',line:{color:C.molt,width:2}},{x:t,y:useCum,name:'useful (to metal)',line:{color:C.green,width:2},fill:'tonexty',fillcolor:'rgba(229,72,77,0.12)'}],{xaxis:{title:'min'},yaxis:{title:'kWh'}});
}

/* ================= EKF ================= */
async function ekfRun(){
  let r; if(state._ekfLive){ r=await req('/api/ekf',{plant:state.plant,true_eta:state.ctrl.eta,true_UA:state.ctrl.ua,n_dips:state.ctrl.dips}); r.__live=true; state._ekfLive=false; }
  else r=await req('/api/ekf/default');
  state.ekf=r; if(!r.available){ el('main').innerHTML='<div class="note">EKF cache unavailable — use Run live.</div>'; return; }
  pageHead('🛰️ Virtual Temperature Sensor (EKF)','Extended Kalman Filter using intermittent immersion dips to estimate bath temperature and the hidden furnace efficiency.');
  el('main').appendChild(h(kpiRow([
    ['Final error °C',(r.final_error_C>=0?'+':'')+r.final_error_C.toFixed(1),'est − truth'],['η̂ electrical',r.eta_hat.toFixed(3),'converged'],
    ['σ_T end °C',r.sigma1.toFixed(1),'uncertainty'],['Dips used',r.n_dips,'measurements'],
  ],4)));
  el('main').appendChild(h(`<div class="grid2" style="grid-template-columns:1.5fr 1fr">
    <div class="card"><h3>Bath temperature — truth vs EKF estimate</h3><div id="ek1" style="height:460px"></div></div>
    <div class="card"><h3>Tracked parameters converging to truth</h3><div id="ek2" style="height:460px"></div></div></div>`));
  const d=r.df,t=d.t_min,est=d.T_est_C,sig=d.sigma_T;
  plot('ek1',[
    {x:t,y:est.map((e,i)=>e+2*sig[i]),line:{width:0},showlegend:false,hoverinfo:'skip'},
    {x:t,y:est.map((e,i)=>e-2*sig[i]),fill:'tonexty',fillcolor:'rgba(255,106,52,0.18)',line:{width:0},name:'±2σ confidence'},
    {x:t,y:d.T_true_C,name:'true (hidden)',line:{color:'#cfd6dd',width:2}},
    {x:t,y:est,name:'EKF estimate',line:{color:C.molt,width:2}},
    {x:r.dips.t_min,y:r.dips.T_meas_C,mode:'markers',name:'immersion dip',marker:{color:C.steel,size:12,symbol:'diamond'}},
  ],{xaxis:{title:'min'},yaxis:{title:'°C'}});
  const th=r.theta,trs=[{x:th.t_min,y:th.eta_electrical,name:'η electrical',line:{color:C.molt}}],sh=[hline(r.true_eta,C.molt)];
  if(th.UA_lining_scale){ trs.push({x:th.t_min,y:th.UA_lining_scale,name:'UA wall-loss scale',line:{color:C.steel}}); sh.push(hline(r.true_UA,C.steel)); }
  plot('ek2',trs,{xaxis:{title:'min'},yaxis:{title:'value'},shapes:sh});
  el('main').appendChild(h(`<div class="note">Dashed lines are the true (hidden) values. ${r.__live?'':'Default result is pre-computed and loads instantly; change the sliders and press Run live to recompute (~1 min).'}</div>`));
}

/* ================= ML ================= */
async function mlRun(){
  const gen=state._mlGen||false; state._mlGen=false;
  const r=await req('/api/ml',{plant:state.plant,n_heats:state.ctrl.ml_n||40,split:state.ctrl.ml_split??0.7,generate:gen});
  state.ml=r; if(!r.available){ el('main').innerHTML='<div class="note">No cached dataset — use Generate live.</div>'; return; }
  const m=r.metrics,p=r.pred; const fmt=x=>(x===x)?(x<=1?(x*100).toFixed(0):x.toFixed(0)):'—';
  pageHead('🧠 Hybrid Endpoint Model','The same physics engine plus a gated Gaussian-process residual head — physics predicts, ML corrects, and gates off until it proves out-of-time improvement.');
  el('main').appendChild(h(`<div style="margin-bottom:12px"><span class="pill ${m.ml_T_active?'ok':'warn'}">maturity: ${m.maturity} · T-ML ${m.ml_T_active?'active':'gated off'} · C-ML ${m.ml_C_active?'active':'gated off'} (${m.n_train} train / ${m.n_test} test, ${r.n_rows} rows)</span></div>`));
  el('main').appendChild(h(kpiRow([
    ['T hit ±15°C',fmt(m.T_hit_15C)+'%',`phys ${fmt(m.T_hit_15C_phys)}%`],['T MAE °C',(m.T_MAE_C===m.T_MAE_C)?m.T_MAE_C.toFixed(1):'—','hybrid'],
    ['C hit ±0.02%',fmt(m.C_hit_002)+'%',`phys ${fmt(m.C_hit_002_phys)}%`],['C MAE %',(m.C_MAE===m.C_MAE)?m.C_MAE.toFixed(3):'—','hybrid'],
  ],4)));
  el('main').appendChild(h(`<div class="grid2">
    <div class="card"><h3>Temperature — predicted vs actual</h3><div id="ml1" style="height:440px"></div></div>
    <div class="card"><h3>Test-set temperature error</h3><div id="ml2" style="height:440px"></div></div></div>`));
  const lo=Math.min(...p.T_true_C,...p.T_pred_C)-10, hi=Math.max(...p.T_true_C,...p.T_pred_C)+10;
  plot('ml1',[{x:[lo,hi],y:[lo,hi],mode:'lines',line:{color:C.mut,dash:'dash'},showlegend:false},
    {x:p.T_true_C,y:p.T_phys_C,mode:'markers',name:'physics',marker:{color:C.scrap,size:9,symbol:'x'}},
    {x:p.T_true_C,y:p.T_pred_C,mode:'markers',name:'hybrid',marker:{color:C.molt,size:10}}],{xaxis:{title:'actual °C'},yaxis:{title:'predicted °C'}});
  plot('ml2',[{x:p.heat.map(x=>x-0.2),y:p.T_pred_C.map((v,i)=>v-p.T_true_C[i]),name:'hybrid',type:'bar',marker:{color:C.molt},width:0.4},
    {x:p.heat.map(x=>x+0.2),y:p.T_phys_C.map((v,i)=>v-p.T_true_C[i]),name:'physics',type:'bar',marker:{color:C.scrap},width:0.4}],
    {xaxis:{title:'test heat'},yaxis:{title:'pred − actual °C'},shapes:[{type:'rect',xref:'paper',x0:0,x1:1,y0:-15,y1:15,fillcolor:'rgba(51,209,122,0.1)',line:{width:0}}]});
}

/* ================= DRIFT ================= */
async function driftRun(){
  const gen=state._driftGen||false; state._driftGen=false;
  const r=await req('/api/drift',{plant:state.plant,n_heats:state.ctrl.dr_n||50,regime:state.ctrl.dr_reg||40,ref_frac:0.5,generate:gen});
  state.drift=r; if(!r.available){ el('main').innerHTML='<div class="note">No cached dataset — use Generate live.</div>'; return; }
  pageHead('📡 Drift Monitor','PSI alarms when incoming scrap or practice changes — before endpoint accuracy quietly degrades.');
  el('main').appendChild(h(`<div style="margin-bottom:12px"><span class="pill ${r.alarm?'bad':'ok'}">${r.alarm?'DRIFT ALARM — '+(r.reasons.slice(0,2).join(', ')):'stable — no significant drift'}</span></div>`));
  el('main').appendChild(h(kpiRow([['Max PSI',r.psi_max.toFixed(2),'>0.25 shift · >0.5 major'],['Reference heats',r.n_ref,'baseline'],['Recent heats',r.n_recent,'checked']],3)));
  el('main').appendChild(h(`<div class="grid2" style="grid-template-columns:1.2fr 1fr">
    <div class="card"><h3>Population drift by feature (PSI)</h3><div id="dr1" style="height:520px"></div></div>
    <div class="card"><h3>The variable that moved</h3><div id="dr2" style="height:400px"></div></div></div>`));
  const feats=r.psi.feature.slice(0,12), vals=r.psi.PSI.slice(0,12), cols=vals.map(v=>v>.5?C.red:v>.25?C.amber:C.steel);
  plot('dr1',[{x:vals,y:feats,type:'bar',orientation:'h',marker:{color:cols}}],{xaxis:{title:'PSI'},yaxis:{autorange:'reversed'},showlegend:false,margin:{l:150,r:20,t:20,b:50},shapes:[vline(.25,C.amber,'dash'),vline(.5,C.red,'dash')]});
  const cu=r.cu_series;
  plot('dr2',[{x:cu.heat,y:cu.value,mode:'lines+markers',name:cu.col,line:{color:C.molt}}],{xaxis:{title:'heat number'},yaxis:{title:cu.col},showlegend:false,shapes:[vline(r.regime,C.red),{type:'rect',x0:0,x1:r.n_ref,yref:'paper',y0:0,y1:1,fillcolor:'rgba(79,168,216,0.08)',line:{width:0}}]});
}

/* ================= CHARGE-MIX ================= */
async function mixRun(){
  const mode=state.ctrl.mix_mode||'optimise';
  const body={plant:state.plant,mode:mode==='Manual'?'manual':'optimise',target_t:state.ctrl.target_t??12,c_lo:state.ctrl.c_lo??0.10,c_hi:state.ctrl.c_hi??0.40,cu_limit:state.ctrl.cu_lim??0.20,sn_limit:state.ctrl.sn_lim??0.03,materials:[],manual_weights:state.ctrl.manual_weights||{}};
  const r=await req('/api/chargemix',body); state.mix=r;
  pageHead('⚖️ Charge-Mix Optimiser','17-stream least-cost optimiser and manual charge evaluation with Cu/Sn tramp constraints.');
  // mode radio
  const mr=h(`<div class="mode-radio"><button class="${mode!=='Manual'?'on':''}">Optimise (least cost)</button><button class="${mode==='Manual'?'on':''}">Manual (operator sets kg)</button></div>`);
  mr.children[0].addEventListener('click',()=>{state.ctrl.mix_mode='optimise';scheduleRun();});
  mr.children[1].addEventListener('click',()=>{state.ctrl.mix_mode='Manual';scheduleRun();});
  el('main').appendChild(mr);
  // material table (editable kg in manual)
  const mats=state.cfg.scrap; const manual=mode==='Manual';
  const hdr=['Material','₹/kg','Fe%','Cu%','Sn%','C%'].concat(manual?['kg']:[]);
  const rows=mats.map((m,i)=>`<tr data-i="${i}"><td>${m.name}</td><td>${m.price}</td><td>${(100*m.Fe).toFixed(1)}</td><td>${(100*m.Cu).toFixed(3)}</td><td>${(100*(m.Sn||0)).toFixed(3)}</td><td>${(100*(m.C||0)).toFixed(2)}</td>${manual?`<td contenteditable data-kg="${m.name}">${(state.ctrl.manual_weights||{})[m.name]||0}</td>`:''}</tr>`).join('');
  el('main').appendChild(h(`<div class="grid2" style="grid-template-columns:1.1fr 0.9fr"><div class="card"><h3>Scrap library — 17 streams (price ₹/kg · assays wt%)</h3><div style="max-height:445px;overflow:auto">${tbl(hdr,[]).replace('<tbody></tbody>',`<tbody>${rows}</tbody>`)}</div></div><div id="mix-result"></div></div>`));
  if(manual) el('main').querySelectorAll('td[contenteditable]').forEach(td=>td.addEventListener('blur',()=>{ const name=td.dataset.kg,v=parseFloat(td.textContent)||0; const w=Object.assign({},state.ctrl.manual_weights||{}); if(v>0)w[name]=v; else delete w[name]; state.ctrl.manual_weights=w; scheduleRun(); }));
  const R=el('mix-result');
  if(mode!=='Manual'){
    if(!r.feasible){ R.innerHTML=`<div class="card"><h3>Result</h3><span class="pill bad">infeasible — widen C window or raise a ceiling</span><div class="note">${r.message||''}</div></div>`; return; }
    const bath=r.bath||{};
    R.innerHTML=`<div class="card"><h3>Result — least-cost compliant blend</h3><span class="pill ok">feasible</span>`+
      kpiRow([['Blend cost ₹/t','₹'+fmtIN(r.cost_per_t),'of liquid'],['Charge energy',fmtIN(r.energy_kWh)+' kWh',''],['Predicted Cu %',(bath.Cu||0).toFixed(3),`≤ ${(state.ctrl.cu_lim??0.20).toFixed(2)}`],['Predicted C %',(bath.C||0).toFixed(3),`${(state.ctrl.c_lo??0.1).toFixed(2)}–${(state.ctrl.c_hi??0.4).toFixed(2)}`]],2)+
      (r.rows&&r.rows.length?`<div style="margin-top:8px">${tbl(['Material','kg','% of charge'],r.rows.map(x=>[x.Material,fmtIN(x.kg),(x['% of charge']??0).toFixed(1)]))}</div>`:'')+
      `<h3 style="margin-top:10px">Predicted bath chemistry</h3>${tbl(['Element','wt %'],['C','Si','Mn','Cr','Cu','Sn','Fe'].filter(e=>bath[e]>1e-6).map(e=>[e,(+bath[e]).toFixed(4)]))}`+
      (r.cu_shadow&&Math.abs(r.cu_shadow)>1?`<div class="note">Copper ceiling shadow price ≈ ₹${fmtIN(Math.abs(r.cu_shadow)/100)}/t liquid per 0.01% relaxed.</div>`:`<div class="note">Copper ceiling not binding — the cheapest blend already sits below it.</div>`)+`</div>`;
  } else {
    if(!r.feasible){ R.innerHTML=`<div class="card"><h3>Result</h3><span class="pill warn">no kg set — enter manual weights in the table</span></div>`; return; }
    const bath=r.predicted_bath_pct||{}, tot=Object.values(state.ctrl.manual_weights||{}).reduce((a,b)=>a+b,0);
    R.innerHTML=`<div class="card"><h3>Result — manual blend</h3><span class="pill ok">evaluated</span>`+
      kpiRow([['Blend cost ₹/t','₹'+fmtIN(r.cost_INR_per_t_liquid),`${r.liquid_t.toFixed(1)} t liquid`],['Charge energy',fmtIN(r.energy_kWh)+' kWh',''],['Predicted Cu %',(bath.Cu||0).toFixed(3),'tramp'],['Predicted C %',(bath.C||0).toFixed(3),'carbon']],2)+
      `<h3 style="margin-top:10px">Predicted bath chemistry</h3>${tbl(['Element','wt %'],['C','Si','Mn','Cr','Cu','Sn','Fe'].filter(e=>bath[e]>1e-6).map(e=>[e,(+bath[e]).toFixed(4)]))}<div class="note">${fmtIN(tot)} kg charged → ${r.liquid_t.toFixed(1)} t liquid.</div></div>`;
  }
}

/* ================= ECONOMICS ================= */
async function econRun(){
  const tpy=state.ctrl.tpy??40000, saving=state.ctrl.saving??40, lic=state.ctrl.licence??20;
  const r=await req('/api/economics',{plant:state.plant,tpy,saving}); state.econ=r;
  const tar=r.tariff, ef=r.grid_ef, base=r.base_sec, floor=r.floor;
  const annual=tpy*saving*tar, payback=annual>0?(lic*1e5)/annual*12:Infinity, co2=tpy*saving/1000*ef;
  pageHead('💰 Economics','Savings, payback and CO₂ using the active plant tariff and emission factor. Every input updates live.');
  el('main').appendChild(h(kpiRow([
    ['Annual saving','₹'+(annual/1e7).toFixed(2)+' cr',`at ₹${tar.toFixed(1)}/kWh`],['Payback',(isFinite(payback)?payback.toFixed(1):'∞')+' mo','energy alone'],
    ['CO₂ avoided',fmtIN(co2)+' t/yr',`at ${ef.toFixed(3)}`],['Headroom left',Math.max(base-saving-floor,0).toFixed(0)+' kWh/t',`above ${floor.toFixed(0)}`],
  ],4)));
  el('main').appendChild(h(`<div class="card"><h3>Savings sensitivity</h3>${tbl(['Annual output','30 kWh/t','50 kWh/t','80 kWh/t'],[30000,50000,100000].map(o=>[fmtIN(o)+' t/yr',...[30,50,80].map(s=>'₹'+(o*s*tar/1e7).toFixed(2)+' cr')]))}<div class="note">At ₹${tar.toFixed(1)}/kWh. Energy alone — yield, alloy and reduced reblows are additional. Realised payback normally 4–12 months.</div></div>`));
  if(r.cross_check&&Object.keys(r.cross_check).length) el('main').appendChild(h(`<div class="card"><h3>Engine economics cross-check</h3>${tbl(['metric','value'],Object.entries(r.cross_check).map(([k,v])=>[k,typeof v==='number'?fmtIN(v):v]))}</div>`));
}

/* ================= HEAT LOG ================= */
function heatlogRun(){
  pageHead('🗒️ Heat log — audit trail','Every action and outcome lands here — audit trail, ML training set and shared-savings evidence in one table.');
  const bar=h(`<div class="row-actions"><button class="act" id="hl-clear">Clear</button><button class="act" id="hl-exp">Export CSV</button></div>`);
  el('main').appendChild(bar);
  el('main').appendChild(h(`<div class="card"><div style="max-height:560px;overflow:auto">${tbl(['Clock','Heat min','Event','Detail'], state.heatLog.length?state.heatLog.map(e=>[e.clock,e.sim_min,e.event,e.detail]):[['—','','(no events yet)','']])}</div></div>`));
  el('hl-clear').addEventListener('click',()=>{ state.heatLog=[]; runPage(); });
  el('hl-exp').addEventListener('click',()=>{ const csv='clock,sim_min,event,detail\n'+state.heatLog.map(e=>[e.clock,e.sim_min,e.event,'"'+(e.detail||'').replace(/"/g,'""')+'"'].join(',')).join('\n'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='smartmelt_heatlog.csv'; a.click(); });
}

/* ================= SETTINGS ================= */
function settingsRun(){
  const s=state.cfg.summary;
  pageHead('⚙️ Settings — plant & process configuration','These set the aim and economic basis used by advisory, endpoint checks and economics. Adjust, then Apply.');
  el('main').appendChild(h(`<div class="grid2"><div class="card"><h3>Edit configuration</h3>
    <div class="form-grid">
      <div><label>Tap temperature aim (°C)</label><input id="s-tap" type="number" value="${state.cfg.tap_aim}"></div>
      <div><label>Rated power (kW)</label><input id="s-rated" type="number" value="${state.cfg.rated_kW}"></div>
      <div><label>Carbon aim — min (%)</label><input id="s-clo" type="number" step="0.001" value="${state.cfg.aim_C_lo}"></div>
      <div><label>Carbon aim — max (%)</label><input id="s-chi" type="number" step="0.001" value="${state.cfg.aim_C_hi}"></div>
      <div><label>Tariff (₹/kWh)</label><input id="s-tar" type="number" step="0.1" value="${state.cfg.tariff}"></div>
      <div><label>Grid EF (tCO₂/MWh)</label><input id="s-ef" type="number" step="0.001" value="${state.cfg.grid_ef}"></div>
      <div><label>Baseline SEC (kWh/t)</label><input id="s-base" type="number" value="${state.cfg.base_sec}"></div>
    </div><button class="act primary" id="s-apply" style="width:auto">Apply settings</button></div>
    <div class="card"><h3>Active configuration — ${state.plant}</h3>${tbl(['Setting','Value'],Object.entries(s).map(([k,v])=>[k,v]))}</div></div>`));
  el('s-apply').addEventListener('click',async()=>{ setStatus('applying…','busy');
    state.cfg=await req('/api/settings',{plant:state.plant,tap_aim:+el('s-tap').value,c_lo:+el('s-clo').value,c_hi:+el('s-chi').value,rated_kW:+el('s-rated').value,tariff:+el('s-tar').value,grid_ef:+el('s-ef').value,baseline_sec:+el('s-base').value});
    logEvent('SETTINGS','operator updated plant/process settings'); state.traj=null; state.physics=null; state.valid=null; setStatus('settings applied','ok'); settingsRun(); });
}

/* ================= VALIDATION ================= */
async function validationRun(){
  const r = state.valid || (state.valid = await req('/api/heat',{plant:state.plant,charge_t:12,power_kW:5200,c_pct:0.6,cu_pct:0.20,dt:2.0,
    additions:[{material:'Lime (92% CaO)',time_min:10,mass:48},{material:'FeSi75',time_min:45,mass:15},{material:'Mill scale (FeO)',time_min:60,mass:150}]})); const s=state.cfg.summary, aim=r.tap_aim, clo=r.energy.residual_pct??0, hit=Math.abs(r.endpoint.T_C-aim)<=15;
  pageHead('✅ Validation — verified parameters & live conservation','Literature-verified constants (v0.5) plus a live mass & energy conservation test on a fresh heat.');
  el('main').appendChild(h(`<div class="card"><h3>Parameter audit — verified against the literature (v0.5)</h3>${tbl(['Quantity','In model','Literature','Source'],[
    ['Latent heat of fusion',s['L_fusion (kJ/kg)'].toFixed(0)+' kJ/kg','247','CRC Handbook 104th ed.'],
    ['(FeO)+[C]→Fe+CO','1.39 MJ/kg FeO','+100 kJ/mol CO','Turkdogan; Fruehan MSTS'],
    ['FeSi75 heat of solution','−3511 kJ/kg','−4681 kJ/kg Si','Sigworth & Elliott 1974'],
    ['Carburiser heat of solution','+1883 kJ/kg C','+22.6 kJ/mol','graphite dissolution'],
    ['Grid emission factor',state.cfg.grid_ef.toFixed(3)+' tCO₂/MWh','0.712','CEA v21.0, FY2024-25'],
    ['Reversible melting floor',r.floor.toFixed(0)+' kWh/t','practical ≈500','computed, L_f=247'],
    ['Default tariff','₹'+state.cfg.tariff.toFixed(1)+'/kWh','₹6.0–8.5 grid','HT industrial FY25-26'],
    ['Baseline SEC',state.cfg.base_sec.toFixed(0)+' kWh/t','550–650 scrap IF','field practice'],
  ])}</div>`));
  el('main').appendChild(h(`<div class="krow" style="grid-template-columns:repeat(4,1fr)">
    <div class="kpi"><div class="lab">Element ledger</div><div style="margin-top:4px"><span class="pill ${r.ledger_max_pct<1?'ok':'warn'}">${r.ledger_max_pct.toFixed(2)}% < 1%</span></div></div>
    <div class="kpi"><div class="lab">First-law</div><div style="margin-top:4px"><span class="pill ${Math.abs(clo)<5?'ok':'warn'}">${clo>=0?'+':''}${clo.toFixed(1)}%</span></div></div>
    <div class="kpi"><div class="lab">Endpoint</div><div style="margin-top:4px"><span class="pill ${hit?'ok':'warn'}">${r.endpoint.T_C.toFixed(0)}°C</span></div></div>
    <div class="kpi"><div class="lab">Undissolved</div><div style="margin-top:4px"><span class="pill ${r.undissolved_kg<5?'ok':'warn'}">${r.undissolved_kg.toFixed(0)} kg</span></div></div></div>`));
  el('main').appendChild(h(`<div class="card"><h3>Per-element mass-balance closure</h3><div id="val1" style="height:380px"></div></div>`));
  plot('val1',[{x:r.ledger.element,y:r.ledger.closure_pct.map(Math.abs),type:'bar',marker:{color:C.steel}}],{xaxis:{title:''},yaxis:{title:'|closure| %'},showlegend:false,shapes:[hline(1,C.amber)]});
}

/* ================= ABOUT ================= */
function aboutRun(){
  pageHead('🔥 SmartMelt Studio','Hybrid physics + machine-learning melt optimisation for induction, arc and basic-oxygen steelmaking. A faithful web rendering of the full operator/manager console over the validated SmartMelt engine — advisory-only.');
  el('main').appendChild(h(`<div class="card"><h3>What each tab does</h3><div class="note" style="line-height:1.7">
   <b>Operator Console</b> — start a heat, pick playback speed, inject any flux/ferro-alloy/recarburiser at the live time, watch the coloured furnace and streaming KPIs, and tap.<br>
   <b>Process Trajectory</b> — the same heat in six panels: temperatures, inventories, chemistry, slag/basicity, heat flows and energy.<br>
   <b>Physics & Energy</b> — heat-flow ledger, first-law audit and energy split from grid input to tapped steel.<br>
   <b>Virtual Sensor</b> — EKF using intermittent immersion dips to estimate bath temperature and hidden furnace efficiency.<br>
   <b>Machine Learning</b> — physics plus a gated residual ML head, with out-of-time performance vs physics alone.<br>
   <b>Drift Monitor</b> — PSI alarms when incoming scrap or practice changes.<br>
   <b>Charge-Mix</b> — 17-stream least-cost optimiser and manual charge evaluation with Cu/Sn constraints.<br>
   <b>Economics</b> — savings, payback and CO₂ using the active plant tariff and emission factor.<br>
   <b>Heat Log</b> — session audit trail and CSV export.<br>
   <b>Settings</b> — plant aims, power, tariff, grid factor and baseline SEC.<br>
   <b>Validation</b> — verified-parameter audit plus live conservation test.</div></div>
   <div class="card"><h3>The engine behind the GUI</h3><div class="logbox" style="min-height:0">physics.py    first-principles furnace model (mass, energy, kinetics, refractory)
thermo.py     Wagner activities, equilibria, theoretical energy floor
ekf.py        Extended Kalman virtual temperature sensor
ml.py         hybrid GP-residual + GBM endpoint model, drift monitor
chargemix.py  least-cost charge LP with tramp shadow prices
mpc.py        receding-horizon power / tap-time advice
advisory.py   bilingual traffic-light operator guidance
simulator.py  virtual plant for rehearsal & ML data generation
metrics.py    hit-rates, PSI, economics</div></div>
   <div class="note">Engine v${state.cfg.summary?'0.5.0':''}. Plant identities anonymised (Industry-X = MSME IF pilot, Industry-Y = integrated BOF). Figures are indicative until sized against a plant's audited baseline.</div>`));
}

/* ================= REGISTRY + INIT ================= */
const PAGES = {
  console:{ label:'Operator Console', controls:consoleControls, onCtrl(key){ if(!state.started||state.tapped) return; clearTimeout(_recomputeTimer); _recomputeTimer=setTimeout(recomputeHeat,420); }, run(){ drawConsole(); } },
  trajectory:{ label:'Process Trajectory', controls(){ sbHead('Trajectory'); caption('Shows the operator\'s heat (default schedule, or the last heat you tapped on the Console). Six-panel physics view.'); }, run:trajRun },
  physics:{ label:'Physics & Energy', controls(){ sbHead('Physics'); caption('Energy audit & heat-flow ledger for the operator\'s heat.'); }, run:physicsRun },
  ekf:{ label:'Virtual Sensor', controls(){ sbHead('Mismatched plant');
      slider('eta','True η electrical',.8,1.0,.01,.90,'prior is 1.00',x=>x.toFixed(2));
      slider('ua','True wall-loss scale',.8,1.8,.05,1.35,'prior is 1.00',x=>x.toFixed(2));
      slider('dips','Immersion dips',1,6,1,3,null,x=>x.toFixed(0));
      button('▶ Run live (~1 min)',()=>{state._ekfLive=true;runPage();},true);
      caption('Default is pre-computed and loads instantly.'); }, onCtrl(){}, run:ekfRun },
  ml:{ label:'Machine Learning', controls(){ sbHead('Model');
      slider('ml_split','Train fraction',.5,.85,.01,.70,null,x=>x.toFixed(2));
      button('Train on cached data',()=>{state._mlGen=false;runPage();});
      slider('ml_n','Live heats',20,80,1,40,null,x=>x.toFixed(0));
      button('Generate live (slow)',()=>{state._mlGen=true;runPage();},true);
      caption('Train fraction re-fits the cached dataset instantly.'); }, onCtrl(key){ if(key==='ml_split'){state._mlGen=false;scheduleRun();} }, run:mlRun },
  drift:{ label:'Drift Monitor', controls(){ sbHead('Run');
      button('Check cached data',()=>{state._driftGen=false;runPage();});
      slider('dr_n','Live heats',30,80,1,50,null,x=>x.toFixed(0));
      slider('dr_reg','Regime change at heat',15,60,1,40,null,x=>x.toFixed(0));
      button('Generate live (slow)',()=>{state._driftGen=true;runPage();},true); }, onCtrl(){}, run:driftRun },
  chargemix:{ label:'Charge-Mix', controls(){ sbHead('Targets');
      slider('target_t','Target liquid (t)',4,14,.1,12,null,x=>x.toFixed(1));
      slider('c_lo','Min C (%)',0,.5,.01,.10,null,x=>x.toFixed(2));
      slider('c_hi','Max C (%)',.1,1.0,.01,.40,null,x=>x.toFixed(2));
      slider('cu_lim','Cu ceiling (%)',.08,.5,.01,.20,null,x=>x.toFixed(2));
      slider('sn_lim','Sn ceiling (%)',.01,.10,.001,.03,null,x=>x.toFixed(3));
      caption('Optimise re-solves live. Switch to Manual (top) to enter kg per stream.'); }, run:mixRun },
  economics:{ label:'Economics', controls(){ sbHead('Inputs');
      numberIn('tpy','Annual output (t/yr)',5000,200000,40000,1000);
      slider('saving','SEC saving (kWh/t)',10,100,1,40,null,x=>x.toFixed(0));
      numberIn('licence','Licence (₹ lakh)',5,40,20,1); }, run:econRun },
  heatlog:{ label:'Heat Log', controls(){ sbHead('Audit trail'); caption('Every START, ADDITION, TAP and SETTINGS action is recorded. Export as CSV.'); }, run(){ heatlogRun(); } },
  settings:{ label:'Settings', controls(){ sbHead('Configuration'); caption('Edit plant aims and economic basis; Apply updates every tab.'); }, run(){ settingsRun(); } },
  validation:{ label:'Validation', controls(){ sbHead('Validation'); caption('Verified constants + a fresh conservation heat.'); }, run:validationRun },
  about:{ label:'About / Details', controls(){ sbHead('About'); caption('Plant identities anonymised. Advisory-only tool.'); }, run(){ aboutRun(); } },
};

function buildTabs(){ const tabs=el('tabs'); tabs.innerHTML='';
  Object.entries(PAGES).forEach(([id,pg])=>{ const b=h(`<button class="tab ${id===state.page?'active':''}" data-p="${id}">${pg.label}</button>`); b.addEventListener('click',()=>selectPage(id)); tabs.appendChild(b); }); }
function selectPage(id){ state.page=id;
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.p===id));
  renderSidebar(); el('main').innerHTML='<div class="note"><span class="spin"></span>computing…</div>'; runPage(); }
async function loadPlant(p){ state.plant=p; state.cfg=await req('/api/config?plant='+encodeURIComponent(p));
  state.heat=null; state.started=false; state.playing=false; state.tapped=false; state.schedule=[]; state.idx=0; state.heatSpec=null;
  state.traj=null; state.physics=null; state.valid=null; state.ekf=null; state.ml=null; state.drift=null;
  ['op_mat','op_mass','manual_weights','mix_mode'].forEach(k=>delete state.ctrl[k]); }
async function init(){
  try{
    state.cfg=await req('/api/config'); state.plant=state.cfg.plant;
    const sel=el('plant'); sel.innerHTML=state.cfg.plants.map(p=>`<option ${p===state.cfg.plant?'selected':''}>${p}</option>`).join('');
    sel.addEventListener('change',async()=>{ setStatus('loading plant…','busy'); await loadPlant(sel.value); renderSidebar(); runPage(); });
    buildTabs(); renderSidebar(); window.__ready=true; setStatus('ready','ok'); runPage();
  }catch(e){ console.error(e); setStatus('offline','bad'); showFatal('Backend not reachable',(e&&(e.stack||e.message))||e); }
}
init();
