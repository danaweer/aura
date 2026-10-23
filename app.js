/* aura Meeting Room Digital Twin.
   Self-contained perspective 3D renderer (canvas) with no CDN dependencies.
   Device data: real Modbus FC04 via Python -> Server-Sent Events.
*/
(() => {
'use strict';
const $ = id => document.getElementById(id);
const scene = $('scene');
const canvas = $('roomCanvas');
const ctx = canvas.getContext('2d');
const chartCanvas = $('trendCanvas');
const chart = chartCanvas.getContext('2d');
let angle = .69, elevation = .69, distance = 17.2;
let roomOn = true, tagsOn = true, viewTop = false, sceneDirty = true;
let isDragging = false, lastPointer = null, pointerOrigin = null;
let alarmOn = null, latest = null, lastOnline = false, simulation = false;
let renderStamp = 0;
const history = [], maxHistory = 60;
const fmt = (v, dec = 1) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(dec) : '—';
const val = (id, v, decimals=1) => { $(id).textContent = fmt(v, decimals) };
const pad = n => String(n).padStart(2, '0');
const clock = () => { const now = new Date(); $('clock').textContent = [now.getHours(), now.getMinutes(), now.getSeconds()].map(pad).join(':'); };
clock(); setInterval(clock, 1000);

function setConnectivity(type, text) {
  const s = $('connState');
  s.className = 'connection-status ' + type;
  $('connLabel').textContent = text;
  $('quality').className = 'reading-quality' + (type === 'online' ? ' good' : '');
  $('quality').lastChild.textContent = type === 'online' ? 'LIVE' : 'NO SIGNAL';
}
function addEvent(label, type='neutral', stamp=new Date()) {
  const el = document.createElement('div'); el.className = 'event-item';
  const tm = document.createElement('span'); tm.className='event-time'; tm.textContent = `${pad(stamp.getHours())}:${pad(stamp.getMinutes())}:${pad(stamp.getSeconds())}`;
  const dot=document.createElement('span');dot.className='event-dot '+type;
  const desc=document.createElement('span'); desc.className='event-message';desc.textContent=label;
  el.append(tm,dot,desc); const log=$('eventList');log.prepend(el);
  while(log.children.length>7)log.removeChild(log.lastChild);
}
function setAlarm(status) {
  alarmOn = status;
  const active=status === true;
  $('alarmCard').classList.toggle('active',active);
  $('markerAlarm').classList.toggle('triggered', active);
  $('alarmBadge').textContent=status===null?'UNKNOWN':(active?'ON':'OFF');
  $('alarmHeadline').textContent=status===null?'Alarm not available':(active?'DEMO alarm activated':'Normal · no demo alarm');
  $('alarmHint').textContent=active?'Button A demo state is ON. This is not a real fire detection event.':
    'Physical Button A controls the MXCHIP demo alarm register.';
  $('markerAlarmText').textContent=status===null?'—':(active?'ON':'OFF');
  sceneDirty=true;
}
function setReading(data) {
  if(!data || !data.online) return;
  latest=data;
  const e=data.environment || {}, s=data.status || {}, m=data.motion || {};
  setConnectivity('online', data.simulated ? 'SIMULATED STREAM' : 'DEVICE ONLINE');
  if(data.device) $('deviceIp').textContent=data.simulated ? 'SIMULATED DEVICE' : `${data.device.ip}:${data.device.port}`;
  val('temperature',e.temperature_c,1); val('humidity', e.humidity_pct,1); val('pressure',e.pressure_hpa,1);
  $('markerTemp').textContent=e.temperature_c == null?'—':fmt(e.temperature_c,1)+'°C';
  val('rssi',s.wifi_rssi_dbm,0);val('uptime',s.uptime_seconds_16bit,0);
  const a=m.acceleration_mg || {};val('ax',a.x,0);val('ay',a.y,0);val('az',a.z,0);
  $('humidityMeter').style.width=e.humidity_pct!=null?Math.min(100,Math.max(0,e.humidity_pct))+'%':'0%';
  $('pressureMeter').style.width=e.pressure_hpa!=null?Math.min(100,Math.max(0,(e.pressure_hpa-960)/90*100))+'%':'0%';
  $('rssiMeter').style.width=s.wifi_rssi_dbm!=null?Math.min(100,Math.max(0,(s.wifi_rssi_dbm+100)*2))+'%':'0%';
  $('uptimeMeter').style.width=s.uptime_seconds_16bit!=null?Math.min(100,(s.uptime_seconds_16bit/3600)*100)+'%':'0%';
  $('lastReading').textContent='Updated '+new Date(data.observed_at).toLocaleTimeString();
  $('sceneSync').textContent='SYNCED '+new Date(data.observed_at).toLocaleTimeString();
  $('tempTrend').textContent=data.simulated?'SIMULATED SENSOR VALUES':'FROM PHYSICAL MXCHIP';
  const nextAlarm=typeof s.alarm_on==='boolean'?s.alarm_on:null;
  setAlarm(nextAlarm);
  if(typeof e.temperature_c==='number') {
    history.push(e.temperature_c); if(history.length>maxHistory)history.shift();
    drawTrend();
  }
  if (!lastOnline){
    addEvent(data.simulated ? 'Simulated device stream connected' : 'MXCHIP connected · Modbus FC04 responding','normal');
    lastOnline=true;
  }
}
function offline(reason) {
  setConnectivity('offline','DEVICE OFFLINE');
  $('sceneSync').textContent='LAST READING · STALE';
  $('lastReading').textContent='Disconnected — last values may be stale';
  if(lastOnline){addEvent('Lost communication with MXCHIP · '+String(reason||'No response').slice(0,75),'warning');lastOnline=false;}
}
function setMode(demo) {
  simulation=!!demo;const mode=$('modeChip');mode.classList.toggle('simulated',simulation);
  mode.textContent=simulation?'SIMULATED MODE':'LIVE DEVICE';
  $('demoAlarmBtn').hidden=!simulation;
  $('sceneHelp').textContent=simulation
   ? 'SIMULATED DATA · All telemetry and demo alarm signals are generated in software. Room model is illustrative.'
   : 'This 3D room is an illustrative model. Only MXCHIP telemetry and its demo alarm are connected to the physical device.';
}
function receive(payload) {
  if(!payload)return;
  if(payload.kind==='telemetry'){ setReading(payload.data); }
  else if(payload.kind==='offline'){offline(payload.reason);}
}
// Get current state promptly, then subscribe. Browser reconnects EventSource automatically.
fetch('/api/state', {cache:'no-store'}).then(r=>r.json()).then(json=>{
  setMode(json.demo);
  if(json.message)receive(json.message);
}).catch(e=>{offline(e.message);});
const live=new EventSource('/api/events');
live.addEventListener('state', event=>{
  try{receive(JSON.parse(event.data))}catch(e){console.error('Invalid telemetry',e)}
});
live.addEventListener('alarm', event=>{
  try{
    const data=JSON.parse(event.data);
    addEvent(data.alarm_on ? 'Button A · DEMO alarm ON (register 30006)' : 'Button A · DEMO alarm OFF (register 30006)',data.alarm_on?'alarm':'normal');
  }catch(e){console.error('Invalid alarm event',e)}
});
live.onerror=()=>{if(!lastOnline)setConnectivity('offline','STREAM RECONNECTING');};
$('demoAlarmBtn').addEventListener('click',async()=>{
  if(!simulation)return;
  try { const res=await fetch('/api/demo/toggle-alarm',{method:'POST'});if(!res.ok)throw new Error('Failed'); }
  catch(e){addEvent('Failed to toggle simulated alarm','warning')}
});

// Perspective engine: lightweight 3D solids projected to Canvas2D. Fully offline.
const v=(x,y,z)=>({x,y,z});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>v(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);
const sub=(a,b)=>v(a.x-b.x,a.y-b.y,a.z-b.z);
const norm=a=>{const d=Math.hypot(a.x,a.y,a.z)||1;return v(a.x/d,a.y/d,a.z/d)};
let W=900,H=530,dpr=1, cam, forward,right,up;
function fit() {
  W=Math.max(1,scene.clientWidth); H=Math.max(1,scene.clientHeight);
  dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr);
  canvas.style.width=W+'px';canvas.style.height=H+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);sceneDirty=true;
}
function cameraSetup() {
  const target=v(0,1.03,-.18);
  cam=v(target.x+distance*Math.sin(angle)*Math.cos(elevation),target.y+distance*Math.sin(elevation),target.z+distance*Math.cos(angle)*Math.cos(elevation));
  forward=norm(sub(target,cam)); right=norm(cross(forward,v(0,1,0)));up=norm(cross(right,forward));
}
function project(p) {
  const delta=sub(p,cam),depth=dot(delta,forward);
  if(depth<.1)return null;
  const focal = Math.min(W*1.11,H*1.59);
  return {x:W/2+dot(delta,right)/depth*focal, y:H*.565-dot(delta,up)/depth*focal,depth};
}
function parseHex(h){const c=h.replace('#','');return [parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)]}
function tint(base,k){const c=parseHex(base);return `rgb(${c.map(n=>Math.min(255,Math.max(0,Math.round(n*k)))).join(',')})`}
const faces=[];
function poly(points,color,stroke='#00000000',alpha=1){
  const pts=points.map(project);if(pts.some(p=>!p))return;
  const depth=pts.reduce((s,p)=>s+p.depth,0)/pts.length;
  faces.push({points:pts,color,stroke,alpha,depth});
}
function box(x,y,z,w,h,d,color,rotation=0,alpha=1) {
  const pts=[];
  for(let i=0;i<8;i++){
    const px=(i&1?w/2:-w/2),py=(i&2?h:0),pz=(i&4?d/2:-d/2);
    pts.push(v(x+px*Math.cos(rotation)-pz*Math.sin(rotation),y+py,z+px*Math.sin(rotation)+pz*Math.cos(rotation)));
  }
  // Flat-shaded faces; painter sort across the whole scene.
  const fs=[[[0,1,3,2],.72],[[4,6,7,5],.74],[[0,2,6,4],.84],[[1,5,7,3],1.03],[[2,3,7,6],1.22],[[0,4,5,1],.68]];
  for(const [ix,k] of fs)poly(ix.map(i=>pts[i]),tint(color,k),'#0c223034',alpha);
}
function slab(x,z,w,d,color){poly([v(x-w/2,.015,z-d/2),v(x+w/2,.015,z-d/2),v(x+w/2,.015,z+d/2),v(x-w/2,.015,z+d/2)],color)}
function stool(x,z,rotation=0){
  // Conference swivel chair with five simple solids.
  box(x,.11,z,.67,.14,.64,'#31546a',rotation);
  const backOffset=v(-.28*Math.sin(rotation),0,.28*Math.cos(rotation));
  box(x+backOffset.x,.25,z+backOffset.z,.68,.88,.13,'#41677b',rotation);
  box(x,.01,z,.11,.19,.12,'#72818b');
  box(x,.02,z,.9,.045,.07,'#2c5065',rotation);
  box(x,.02,z,.07,.045,.8,'#2c5065',rotation);
}
function addSceneGeometry() {
  if(roomOn){
    slab(0,0,11.2,8.2,'#30485c');
    for(let i=-5.6;i<=5.7;i+=.8)slab(i,0,.035,8.22,'#2a4153');
    for(let i=-4.1;i<=4.2;i+=.8)slab(0,i,11.25,.03,'#2a4153');
    box(0,0,-4.13,11.3,3.72,.12,'#35546a');
    box(-5.67,0,0,.12,3.72,8.18,'#2e485f');
    // accent wall, linear architectural details
    box(0,0,-4.04,10.9,.12,.07,'#5b8791');
    box(0,3.38,-4.05,11.15,.045,.08,'#71919e');
    box(-5.59,3.35,0,.08,.05,8.1,'#587489');
    // back wall acoustic panels
    for(let x=-5.05;x<=4.6;x+=.65)box(x,.3,-4.018,.51,2.8,.045,Math.abs(x)<2?'#35586c':'#3e6471');
    // wall mounted meeting screen (decorative)
    box(.55,1.15,-3.93,3.25,1.67,.10,'#0b1825');
    box(.55,1.25,-3.82,3.03,1.45,.032,'#1b4254');
    box(.55,1.62,-3.785,2.56,.018,.015,'#4b918f');
    box(.55,1.42,-3.784,1.89,.013,.018,'#4b918f');
    // presentation shelf
    box(.55,.62,-3.77,2.2,.10,.31,'#284558');
    // windows left and back, using blue 'glazing'
    box(3.92,1.20,-3.975,2.16,1.66,.06,'#142d3e');
    box(3.92,1.32,-3.926,1.89,1.38,.02,'#5c97aa');
    box(3.92,1.32,-3.899,.035,1.38,.013,'#c1d6e1');
    box(3.92,2.02,-3.892,1.90,.03,.018,'#c1d6e1');
    // left wall door
    box(-5.51,.02,2.36,.095,2.75,1.34,'#153145');
    box(-5.42,.17,2.34,.045,2.37,1.08,'#507383');
    box(-5.36,1.25,2.78,.065,.09,.13,'#d7c294');
    // alarm beacon / FACP model near left wall
    box(-5.32,1.28,1.05,.17,.63,.49,'#b04455');
    box(-5.17,1.51,1.05,.08,.24,.34,'#482b38');
    // floating sensors / ceiling fixtures
    box(-.3,3.27,-.5,.56,.10,.56,'#dee1d1'); // detector model
    box(2.75,3.38,.2,1.6,.095,.56,'#607d8b'); // HVAC grille
    for(let n=0;n<5;n++)box(2.1+n*.26,3.47,.2,.05,.018,.47,'#243f53');
  }
  // table shadows and base
  slab(0,.29,5.25,2.45,'#1a3243');
  box(0,.42,.25,4.78,.20,1.88,'#aa8970');
  box(0,.29,.25,4.42,.15,1.65,'#6c5c53');
  for(const x of [-1.68,1.68])for(const z of [-.37,.9])box(x,.06,z,.18,.32,.19,'#6c8187');
  // desk meeting items
  box(-.92,.64,.15,.57,.025,.38,'#1b3647');
  box(-.93,.66,.15,.50,.012,.32,'#537f8e');
  box(1.34,.64,.65,.45,.02,.32,'#d9ccb1');
  box(1.34,.665,.65,.34,.004,.18,'#a4c2c9');
  // onboard MXCHIP node represented by cyan board on the table
  box(.38,.67,.2,.39,.10,.25,'#25696e');
  box(.38,.78,.2,.22,.02,.15,'#74d3bd');
  box(.38,.815,.2,.04,.015,.06,alarmOn?'#ff475b':'#58edc7');
  // chairs with orientations angled toward the table
  for(let x of [-1.55,0,1.55]){stool(x,-1.41,Math.PI);stool(x,1.94,0)}
  stool(-3.03,.26,-Math.PI/2);stool(3.04,.26,Math.PI/2);
  // credenza at right
  box(4.15,.08,1.5,1.23,.69,1.5,'#546676');
  box(4.15,.80,1.5,1.34,.08,1.6,'#81949b');
  // greenery on right rear
  box(4.42,.14,-2.34,.46,.45,.46,'#847c68');
  box(4.42,.58,-2.34,.30,.49,.30,'#39756b');
  box(4.15,.79,-2.34,.43,.13,.24,'#4c887a');
  box(4.69,.91,-2.34,.43,.13,.24,'#4e867a');
  // alarm status beacon; purely visual cue, based on input register
  box(-4.63,2.72,1.05,.34,.29,.34,alarmOn?'#ff3f60':'#608ca0');
  box(-4.63,2.99,1.05,.24,.05,.24,alarmOn?'#ffe09c':'#9eabb4');
  if(alarmOn===true){
    for(let a=0;a<3;a++){
      const spread=a*.21;
      slab(-4.6,1.05,1.0+spread,1.0+spread,a%2?'#833c4c':'#653548');
    }
  }
}
function drawBackground() {
  ctx.clearRect(0,0,W,H);
  // subtle technical coordinate grid for the stage
  ctx.save();ctx.strokeStyle='#33566b27';ctx.lineWidth=.7;
  for(let i=0;i<=W;i+=33){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,H);ctx.stroke()}
  for(let i=0;i<=H;i+=33){ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(W,i);ctx.stroke()}
  ctx.restore();
  const gx=ctx.createRadialGradient(W*.47,H*.64,60,W*.46,H*.56,W*.67);
  gx.addColorStop(0,'#40627316');gx.addColorStop(1,'#05131b00');ctx.fillStyle=gx;ctx.fillRect(0,0,W,H);
}
const markerPositions={mxchip:v(.38,1.05,.2),alarm:v(-4.63,3.13,1.05),hvac:v(2.75,3.58,.2)};
function placeMarkers(){
  const targets={mxchip:'markerSensor',alarm:'markerAlarm',hvac:'markerHVAC'};
  Object.entries(targets).forEach(([key,id])=>{
    const item=$(id),p=project(markerPositions[key]);
    const visible=!!p && p.x>-65 && p.x<W+10 && p.y>0 && p.y<H && tagsOn;
    item.hidden=!visible;
    if(visible){item.style.left=p.x+'px';item.style.top=p.y+'px'}
  });
}
function draw3D(){
  cameraSetup();drawBackground();faces.length=0;addSceneGeometry();
  faces.sort((a,b)=>b.depth-a.depth);
  for(const face of faces){
    const pts=face.points;
    ctx.globalAlpha=face.alpha;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);
    ctx.closePath();ctx.fillStyle=face.color;ctx.fill();
    ctx.strokeStyle=face.stroke;ctx.lineWidth=.65;ctx.stroke();
  }
  ctx.globalAlpha=1;
  // ceiling detector ring and light guidance, drawn as upper layer
  placeMarkers();
  sceneDirty=false;
}
function animate(time){
  if(sceneDirty || (alarmOn===true && time-renderStamp>520)){
    renderStamp=time;
    draw3D();
  }
  requestAnimationFrame(animate);
}
function orbit(dx,dy){
  if(viewTop)viewTop=false;
  angle=Math.max(-.2,Math.min(1.55,angle+dx*.007));
  elevation=Math.max(.26,Math.min(1.5,elevation+dy*.0055));
  syncViewButtons();sceneDirty=true;
}
function syncViewButtons(){
  $('isoBtn').classList.toggle('active',!viewTop);$('topBtn').classList.toggle('active',viewTop);
}
canvas.addEventListener('pointerdown', e=>{
  canvas.setPointerCapture(e.pointerId);isDragging=true;
  lastPointer={x:e.clientX,y:e.clientY};pointerOrigin={x:e.clientX,y:e.clientY};
});
canvas.addEventListener('pointermove',e=>{
  if(!isDragging||!lastPointer)return;
  const dx=e.clientX-lastPointer.x,dy=e.clientY-lastPointer.y;
  orbit(dx,dy);lastPointer={x:e.clientX,y:e.clientY};
});
canvas.addEventListener('pointerup',()=>{isDragging=false;lastPointer=null});
canvas.addEventListener('pointercancel',()=>{isDragging=false;lastPointer=null});
scene.addEventListener('wheel',e=>{e.preventDefault();distance=Math.max(10,Math.min(25,distance+Math.sign(e.deltaY)*.75));sceneDirty=true},{passive:false});
$('zoomIn').onclick=()=>{distance=Math.max(10,distance-1.2);sceneDirty=true};
$('zoomOut').onclick=()=>{distance=Math.min(25,distance+1.2);sceneDirty=true};
$('isoBtn').onclick=()=>{viewTop=false;angle=.69;elevation=.69;distance=17.2;syncViewButtons();sceneDirty=true};
$('topBtn').onclick=()=>{viewTop=true;angle=.15;elevation=1.48;distance=18.2;syncViewButtons();sceneDirty=true};
$('resetView').onclick=()=>$('isoBtn').click();
$('toggleHotspots').addEventListener('change',e=>{tagsOn=e.target.checked;sceneDirty=true});
$('toggleRoom').addEventListener('change',e=>{roomOn=e.target.checked;sceneDirty=true});
function inspect(key){
  const description={mxchip:['MXCHIP AZ3166','Environmental / motion sensor · LIVE SOURCE'],alarm:['Demo fire alarm','Modeled fire panel · physical demo alarm input'],hvac:['HVAC diffuser','Decorative model — no HVAC telemetry connected']};
  const [name,desc]=description[key]||description.mxchip;
  $('assetTitle').textContent=name;$('assetDesc').textContent=desc;
  if(key==='alarm')$('alarmCard').scrollIntoView({behavior:'smooth',block:'nearest'});
  else if(key==='mxchip')$('temperature').scrollIntoView({behavior:'smooth',block:'nearest'});
}
for(const item of document.querySelectorAll('[data-asset]')){
  item.addEventListener('click',()=>inspect(item.dataset.asset));
  item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect(item.dataset.asset)}});
}
$('navSensors').onclick=()=>inspect('mxchip');$('navAlarm').onclick=()=>inspect('alarm');
const dlg=$('helpDialog');$('helpBtn').onclick=()=>dlg.showModal();$('closeHelp').onclick=()=>dlg.close();
function drawTrend() {
  let width=Math.max(5,chartCanvas.clientWidth),height=Math.max(20,chartCanvas.clientHeight);
  const dpi=Math.min(window.devicePixelRatio||1,2);
  chartCanvas.width=Math.round(width*dpi);chartCanvas.height=Math.round(height*dpi);
  chart.setTransform(dpi,0,0,dpi,0,0);chart.clearRect(0,0,width,height);
  chart.strokeStyle='#344e6155';chart.lineWidth=1;
  for(let i=1;i<4;i++){const y=height*i/4;chart.beginPath();chart.moveTo(0,y);chart.lineTo(width,y);chart.stroke()}
  if(history.length===0){$('chartRange').textContent='Waiting for samples';return;}
  const lo=Math.min(...history),hi=Math.max(...history),pad=Math.max((hi-lo)*.6,.6),min=lo-pad,max=hi+pad;
  $('chartRange').textContent=`${lo.toFixed(1)} — ${hi.toFixed(1)} °C`;
  const pts=history.map((value,i)=>({x:8+i*(width-16)/Math.max(1,history.length-1),y:height-10-(value-min)/(max-min)*(height-22)}));
  chart.beginPath();pts.forEach((p,i)=>i===0?chart.moveTo(p.x,p.y):chart.lineTo(p.x,p.y));
  chart.lineTo(pts.at(-1).x,height);chart.lineTo(pts[0].x,height);chart.closePath();
  const gradient=chart.createLinearGradient(0,0,0,height);gradient.addColorStop(0,'#36e1c536');gradient.addColorStop(1,'#36e1c500');chart.fillStyle=gradient;chart.fill();
  chart.beginPath();pts.forEach((p,i)=>i===0?chart.moveTo(p.x,p.y):chart.lineTo(p.x,p.y));
  chart.strokeStyle='#56e6d3';chart.lineWidth=2.25;chart.stroke();
  const p=pts.at(-1);chart.beginPath();chart.arc(p.x,p.y,3.5,0,Math.PI*2);chart.fillStyle='#81fff0';chart.fill();
}
new ResizeObserver(()=>{fit();drawTrend()}).observe(scene);
fit();requestAnimationFrame(animate);drawTrend();
})();
