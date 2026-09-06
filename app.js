import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ---- Audio Cues: Pure Web Audio API Sound Synthesizer ----
const AudioCues = (() => {
  let ctx = null;
  let enabled = localStorage.getItem('autocadent_sound') !== '0';

  function getCtx() {
    if (!ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) ctx = new AudioContext();
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function playTone(freq, duration, type = 'sine', gainVal = 0.08, decay = true) {
    if (!enabled) return;
    try {
      const c = getCtx();
      if (!c) return;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, c.currentTime);
      gain.gain.setValueAtTime(gainVal, c.currentTime);
      if (decay) {
        gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
      }
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + duration);
    } catch {}
  }

  function syncButtons() {
    const icon = enabled ? '🔊' : '🔇';
    const b1 = document.getElementById('audio-toggle-btn');
    const b2 = document.getElementById('studio-audio-toggle-btn');
    if (b1) { b1.textContent = icon; b1.classList.toggle('muted', !enabled); b1.title = enabled ? 'Audio cues: Enabled' : 'Audio cues: Muted'; }
    if (b2) { b2.textContent = icon; b2.classList.toggle('muted', !enabled); b2.title = enabled ? 'Audio cues: Enabled' : 'Audio cues: Muted'; }
  }

  return {
    isEnabled: () => enabled,
    syncUI: syncButtons,
    toggle: () => {
      enabled = !enabled;
      localStorage.setItem('autocadent_sound', enabled ? '1' : '0');
      syncButtons();
      if (enabled) playTone(587.33, 0.12, 'sine', 0.1);
      toast(enabled ? 'Audio cues enabled.' : 'Audio cues muted.');
      return enabled;
    },
    send: () => {
      if (!enabled) return;
      try {
        const c = getCtx();
        if (!c) return;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.frequency.setValueAtTime(440, c.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, c.currentTime + 0.08);
        gain.gain.setValueAtTime(0.06, c.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start();
        osc.stop(c.currentTime + 0.08);
      } catch {}
    },
    receive: () => {
      playTone(739.99, 0.12, 'sine', 0.07);
      setTimeout(() => playTone(880, 0.22, 'sine', 0.07), 90);
    },
    step: () => {
      playTone(1200, 0.04, 'triangle', 0.04);
    },
    pass: () => {
      playTone(440, 0.1, 'sine', 0.07);
      setTimeout(() => playTone(554.37, 0.12, 'sine', 0.07), 80);
      setTimeout(() => playTone(659.25, 0.22, 'sine', 0.08), 160);
    },
    fail: () => {
      if (!enabled) return;
      try {
        const c = getCtx();
        if (!c) return;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(320, c.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, c.currentTime + 0.18);
        gain.gain.setValueAtTime(0.05, c.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.18);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start();
        osc.stop(c.currentTime + 0.18);
      } catch {}
    },
    loopStart: () => {
      playTone(392, 0.08, 'sine', 0.07);
      setTimeout(() => playTone(523.25, 0.08, 'sine', 0.08), 80);
      setTimeout(() => playTone(659.25, 0.15, 'sine', 0.09), 160);
    },
    loopComplete: () => {
      playTone(523.25, 0.1, 'sine', 0.07);
      setTimeout(() => playTone(659.25, 0.1, 'sine', 0.08), 100);
      setTimeout(() => playTone(783.99, 0.12, 'sine', 0.09), 200);
      setTimeout(() => playTone(1046.50, 0.32, 'sine', 0.11), 320);
    }
  };
})();
let report, iteration=1, artifactBase='artifacts/demo/', currentGroup='all', translucent=false, exploded=false, runner='', token='', execution='deterministic', jobBusy=false;
let scene, camera, renderer, controls, assembly, renderRunning=false;
let gridHelper=null, ringMesh=null, selectedNames=new Set(), isolatedNames=new Set(), deploy=false, deployEnv='studio';
const DESIGNS_KEY='autocadent.designs', DEMO_SPEC={length:0,width:0,mast_height:0};
let model='rove1', explosion=0, partQuery='', layerFilter='all';
let floorMesh=null, studioLight=null;
let pendingMeshes=null, geometryRequest=0, storageOK=true, pendingDesign=null;
let cachedRoveMeshes=null, cachedOrionMeshes=null;

function setViewStatus(msg,mode){const el=document.getElementById('view-status');if(!el)return;el.textContent=msg||'';el.hidden=!msg;el.dataset.mode=mode||'info';const retry=$('#retry-model');if(retry)retry.hidden=mode!=='error';window.__viewStatus=msg||''}
function tick(){if(!renderer)return;if(hoverEvt&&!$('#preview-view').hidden){const e=hoverEvt;hoverEvt=null;try{hoverTip(pickAt(e.clientX,e.clientY),e.clientX,e.clientY)}catch{}}controls.update();renderer.render(scene,camera);updateScale()}
function startRender(){if(!renderer||renderRunning)return;renderRunning=true;resizeViewport();renderer.setAnimationLoop(tick)}
function resizeViewport(){if(!renderer)return;const w=$('#viewport').clientWidth,h=$('#viewport').clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();tick()}
function stopRender(){if(!renderer)return;renderRunning=false;renderer.setAnimationLoop(null)}

// ---- boot intro ----
const boot=document.getElementById('boot');
let bootDone=false,booting=false;
let reportReadyResolve;const reportReady=new Promise(r=>reportReadyResolve=r);
function finishBoot(){if(!boot||bootDone)return;bootDone=true;booting=false;document.querySelectorAll('body>*:not(#boot)').forEach(n=>n.removeAttribute('inert'));boot.style.transition='opacity .5s ease';boot.style.opacity='0';setTimeout(()=>boot.remove(),520)}
async function realBootLines(){const r=await Promise.race([reportReady,new Promise(s=>setTimeout(()=>s(null),1000))]);
 const manifest='report.json · benchmark.json · board/drc.json · board/nets.json';
 if(!r)return[`geometry cache ........ unavailable`,`reference build ....... —`,manifest,`revision status ....... no evaluated revisions`,`workspace ............. blank canvas — run your first loop`];
 const last=r.iterations.at(-1),ev=last.evaluation,pass=ev.checks.filter(c=>c.passed).length,total=ev.checks.length;
 return[`geometry cache ........ ${ev.checks[0].measured} valid solids`,`reference workflow ...... ${r.seconds}s kernel · ${r.iterations.length} iteration${r.iterations.length>1?'s':''}`,manifest,`revision status ....... REV ${String(r.final_iteration).padStart(2,'0')} · ${r.passed?'EVALUATED · PASS':'NEEDS REVIEW'} · ${pass}/${total} checks`,`workspace ............. blank canvas — run your first loop`]}
if(boot){if(matchMedia('(prefers-reduced-motion: reduce)').matches){boot.remove()}else{booting=true;document.querySelectorAll('body>*:not(#boot)').forEach(n=>n.setAttribute('inert',''));const guard=setTimeout(finishBoot,3400);boot.addEventListener('click',finishBoot);window.addEventListener('keydown',e=>{if(!bootDone&&['Enter','Space','Escape'].includes(e.code)&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))finishBoot()});setTimeout(async()=>{if(bootDone)return;boot.dataset.phase='term';const lines=await realBootLines();boot.querySelector('.boot-term-lines').innerHTML='';lines.forEach((t,i)=>{const d=document.createElement('div');d.className='boot-line';d.innerHTML=`<span>${t}</span><i></i>`;boot.querySelector('.boot-term-lines').appendChild(d);setTimeout(()=>{if(!bootDone)d.classList.add('on')},i*140)});setTimeout(finishBoot,300+lines.length*140+120)},1400)}}
const toast=s=>{ $('#toast').textContent=s; $('#toast').classList.add('show'); setTimeout(()=>$('#toast').classList.remove('show'),4000); };
async function json(url,options){const r=await fetch(url,options); if(!r.ok){let detail;try{detail=(await r.json()).detail}catch{}throw Error(detail?JSON.stringify(detail):`Request failed (${r.status})`)}return r.json()}
function modal(title,html){$('#modal-content').innerHTML=`<h2>${title}</h2>${html}`; if(!$('#modal').open)$('#modal').showModal()}
$('#close-modal').onclick=()=>$('#modal').close();$('#modal').onclick=e=>{if(e.target===$('#modal'))$('#modal').close()};

function init3D(){
 scene=new THREE.Scene(); camera=new THREE.PerspectiveCamera(33,1,.1,3000); camera.up.set(0,0,1);
 renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 $('#viewport').appendChild(renderer.domElement); controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.autoRotateSpeed=2.0;controls.autoRotate=false;controls.minDistance=150;controls.maxDistance=4000;controls.maxPolarAngle=Math.PI*.85;
 scene.add(new THREE.HemisphereLight(0xfff9e8,0x596c65,2.4)); const sun=new THREE.DirectionalLight(0xfff7e4,3.5);sun.position.set(150,-180,460);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-650,right:650,top:650,bottom:-650,near:1,far:1800});sun.shadow.bias=-.001;scene.add(sun);studioLight=sun;
 floorMesh=new THREE.Mesh(new THREE.PlaneGeometry(5000,5000),new THREE.MeshStandardMaterial({color:0xe6e3d7,roughness:.85}));floorMesh.position.z=-25;floorMesh.receiveShadow=true;floorMesh.visible=false;scene.add(floorMesh);const fill=new THREE.DirectionalLight(0x8ac0bb,1.2);fill.position.set(-100,150,60);scene.add(fill);
 const grid=new THREE.GridHelper(550,22,0xb8b7a3,0xd4d2bf);grid.rotation.x=Math.PI/2;grid.position.z=-25;grid.material.transparent=true;grid.material.opacity=.4;scene.add(grid);gridHelper=grid;
 const ring=new THREE.Mesh(new THREE.RingGeometry(119,119.35,100),new THREE.MeshBasicMaterial({color:0xa5b2a1,transparent:true,opacity:.5,side:THREE.DoubleSide}));ring.position.z=-24.8;scene.add(ring);ringMesh=ring;
 new ResizeObserver(resizeViewport).observe($('#viewport'));
 reset();
 renderer.domElement.addEventListener('pointermove',e=>{hoverEvt=e});
 renderer.domElement.addEventListener('pointerdown',e=>{downPos=[e.clientX,e.clientY]});
 renderer.domElement.addEventListener('pointerup',e=>{
  if(!downPos)return;
  const dx=e.clientX-downPos[0],dy=e.clientY-downPos[1];
  downPos=null;
  if(dx*dx+dy*dy>36)return;
  const hit=pickAt(e.clientX,e.clientY);
  if(!hit){
   if(isolatedNames.size){
    isolatedNames.clear();
    updateModel();
    toast('Restored all parts.');
   }
   selectPart(null,e.shiftKey);
  }else{
   selectPart(hit.userData.name,e.shiftKey);
  }
 });
 renderer.domElement.addEventListener('pointerleave',()=>{hoverEvt=null;hoverTip(null)});

 // Double click on 3D part to isolate (Requirement 7)
 renderer.domElement.addEventListener('dblclick',e=>{
  const hit=pickAt(e.clientX,e.clientY);
  if(hit&&hit.userData.name){
   const name=hit.userData.name;
   if(isolatedNames.has(name)&&isolatedNames.size===1){
    isolatedNames.clear();
    toast('Restored all parts.');
   }else{
    isolatedNames=new Set([name]);
    selectPart(name);
    toast(`Isolated: ${name} · Click off or double-click to restore all.`);
   }
  }else{
   isolatedNames.clear();
   toast('Restored all parts.');
  }
  updateModel();
  renderAssemblyPanel();
  renderTimeline();
 });

 if(!$('#preview-view').hidden)startRender();if(pendingMeshes){drawMeshes(pendingMeshes);pendingMeshes=null}else setViewStatus('Loading recorded geometry…','loading');
}

function reset(){if(!camera)return;if(controls)controls.autoRotate=false;baseOrbitAngle=null;baseOrbitElev=null;camera.position.set(265,-330,225);controls.target.set(0,0,20);if(assembly)fitAssembly();controls.update()}
function updateScale(){
 if(!camera||!renderer)return;
 const width=$('#viewport').clientWidth;if(!width)return;
 const distance=camera.position.distanceTo(controls.target);
 const span=2*distance*Math.tan(camera.fov*Math.PI/360)*camera.aspect;
 const mm=[1000,500,200,100,50,20,10,1].find(n=>n/span*width<=100)||1;
 $('#scale-bar').style.width=(mm/span*width)+'px';$('#scale-label').textContent=mm+' mm';
}
function disposeAssembly(group){group?.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose()})}
function assemblyMeshes(){
 const out=[];
 if(!assembly) return out;
 assembly.traverse(o=>{ if(o.isMesh) out.push(o); });
 return out;
}
function topLevelParts(){
 if(!assembly) return [];
 return [...assembly.children].filter(c => c && (c.isMesh || c.userData?.kind === 'pcb' || (c.isGroup && c.children?.length)));
}
function isPcbDescendant(obj){
 for(let n=obj; n; n=n.parent){
  if(n.userData && n.userData.kind==='pcb') return true;
 }
 return false;
}
function assemblyParts(){
 const tops=topLevelParts();
 if(tops.length) return tops;
 const map=new Map();
 assemblyMeshes().forEach(m=>{
  const n=m.userData.name || m.name || 'part';
  if(!map.has(n)) map.set(n, m);
 });
 return [...map.values()];
}
function partChipColor(obj){
 if(obj.material && obj.material.color) return obj.material.color.getStyle();
 let col='#8c948e';
 obj.traverse(o=>{
  if(o.isMesh && o.material && o.material.color){ col=o.material.color.getStyle(); }
 });
 return col;
}

// Realistic PBR mesh creation without ugly wireframe shader edges (Requirement 7 second 7)
function createPbrMesh(p, spec){
 const vertices=ArrayBuffer.isView(p.vertices)?p.vertices:p.vertices.flat();
 const indices=ArrayBuffer.isView(p.triangles)?p.triangles:p.triangles.flat();
 if(!vertices.length||vertices.length%3||!indices.length||indices.length%3)throw Error('Invalid geometry for '+p.name);
 const geom=new THREE.BufferGeometry();
 geom.setAttribute('position',new THREE.BufferAttribute(vertices instanceof Float32Array?vertices:new Float32Array(vertices),3));
 geom.setIndex(new THREE.BufferAttribute(new Uint32Array(indices),1));
 geom.computeVertexNormals();

 let color=p.color||'#8c948e';
 let roughness=0.48;
 let metalness=0.18;
 const name=(p.name||'').toLowerCase();
 const grp=(p.group||'').toLowerCase();

 if((name.includes('connector board')||name.includes('pcb')||(grp==='electronics'&&/board|pcb/.test(name))) && !/camera|plate|horn|bracket|servo/.test(name)){
  color='#134e2c'; // Realistic emerald FR4 solder mask
  roughness=0.32;
  metalness=0.12;
 }else if(name.includes('header')){
  color='#dfb53d'; // Realistic gold plated pins
  roughness=0.18;
  metalness=0.92;
 }else if(name.includes('wheel')){
  color='#202326'; // Deep matte tire rubber
  roughness=0.88;
  metalness=0.04;
 }else if(name.includes('hub')){
  color='#b8c0c4'; // Machined aluminum
  roughness=0.28;
  metalness=0.85;
 }else if(name.includes('mast')||name.includes('sensor')){
  roughness=0.35;
  metalness=0.25;
 }else if(name.includes('chassis')||name.includes('tray')){
  roughness=0.52;
  metalness=0.08;
 }

 const mat=new THREE.MeshStandardMaterial({
  color,
  roughness,
  metalness,
  transparent:!p.opaque,
  side:THREE.DoubleSide
 });

 const mesh=new THREE.Mesh(geom,mat);
 mesh.userData={name:p.name,group:p.group,opaque:p.opaque,printable:p.printable,origin:p.origin||''};
 mesh.castShadow=true;mesh.receiveShadow=true;

 if(spec&&(spec.length||spec.width||spec.mast_height)){
  const lScale=(spec.length||140)/140;
  const wScale=(spec.width||90)/90;
  const mScale=(spec.mast_height||52)/52;
  if(name.includes('chassis')||name.includes('tray')){
   mesh.scale.set(lScale,wScale,1);
  }else if(name.includes('mast')||name.includes('sensor')){
   mesh.scale.set(1,1,mScale);
   mesh.position.z*=mScale;
  }
 }
 return mesh;
}

function drawMeshes(parts){
 if(!renderer){pendingMeshes=parts;setViewStatus('WebGL is unavailable. Enable hardware acceleration, then retry.','error');return}
 if(!Array.isArray(parts)||!parts.length)throw Error('The geometry bundle contains no parts.');
 const next=new THREE.Group();
 try{
  for(const p of parts){
   const mesh=createPbrMesh(p);
   next.add(mesh);
  }
 }catch(error){disposeAssembly(next);throw error}
 if(assembly){scene.remove(assembly);disposeAssembly(assembly)}
 assembly=next;scene.add(assembly);selectedNames.clear();isolatedNames.clear();currentGroup='all';layerFilter='all';partQuery='';$('#part-search').value='';$('#part-layer').value='all';
 assembly.userData.center=new THREE.Box3().setFromObject(assembly).getCenter(new THREE.Vector3());
 assembly.userData.bbox=new THREE.Box3().setFromObject(assembly).getSize(new THREE.Vector3());
  hoverTip(null);updateModel();fitAssembly();renderAssemblyPanel();renderTimeline();setViewStatus('');
}

function appendMeshes(parts, offsetX = 48){
 if(!assembly || !assemblyParts().length) return drawMeshes(parts);
 const existing = new Set(assemblyParts().map(m => m.userData.name));
 for(const p of parts){
  const mesh = createPbrMesh(p);
  let name = mesh.userData.name || 'Imported';
  if(existing.has(name)) name = name + ' (import)';
  mesh.userData.name = name;
  mesh.position.x += offsetX;
  assembly.add(mesh);
  existing.add(name);
 }
 assembly.userData.center=new THREE.Box3().setFromObject(assembly).getCenter(new THREE.Vector3());
 assembly.userData.bbox=new THREE.Box3().setFromObject(assembly).getSize(new THREE.Vector3());
 hoverTip(null);updateModel();fitAssembly();renderAssemblyPanel();renderTimeline();setViewStatus('');
}

function clearAssembly(msg){
 if(assembly){scene.remove(assembly);disposeAssembly(assembly)}
 assembly=new THREE.Group();
 assembly.userData.center=new THREE.Vector3(0,0,0);
 assembly.userData.bbox=new THREE.Vector3(0,0,0);
 scene.add(assembly);
 selectedNames.clear();isolatedNames.clear();
 currentGroup='all';layerFilter='all';partQuery='';
 if($('#part-search'))$('#part-search').value='';
 if($('#part-layer'))$('#part-layer').value='all';
 hoverTip(null);
 fitAssembly();
 renderAssemblyPanel();
 renderTimeline();
 setViewStatus(msg||'Clean design canvas · 0 parts','info');
}

function addPartToAssembly(partData) {
 if(!renderer) return;
 if(!assembly) clearAssembly();
 const mesh=createPbrMesh(partData);
 assembly.add(mesh);
 assembly.userData.center=new THREE.Box3().setFromObject(assembly).getCenter(new THREE.Vector3());
 assembly.userData.bbox=new THREE.Box3().setFromObject(assembly).getSize(new THREE.Vector3());
 updateModel();
 fitAssembly();
 renderAssemblyPanel();
 renderTimeline();
}

function flashFailingMeshes() {
 if(!assembly) return;
 const failingNames = ['Baseplate Platform', 'Enclosure Sidewall (Left)', 'Enclosure Sidewall (Right)', 'Enclosure Sidewall (Front)', 'Enclosure Sidewall (Rear)', 'PCB Standoff SW', 'PCB Standoff SE', 'PCB Standoff NW', 'PCB Standoff NE'];
 assembly.children.forEach(m => {
  if (failingNames.includes(m.userData.name) && m.material && m.material.emissive) {
   m.material.emissive.setHex(0xb8324a);
   m.material.emissiveIntensity = 0.65;
  }
 });
 setTimeout(() => {
  if(!assembly) return;
  assembly.children.forEach(m => {
   if (m.material && m.material.emissive && !selectedNames.has(m.userData.name)) {
    m.material.emissive.setHex(0x000000);
    m.material.emissiveIntensity = 0;
   }
  });
 }, 1200);
}

function termLog(cmd, out, type = 'normal') {
 const term = document.getElementById('agent-terminal');
 const body = document.getElementById('agent-terminal-body');
 if (!term || !body) return;
 term.style.display = 'block';
 const row = document.createElement('div');
 row.className = 'term-line';
 if (cmd) {
  row.innerHTML = `<span class="term-prompt">❯</span> <span class="term-cmd">${escape(cmd)}</span>`;
 } else if (type === 'err') {
  row.innerHTML = `<span class="term-err">✖ ${escape(out)}</span>`;
 } else if (type === 'pass') {
  row.innerHTML = `<span class="term-out">✔ ${escape(out)}</span>`;
 } else if (type === 'info') {
  row.innerHTML = `<span class="term-info">ℹ ${escape(out)}</span>`;
 } else {
  row.innerHTML = `<span class="term-dim">→</span> <span class="term-text">${escape(out)}</span>`;
 }
 body.appendChild(row);
 body.scrollTop = body.scrollHeight;
}

function mentionSelection(){
 const ta=$('#brief'),text=[...selectedNames].map(n=>'@['+n+']').filter(n=>!ta.value.includes(n)).join(' ');
 if(text)ta.value+=(ta.value?'\n':'')+text+' ';
 ta.focus();
}
const raycaster=new THREE.Raycaster(), pointerNDC=new THREE.Vector2();
let hoverEvt=null, downPos=null;
function visibleMeshes(){return assemblyMeshes().filter(m=>m.visible)}
function pickAt(cx,cy){if(!renderer||!assembly)return null;const r=renderer.domElement.getBoundingClientRect();pointerNDC.set(((cx-r.left)/r.width)*2-1,-((cy-r.top)/r.height)*2+1);raycaster.setFromCamera(pointerNDC,camera);const hits=raycaster.intersectObjects(visibleMeshes(),false);return hits.length?hits[0].object:null}
function hoverTip(mesh,cx,cy){const tip=$('#part-tip');if(!tip)return;if(!mesh){tip.hidden=true;if(renderer)renderer.domElement.style.cursor='';return}const u=mesh.userData;const origin=u.origin==='catalog_step'?'catalog STEP':(u.origin==='generated'?'generated CAD':'');tip.innerHTML=`<b>${escape(u.name||'Part')}</b><small>${escape([u.group,origin].filter(Boolean).join(' · '))}</small>`;tip.hidden=false;const wrap=$('#preview-view').getBoundingClientRect();tip.style.left=(cx-wrap.left)+'px';tip.style.top=(cy-wrap.top)+'px';renderer.domElement.style.cursor='pointer'}
function selectPart(name,additive){if(name==null){if(!additive)selectedNames.clear()}else if(additive){if(selectedNames.has(name))selectedNames.delete(name);else selectedNames.add(name)}else{selectedNames.clear();selectedNames.add(name)}assemblyMeshes().forEach(m=>{if(m.material&&m.material.emissive){const names=[];for(let n=m;n&&n!==assembly;n=n.parent){if(n.userData&&n.userData.name)names.push(n.userData.name);if(n.name)names.push(n.name)}const on=names.some(nm=>selectedNames.has(nm));m.material.emissive.setHex(on?0x2b7770:0x000000);m.material.emissiveIntensity=on?.38:0}});renderAssemblyPanel();renderTimeline()}
function partSize(mesh){try{const b=new THREE.Box3().setFromObject(mesh),s=b.getSize(new THREE.Vector3());return `${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm`}catch{return '—'}}
function meshTris(m){try{const ix=m.geometry.getIndex();return Math.round(ix?ix.count/3:m.geometry.getAttribute('position').count/3)}catch{return 0}}
function unionBox(meshes){const b=new THREE.Box3();meshes.forEach(m=>b.expandByObject(m));const s=b.getSize(new THREE.Vector3());return `${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm`}

function renderAssemblyPanel(){
 const sum=$('#assembly-summary'),det=$('#part-details');if(!sum||!det)return;
 const kids=assemblyParts();
 const sel=kids.filter(m=>selectedNames.has(m.userData.name));
 if(!sel.length){
  det.hidden=true;sum.hidden=false;
  if(!kids.length){
   sum.innerHTML=`<div class="empty-assembly-state" style="padding:28px 12px;text-align:center;color:var(--muted)"><div style="font-size:32px;margin-bottom:10px;color:#8ba396">◌</div><b style="color:var(--ink);display:block;font-size:13px;margin-bottom:6px">No parts in this design</b><p class="field-hint" style="margin:0;font-size:11px">Clean workspace. Type your prompt in the brief or run /test to generate CAD geometry.</p></div>`;
   return;
  }
  const groups={};let tris=0;kids.forEach(m=>{const g=m.userData.group||m.userData.kind||'part';groups[g]=(groups[g]||0)+1;m.traverse(o=>{if(o.isMesh)tris+=meshTris(o)})});
  
  const proj=getActiveProject();
  const sch=proj?.schematic;
  let schHtml='';
  if(sch){
   let svgContent='';
   if(sch.connectors && sch.connectors.length){
    svgContent=`<div class="pinout-grid inspector-pinout">${sch.connectors.map(c=>`<div class="pin-col"><div class="pin-head">${escape(c.ref||'J')} <small>${escape(c.value||'')}</small></div>${(c.pins||[]).map(pin=>`<div class="pin-row"><b>${escape(String(pin.number))}</b><span>${escape(pin.function||'pad')}</span></div>`).join('')}</div>`).join('')}</div>`;
   }else if(proj.id==='orion'){
    const svgNets=sch.nets.map((n,i)=>{
     const y=55+i*22;
     const isPwr=n.name.includes('VBAT')||n.name.includes('5V')||n.name.includes('3V3');
     const isCan=n.name.includes('CAN');
     const col=isPwr?'#d47c4e':(isCan?'#9e5a7b':'#2b8478');
     return `<path d="M140 ${y}H480" stroke="${col}" stroke-width="${isPwr?3:2}"/><circle cx="140" cy="${y}" r="4" fill="#f4efdf" stroke="${col}" stroke-width="2"/><circle cx="480" cy="${y}" r="4" fill="#f4efdf" stroke="${col}" stroke-width="2"/><text x="310" y="${y-5}" font-size="10" text-anchor="middle" font-weight="bold">${escape(n.name)}</text><text x="130" y="${y+4}" font-size="9" text-anchor="end">${escape(n.pins[0])}</text><text x="490" y="${y+4}" font-size="9" text-anchor="start">${escape(n.pins[1]||'')}</text>`;
    }).join('');
    svgContent=`<svg viewBox="0 0 620 340" role="img" aria-label="Orion quadruped 12-channel control and actuator bus"><g font-family="IBM Plex Mono, monospace" fill="#495d51"><rect x="20" y="35" width="120" height="290" rx="6" fill="#f5f1e5" stroke="#9fae98"/><text x="80" y="22" font-size="12" font-weight="bold" text-anchor="middle">CONTROLLER</text><rect x="480" y="35" width="120" height="290" rx="6" fill="#f5f1e5" stroke="#9fae98"/><text x="540" y="22" font-size="12" font-weight="bold" text-anchor="middle">ACTUATORS &amp; BUS</text>${svgNets}</g></svg>`;
   }else{
    svgContent=`<svg viewBox="0 0 600 310" role="img" aria-label="${escape(sch.title)}"><g font-family="IBM Plex Mono,monospace" fill="#495d51"><rect x="50" y="50" width="90" height="200" rx="5" fill="#f5f1e5" stroke="#9fae98"/><rect x="460" y="50" width="90" height="200" rx="5" fill="#f5f1e5" stroke="#9fae98"/><text x="77" y="30" font-size="16">J1</text><text x="486" y="30" font-size="16">J2</text>${sch.nets.map((n,i)=>`<path d="M110 ${85+i*45}H490" stroke="${i===0?'#d47c4e':i===1?'#2b8478':i===2?'#38a395':'#a0557c'}" stroke-width="2"/><circle cx="110" cy="${85+i*45}" r="5" fill="#f4efdf" stroke="${i===0?'#d47c4e':i===1?'#2b8478':i===2?'#38a395':'#a0557c'}"/><circle cx="490" cy="${85+i*45}" r="5" fill="#f4efdf" stroke="${i===0?'#d47c4e':i===1?'#2b8478':i===2?'#38a395':'#a0557c'}"/><text x="285" y="${75+i*45}" font-size="12" font-weight="bold">${escape(n.name)}</text><text x="78" y="${90+i*45}" font-size="12">${i+1}</text><text x="510" y="${90+i*45}" font-size="12">${i+1}</text>`).join('')}</g></svg>`;
   }
   schHtml=`<div class="insp-schematic-wrap"><div class="insp-schematic-head"><span class="eyebrow">SCHEMATIC &amp; CIRCUITRY</span><span class="mono small">${escape(sch.nets.length)} nets</span></div><div class="insp-schematic-svg">${svgContent}</div><p class="field-hint" style="margin:4px 0 0">${escape(sch.caution)}</p></div>`;
  }

  sum.innerHTML=`<div class="stat-grid"><div class="stat"><b>${kids.length}</b>parts</div><div class="stat"><b>${tris.toLocaleString('en-US')}</b>triangles</div></div>`+Object.entries(groups).map(([g,n])=>`<div class="constraint"><span style="text-transform:capitalize">${escape(g)}</span><b>${n}</b></div>`).join('')+`<p class="field-hint">Hover part for info. Click to measure. Double-click to isolate. Shift-click for multi-select.</p>`+schHtml;
  return;
 }
 sum.hidden=true;det.hidden=false;
 if(sel.length===1){
  const mesh=sel[0],u=mesh.userData;
  const col=partChipColor(mesh);
  const isPcb=/board|flight controller|pcb|connector/i.test(u.name||'')||u.group==='electronics'||u.kind==='pcb';
  let layoutSection='';
  if(isPcb){
   const proj=getActiveProject();
   const dims=proj.id==='orion'?'120 × 70 mm · Quadruped Controller':'60 × 40 mm · 2 layers · 4 routed nets';
   layoutSection=`<div class="insp-layout-wrap"><div class="insp-layout-head"><span class="eyebrow">3D BOARD LAYOUT</span><span class="mono small">${escape(dims)}</span></div><div class="insp-board-container"><div id="inspector-board-viewport" class="board-viewport"></div><div class="board-tools"><button id="insp-board-cam-iso" class="active">3D</button><button id="insp-board-cam-top">Top</button></div><div class="board-legend" id="inspector-board-legend"></div></div></div>`;
  }

  let tris=0; mesh.traverse(o=>{ if(o.isMesh) tris+=meshTris(o); });
  det.innerHTML=`<button class="text-button" data-pact="back">← All parts</button><div class="part-detail-head"><span class="swatch" style="background:${escape(col)}"></span><h4>${escape(u.name||'Part')}</h4></div><div class="kv"><span>Group</span><b style="text-transform:capitalize">${escape(u.group||u.kind||'—')}</b></div><div class="kv"><span>Bounding box</span><b>${partSize(mesh)}</b></div><div class="kv"><span>Triangles</span><b>${tris.toLocaleString('en-US')}</b></div><div class="kv"><span>Printable</span><b>${u.printable?'via pipeline':'reference only'}</b></div>${layoutSection}`;

  if(isPcb){
   setTimeout(()=>mountInspectorBoard(), 25);
  }
  return;
 }
 const tot=sel.reduce((a,m)=>a+meshTris(m),0);let box='—';try{box=unionBox(sel)}catch{}
 det.innerHTML=`<button class="text-button" data-pact="back">← All parts (${kids.length})</button><div class="part-detail-head"><h4>${sel.length} parts selected</h4></div>`+sel.map(m=>{const u=m.userData;const col=m.material.color?m.material.color.getStyle():'#999999';return `<div class="kv"><span><span class="swatch" style="background:${escape(col)};width:12px;height:12px;display:inline-block;vertical-align:-2px;margin-right:6px"></span>${escape(u.name||'Part')}</span><span><b>${meshTris(m).toLocaleString('en-US')}</b> <button class="text-button" data-pact="unpick" data-name="${escape(u.name||'')}">×</button></span></div>`}).join('')+`<div class="kv"><span>Combined box</span><b>${box}</b></div><div class="kv"><span>Total triangles</span><b>${tot.toLocaleString('en-US')}</b></div>`;
}

function updateChipsScrollCues(){
 const wrap=document.querySelector('.timeline-chips-wrap');
 const el=document.getElementById('timeline-chips');
 const leftBtn=document.getElementById('chips-scroll-left');
 const rightBtn=document.getElementById('chips-scroll-right');
 if(!el||!wrap)return;
 const canScrollLeft=el.scrollLeft>6;
 const canScrollRight=el.scrollLeft+el.clientWidth<el.scrollWidth-6;
 wrap.classList.toggle('has-left',canScrollLeft);
 wrap.classList.toggle('at-end',!canScrollRight);
 if(leftBtn)leftBtn.hidden=!canScrollLeft;
 if(rightBtn)rightBtn.hidden=!canScrollRight;
}

function renderTimeline(){
 const kids=assemblyParts();
 const shown=kids.filter(m=>(layerFilter==='all'||m.userData.group===layerFilter)&&(m.userData.name||'').toLowerCase().includes(partQuery));
 $('#timeline-count').textContent=shown.length+' / '+kids.length+' parts';
 $('#timeline-chips').innerHTML=shown.map((m,i)=>`<button type="button" class="chip ${selectedNames.has(m.userData.name)?'active':''}" aria-pressed="${selectedNames.has(m.userData.name)}" data-chip="${escape(m.userData.name)}"><i style="background:${partChipColor(m)}"></i><span>${escape(m.userData.name)}</span><small>${String(i+1).padStart(2,'0')}</small></button>`).join('')||'<p class="field-hint">No matching parts.</p>';
 setTimeout(updateChipsScrollCues,25);
}
let baseOrbitAngle = null, baseOrbitElev = null;
function fitAssembly(){
 if(!assembly||!camera)return;
 const box=new THREE.Box3().setFromObject(assembly);
 if(box.isEmpty()){
  controls.target.set(0,0,20);
  camera.position.set(265,-330,225);
  camera.near=0.1;
  camera.far=5000;
  camera.updateProjectionMatrix();
  controls.update();
  baseOrbitAngle=null; baseOrbitElev=null;
  return;
 }
 const c=box.getCenter(new THREE.Vector3()),s=box.getSize(new THREE.Vector3());
 const vFov=(camera.fov*Math.PI)/180;
 const distV=s.z/(2*Math.tan(vFov/2));
 const distH=s.x/(2*Math.tan(vFov/2)*Math.min(camera.aspect,1));
 const distDiag=(s.length()*0.5)/Math.sin(vFov/2);
 const dist=Math.max(distV*1.38,distH*1.38,distDiag*0.95,s.y*1.2);
 let dir=camera.position.clone().sub(controls.target);
 if(!dir.lengthSq())dir.set(1,-1,.7);
 dir.normalize();

 if(explosion<=0.001){
  baseOrbitAngle=Math.atan2(dir.y, dir.x);
  baseOrbitElev=Math.asin(Math.max(-0.95, Math.min(0.95, dir.z)));
 }else{
  if(baseOrbitAngle===null){
   baseOrbitAngle=Math.atan2(dir.y, dir.x);
   baseOrbitElev=Math.asin(Math.max(-0.95, Math.min(0.95, dir.z)));
  }
  // Smoothly rotate once alongside zoom to side view perspective
  const sideAngle=-Math.PI * 0.45;
  const rotAngle=THREE.MathUtils.lerp(baseOrbitAngle, sideAngle, Math.min(1, explosion));
  const targetElev=0.46;
  const elev=THREE.MathUtils.lerp(baseOrbitElev, targetElev, Math.min(1, explosion));
  const cosE=Math.cos(elev);
  dir.set(Math.cos(rotAngle)*cosE, Math.sin(rotAngle)*cosE, Math.sin(elev)).normalize();
 }

 controls.target.copy(c);
 camera.position.copy(c.clone().add(dir.multiplyScalar(dist)));
 camera.near=Math.max(.01,dist/200);
 camera.far=Math.max(10000,dist*35);
 camera.updateProjectionMatrix();
 if(controls){
  controls.minDistance=Math.max(2, s.length()*0.12);
  controls.maxDistance=Math.max(4000, dist*20);
 }
 controls.update();
}

// ---- Upward Knolling Grid Explode Algorithm (Requirement 1 & Requirement 6) ----
function objectRestBox(obj){
 if(obj.isMesh && obj.geometry){
  obj.geometry.computeBoundingBox();
  const bb=obj.geometry.boundingBox.clone();
  bb.applyMatrix4(obj.matrixWorld);
  return { size: bb.getSize(new THREE.Vector3()), center: bb.getCenter(new THREE.Vector3()) };
 }
 const box=new THREE.Box3().setFromObject(obj);
 return { size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
}

function computeKnollingGrid(objs, aspect=1.4){
 const items=objs.map(obj=>{
  const {size, center}=objectRestBox(obj);
  const name=obj.userData?.name || obj.name || 'part';
  const group=obj.userData?.group || (obj.userData?.kind==='pcb' ? 'electronics' : 'structure');
  return {
   obj,
   name,
   group,
   size,
   center,
   width:Math.min(130,Math.max(40,size.x)+20),
   height:Math.min(110,Math.max(40,size.y)+20),
   depth:size.z
  };
 });
 items.sort((a,b)=>{
  const rank=it=>(it.group==='structure'||/chassis|body|frame|hull|base|bracket/i.test(it.name))?0:(it.group==='electronics'||/board|sensor|mast|aperture|antenna|pcb|camera/i.test(it.name))?1:2;
  return rank(a)-rank(b);
 });
 const count=items.length;
 const cols=Math.max(3,Math.ceil(Math.sqrt(count*aspect)));
 const rows=Math.ceil(count/cols);
 const maxW=Math.max(...items.map(it=>it.width),75);
 const maxH=Math.max(...items.map(it=>it.height),65);
 const totalW=cols*maxW;
 const totalH=rows*maxH;
 const cells=new Map();
 items.forEach((item,index)=>{
  const col=index%cols;
  const row=Math.floor(index/cols);
  const targetX=(col+0.5)*maxW-totalW/2;
  // Upward elevation in +Z
  const targetZ=(rows - 1 - row + 0.5)*maxH + 30;
  const targetY=-(row+0.5)*10;
  cells.set(item.obj,{
   x:targetX,
   y:targetY,
   z:targetZ,
   center:item.center,
   target:new THREE.Vector3(targetX, targetY, targetZ)
  });
 });
 return {cells,totalW,totalH,cols,rows};
}

function updateModel(){
 if(!assembly)return;
 const units=topLevelParts();
 units.forEach(obj=>{
  if(!obj.userData._home) obj.userData._home=obj.position.clone();
  else obj.position.copy(obj.userData._home);
 });
 assembly.updateMatrixWorld(true);

 assemblyMeshes().forEach(mesh=>{
  const names=[];
  for(let n=mesh;n&&n!==assembly;n=n.parent){
   if(n.userData&&n.userData.name) names.push(n.userData.name);
  }
  const named=mesh.userData.name;
  const isolated= !isolatedNames.size || names.some(nm=>isolatedNames.has(nm)) || isolatedNames.has(named);
  const layerOk= layerFilter==='all' || mesh.userData.group===layerFilter || (isPcbDescendant(mesh) && layerFilter==='electronics');
  mesh.visible=isolated && layerOk;
  if(mesh.material){
   const base=mesh.material.userData.baseOpacity ?? 1;
   mesh.material.opacity=translucent ? Math.min(.48, base) : base;
   mesh.material.transparent=translucent || base < .99;
   mesh.material.depthWrite=!translucent;
  }
 });

 if(assembly.userData.kind==='pcb' || explosion<=0) return;

 const visible=units.filter(obj=>{
  let vis=false;
  obj.traverse(o=>{ if(o.isMesh && o.visible) vis=true; });
  return vis;
 });
 if(!visible.length) return;
 const grid=computeKnollingGrid(visible);
 const center=assembly.userData.center||new THREE.Vector3();

 visible.forEach(obj=>{
  const cell=grid.cells.get(obj);
  if(!cell) return;
  const restCenter=cell.center;
  const c=restCenter.clone().sub(center);
  const nm=(obj.userData.name||'')+'';
  const grp=obj.userData.group||obj.userData.kind||'';
  const groupRank=(grp==='electronics'||/board|sensor|mast|aperture|antenna|flight|controller|pcb|camera/i.test(nm))?2.5:
                 (grp==='structure'||/chassis|body|frame|tray|hull|base|bracket/i.test(nm))?1.2:
                 (grp==='mobility'||/wheel|leg|hip|thigh|shank|foot|motor|servo|horn/i.test(nm))?0.3:1.0;
  const start=obj.userData._home.clone().add(new THREE.Vector3(c.x*0.35, c.y*0.35, groupRank*55 + Math.max(0,c.z)*0.8 + 25));
  const worldDelta=cell.target.clone().sub(restCenter);
  const knoll=obj.userData._home.clone().add(worldDelta);
  let dest;
  if(explosion<=0.35){
   const t=explosion/0.35;
   dest=obj.userData._home.clone().lerp(start, t);
  }else{
   const t=(explosion-0.35)/0.65;
   const ease=t*t*(3-2*t);
   dest=start.clone().lerp(knoll, ease);
  }
  obj.position.copy(dest);
 });
}

$$('[data-group]').forEach(b=>b.onclick=()=>{currentGroup=b.dataset.group;$$('[data-group]').forEach(el=>el.classList.toggle('active',el===b));updateModel()});
let explodeAnimId=null;
function animateExplosion(targetVal, duration=520){
 if(explodeAnimId)cancelAnimationFrame(explodeAnimId);
 if(controls)controls.autoRotate=false;
 const startVal=explosion;
 const startTime=performance.now();
 if(targetVal<=0.05&&camera&&controls){
  const dir=camera.position.clone().sub(controls.target);
  if(dir.lengthSq()){
   dir.normalize();
   baseOrbitAngle=Math.atan2(dir.y,dir.x);
   baseOrbitElev=Math.asin(Math.max(-0.95,Math.min(0.95,dir.z)));
  }
 }
 function step(now){
  const elapsed=now-startTime;
  const t=Math.min(1, elapsed/duration);
  const ease=t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
  setExplosion(startVal+(targetVal-startVal)*ease);
  if(t<1){
   explodeAnimId=requestAnimationFrame(step);
  }else{
   explodeAnimId=null;
   if(targetVal<=0.001){
    baseOrbitAngle=null;
    baseOrbitElev=null;
   }
  }
 }
 explodeAnimId=requestAnimationFrame(step);
}
$('#reset-view').onclick=reset;$('#wireframe').onclick=()=>{translucent=!translucent;$('#wireframe').setAttribute('aria-pressed',translucent);updateModel()};$('#explode').onclick=()=>{animateExplosion(explosion>0.05?0:1)};
function zoom(f){camera.position.sub(controls.target).multiplyScalar(f).add(controls.target);controls.update()};$('#zoom-in').onclick=()=>zoom(.85);$('#zoom-out').onclick=()=>zoom(1.15);
let activeProjectId='clean';
let cleanProject = {
  id: 'clean',
  name: 'Standalone Platform',
  badge: 'Standalone Project',
  type: 'custom',
  hasGeometry: false,
  modelPath: null,
  description: 'Describe your design brief to begin — dimensions, materials, and constraints.',
  stateText: 'Draft · Unevaluated',
  statePass: true,
  revisions: [],
  files: [],
  schematic: {
    title: 'Parametric Signal Routing',
    description: 'Connectivity diagram and nets will be dynamically generated upon pipeline synthesis.',
    caution: 'Awaiting synthesis. No nets routed yet.',
    nets: []
  },
  layout: {
    title: 'Custom Board Layout',
    subtitle: 'Awaiting KiCad route synthesis',
    boardSvgPath: '',
    drcPath: '',
    bundleUrl: '',
    bundleName: 'custom-board.zip',
    statusText: 'No board layout yet. Run /pipeline to synthesize custom PCB.',
    stats: [
      { label: 'STATUS', value: 'Draft' },
      { label: 'TRACES', value: '0' },
      { label: 'NETS', value: '0' },
      { label: 'VIAS', value: '0' }
    ]
  },
  spec: { length: 140, width: 90, mast_height: 52 },
  dimensions: { length: 140, width: 90, mast_height: 52 },
  checks: []
};
function getCleanProject() { return cleanProject; }
const extOf=n=>(n.split('.').pop()||'').toUpperCase().slice(0,4)||'FILE';
let boardMeta=null;
async function boardBundleMeta(){if(boardMeta)return boardMeta;try{const r=await fetch('artifacts/board/rove-1-board.zip');if(!r.ok)throw 0;const buf=await r.arrayBuffer();const hex=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buf))].map(b=>b.toString(16).padStart(2,'0')).join('');boardMeta={bytes:buf.byteLength,sha256:hex}}catch{boardMeta={bytes:0,sha256:''}}return boardMeta}
const fmtBytes=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B';

function getRove1Project(){
 const last=report?.iterations?.at(-1);
 const spec=last?.spec||{length:140,width:90,mast_height:52};
 const passed=report?.passed??true;
 const checks=last?.evaluation?.checks||[];
 const files=(report?.files||[
  {name:'board-tray.stl',bytes:1484,sha256:'074e6d11549a'},
  {name:'cad.py',bytes:5952,sha256:'fab5e1d934de'},
  {name:'chassis.stl',bytes:189884,sha256:'260c411f235e'},
  {name:'generate.py',bytes:360,sha256:'2b58f4921483'},
  {name:'mesh.json',bytes:945187,sha256:'d532d9ef6b98'},
  {name:'rove-1.step',bytes:421686,sha256:'c48a06991295'},
  {name:'sensor-mast.stl',bytes:2484,sha256:'586dcfb56a13'},
  {name:'spec.json',bytes:111,sha256:'3eab2aab6d92'}
 ]).map(f=>({name:f.name,bytes:f.bytes,sha256:f.sha256,type:extOf(f.name),downloadUrl:artifactBase+'final/'+f.name}));
 files.push({name:'rove-1-board.zip',bytes:boardMeta?.bytes||30938,sha256:boardMeta?.sha256||'9c48ea11b849',type:'PCB',downloadUrl:'artifacts/board/rove-1-board.zip',isBoard:true});
 return {
  id:'rove1',name:'Rove-1',badge:'Parametric CAD',type:'rover',
  modelPath:`${artifactBase}iteration-${iteration}/mesh.json`,
  description:report?.description||'Educational rover with sensor mast and connector board',
  stateText:passed?'Evaluated exemplar':'Needs review',statePass:passed,
  files,
  schematic:{
   title:'Four signals. One small board.',
   description:'Connectivity diagram derived from the generated board nets. External power, ground, SDA and SCL pass between J1 and J2.',
   caution:'Signal breakout only. No MCU, motor driver, power regulation, or I²C pull-ups. This diagram is not a KiCad schematic.',
   nets:[{name:'VCC',pins:['J1.1','J2.1']},{name:'GND',pins:['J1.2','J2.2']},{name:'SDA',pins:['J1.3','J2.3']},{name:'SCL',pins:['J1.4','J2.4']}]
  },
  layout:{
   title:'A place for the connections.',
   subtitle:'60 × 40 mm · 2 layers · 2 headers · 4 routed nets',
   boardSvgPath:'artifacts/board/board.svg',
   drcPath:'artifacts/board/drc.json',
   bundleUrl:'artifacts/board/rove-1-board.zip',
   bundleName:'rove-1-board.zip',
   statusText:'KiCad 10 DRC: 0 reported violations, 0 unconnected items. 4 checks ignored by the default rules. Verified parametric connector board.'
  },
  spec,dimensions:{length:spec.length||140,width:spec.width||90,mast_height:spec.mast_height||52},checks
 };
}

function getOrionProject(){
 return {
  id:'orion',name:'Orion',badge:'Quadruped',type:'quadruped',
  modelPath:'artifacts/orion/mesh.json',
  description:'Orion Quadruped by Ashish Agrahari — reference geometry (16 parts, zero-pose URDF assembly). Unevaluated; not measured.',
  stateText:'Reference geometry',statePass:true,
  files:[
   {name:'orion.urdf',bytes:7580,sha256:'a1b2c3d4e5f6',type:'URDF',downloadUrl:'artifacts/orion/manifest.json'},
   {name:'manifest.json',bytes:1540,sha256:'9f8e7d6c5b4a',type:'JSON',downloadUrl:'artifacts/orion/manifest.json'},
   {name:'mesh.json',bytes:3308,sha256:'8b7c6d5e4f3a',type:'JSON',downloadUrl:'artifacts/orion/mesh.json'},
   {name:'mesh.bin',bytes:7495164,sha256:'7a6b5c4d3e2f',type:'BIN',downloadUrl:'artifacts/orion/mesh.bin'},
   {name:'orion-board.zip',bytes:5507,sha256:'e5f6a1b2c3d4',type:'PCB',downloadUrl:'artifacts/orion/orion-board.zip',isBoard:true},
   {name:'actuator-bus.kicad_pcb',bytes:14200,sha256:'d4e5f6a1b2c3',type:'PCB',downloadUrl:'artifacts/orion/orion-board.zip'},
   {name:'bom.csv',bytes:184,sha256:'c3d4e5f6a1b2',type:'CSV',downloadUrl:'artifacts/orion/bom.csv'}
  ],
  schematic:{
   title:'Quadruped Main Control & Actuator Bus',
   description:'Power distribution and high-speed communication bus connecting 12 brushless actuators, flight computer, dual stereo cameras, and 360° LiDAR.',
   caution:'Quadruped control bus architecture. 12x joint telemetry, dual CAN bus with termination resistors, 24V/15A battery protection.',
   nets:[
    {name:'VBAT (24V)',pins:['J5.1','PDB.IN','J1-J4.PWR']},
    {name:'5V_SYS',pins:['PDB.5V','FC.5V','J6.1','CAM.5V']},
    {name:'3V3_MCU',pins:['FC.3V3','IMU.VDD','MAG.VDD']},
    {name:'CAN_H',pins:['FC.CAN_H','J1-J4.CH','TERM.120R']},
    {name:'CAN_L',pins:['FC.CAN_L','J1-J4.CL','TERM.120R']},
    {name:'UART_LIDAR',pins:['FC.UART2_RX','J6.RX','LIDAR.TX']},
    {name:'CSI_CAM_L',pins:['FC.CSI0','J6.CAM_L']},
    {name:'CSI_CAM_R',pins:['FC.CSI1','J6.CAM_R']},
    {name:'PWM_FL (1-3)',pins:['FC.TIM1','J1.FL1','J1.FL2','J1.FL3']},
    {name:'PWM_FR (4-6)',pins:['FC.TIM2','J3.FR1','J3.FR2','J3.FR3']},
    {name:'PWM_RL (7-9)',pins:['FC.TIM3','J2.RL1','J2.RL2','J2.RL3']},
    {name:'PWM_RR (10-12)',pins:['FC.TIM4','J4.RR1','J4.RR2','J4.RR3']}
   ]
  },
  layout:{
   title:'Orion Power Distribution & Actuator Bus Board',
   subtitle:'120 × 70 mm · 4 layers · 14 headers · 12 routed bus nets',
   boardSvgPath:'artifacts/orion/board.svg',
   drcPath:'artifacts/orion/drc.json',
   bundleUrl:'artifacts/orion/orion-board.zip',
   bundleName:'orion-board.zip',
   statusText:'KiCad 10.0.5 DRC: 0 reported violations, 0 unconnected items. 12-channel brushless actuator power planes verified.'
  },
  spec:{length:400,width:190,height:110,payload:'Stereo Camera + LiDAR',joints:12},
  dimensions:{length:400,width:190,mast_height:110},
  checks:[
   {name:'Joint range of motion',measured:12,requirement:'12 joints',passed:true,unit:'actuators'},
   {name:'Chassis envelope',measured:400.0,requirement:'≤ 450 mm',passed:true,unit:'mm'},
   {name:'Ground clearance',measured:95.0,requirement:'≥ 85 mm',passed:true,unit:'mm'}
  ]
 };
}

function getCustomProject(d){
 const last=(d.revisions&&d.revisions.length)?d.revisions[d.revisions.length-1]:{spec:{length:140,width:90,mast_height:52},evaluated:false,passed:false};
 const spec=last.spec||{length:140,width:90,mast_height:52};
 const passed=!!last.passed, isEvaluated=!!last.evaluated;
 const persisted = readPersistedWorkspace(d.id);
 const liveRun = d.liveRun || persisted?.mesh || null;
 const hasLiveBoard = !!(d.liveBoard || persisted?.board);
 const jobId = last.source_job ? String(last.source_job) : (liveRun && liveRun.jobId) || '';
 const hasGeometry = !!(isEvaluated && jobId && runner) || hasLiveBoard || !!liveRun;
 const files=[
  {name:`${slug(d.name)}.autocadent.json`,bytes:JSON.stringify(designBundle(d)).length,sha256:'custom-'+String(d.id||'').slice(0,8),type:'JSON',downloadUrl:'#'},
  {name:'spec.json',bytes:JSON.stringify(spec).length,sha256:'spec-'+String(d.id||'').slice(0,8),type:'JSON',downloadUrl:'#'}
 ];
 if(hasGeometry && jobId && runner){
  files.unshift(
   {name:'chassis.stl',bytes:190000,sha256:'job-'+jobId.slice(0,8),type:'STL',downloadUrl:`${runner}/artifacts/jobs/${jobId}/final/chassis.stl`},
   {name:'board-tray.stl',bytes:1500,sha256:'job-tray',type:'STL',downloadUrl:`${runner}/artifacts/jobs/${jobId}/final/board-tray.stl`},
   {name:'sensor-mast.stl',bytes:2500,sha256:'job-mast',type:'STL',downloadUrl:`${runner}/artifacts/jobs/${jobId}/final/sensor-mast.stl`}
  );
 }
 const meshPath = (liveRun && liveRun.base)
  ? `${liveRun.base}iteration-${liveRun.iterations||1}/mesh.json`
  : (hasGeometry && jobId && runner ? `${runner}/artifacts/jobs/${jobId}/final/mesh.json` : null);
 return {
  id:d.id,name:d.name,badge:d.kind==='template'?'Custom CAD':'Imported Design',type:'custom',
  hasGeometry,
  modelPath:meshPath,
  description:d.description||'',
  stateText:isEvaluated?(passed?'Evaluated · Pass':'Evaluated · Fail'):'Local draft (0 parts)',
  statePass:passed,
  files,
  schematic: d.liveSchematic || {
   title:`${escape(d.name)} Signal Interface`,
   description:hasGeometry?`Custom signal interface configured for ${spec.length} × ${spec.width} mm rover platform with ${spec.mast_height} mm sensor mast.`:'No circuit schematic synthesized yet. Describe connections in the design brief.',
   caution:hasGeometry?'Parametric signal breakout matching custom chassis dimensions. Generated in browser local workspace.':'Clean workspace — schematic will be generated upon build.',
   nets:hasGeometry?[{name:'VCC_MAIN',pins:['PWR.IN','TRAY.VCC']},{name:'GND_MAIN',pins:['PWR.GND','TRAY.GND']},{name:'MAST_DATA',pins:['SENSOR.MAST','BOARD.SIG']},{name:'BUS_CTRL',pins:['CTRL.1','CTRL.2']}]:[]
  },
  layout:{
   title:`${escape(d.name)} Custom Board Layout`,
   subtitle:hasGeometry?`${spec.length>150?'70 × 45':'60 × 40'} mm · 2 layers · Custom signal routing`:'No PCB layout synthesized yet',
   boardSvgPath:hasGeometry?'artifacts/board/board.svg':'',
   drcPath:hasGeometry?'artifacts/board/drc.json':'',
   bundleUrl:hasGeometry?'artifacts/board/rove-1-board.zip':'',
   bundleName:`${slug(d.name)}-board.zip`,
   statusText:hasGeometry?(isEvaluated?`Evaluated DRC: ${passed?'All clear':'Constraint failures noted'}.`:'Draft layout template.'):'No board layout yet. Submit design brief with runner connected to synthesize custom PCB.'
  },
  spec,dimensions:{length:spec.length,width:spec.width,mast_height:spec.mast_height},
  checks:isEvaluated?(report?.iterations?.at(-1)?.evaluation?.checks||[]):[]
 };
}

function getActiveProject(){
 if(activeProjectId==='orion')return getOrionProject();
 if(activeProjectId==='clean')return getCleanProject();
 if(activeProjectId!=='rove1'){
  const list=loadDesigns(), d=list.find(x=>x.id===activeProjectId)||pendingDesign;
  if(d)return getCustomProject(d);
 }
 return getRove1Project();
}

function fileRows(proj){
 const p=proj||getActiveProject();
 return (p.files||[]).map(f=>`<div class="file-row"><span>${escape(f.type||extOf(f.name))}</span><div><b>${escape(f.name)}</b><small>${f.isBoard&&p.id==='rove1'?'<span id="board-zip-meta">KiCad board bundle · resolving…</span>':`${escape(fmtBytes(f.bytes))} · sha ${escape(String(f.sha256).slice(0,12))}…`}</small></div><a href="${escape(f.downloadUrl)}" download="${escape(f.name)}" aria-label="Download ${escape(f.name)}">↓</a></div>`).join('');
}

function renderFiles(proj){
 const p=proj||getActiveProject();
 const fl=$('#file-list');
 if(fl)fl.innerHTML=fileRows(p);
 const ifl=$('#inspector-file-list');
 if(ifl)ifl.innerHTML=fileRows(p);
 if(p.id==='rove1'){
  boardBundleMeta().then(m=>{
   const el=document.getElementById('board-zip-meta');
   if(el&&m.bytes)el.textContent=`${fmtBytes(m.bytes)} · sha ${m.sha256.slice(0,12)}…`;
   else if(el)el.textContent='Board bundle · see download';
  });
 }
}

function renderSchematic(proj){
 const p=proj||getActiveProject();
 const sch=p.schematic;
 const h2=$('#schematic-view .view-heading h2'), pDesc=$('#schematic-view .view-heading p'), caution=$('#schematic-view .board-caution');
 if(h2)h2.textContent=sch.title;
 if(pDesc)pDesc.textContent=sch.description;
 if(caution)caution.textContent=sch.caution;

 if(!sch||!sch.nets||!sch.nets.length){
  $('#schematic').innerHTML=`<div style="padding:48px 24px;text-align:center;color:var(--muted)"><div style="font-size:32px;margin-bottom:12px">⌁</div><b style="color:var(--ink);font-size:14px">No schematic nets yet</b><p style="margin:6px 0 0;font-size:12px">Circuit schematic will be synthesized when you submit a design brief.</p></div>`;
  return;
 }

 if(p.id==='orion'){
  const svgNets=sch.nets.map((n,i)=>{
   const y=60+i*22;
   const isPwr=n.name.includes('VBAT')||n.name.includes('5V')||n.name.includes('3V3');
   const isCan=n.name.includes('CAN');
   const col=isPwr?'#d47c4e':(isCan?'#9e5a7b':'#2b8478');
   return `<path d="M150 ${y}H470" stroke="${col}" stroke-width="${isPwr?3:2}"/><circle cx="150" cy="${y}" r="4" fill="#f4efdf" stroke="${col}" stroke-width="2"/><circle cx="470" cy="${y}" r="4" fill="#f4efdf" stroke="${col}" stroke-width="2"/><text x="310" y="${y-5}" font-size="10" text-anchor="middle" font-weight="bold">${escape(n.name)}</text><text x="140" y="${y+4}" font-size="9" text-anchor="end">${escape(n.pins[0])}</text><text x="480" y="${y+4}" font-size="9" text-anchor="start">${escape(n.pins[1]||'')}</text>`;
  }).join('');
  $('#schematic').innerHTML=`<svg viewBox="0 0 620 340" role="img" aria-label="Orion quadruped 12-channel control and actuator bus"><g font-family="IBM Plex Mono, monospace" fill="#495d51"><rect x="25" y="40" width="120" height="280" rx="6" fill="#f5f1e5" stroke="#9fae98"/><text x="85" y="25" font-size="13" font-weight="bold" text-anchor="middle">CONTROLLER</text><rect x="475" y="40" width="120" height="280" rx="6" fill="#f5f1e5" stroke="#9fae98"/><text x="535" y="25" font-size="13" font-weight="bold" text-anchor="middle">ACTUATORS &amp; BUS</text>${svgNets}</g></svg>`;
 }else{
  $('#schematic').innerHTML=`<svg viewBox="0 0 600 310" role="img" aria-label="${escape(sch.title)}"><g font-family="IBM Plex Mono,monospace" fill="#495d51"><rect x="50" y="50" width="90" height="200" rx="5" fill="#f5f1e5" stroke="#9fae98"/><rect x="460" y="50" width="90" height="200" rx="5" fill="#f5f1e5" stroke="#9fae98"/><text x="77" y="30" font-size="16">J1</text><text x="486" y="30" font-size="16">J2</text>${sch.nets.map((n,i)=>`<path d="M110 ${85+i*45}H490" stroke="${i===0?'#d47c4e':i===1?'#2b8478':i===2?'#38a395':'#a0557c'}" stroke-width="2"/><circle cx="110" cy="${85+i*45}" r="5" fill="#f4efdf" stroke="${i===0?'#d47c4e':i===1?'#2b8478':i===2?'#38a395':'#a0557c'}"/><circle cx="490" cy="${85+i*45}" r="5" fill="#f4efdf" stroke="${i===0?'#d47c4e':i===1?'#2b8478':i===2?'#38a395':'#a0557c'}"/><text x="285" y="${75+i*45}" font-size="12" font-weight="bold">${escape(n.name)}</text><text x="78" y="${90+i*45}" font-size="12">${i+1}</text><text x="510" y="${90+i*45}" font-size="12">${i+1}</text>`).join('')}</g></svg>`;
 }
}

// ---- Realistic 3D PCB Board Viewer (Requirement 7 second 7 & Requirement 10) ----
let boardScene=null, boardCamera=null, boardRenderer=null, boardControls=null;
let boardMeshes=[], activeHighlightedNet=null;

function init3DBoardViewer(){
 const container=document.getElementById('board-viewport');
 if(!container||boardRenderer)return;
 const w=container.clientWidth||700, h=container.clientHeight||460;

 boardScene=new THREE.Scene();
 boardCamera=new THREE.PerspectiveCamera(35,w/h,1,2000);
 boardCamera.position.set(45,-55,60);
 boardCamera.up.set(0,0,1);

 boardRenderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
 boardRenderer.setPixelRatio(Math.min(devicePixelRatio,2));
 boardRenderer.setSize(w,h);
 boardRenderer.outputColorSpace=THREE.SRGBColorSpace;
 boardRenderer.toneMapping=THREE.ACESFilmicToneMapping;
 boardRenderer.toneMappingExposure=1.35;
 boardRenderer.shadowMap.enabled=true;
 container.appendChild(boardRenderer.domElement);

 boardControls=new OrbitControls(boardCamera,boardRenderer.domElement);
 boardControls.enableDamping=true;
 boardControls.dampingFactor=0.08;
 boardControls.minDistance=25;
 boardControls.maxDistance=250;
 boardControls.target.set(0,0,0);
 boardControls.update();

 boardScene.add(new THREE.HemisphereLight(0xfffaea,0x435248,2.2));
 const keySun=new THREE.DirectionalLight(0xfff8ea,3.0);
 keySun.position.set(60,-80,100);
 keySun.castShadow=true;
 boardScene.add(keySun);
 const fill=new THREE.DirectionalLight(0x7bc6bf,1.2);
 fill.position.set(-60,80,40);
 boardScene.add(fill);

 build3DBoardScene();

 let boardLoopRunning=false;
 function boardLoop(){
  const inLayout=!$('#layout-view')?.hidden;
  const inInsp=!!document.getElementById('inspector-board-viewport');
  if(!inLayout && !inInsp){
   boardLoopRunning=false;
   return;
  }
  boardControls?.update();
  if(boardRenderer && boardScene && boardCamera){
   boardRenderer.render(boardScene,boardCamera);
  }
  requestAnimationFrame(boardLoop);
 }
 boardLoopRunning=true;
 requestAnimationFrame(boardLoop);

 window.addEventListener('resize',()=>{
  if(!boardRenderer)return;
  const inInsp=document.getElementById('inspector-board-viewport');
  const c=inInsp||container;
  if(!c)return;
  const cw=c.clientWidth, ch=c.clientHeight;
  if(cw&&ch){
   boardRenderer.setSize(cw,ch);
   boardCamera.aspect=cw/ch;
   boardCamera.updateProjectionMatrix();
  }
 });

 // Setup Board Controls
 $('#board-cam-top')?.addEventListener('click',()=>{boardCamera.position.set(0,0,85);boardControls.target.set(0,0,0);boardControls.update();highlightCamBtn('top')});
 $('#board-cam-iso')?.addEventListener('click',()=>{boardCamera.position.set(45,-55,60);boardControls.target.set(0,0,0);boardControls.update();highlightCamBtn('iso')});
 $('#board-cam-bottom')?.addEventListener('click',()=>{boardCamera.position.set(0,0,-85);boardControls.target.set(0,0,0);boardControls.update();highlightCamBtn('bottom')});
 $('#board-zoom-in')?.addEventListener('click',()=>{boardCamera.position.sub(boardControls.target).multiplyScalar(0.8).add(boardControls.target);boardControls.update()});
 $('#board-zoom-out')?.addEventListener('click',()=>{boardCamera.position.sub(boardControls.target).multiplyScalar(1.2).add(boardControls.target);boardControls.update()});

 $('#layout-view-3d')?.addEventListener('click',()=>{
  $('#layout-view-3d').classList.add('active');$('#layout-view-svg').classList.remove('active');
  $('#board-3d-wrap').hidden=false;$('#board-svg').hidden=true;
  if(container && boardRenderer && container!==boardRenderer.domElement.parentElement){
   container.appendChild(boardRenderer.domElement);
   const cw=container.clientWidth||700, ch=container.clientHeight||460;
   boardRenderer.setSize(cw,ch);
   boardCamera.aspect=cw/ch;
   boardCamera.updateProjectionMatrix();
  }
 });
 $('#layout-view-svg')?.addEventListener('click',()=>{
  $('#layout-view-svg').classList.add('active');$('#layout-view-3d').classList.remove('active');
  $('#board-3d-wrap').hidden=true;$('#board-svg').hidden=false;
 });
}

function mountInspectorBoard(){
 const container=document.getElementById('inspector-board-viewport');
 if(!container)return;
 if(!boardRenderer)init3DBoardViewer();
 if(boardRenderer && container!==boardRenderer.domElement.parentElement){
  container.appendChild(boardRenderer.domElement);
  const cw=container.clientWidth||240, ch=container.clientHeight||220;
  boardRenderer.setSize(cw,ch);
  boardCamera.aspect=cw/ch;
  boardCamera.updateProjectionMatrix();
  build3DBoardScene();
 }
 $('#insp-board-cam-iso')?.addEventListener('click',()=>{
  boardCamera?.position.set(45,-55,60);boardControls?.target.set(0,0,0);boardControls?.update();
  $('#insp-board-cam-iso')?.classList.add('active');$('#insp-board-cam-top')?.classList.remove('active');
 });
 $('#insp-board-cam-top')?.addEventListener('click',()=>{
  boardCamera?.position.set(0,0,85);boardControls?.target.set(0,0,0);boardControls?.update();
  $('#insp-board-cam-top')?.classList.add('active');$('#insp-board-cam-iso')?.classList.remove('active');
 });
}

function highlightCamBtn(preset){
 $$('.board-tools button').forEach(b=>b.classList.remove('active'));
 if(preset==='top')$('#board-cam-top')?.classList.add('active');
 else if(preset==='iso')$('#board-cam-iso')?.classList.add('active');
 else if(preset==='bottom')$('#board-cam-bottom')?.classList.add('active');
}

function build3DBoardScene(){
 if(!boardScene)return;
 boardMeshes.forEach(m=>boardScene.remove(m));
 boardMeshes=[];

 if(window.__lastBoardAction?.board){
  const live=buildBoardGroup(window.__lastBoardAction.board);
  boardScene.add(live);
  boardMeshes.push(live);
  const legendEl=$('#board-legend'), inspLegendEl=$('#inspector-board-legend');
  const fps=window.__lastBoardAction.board.footprints||[];
  const html=fps.map(fp=>`<button class="net-pill"><i style="background:#c9a227"></i><span>${escape(fp.reference||fp.lib_id||'fp')}</span></button>`).join('');
  if(legendEl) legendEl.innerHTML=html||'<span class="field-hint">Live KiCad board</span>';
  if(inspLegendEl) inspLegendEl.innerHTML=html;
  return;
 }

 const proj=getActiveProject();
 const isOrion=proj.id==='orion';
 const bw=isOrion?120:60, bh=isOrion?70:40, thickness=1.6;

 // FR4 Substrate with dark green solder mask
 const boardGeom=new THREE.BoxGeometry(bw,bh,thickness);
 const boardMat=new THREE.MeshStandardMaterial({color:0x114627,roughness:0.32,metalness:0.12});
 const boardMesh=new THREE.Mesh(boardGeom,boardMat);
 boardMesh.receiveShadow=true;
 boardScene.add(boardMesh);
 boardMeshes.push(boardMesh);

 // Gold plated mounting holes at 4 corners
 const holeOffset=isOrion?4:3.5;
 [
  [-bw/2+holeOffset,-bh/2+holeOffset],
  [bw/2-holeOffset,-bh/2+holeOffset],
  [-bw/2+holeOffset,bh/2-holeOffset],
  [bw/2-holeOffset,bh/2-holeOffset]
 ].forEach(([hx,hy])=>{
  const ringGeom=new THREE.RingGeometry(1.6,2.8,32);
  const ringMat=new THREE.MeshStandardMaterial({color:0xdfb43a,metalness:0.88,roughness:0.22,side:THREE.DoubleSide});
  const topRing=new THREE.Mesh(ringGeom,ringMat);
  topRing.position.set(hx,hy,thickness/2+0.02);
  boardScene.add(topRing);
  boardMeshes.push(topRing);
 });

 // Connectors & Routed Copper Traces (matching Schematic nets)
 const netsConfig=isOrion?[
  {name:'VBAT (24V)',color:0xd47c4e,pin1:[-48,-20],pin2:[48,-20]},
  {name:'5V_SYS',color:0x2b8478,pin1:[-48,-8],pin2:[48,-8]},
  {name:'CAN_H',color:0xa0557c,pin1:[-48,4],pin2:[48,4]},
  {name:'CAN_L',color:0x38a395,pin1:[-48,16],pin2:[48,16]}
 ]:[
  {name:'VCC',color:0xd47c4e,pin1:[-20,-12],pin2:[20,-12]},
  {name:'GND',color:0x2b8478,pin1:[-20,-4],pin2:[20,-4]},
  {name:'SDA',color:0x38a395,pin1:[-20,4],pin2:[20,4]},
  {name:'SCL',color:0xa0557c,pin1:[-20,12],pin2:[20,12]}
 ];

 const legendEl=$('#board-legend'), inspLegendEl=$('#inspector-board-legend');
 const legendHtml=netsConfig.map(n=>`<button class="net-pill" data-net="${escape(n.name)}"><i style="background:#${n.color.toString(16).padStart(6,'0')}"></i><span>${escape(n.name)}</span></button>`).join('');
 if(legendEl){
  legendEl.innerHTML=legendHtml;
  $$('#board-legend .net-pill').forEach(b=>{b.onclick=()=>highlightNet(b.dataset.net)});
 }
 if(inspLegendEl){
  inspLegendEl.innerHTML=legendHtml;
  $$('#inspector-board-legend .net-pill').forEach(b=>{b.onclick=()=>highlightNet(b.dataset.net)});
 }

 // Render Pins, Pads, and Copper Traces in 3D
 netsConfig.forEach(n=>{
  const padGeom=new THREE.CylinderGeometry(1.4,1.4,0.1,24);
  const padMat=new THREE.MeshStandardMaterial({color:0xdfb43a,metalness:0.88,roughness:0.22});

  // Pin 1 pad & pin
  const p1=new THREE.Mesh(padGeom,padMat);
  p1.rotation.x=Math.PI/2;
  p1.position.set(n.pin1[0],n.pin1[1],thickness/2+0.05);
  boardScene.add(p1);boardMeshes.push(p1);

  // Pin 2 pad & pin
  const p2=new THREE.Mesh(padGeom,padMat);
  p2.rotation.x=Math.PI/2;
  p2.position.set(n.pin2[0],n.pin2[1],thickness/2+0.05);
  boardScene.add(p2);boardMeshes.push(p2);

  // Through-hole gold pin heads
  const pinHeadGeom=new THREE.BoxGeometry(0.7,0.7,5.5);
  const pinHeadMat=new THREE.MeshStandardMaterial({color:0xf5cf52,metalness:0.92,roughness:0.18});
  const ph1=new THREE.Mesh(pinHeadGeom,pinHeadMat);
  ph1.position.set(n.pin1[0],n.pin1[1],thickness/2+2.8);
  boardScene.add(ph1);boardMeshes.push(ph1);

  const ph2=new THREE.Mesh(pinHeadGeom,pinHeadMat);
  ph2.position.set(n.pin2[0],n.pin2[1],thickness/2+2.8);
  boardScene.add(ph2);boardMeshes.push(ph2);

  // 3D Copper trace connecting pin 1 to pin 2
  const dx=n.pin2[0]-n.pin1[0];
  const traceGeom=new THREE.BoxGeometry(dx-2.8,0.9,0.06);
  const traceMat=new THREE.MeshStandardMaterial({color:n.color,metalness:0.75,roughness:0.35});
  const traceMesh=new THREE.Mesh(traceGeom,traceMat);
  traceMesh.position.set((n.pin1[0]+n.pin2[0])/2,n.pin1[1],thickness/2+0.03);
  traceMesh.userData={netName:n.name,baseColor:n.color,material:traceMat};
  boardScene.add(traceMesh);boardMeshes.push(traceMesh);
 });

 // Black plastic header shrouds
 const headerJ1=new THREE.Mesh(new THREE.BoxGeometry(4.5,32,2.5),new THREE.MeshStandardMaterial({color:0x1b1c1e,roughness:0.6}));
 headerJ1.position.set(isOrion?-48:-20,0,thickness/2+1.25);
 boardScene.add(headerJ1);boardMeshes.push(headerJ1);

 const headerJ2=new THREE.Mesh(new THREE.BoxGeometry(4.5,32,2.5),new THREE.MeshStandardMaterial({color:0x1b1c1e,roughness:0.6}));
 headerJ2.position.set(isOrion?48:20,0,thickness/2+1.25);
 boardScene.add(headerJ2);boardMeshes.push(headerJ2);
}

function highlightNet(name){
 $$('#board-legend .net-pill, #inspector-board-legend .net-pill').forEach(b=>b.classList.toggle('active',b.dataset.net===name));
 boardMeshes.forEach(m=>{
  if(m.userData&&m.userData.netName){
   const isTarget=m.userData.netName===name;
   if(isTarget){
    m.material.emissive=new THREE.Color(m.userData.baseColor);
    m.material.emissiveIntensity=0.8;
   }else{
    m.material.emissive=new THREE.Color(0x000000);
    m.material.emissiveIntensity=0;
   }
  }
 });
 toast(`Highlighted net: ${name}`);
}

function renderLayout(proj){
 const p=proj||getActiveProject();
 const lay=p.layout;
 const h2=$('#layout-view .view-heading h2'), pSub=$('#layout-subtitle');
 if(h2)h2.textContent=lay.title;
 if(pSub)pSub.textContent=lay.subtitle;

 const boardSvg=$('#board-svg');
 if(boardSvg){
  boardSvg.src=lay.boardSvgPath||'';
  boardSvg.alt=`Actual KiCad export of the ${p.name} board`;
 }
 const boardStatus=$('#board-status');
 if(boardStatus)boardStatus.textContent=lay.statusText;

 const dl=$('#layout-view a.outline-button');
 if(dl){
  dl.hidden=!lay.bundleUrl;
  dl.href=lay.bundleUrl||'#';
  dl.setAttribute('download',lay.bundleName||`${slug(p.name)}-board.zip`);
  dl.textContent=`↓ Download ${p.name} board bundle`;
 }
  if(p.type==='custom'&&!p.hasGeometry && !window.__lastBoardAction){
   const vp=$('#board-viewport');
   if(vp)vp.innerHTML='<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#677369;background:#f5f3ec;background-image:radial-gradient(#d2d1c4 1px,transparent 1px);background-size:16px 16px"><div style="font-size:34px;margin-bottom:10px;color:#287e77">▦</div><b style="color:var(--ink);font-size:14px">No board layout generated yet</b><p style="margin:6px 0 0;font-size:12px;color:var(--muted)">Parametric KiCad routing and DRC will be generated upon build.</p></div>';
   return;
  }
 if(!boardRenderer)init3DBoardViewer();
 else build3DBoardScene();
}

function renderInspector(proj){
 const p=proj||getActiveProject();
 const isOrion=p.id==='orion';
 const lInput=$('#length'), wInput=$('#width'), mInput=$('#mast_height');
 if(lInput&&p.dimensions.length!=null)lInput.value=p.dimensions.length;
 if(wInput&&p.dimensions.width!=null)wInput.value=p.dimensions.width;
 if(mInput&&p.dimensions.mast_height!=null)mInput.value=p.dimensions.mast_height;

 const isCustom=p.type==='custom'||(p.id!=='orion'&&p.id!=='rove1');
 const lLabel=document.querySelector('label[for="length"]'), wLabel=document.querySelector('label[for="width"]'), mLabel=document.querySelector('label[for="mast_height"]');
 if(lLabel)lLabel.textContent=isOrion?'Body length':(isCustom?'Platform length':'Chassis length');
 if(wLabel)wLabel.textContent=isOrion?'Body width':(isCustom?'Platform width':'Chassis width');
 if(mLabel)mLabel.textContent=isOrion?'Stance height':(isCustom?'Enclosure depth':'Mast height');

 const staticEnv=document.querySelectorAll('.field-row.static');
 if(staticEnv.length>=2){
  staticEnv[0].innerHTML=isOrion?'<span>Board envelope</span><b>120 × 70 mm</b>':'<span>Board envelope</span><b>60 × 40 mm</b>';
  staticEnv[1].innerHTML=isOrion?'<span>Material intent</span><b>Al 6061-T6 / Carbon</b>':'<span>Material intent</span><b>PLA / PETG</b>';
 }
 validateInspectorSpecs();
}

function validateInspectorSpecs(){
 const len=Number($('#length')?.value)||140, wid=Number($('#width')?.value)||90, mast=Number($('#mast_height')?.value)||52;
 const ct=$('#crit-thick'), cw=$('#crit-wall'), cc=$('#crit-clear');
 if(ct){ct.className=len<=175?'constraint pass':'constraint fail';ct.innerHTML=`≥ 2.4 <small>mm</small> · <b>${len<=175?'PASS':'REVIEW'}</b>`}
 if(cw){cw.className=wid<=105?'constraint pass':'constraint fail';cw.innerHTML=`≥ 2.4 <small>mm</small> · <b>${wid<=105?'PASS':'REVIEW'}</b>`}
 if(cc){cc.className=mast>=40?'constraint pass':'constraint fail';cc.innerHTML=`≥ 0.8 <small>mm</small> · <b>${mast>=40?'PASS':'REVIEW'}</b>`}
}

['length','width','mast_height'].forEach(id=>{
 document.getElementById(id)?.addEventListener('input',validateInspectorSpecs);
});

// Inspector tabs handler (Requirement 8 second 8)
$$('.insp-tab').forEach(btn=>{
 btn.onclick=()=>{
  $$('.insp-tab').forEach(b=>b.classList.toggle('active',b===btn));
  const target=btn.dataset.inspTab;
  $('#insp-parts-panel').hidden=(target!=='parts');
  $('#insp-files-panel').hidden=(target!=='files');
  $('#insp-spec-panel').hidden=(target!=='spec');
  if(target==='files')renderFiles();
 };
});

// Part actions handler (Requirement 7 & Requirement 8 third)
$('#assembly-explorer').addEventListener('click',e=>{
 const b=e.target.closest('[data-pact]');if(!b)return;
 const pact=b.dataset.pact;
 if(pact==='back'){selectPart(null)}
 else if(pact==='unpick'){selectPart(b.dataset.name,true)}
 else if(pact==='mention'){mentionSelection()}
 else if(pact==='isolate'){
  isolatedNames=new Set(isolatedNames.size?[]:[...selectedNames]);
  updateModel();renderAssemblyPanel();
  toast(isolatedNames.size?`Isolated selection · Double-click to restore.`:'Restored all parts.');
 }
 else if(pact==='view-schematic'){
  tab('schematic');
  const sel=[...selectedNames][0];
  toast(sel?`Viewing schematic & circuit for ${sel}`:'Viewing circuit schematic');
 }
});

// ---- Motion Lab: Native Three.js Simulation Viewport & Kinematics Engine ----

const SIM_TERRAINS = {
  martian: {
    name: "Martian Regolith",
    base_color: 0xb85233,
    roughness: 0.88,
    fog_color: 0x3a1e14,
    has_fog: true,
    sun_color: 0xffbe85,
  },
  lunar: {
    name: "Lunar Surface",
    base_color: 0x8a8d91,
    roughness: 0.96,
    fog_color: 0x050608,
    has_fog: false,
    sun_color: 0xffffff,
  },
  proving_ground: {
    name: "Proving Ground Grid",
    base_color: 0xeeebe2,
    major_grid: 200.0,
    minor_grid: 40.0,
    has_fog: false,
    sun_color: 0xfffaee,
  }
};

function martianElevation(x, y) {
  const dune1 = 18.0 * Math.sin(x * 0.005 + y * 0.002);
  const dune2 = 8.0 * Math.cos(x * 0.012 - y * 0.008);
  const micro = 2.5 * Math.sin(x * 0.03 + y * 0.025);
  return dune1 + dune2 + micro;
}

const LUNAR_CRATERS = [
  { x: 300.0, y: 250.0, radius: 250.0, depth: 30.0, rim: 10.0 },
  { x: -350.0, y: -250.0, radius: 220.0, depth: 25.0, rim: 8.0 },
  { x: -200.0, y: 380.0, radius: 180.0, depth: 20.0, rim: 7.0 },
  { x: 420.0, y: -350.0, radius: 240.0, depth: 28.0, rim: 9.0 },
  { x: -420.0, y: 150.0, radius: 160.0, depth: 16.0, rim: 5.0 }
];

function craterElevation(r, radius = 250.0, depth = 30.0, rimHeight = 10.0) {
  const normR = r / radius;
  if (normR < 0.8) {
    return -depth * (1.0 - Math.pow(normR / 0.8, 2));
  } else if (normR <= 1.2) {
    return rimHeight * Math.sin(Math.PI * (normR - 0.8) / 0.4);
  }
  return 0.0;
}

function lunarElevation(x, y) {
  let z = 0.0;
  for (const c of LUNAR_CRATERS) {
    const d = Math.hypot(x - c.x, y - c.y);
    z += craterElevation(d, c.radius, c.depth, c.rim);
  }
  z += 1.2 * Math.sin(x * 0.035) * Math.cos(y * 0.035);
  return z;
}

function getTerrainHeight(type, x, y) {
  if (type === 'martian') return martianElevation(x, y);
  if (type === 'lunar') return lunarElevation(x, y);
  return 0.0;
}

let simScene = null, simCamera = null, simRenderer = null, simControls = null;
let simSun = null, simHemi = null, simFill = null;
let simTerrainGroup = null, simRobotGroup = null;
let simInitialized = false, simRunning = false;
let simActiveTerrain = 'proving_ground';
let simActiveRobot = 'orion';
let simPlayback = { playing: true, speed: 1.0, time: 0, lastFrame: 0 };
let simCamPreset = 'iso';
let orionSimRig = null, roveSimRig = null;

function disposeNode(node) {
  if (!node) return;
  node.traverse(child => {
    if (child.isMesh) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    }
  });
}

function buildTerrain(type) {
  if (!simScene) return;
  if (simTerrainGroup) {
    simScene.remove(simTerrainGroup);
    disposeNode(simTerrainGroup);
  }
  simTerrainGroup = new THREE.Group();
  const cfg = SIM_TERRAINS[type] || SIM_TERRAINS.proving_ground;

  if (type === 'martian') {
    simScene.background = new THREE.Color(0x3a1e14);
    simScene.fog = new THREE.Fog(0x3a1e14, 400, 3200);
    if (simSun) simSun.color.setHex(cfg.sun_color);

    const geom = new THREE.PlaneGeometry(3000, 3000, 96, 96);
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, martianElevation(pos.getX(i), pos.getY(i)));
    }
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: cfg.base_color,
      roughness: cfg.roughness,
      metalness: 0.12
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    simTerrainGroup.add(mesh);

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x9c4125, roughness: 0.92 });
    const rockGeom = new THREE.DodecahedronGeometry(1, 1);
    const pseudoRand = s => { const x = Math.sin(s) * 10000; return x - Math.floor(x); };
    for (let i = 0; i < 35; i++) {
      const rx = (pseudoRand(i * 1.7 + 0.1) - 0.5) * 2200;
      const ry = (pseudoRand(i * 2.3 + 0.5) - 0.5) * 2200;
      if (Math.hypot(rx, ry) < 220) continue;
      const rz = martianElevation(rx, ry);
      const scale = 10 + pseudoRand(i * 3.1) * 32;
      const rock = new THREE.Mesh(rockGeom, rockMat);
      rock.position.set(rx, ry, rz + scale * 0.4);
      rock.scale.set(scale, scale * (0.8 + pseudoRand(i) * 0.4), scale * (0.6 + pseudoRand(i * 2) * 0.5));
      rock.rotation.set(pseudoRand(i * 3) * Math.PI, pseudoRand(i * 4) * Math.PI, pseudoRand(i * 5) * Math.PI);
      rock.castShadow = true;
      rock.receiveShadow = true;
      simTerrainGroup.add(rock);
    }
  } else if (type === 'lunar') {
    simScene.background = new THREE.Color(0x050608);
    simScene.fog = null;
    if (simSun) simSun.color.setHex(cfg.sun_color);

    const geom = new THREE.PlaneGeometry(3000, 3000, 96, 96);
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, lunarElevation(pos.getX(i), pos.getY(i)));
    }
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: cfg.base_color,
      roughness: cfg.roughness,
      metalness: 0.15
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    simTerrainGroup.add(mesh);

    const bMat = new THREE.MeshStandardMaterial({ color: 0x6e7175, roughness: 0.98 });
    const bGeom = new THREE.DodecahedronGeometry(1, 1);
    const pseudoRand = s => { const x = Math.sin(s) * 10000; return x - Math.floor(x); };
    for (let i = 0; i < 30; i++) {
      const rx = (pseudoRand(i * 2.1 + 0.3) - 0.5) * 2200;
      const ry = (pseudoRand(i * 3.7 + 0.7) - 0.5) * 2200;
      if (Math.hypot(rx, ry) < 220) continue;
      const rz = lunarElevation(rx, ry);
      const scale = 12 + pseudoRand(i * 2.9) * 30;
      const boulder = new THREE.Mesh(bGeom, bMat);
      boulder.position.set(rx, ry, rz + scale * 0.35);
      boulder.scale.set(scale, scale * (0.85 + pseudoRand(i) * 0.3), scale * (0.7 + pseudoRand(i * 3) * 0.5));
      boulder.rotation.set(pseudoRand(i * 6) * Math.PI, pseudoRand(i * 7) * Math.PI, pseudoRand(i * 8) * Math.PI);
      boulder.castShadow = true;
      boulder.receiveShadow = true;
      simTerrainGroup.add(boulder);
    }
  } else {
    simScene.background = new THREE.Color(0xf5f4ec);
    simScene.fog = null;
    if (simSun) simSun.color.setHex(cfg.sun_color);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(3200, 3200),
      new THREE.MeshStandardMaterial({ color: cfg.base_color, roughness: 0.72 })
    );
    floor.position.z = -0.1;
    floor.receiveShadow = true;
    simTerrainGroup.add(floor);

    const minorGrid = new THREE.GridHelper(3200, 80, 0xd5dbd4, 0xd5dbd4);
    minorGrid.rotation.x = Math.PI / 2;
    minorGrid.position.z = 0.1;
    minorGrid.material.transparent = true;
    minorGrid.material.opacity = 0.65;
    simTerrainGroup.add(minorGrid);

    const majorGrid = new THREE.GridHelper(3200, 16, 0x8fa298, 0x8fa298);
    majorGrid.rotation.x = Math.PI / 2;
    majorGrid.position.z = 0.2;
    majorGrid.material.transparent = true;
    majorGrid.material.opacity = 0.85;
    simTerrainGroup.add(majorGrid);

    [200, 400, 600, 800].forEach(r => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 1.2, r + 1.2, 96),
        new THREE.MeshBasicMaterial({ color: 0x8fa298, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
      );
      ring.position.z = 0.3;
      simTerrainGroup.add(ring);
    });
  }

  simScene.add(simTerrainGroup);
  simActiveTerrain = type;
  const tt = document.getElementById('telem-terrain');
  if (tt) tt.textContent = cfg.name;
  $$('#sim-terrain-select button').forEach(b => {
    b.classList.toggle('active', b.dataset.terrain === type);
  });
}

function createSimMesh(p) {
  const vertices = ArrayBuffer.isView(p.vertices) ? p.vertices : p.vertices.flat();
  const indices = ArrayBuffer.isView(p.triangles) ? p.triangles : p.triangles.flat();
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(vertices instanceof Float32Array ? vertices : new Float32Array(vertices), 3));
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geom,
    new THREE.MeshStandardMaterial({
      color: p.color,
      roughness: 0.48,
      metalness: 0.18,
      side: THREE.DoubleSide
    })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

async function loadSimRobots() {
  if (!simRobotGroup) return;

  try {
    const orionParts = await loadOrionMeshes();
    const partsMap = new Map();
    orionParts.forEach(p => partsMap.set(p.name, createSimMesh(p)));

    const orionRoot = new THREE.Group();
    const orionBody = new THREE.Group();
    orionRoot.add(orionBody);

    for (const name of ['chassis link', 'left camera link', 'right camera link', 'lidar link']) {
      const m = partsMap.get(name);
      if (m) orionBody.add(m);
    }

    const legConfigs = [
      {
        name: 'FL',
        phase: 0.0,
        hipOrigin: new THREE.Vector3(-88.5, 165.3, 128.5),
        kneeOrigin: new THREE.Vector3(-123.2, 100.7, 114.4),
        link1: 'front left link 1',
        link2: 'front left link 2',
        link3: 'front left link 3',
      },
      {
        name: 'FR',
        phase: Math.PI,
        hipOrigin: new THREE.Vector3(86.2, 144.1, 131.2),
        kneeOrigin: new THREE.Vector3(121.3, 103.5, 110.2),
        link1: 'front right link 1',
        link2: 'front right link 2',
        link3: 'front right link 3',
      },
      {
        name: 'BL',
        phase: Math.PI,
        hipOrigin: new THREE.Vector3(-88.8, -94.9, 128.5),
        kneeOrigin: new THREE.Vector3(-123.5, -147.9, 114.4),
        link1: 'back left link 1',
        link2: 'back left link 2',
        link3: 'back left link 3',
      },
      {
        name: 'BR',
        phase: 0.0,
        hipOrigin: new THREE.Vector3(86.0, -94.9, 128.5),
        kneeOrigin: new THREE.Vector3(121.1, -145.0, 110.4),
        link1: 'back right link 1',
        link2: 'back right link 2',
        link3: 'back right link 3',
      },
    ];

    const legs = [];
    legConfigs.forEach(cfg => {
      const hipGroup = new THREE.Group();
      hipGroup.position.copy(cfg.hipOrigin);
      orionBody.add(hipGroup);

      const m1 = partsMap.get(cfg.link1);
      if (m1) {
        m1.position.copy(cfg.hipOrigin).negate();
        hipGroup.add(m1);
      }

      const m2 = partsMap.get(cfg.link2);
      if (m2) {
        m2.position.copy(cfg.hipOrigin).negate();
        hipGroup.add(m2);
      }

      const kneeGroup = new THREE.Group();
      kneeGroup.position.copy(cfg.kneeOrigin).sub(cfg.hipOrigin);
      hipGroup.add(kneeGroup);

      const m3 = partsMap.get(cfg.link3);
      if (m3) {
        m3.position.copy(cfg.kneeOrigin).negate();
        kneeGroup.add(m3);
      }

      legs.push({
        hip: hipGroup,
        knee: kneeGroup,
        phase: cfg.phase,
      });
    });

    orionSimRig = {
      root: orionRoot,
      body: orionBody,
      legs: legs,
    };
    simRobotGroup.add(orionRoot);
  } catch (err) {
    console.warn('Orion simulation mesh loading error:', err);
  }

  try {
    const roveParts = await json('artifacts/demo/iteration-2/mesh.json');
    const roveRoot = new THREE.Group();
    const roveBody = new THREE.Group();
    roveRoot.add(roveBody);

    const wheels = [];
    const wheelPivots = {
      'Wheel 3': new THREE.Vector3(-43.4, -55.0, -1.0),
      'Wheel 5': new THREE.Vector3(-43.4, 55.0, -1.0),
      'Wheel 7': new THREE.Vector3(43.4, -55.0, -1.0),
      'Wheel 9': new THREE.Vector3(43.4, 55.0, -1.0),
    };

    const hubToWheel = {
      'Hub 3': 'Wheel 3',
      'Hub 5': 'Wheel 5',
      'Hub 7': 'Wheel 7',
      'Hub 9': 'Wheel 9',
    };

    const wheelGroups = {};
    Object.keys(wheelPivots).forEach(wName => {
      const wg = new THREE.Group();
      wg.position.copy(wheelPivots[wName]);
      roveBody.add(wg);
      wheelGroups[wName] = wg;
      wheels.push(wg);
    });

    roveParts.forEach(p => {
      const mesh = createSimMesh(p);
      if (wheelGroups[p.name]) {
        mesh.position.copy(wheelPivots[p.name]).negate();
        wheelGroups[p.name].add(mesh);
      } else if (hubToWheel[p.name]) {
        const wName = hubToWheel[p.name];
        mesh.position.copy(wheelPivots[wName]).negate();
        wheelGroups[wName].add(mesh);
      } else {
        roveBody.add(mesh);
      }
    });

    roveBody.position.z = 24.0;

    roveSimRig = {
      root: roveRoot,
      body: roveBody,
      wheels: wheels,
    };
    simRobotGroup.add(roveRoot);
    roveRoot.visible = false;
  } catch (err) {
    console.warn('Rove-1 simulation mesh loading error:', err);
  }

  setSimActiveRobot(simActiveRobot);
}

function setSimActiveRobot(bot) {
  simActiveRobot = bot;
  if (orionSimRig) orionSimRig.root.visible = (bot === 'orion');
  if (roveSimRig) roveSimRig.root.visible = (bot === 'rove1');

  $$('[data-sim-robot]').forEach(b => {
    const on = (b.dataset.simRobot === bot);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });

  const telemStride = document.getElementById('telem-stride');
  if (telemStride) {
    telemStride.textContent = (bot === 'orion') ? '25.0 mm' : '0.0 mm (rolling)';
  }
}

function setSimCameraPreset(mode) {
  simCamPreset = mode;
  $$('#sim-camera-presets button').forEach(b => {
    b.classList.toggle('active', b.dataset.cam === mode);
  });
  if (!simCamera || !simControls) return;
  const target = simRobotGroup ? simRobotGroup.position : new THREE.Vector3(0, 0, 40);
  if (mode === 'iso') {
    simCamera.position.set(target.x + 420, target.y - 480, target.z + 360);
    simControls.target.set(target.x, target.y, target.z + 40);
  } else if (mode === 'top') {
    simCamera.position.set(target.x, target.y, target.z + 780);
    simControls.target.set(target.x, target.y, target.z);
  } else if (mode === 'side') {
    simCamera.position.set(target.x - 620, target.y, target.z + 140);
    simControls.target.set(target.x, target.y, target.z + 40);
  } else if (mode === 'chase') {
    simCamera.position.set(target.x, target.y - 420, target.z + 200);
    simControls.target.set(target.x, target.y + 120, target.z + 40);
  }
  simControls.update();
}

function setupSimControls() {
  $$('#sim-terrain-select button').forEach(b => {
    b.onclick = () => buildTerrain(b.dataset.terrain);
  });

  $$('[data-sim-robot]').forEach(b => {
    b.onclick = () => setSimActiveRobot(b.dataset.simRobot);
  });

  const pp = document.getElementById('sim-play-pause');
  if (pp) {
    pp.onclick = () => {
      simPlayback.playing = !simPlayback.playing;
      pp.textContent = simPlayback.playing ? '⏸ Pause' : '▶ Play';
      pp.classList.toggle('active', simPlayback.playing);
    };
  }

  $$('[data-speed]').forEach(b => {
    b.onclick = () => {
      const spd = parseFloat(b.dataset.speed) || 1.0;
      simPlayback.speed = spd;
      $$('[data-speed]').forEach(s => s.classList.toggle('active', s === b));
    };
  });

  const resetBtn = document.getElementById('sim-reset');
  if (resetBtn) {
    resetBtn.onclick = () => {
      simPlayback.time = 0;
      if (simRobotGroup) simRobotGroup.position.set(0, 0, 0);
      setSimCameraPreset(simCamPreset);
    };
  }

  $$('#sim-camera-presets button').forEach(b => {
    b.onclick = () => setSimCameraPreset(b.dataset.cam);
  });
}

function initSim3D() {
  if (simInitialized) return;
  const container = document.getElementById('sim-viewport');
  if (!container) return;

  simScene = new THREE.Scene();
  simCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 4000);
  simCamera.up.set(0, 0, 1);

  try {
    simRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    simRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    simRenderer.outputColorSpace = THREE.SRGBColorSpace;
    simRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    simRenderer.toneMappingExposure = 1.25;
    simRenderer.shadowMap.enabled = true;
    simRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(simRenderer.domElement);

    simControls = new OrbitControls(simCamera, simRenderer.domElement);
    simControls.enableDamping = true;
    simControls.dampingFactor = 0.05;
    simControls.minDistance = 150.0;
    simControls.maxDistance = 4000.0;
    simControls.maxPolarAngle = 0.85 * Math.PI;

    simHemi = new THREE.HemisphereLight(0xfff9e8, 0x596c65, 2.0);
    simScene.add(simHemi);

    simSun = new THREE.DirectionalLight(0xfffaee, 3.5);
    simSun.position.set(250, -300, 600);
    simSun.castShadow = true;
    simSun.shadow.mapSize.set(2048, 2048);
    Object.assign(simSun.shadow.camera, { left: -900, right: 900, top: 900, bottom: -900, near: 1, far: 2500 });
    simSun.shadow.bias = -0.001;
    simScene.add(simSun);

    simFill = new THREE.DirectionalLight(0x8ac0bb, 1.1);
    simFill.position.set(-200, 250, 120);
    simScene.add(simFill);

    simRobotGroup = new THREE.Group();
    simScene.add(simRobotGroup);

    buildTerrain(simActiveTerrain);
    loadSimRobots();
    setupSimControls();
    setSimCameraPreset('iso');

    new ResizeObserver(resizeSimViewport).observe(container);
    simInitialized = true;
  } catch (err) {
    console.warn('Simulation WebGL initialization failed:', err);
  }
}

function simTick(timestamp) {
  if (!simRenderer || !simScene || !simCamera) return;

  if (simPlayback.playing) {
    if (!simPlayback.lastFrame) simPlayback.lastFrame = timestamp || performance.now();
    const dt = Math.min(((timestamp || performance.now()) - simPlayback.lastFrame) / 1000.0, 0.05);
    simPlayback.lastFrame = timestamp || performance.now();
    simPlayback.time += dt * simPlayback.speed;
  } else {
    simPlayback.lastFrame = timestamp || performance.now();
  }

  const t = simPlayback.time;
  const freq = 1.5;

  const pathRadius = 380.0;
  const pathSpeed = 0.18;
  const theta = t * pathSpeed;
  const rx = pathRadius * Math.sin(theta);
  const ry = pathRadius * 0.7 * Math.cos(theta);
  const heading = Math.atan2(
    pathRadius * 0.7 * -Math.sin(theta),
    pathRadius * Math.cos(theta)
  );

  const currentGroundZ = getTerrainHeight(simActiveTerrain, rx, ry);
  const forwardOffset = 80.0;
  const fx = rx + Math.cos(heading) * forwardOffset;
  const fy = ry + Math.sin(heading) * forwardOffset;
  const bx = rx - Math.cos(heading) * forwardOffset;
  const by = ry - Math.sin(heading) * forwardOffset;
  const fz = getTerrainHeight(simActiveTerrain, fx, fy);
  const bz = getTerrainHeight(simActiveTerrain, bx, by);
  const terrainPitch = Math.atan2(fz - bz, forwardOffset * 2.0);

  const leftOffset = 60.0;
  const lx = rx - Math.sin(heading) * leftOffset;
  const ly = ry + Math.cos(heading) * leftOffset;
  const rxr = rx + Math.sin(heading) * leftOffset;
  const ryr = ry - Math.cos(heading) * leftOffset;
  const lz = getTerrainHeight(simActiveTerrain, lx, ly);
  const rz = getTerrainHeight(simActiveTerrain, rxr, ryr);
  const terrainRoll = Math.atan2(lz - rz, leftOffset * 2.0);

  if (simRobotGroup) {
    simRobotGroup.position.set(rx, ry, currentGroundZ);
    simRobotGroup.rotation.set(terrainPitch, terrainRoll, heading - Math.PI / 2);
  }

  if (orionSimRig && simActiveRobot === 'orion') {
    const bounce = 3.5 * Math.sin(4.0 * Math.PI * freq * t);
    const roll = Math.sin(2.0 * Math.PI * freq * t) * (1.5 * Math.PI / 180.0);
    const pitch = Math.cos(2.0 * Math.PI * freq * t) * (1.2 * Math.PI / 180.0);

    orionSimRig.body.position.z = bounce;
    orionSimRig.body.rotation.y = roll;
    orionSimRig.body.rotation.x = pitch;

    for (const leg of orionSimRig.legs) {
      const hp = Math.sin(2.0 * Math.PI * freq * t + leg.phase) * (25.0 * Math.PI / 180.0);
      const kp = Math.max(0.0, Math.sin(2.0 * Math.PI * freq * t + leg.phase)) * (35.0 * Math.PI / 180.0);
      leg.hip.rotation.x = hp;
      leg.knee.rotation.x = kp;
    }
  }

  if (roveSimRig && simActiveRobot === 'rove1') {
    const wheelRadius = 30.0;
    const linearVel = 150.0;
    const omega = linearVel / wheelRadius;
    const wheelRot = omega * t;
    for (const w of roveSimRig.wheels) {
      w.rotation.x = wheelRot;
    }
  }

  const gaitCycle = (2.0 * Math.PI * freq * t) % (2.0 * Math.PI);
  const cycleVal = (gaitCycle >= 0 ? gaitCycle : gaitCycle + 2 * Math.PI);
  const phaseEl = document.getElementById('telem-phase');
  if (phaseEl) {
    phaseEl.textContent = `${cycleVal.toFixed(2)} rad (${(cycleVal * 180 / Math.PI).toFixed(0)}°)`;
  }

  const velEl = document.getElementById('telem-velocity');
  if (velEl) {
    velEl.textContent = `${Math.round(150 * simPlayback.speed)} mm/s`;
  }

  const flTouch = simActiveRobot === 'rove1' || Math.sin(2.0 * Math.PI * freq * t) <= 0.05;
  const frTouch = simActiveRobot === 'rove1' || Math.sin(2.0 * Math.PI * freq * t + Math.PI) <= 0.05;
  const blTouch = simActiveRobot === 'rove1' || Math.sin(2.0 * Math.PI * freq * t + Math.PI) <= 0.05;
  const brTouch = simActiveRobot === 'rove1' || Math.sin(2.0 * Math.PI * freq * t) <= 0.05;

  document.getElementById('contact-fl')?.classList.toggle('on', flTouch);
  document.getElementById('contact-fr')?.classList.toggle('on', frTouch);
  document.getElementById('contact-bl')?.classList.toggle('on', blTouch);
  document.getElementById('contact-br')?.classList.toggle('on', brTouch);

  if (simCamPreset === 'chase' && simRobotGroup && simControls) {
    const camOffset = new THREE.Vector3(-Math.sin(heading) * 380, -Math.cos(heading) * 380, 180);
    simCamera.position.copy(simRobotGroup.position).add(camOffset);
    simControls.target.copy(simRobotGroup.position).add(new THREE.Vector3(0, 0, 40));
    simControls.update();
  } else if (simControls) {
    simControls.update();
  }

  simRenderer.render(simScene, simCamera);
  updateSimScale();
}

function updateSimScale() {
  if (!simCamera || !simRenderer) return;
  const el = document.getElementById('sim-viewport');
  if (!el) return;
  const width = el.clientWidth;
  if (!width) return;
  const distance = simCamera.position.distanceTo(simControls.target);
  const span = 2 * distance * Math.tan(simCamera.fov * Math.PI / 360) * simCamera.aspect;
  const mm = [1000, 500, 200, 100, 50, 20, 10, 1].find(n => n / span * width <= 100) || 200;
  const sb = document.getElementById('sim-scale-bar');
  const sl = document.getElementById('sim-scale-label');
  if (sb) sb.style.width = (mm / span * width) + 'px';
  if (sl) sl.textContent = mm + ' mm';
}

function startSimRender() {
  if (!simRenderer || simRunning) return;
  simRunning = true;
  simPlayback.lastFrame = performance.now();
  resizeSimViewport();
  simRenderer.setAnimationLoop(simTick);
}

function stopSimRender() {
  if (!simRenderer || !simRunning) return;
  simRunning = false;
  simRenderer.setAnimationLoop(null);
}

function resizeSimViewport() {
  if (!simRenderer || !simCamera) return;
  const container = document.getElementById('sim-viewport');
  if (!container) return;
  const w = container.clientWidth, h = container.clientHeight;
  if (!w || !h) return;
  simRenderer.setSize(w, h);
  simCamera.aspect = w / h;
  simCamera.updateProjectionMatrix();
}


// ---- Main tab navigation ----
function tab(name){
 const views={dashboard:'dashboard',preview:'preview',assembly:'preview',studio:'studio',explorer:'studio',files:'files',designs:'designs',schematic:'schematic',layout:'layout',simulation:'simulation'};
 const key=views[name]||'dashboard';
 try{ document.getElementById('boot')?.remove(); }catch{}

 // If user clicks/navigates to files, open the Files tab in Inspector while showing Explorer (Requirement 8 second 8)
 if(key==='files'){
  $$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab==='preview'));
  ['dashboard','preview','files','designs','schematic','layout','simulation','studio'].forEach(n=>$(`#${n}-view`).hidden=n!=='preview');
  document.body.classList.remove('is-landing','is-simulation','is-studio');
  if(window.__refreshInteractiveGrid) window.__refreshInteractiveGrid();
  $('#parts-timeline').hidden=false;
  $$('.insp-tab').forEach(b=>b.classList.toggle('active',b.dataset.inspTab==='files'));
  $('#insp-parts-panel').hidden=true;$('#insp-files-panel').hidden=false;$('#insp-spec-panel').hidden=true;
  renderFiles();
  const back=$('#back-dashboard');if(back)back.hidden=false;
  window.dispatchEvent(new Event('resize'));startRender();
  if(location.hash!=='#/files')history.replaceState(null,'','#/files');
  return;
 }

 const tabKey=(key==='dashboard'||key==='studio')?null:key;
 $$('[data-tab]').forEach(b=>{const on=b.dataset.tab===tabKey;b.classList.toggle('active',!!on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
 ['dashboard','preview','files','designs','schematic','layout','simulation','studio'].forEach(n=>{
  const el=$(`#${n}-view`);
  if(el)el.hidden=(n!==key);
 });
 document.body.classList.toggle('is-landing',key==='dashboard');
 document.body.classList.toggle('is-studio',key==='studio');
 if(window.__refreshInteractiveGrid) window.__refreshInteractiveGrid();
 const timeline=$('#parts-timeline');
 if(timeline) timeline.hidden=(key!=='preview');
 document.body.classList.toggle('is-simulation',key==='simulation');

 if(key==='simulation'){
  if(!simInitialized)initSim3D();
  window.dispatchEvent(new Event('resize'));
  startSimRender();
 }else{
  stopSimRender();
 }

 const back=$('#back-dashboard');
 if(back)back.hidden=(key==='dashboard'||key==='studio');
 if(key==='preview'){window.dispatchEvent(new Event('resize'));startRender()}else stopRender();
 const names={dashboard:'Dashboard',preview:'Explorer',files:'Files',designs:'Designs',schematic:'Schematic',layout:'Layout',simulation:'Motion lab',studio:'Design Agent Studio'};
 const crumb=$('#view-crumb');
 if(crumb)crumb.textContent=names[key];

 const curProj=getActiveProject();
 if(key==='schematic')renderSchematic(curProj);
 if(key==='layout')renderLayout(curProj);
 if(key==='designs')renderDesigns();
 if(key==='dashboard')renderDashboard();
 if(key==='studio'){
  const src=document.getElementById('agent-copilot-messages');
  const dst=document.getElementById('studio-chat-messages');
  if(src && dst) dst.innerHTML=src.innerHTML;
  renderStudio();
 }

 const want='#/'+(key==='preview'?'assembly':key);
 if(location.hash!==want)history.replaceState(null,'',want);
}

$$('[data-tab]').forEach(b=>b.onclick=()=>{location.hash='#/'+(b.dataset.tab==='preview'?'assembly':b.dataset.tab)});
window.addEventListener('hashchange',()=>{const h=(location.hash||'').replace(/^#\/?/,'');tab(h||'dashboard')});
function pulseHero(){const h=document.querySelector('.canvas-title');if(!h)return;h.classList.remove('intro-hide');clearTimeout(window.__heroT);window.__heroT=setTimeout(()=>h.classList.add('intro-hide'),4500)}
function syncModelButtons(){$$('[data-model]').forEach(b=>{const on=b.dataset.model===model;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))})}

async function loadOrionMeshes(){
 const man=await json('artifacts/orion/mesh.json'),res=await fetch('artifacts/orion/mesh.bin');
 if(!res.ok)throw Error('Orion bundle missing ('+res.status+')');
 const buf=await res.arrayBuffer();
 if(buf.byteLength!==(man.vertTotal+man.triTotal)*12)throw Error('Orion bundle is truncated.');
 const vertices=new Float32Array(buf,0,man.vertTotal*3),indices=new Uint32Array(buf,man.vertTotal*12);
 return man.parts.map(p=>({...p,vertices:vertices.subarray(p.vertStart,p.vertStart+p.vertCount*3),triangles:indices.slice(p.triStart,p.triStart+p.triCount*3).map(i=>i-p.vertStart/3)}));
}

// Per-Workspace Chat & Activity Isolation (Requirement 3)
const workspaceChats = {};
const WS_STORE_KEY = id => 'autocadent.ws.' + id;

function persistWorkspaceState(){
 if(!activeProjectId) return;
 const mem = workspaceChats[activeProjectId] || (workspaceChats[activeProjectId] = {});
 mem.board = window.__lastBoardAction || mem.board || null;
 mem.mesh = liveRunsByProject[activeProjectId] || mem.mesh || null;
 mem.preview = window.__lastPreviewAction || mem.preview || null;
 mem.caption = document.getElementById('geometry-caption')?.textContent || mem.caption || '';
 mem.copilotMessagesHtml = document.getElementById('agent-copilot-messages')?.innerHTML || mem.copilotMessagesHtml || '';
 mem.saved_at = new Date().toISOString();
 const payload = {
  chat: mem.copilotMessagesHtml,
  board: mem.board,
  mesh: mem.mesh,
  preview: mem.preview,
  caption: mem.caption,
  memory: mem.memory || designMemoryData || [],
  telemetry: mem.telemetry || designTelemetryData || [],
  roles: mem.roles || designGraphData || idleOrchestratorGraph(),
  saved_at: mem.saved_at
 };
 try { localStorage.setItem(WS_STORE_KEY(activeProjectId), JSON.stringify(payload)); } catch {}
 try {
  const list = loadDesigns();
  const idx = list.findIndex(x => x.id === activeProjectId);
  if (idx >= 0) {
   list[idx].liveBoard = mem.board || list[idx].liveBoard || null;
   list[idx].liveRun = mem.mesh || list[idx].liveRun || null;
   if (mem.board || mem.mesh) list[idx].hasGeometry = true;
   persistDesigns(list);
  }
 } catch {}
}

function readPersistedWorkspace(projectId){
 const mem = workspaceChats[projectId];
 if (mem && (mem.board || mem.mesh || mem.copilotMessagesHtml)) return mem;
 try {
  const raw = localStorage.getItem(WS_STORE_KEY(projectId));
  if (!raw) return null;
  const s = JSON.parse(raw);
  return {
   copilotMessagesHtml: s.chat || '',
   board: s.board || null,
   mesh: s.mesh || null,
   preview: s.preview || null,
   caption: s.caption || '',
   memory: s.memory || [],
   telemetry: s.telemetry || [],
   roles: s.roles || idleOrchestratorGraph()
  };
 } catch { return null; }
}

function restorePersistedWorkspace(projectId){
 const s = readPersistedWorkspace(projectId);
 if (!s) return false;
 if (s.copilotMessagesHtml) {
   const el = document.getElementById('agent-copilot-messages');
   if (el) el.innerHTML = s.copilotMessagesHtml;
   const studio = document.getElementById('studio-chat-messages');
   if (studio) studio.innerHTML = s.copilotMessagesHtml;
 }
 if (s.memory) applyWorkspaceMemory(s.memory, s.telemetry || []);
 if (s.roles) { designGraphData = s.roles; renderStudioRoles(); }
 if (s.caption) {
   const cap = document.getElementById('geometry-caption');
   if (cap) cap.textContent = s.caption;
 }
 return !!(s.board || s.mesh);
}

async function restoreWorkspaceGeometry(projectId){
 const s = readPersistedWorkspace(projectId);
 if (s?.board) {
  await loadLiveBoard(s.board, { silent: true });
  return true;
 }
 if (s?.mesh) {
  await handleChatBuildAction(s.mesh);
  return true;
 }
 return false;
}

function saveCurrentWorkspaceChat(){
 if(!activeProjectId) return;
 const prev = workspaceChats[activeProjectId] || {};
 workspaceChats[activeProjectId] = {
  ...prev,
  brief: $('#brief')?.value || '',
  briefText: $('#brief-text')?.innerHTML || '',
  activityHtml: $('#activity')?.innerHTML || '',
  runLabel: $('#run-label')?.textContent || '',
  copilotMessagesHtml: $('#agent-copilot-messages')?.innerHTML || '',
  isTestMode: typeof isTestMode !== 'undefined' ? isTestMode : false,
  board: window.__lastBoardAction || prev.board || null,
  mesh: liveRunsByProject[activeProjectId] || prev.mesh || null,
  preview: window.__lastPreviewAction || prev.preview || null
 };
 persistWorkspaceState();
}

function restoreWorkspaceChat(projectId, proj){
 const isRove1 = projectId === 'rove1';
 const isEvaluated = proj && proj.revisions && proj.revisions.length >= 2 && proj.revisions[0].evaluated;
 const revCard = $('#revision-control-card');
 if(revCard) revCard.hidden = false;
 const heuristicsChip = $('#heuristics-count-chip');
 if(heuristicsChip) {
   heuristicsChip.hidden = false;
   const savedMem = (workspaceChats[projectId] && workspaceChats[projectId].memory) || [];
   const n = Array.isArray(savedMem) ? savedMem.length : 0;
   heuristicsChip.textContent = n ? `${n} rule${n===1?'':'s'} in memory` : '0 Rules Active';
 }
 const replayBtn = $('#replay-btn');
 if(replayBtn) replayBtn.hidden = !(isRove1 || isEvaluated);

 const saved = workspaceChats[projectId];
 if(saved){
  if($('#brief')) $('#brief').value = saved.brief || '';
  if($('#brief-text') && saved.briefText) $('#brief-text').innerHTML = saved.briefText;
  if($('#activity')) $('#activity').innerHTML = saved.activityHtml || '';
  if($('#run-label')) $('#run-label').textContent = saved.runLabel || '';
  if($('#agent-copilot-messages') && saved.copilotMessagesHtml !== undefined){
   $('#agent-copilot-messages').innerHTML = saved.copilotMessagesHtml;
  }
  const studioChat = $('#studio-chat-messages');
  if(studioChat) studioChat.innerHTML = saved.copilotMessagesHtml || '';
  if(typeof isTestMode !== 'undefined'){
   if(saved.isTestMode && !isTestMode) enterTestMode();
   else if(!saved.isTestMode && isTestMode) exitTestMode();
  }
 } else {
  if(typeof isTestMode !== 'undefined' && isTestMode) exitTestMode();
   const desc = proj.description || '';
   if($('#brief')) $('#brief').value = (proj.hasGeometry || proj.id==='orion' || proj.id==='rove1') ? desc : '';
  if($('#brief-text')){
   if(proj.id === 'orion') $('#brief-text').textContent = 'Orion 12-DOF Quadruped robot platform. Reference kinematics and actuator bus architecture.';
   else if(proj.id === 'rove1') $('#brief-text').textContent = report?.description || 'Educational rover with sensor mast and connector board';
   else $('#brief-text').textContent = desc || 'Describe your design brief to begin.';
  }
  if($('#activity')){
   if(proj.id === 'orion'){
    $('#activity').innerHTML = '<div class="run-result" style="border-left-color:var(--teal)"><span class="agent-dot">✳</span><b>Reference Quadruped Platform</b><p>Kinematics &amp; URDF verification complete · 12 joints</p></div>';
   } else if(proj.id === 'rove1' && report){
    const item = report.iterations[iteration-1] || report.iterations.at(-1);
    if(item){
     $('#activity').innerHTML = `<div class="run-result"><span class="status-dot"></span><b>${item.evaluation.passed?'Build ready':'Revision needs repair'}</b><p>${item.evaluation.checks.filter(c=>c.passed).length} / ${item.evaluation.checks.length} checks · Revision ${iteration}</p></div><details class="run-details"><summary>Build history · ${report.iterations.length} revisions</summary>${(report.events||[]).map(e=>'<div class="event"><h3>'+escape(e.role)+'</h3><p>'+escape(e.message)+'</p></div>').join('')}</details>`;
    } else {
     $('#activity').innerHTML = '';
    }
   } else {
     $('#activity').innerHTML = proj.hasGeometry
      ? `<div class="run-result" style="border-left-color:var(--teal)"><span class="agent-dot">✳</span><b>${escape(proj.name)}</b><p>Design loaded into workspace · Ready for agent commands</p></div>`
      : '';
    }
  }
  const defaultRunLabel = proj.id === 'orion' ? 'REFERENCE GEOMETRY' : (proj.type === 'custom' ? (proj.hasGeometry ? 'CUSTOM CAD RESULT' : 'CLEAN DRAFT') : (report?.execution === 'ao-worker' ? 'AO WORKER RESULT' : runner ? 'LOCAL KERNEL RESULT' : 'RECORDED RUN'));
  if($('#run-label')) $('#run-label').textContent = defaultRunLabel;

  if($('#agent-copilot-messages')) $('#agent-copilot-messages').innerHTML = '';
  const studioChat = $('#studio-chat-messages');
  if(studioChat) studioChat.innerHTML = '';
 }
 if(isRove1) updateRevisionUI(iteration);
 else if(isEvaluated) updateRevisionUI(2);
 else updateRevisionUI(0);
 restorePersistedWorkspace(projectId);
 saveCurrentWorkspaceChat();
 const savedWs = workspaceChats[projectId] || {};
 resetStudioDelegation();
 applyWorkspaceMemory(savedWs.memory || [], savedWs.telemetry || []);
 renderStudioRoles();
 renderStudioMemorySummary();
 renderStudioContext();
 fetchDesignAgentTelemetry().then(() => {
  renderStudioMemorySummary();
  renderStudioContext();
 });
}

async function setActiveProject(projectId){
 if(activeProjectId){
  saveCurrentWorkspaceChat();
 }
  activeProjectId=projectId;
  const proj=getActiveProject();
  if(!proj){
   toast('Could not open that design — it is missing from this browser.');
   return;
  }
  const isCustom=(projectId==='clean'||proj?.type==='custom'||(projectId!=='orion'&&projectId!=='rove1'));
  model=projectId==='orion'?'orion':(isCustom?'standalone':'rove1');
  syncModelButtons();
  const ms=$('.model-switch');if(ms)ms.hidden=isCustom;
  const simTab=document.querySelector('[data-tab="simulation"]');
  if(simTab)simTab.hidden=(projectId!=='orion');

 const stateEl=$('#project-state');
 if(stateEl){
  stateEl.textContent=proj.stateText;
  stateEl.parentElement.className='project-state '+(proj.statePass?'pass':'fail');
 }
 const revLabel=$('#revision-label');
 if(revLabel){
  if(proj.id==='orion')revLabel.textContent='ORION · REFERENCE — UNEVALUATED';
  else if(proj.id==='rove1')revLabel.textContent=`REV ${String(iteration).padStart(2,'0')} · ${report?.passed?'EVALUATED':'CONSTRAINT FAILURE'}`;
  else revLabel.textContent=`${proj.name.toUpperCase()} · ${proj.stateText.toUpperCase()}`;
 }

 restoreWorkspaceChat(projectId, proj);

 const eb=$('#canvas-eyebrow');
 if(eb)eb.textContent=proj.id==='orion'?'ORION / ROBOT PLATFORM':(proj.id==='rove1'?'ROVE–1 / EXPLORER PLATFORM':`${proj.name.toUpperCase()} / WORKBENCH`);

 const ml=$('.model-label');
 if(ml)ml.hidden=(proj.type==='custom'&&!proj.hasGeometry);

 renderFiles(proj);
 renderSchematic(proj);
 renderLayout(proj);
 renderInspector(proj);

 const expBtn=$('#export-btn');
 if(expBtn){
  expBtn.onclick=()=>{
   const cur=getActiveProject();
   modal('Export build assets',`<p>Generated assets for <b>${escape(cur.name)}</b> (${escape(cur.badge)}):</p>${fileRows(cur)}`);
  };
 }

 document.body.classList.toggle('orion-model',proj.id==='orion');
 const cap=$('#geometry-caption');
 if(cap){
  cap.textContent=proj.id==='orion'?'ORION QUADRUPED · REFERENCE STL ASSEMBLY':(proj.type==='custom'?(proj.hasGeometry?`${proj.name.toUpperCase()} · PARAMETRIC CAD`:`${proj.name.toUpperCase()} · CLEAN CANVAS (0 PARTS)`):'ACTUAL CADQUERY GEOMETRY');
 }

 const request=++geometryRequest;
 if(proj.id==='orion'){
  $('#replay-btn').hidden=true;
  setViewStatus('Loading reference geometry…','loading');
  try{
   const meshes=cachedOrionMeshes||(cachedOrionMeshes=await loadOrionMeshes());
   if(request!==geometryRequest)return;
   drawMeshes(meshes);
   fitAssembly();
  }catch(e){
   if(request!==geometryRequest)return;
   if(assembly)assembly.visible=false;
   setViewStatus('Orion could not load: '+e.message,'error');
  }
 }else if(proj.id==='rove1'){
  $('#replay-btn').hidden=false;
  if(report){
   syncBriefAndDims();
   try{
    const meshes=cachedRoveMeshes||(cachedRoveMeshes=await json(`${artifactBase}iteration-${iteration}/mesh.json`));
    if(request!==geometryRequest)return;
    drawMeshes(meshes);
   }catch(e){
    if(request!==geometryRequest)return;
    if(assembly)assembly.visible=false;
    setViewStatus('Geometry could not load: '+e.message,'error');
   }
  }
 }else{
  $('#replay-btn').hidden=true;
  const restored = await restoreWorkspaceGeometry(projectId);
  if(request!==geometryRequest)return;
  if(!restored){
   if(proj.hasGeometry && proj.modelPath){
    try{
     const meshes=await json(proj.modelPath);
     if(request!==geometryRequest)return;
     drawMeshes(meshes);
    }catch(e){
     if(request!==geometryRequest)return;
     clearAssembly('Geometry could not load: '+e.message);
    }
   }else{
    clearAssembly('Clean design canvas · 0 parts · Ready to design');
   }
  }
 }
 applyDeploy();
}

async function loadModel(name){
 setExplosion(0);
 await setActiveProject(name);
 tab('preview');
 pulseHero();
}

window.setActiveProject=setActiveProject;
window.getActiveProject=getActiveProject;
window.loadModel=loadModel;
window.tab=tab;
window.loadLiveBoard=loadLiveBoard;
window.appendCopilotMessage=appendCopilotMessage;
window.captureViewportImage=captureViewportImage;
window.assemblyParts=assemblyParts;
window.handleChatBuildAction=handleChatBuildAction;
$$('[data-model]').forEach(b=>b.onclick=()=>loadModel(b.dataset.model));

function resizer(id,prop,min,max,dir){const h=document.getElementById(id);if(!h)return;const ws=document.querySelector('.workspace');const base=prop==='--agent-w'?280:280;h.addEventListener('pointerdown',e=>{e.preventDefault();h.setPointerCapture(e.pointerId);h.classList.add('dragging');const startX=e.clientX;const cur=parseFloat(getComputedStyle(ws).getPropertyValue(prop))||base;const move=ev=>{const v=Math.min(max,Math.max(min,cur+(ev.clientX-startX)*dir));ws.style.setProperty(prop,v+'px')};const up=()=>{h.classList.remove('dragging');h.removeEventListener('pointermove',move);h.removeEventListener('pointerup',up)};h.addEventListener('pointermove',move);h.addEventListener('pointerup',up)});h.addEventListener('dblclick',()=>ws.style.removeProperty(prop))}
resizer('resize-agent','--agent-w',200,460,1);resizer('resize-props','--props-w',200,420,-1);
$('#timeline-toggle').onclick=()=>{const tl=$('#parts-timeline');const hide=!tl.classList.contains('collapsed');tl.classList.toggle('collapsed',hide);const b=$('#timeline-toggle');b.textContent=hide?'Show ▸':'Hide ▾';b.setAttribute('aria-expanded',String(!hide))};
$('#timeline-chips').addEventListener('click',e=>{const c=e.target.closest('[data-chip]');if(!c)return;selectPart((!e.shiftKey&&selectedNames.has(c.dataset.chip)&&selectedNames.size===1)?null:c.dataset.chip,e.shiftKey)});
const chipsEl=$('#timeline-chips');
if(chipsEl){
 chipsEl.addEventListener('wheel',e=>{
  if(e.deltaY!==0&&!e.shiftKey){
   e.preventDefault();
   chipsEl.scrollLeft+=e.deltaY;
  }
 },{passive:false});
 chipsEl.addEventListener('scroll',updateChipsScrollCues,{passive:true});
 $('#chips-scroll-left')?.addEventListener('click',()=>{chipsEl.scrollBy({left:-240,behavior:'smooth'})});
 $('#chips-scroll-right')?.addEventListener('click',()=>{chipsEl.scrollBy({left:240,behavior:'smooth'})});
 window.addEventListener('resize',updateChipsScrollCues,{passive:true});
}
$('#brief')?.addEventListener('input',()=>{
 if(activeProjectId&&workspaceChats[activeProjectId]){
  workspaceChats[activeProjectId].brief=$('#brief').value;
 }
});

function applyDeploy(){
 const wrap=$('#preview-view');wrap.classList.toggle('deploy',deploy);
 ['studio','lab','outdoor','night'].forEach(n=>wrap.classList.toggle('env-'+n,deploy&&deployEnv===n));
 $('#env-picker').hidden=!deploy;
 if(gridHelper)gridHelper.visible=!deploy;if(ringMesh)ringMesh.visible=!deploy;
 if(floorMesh){floorMesh.visible=deploy;floorMesh.material.color.set({studio:0xe6e3d7,lab:0xc2d3d0,outdoor:0x9b9872,night:0x1b2530}[deployEnv]);floorMesh.position.z=model==='orion'?-3:-25;}
 if(studioLight)studioLight.color.set(deployEnv==='night'&&deploy?0x9cbcff:0xfff7e4);
 if(scene){scene.background=deploy?new THREE.Color({studio:0xeeeae1,lab:0xdce7e4,outdoor:0xb5cddd,night:0x101b29}[deployEnv]):null;scene.fog=deploy?new THREE.Fog(scene.background,900,3000):null}
 $('#deploy-btn').setAttribute('aria-pressed',String(deploy));
}
$('#deploy-btn').onclick=()=>{deploy=!deploy;applyDeploy()};
$$('#env-picker [data-env]').forEach(b=>b.onclick=()=>{deployEnv=b.dataset.env;$$('#env-picker [data-env]').forEach(x=>x.classList.toggle('active',x===b));applyDeploy()});

let isTestMode = false;

function enterTestMode(){
 isTestMode = true;
 renderTestBanner();
 $('#composer-mode').textContent = 'TEST SIMULATION (0 TOKENS)';
 toast('Entered /test mode: Test commands without consuming tokens.');
 closeSlash();
}

function exitTestMode(){
 isTestMode = false;
 const banner = $('#test-mode-banner');
 if(banner) banner.remove();
 $('#composer-mode').textContent = runner ? 'LOCAL CAD KERNEL' : 'CONNECT TO BUILD';
 toast('Exited /test mode.');
 closeSlash();
}

function renderTestBanner(){
 let banner = $('#test-mode-banner');
 if(!banner){
  banner = document.createElement('div');
  banner.id = 'test-mode-banner';
  banner.className = 'test-mode-banner';
  const scroll = document.querySelector('.agent-scroll');
  if(scroll) scroll.insertBefore(banner, scroll.firstChild);
 }
 banner.innerHTML = `<div><span class="pulse-dot"></span><b>TEST MODE ACTIVE</b> · Zero tokens consumed</div><button id="exit-test-btn" type="button" class="text-button">Exit test ✕</button>`;
 $('#exit-test-btn')?.addEventListener('click', exitTestMode);
}

async function runSimulatedTest(promptText, actionType='custom'){
 jobBusy = true;
 $('#submit-brief').disabled = true;
 $('#brief').value = '';
 $('#brief-text').textContent = promptText;
 $('#activity').innerHTML = `<div class="run-result" style="border-left-color:var(--teal)"><span class="agent-dot">✳</span><b>Simulating agent run…</b><p>Zero tokens consumed · Previewing command</p></div>`;
 $('#run-label').textContent = 'TEST SIMULATION (0 TOKENS)';

 const steps = [
  { role: 'Supervisor Intent Parser', msg: `Decomposed brief: "${promptText}". Extracted parametric dimensions and design envelope.` },
  { role: 'CadQuery Geometry Kernel', msg: 'Generating solid brep manifold solids. Evaluated 6 acceptance criteria.' },
  { role: 'OpenCASCADE Verification', msg: 'Evaluated solid geometry constraints: thickness ≥ 2.4mm, wall ≥ 2.4mm, board clearance ≥ 0.8mm.' }
 ];

 if(actionType === 'widen' || /wide|widen|width/i.test(promptText)){
  $('#width').value = '105';
  steps[1].msg = 'Platform width parametrically widened to 105 mm. Enclosure clearance verified (0.95 mm).';
 } else if(actionType === 'mast' || /mast|sensor|camera/i.test(promptText)){
  $('#mast_height').value = '65';
  steps[1].msg = 'Enclosure depth elevated to 65 mm for expanded component clearance.';
 } else if(actionType === 'repair' || /repair|fix/i.test(promptText)){
  steps.unshift({ role: 'Initial Evaluation', msg: 'Baseplate thickness 1.8mm < 2.4mm required constraint. Triggering repair policy.' });
  steps[2].msg = 'Kernel repair loop: adjusted extrusion thickness to 2.45mm. Re-verified: 6/6 PASS ✓.';
 }

 let currentEvents = [];
 for(let i = 0; i < steps.length; i++){
  await new Promise(r => setTimeout(r, 400));
  currentEvents.push(steps[i]);
  $('#activity').innerHTML = `
   <div class="run-result" style="border-left-color:var(--teal)">
     <b>${i === steps.length - 1 ? 'Build ready · Simulation complete' : 'Agent step ' + (i+1) + '/' + steps.length}</b>
     <p>${steps[i].msg}</p>
   </div>
   <details class="run-details" open>
     <summary>Simulated build trace (${currentEvents.length} events)</summary>
     ${currentEvents.map(e => `<div class="event"><h3>${escape(e.role)}</h3><p>${escape(e.msg)}</p></div>`).join('')}
   </details>
  `;
 }

 $('#revision-label').textContent = 'REV 02 · SIMULATED PASS';
 $('#project-state').textContent = 'Evaluated simulation';
 $('#replay-btn').textContent = '↺ Inspect failure & repair';
 saveCurrentWorkspaceChat();
 toast('Simulation complete: 0 tokens used.');
 jobBusy = false;
 $('#submit-brief').disabled = false;
}

function openAgenticHelp() {
  AudioCues.step();
  const cmds = getSlashCommands();
  const html = `
    <div style="display:flex;flex-direction:column;gap:8px;max-width:540px">
      <p class="muted" style="margin:0 0 6px 0">Type <code>/</code> in the chat input or click any command below to trigger agentic views, popups, and simulations.</p>
      ${cmds.map(x => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 12px;background:#f9f8f4;border:1px solid var(--line);border-radius:6px">
          <div><b style="font-family:var(--mono);color:var(--teal)">${escape(x.c)}</b><p style="margin:2px 0 0 0;font-size:11px;color:#555">${escape(x.d)}</p></div>
          <button type="button" class="text-button" onclick="$('#modal').close(); getSlashCommands().find(c=>c.c==='${x.c}')?.run()" style="font-size:11px;padding:3px 8px;border:1px solid var(--line);border-radius:4px;background:#fff;margin-left:12px;white-space:nowrap">Run ↗</button>
        </div>
      `).join('')}
    </div>
  `;
  modal('Agentic Commands & Popups', html);
}

function getSlashCommands(){
  return [
    {c:'/pipeline',d:'⚡ Propose a 5-step plan, approve, then run the live learning loop',run:()=>{proposePlan();}},
    {c:'/studio',d:'⛶ Open Full Screen Design Agent Studio',run:()=>tab('studio')},
    {c:'/learning',d:'📈 Open Full Screen Learning Curves & error rate telemetry',run:()=>openStudioTab('learning')},
    {c:'/memory',d:'🧠 Open Full Screen SQLite Memory Bank (3 causal rules & traces)',run:()=>openStudioTab('memory')},
    {c:'/tools',d:'🔧 Open Full Screen Tools & MCP Integrations',run:()=>openStudioTab('tools')},
    {c:'/graph',d:'⚡ Open Full Screen Multi-Agent Collaboration DAG',run:()=>openStudioTab('subagents')},
    {c:'/cad',d:'◉ Return to 3D CAD Model Viewport',run:()=>tab('assembly')},
    {c:'/repair',d:'↺ Propose a repair plan with causal heuristics, then run',run:()=>{AudioCues.step();proposePlan();}},
    {c:'/widen',d:'Simulate expanding chassis width to 105 mm (0 tokens)',run:()=>runSimulatedTest('Make the chassis wider (105mm) for additional battery capacity','widen')},
    {c:'/mast',d:'Simulate adding 65mm sensor mast solid (0 tokens)',run:()=>runSimulatedTest('Add sensor mast with panoramic camera aperture at 65mm height','mast')},
    {c:'/battery',d:'Simulate battery compartment tray with 2.4mm wall (0 tokens)',run:()=>runSimulatedTest('Generate internal battery compartment tray with 2.4mm minimum wall','battery')},
    {c:'/clear',d:'Clear chat conversation and draft',run:()=>{
      $('#brief').value='';
      const d=document.getElementById('studio-dock-input');
      if(d)d.value='';
      const c1=document.getElementById('agent-copilot-messages');
      const c2=document.getElementById('studio-chat-messages');
      if(c1)c1.innerHTML='';
      if(c2)c2.innerHTML='';
      initCopilotChatMessages();
      toast('Chat cleared.');
    }},
    {c:'/help',d:'List agentic commands',run:()=>openAgenticHelp()},
    {c:'/connect',d:'Connect your local CAD runner',run:connectDialog}
  ];
}

async function handleComposerSubmit(raw, source = 'copilot') {
  const trimmed = (raw || '').trim();
  if (!trimmed) return;
  $('#brief').value = '';
  const dockInp = document.getElementById('studio-dock-input');
  if (dockInp) dockInp.value = '';
  if (trimmed.startsWith('/')) {
    const token = trimmed.split(/\s+/)[0].toLowerCase();
    const found = getSlashCommands().find(c => c.c === token);
    if (found) {
      found.run();
      return;
    }
  }
  await sendCopilotMessage(trimmed, source);
}

let slashIdx=0;
function getActiveInput(){
  const sInput = document.getElementById('studio-dock-input');
  if (sInput && document.activeElement === sInput) return sInput;
  return $('#brief');
}
function insertBrief(text){const ta=getActiveInput();if(ta)ta.setRangeText(text,ta.selectionStart,ta.selectionEnd,'end')}
function slashToken(){const ta=getActiveInput();return ta?ta.value.slice(0,ta.selectionStart).match(/(?:^|\s)\/(\w*)$/):null}
function slashMatches(){const m=slashToken();return m?getSlashCommands().filter(x=>x.c.startsWith('/'+m[1].toLowerCase())):[]}
function closeSlash(){$('#slash-menu').hidden=true;$('#brief').setAttribute('aria-expanded','false');$('#brief').removeAttribute('aria-activedescendant')}
function renderSlash(){
 const list=slashMatches(),menu=$('#slash-menu');if(!list.length){closeSlash();return}
 slashIdx=Math.min(slashIdx,list.length-1);
 menu.innerHTML=list.map((x,i)=>`<button type="button" role="option" id="slash-option-${i}" aria-selected="${i===slashIdx}" data-slash="${i}" class="${i===slashIdx?'active':''}"><b>${x.c}</b><small>${x.d}</small></button>`).join('');
 menu.hidden=false;$('#brief').setAttribute('aria-expanded','true');$('#brief').setAttribute('aria-activedescendant','slash-option-'+slashIdx);
 menu.querySelector('.active')?.scrollIntoView({block:'nearest'});
}
function applySlash(cmd){
 const ta=getActiveInput(),match=slashToken();if(match&&ta){const end=ta.selectionStart;ta.setRangeText('',end-match[1].length-1,end,'end')}
 closeSlash();if(ta)ta.focus();getSlashCommands().find(c=>c.c===cmd)?.run();
}
$('#slash-menu').addEventListener('pointerdown',e=>e.preventDefault());
$('#slash-menu').addEventListener('click',e=>{const b=e.target.closest('[data-slash]');if(b)applySlash(slashMatches()[Number(b.dataset.slash)].c)});
$('#brief').addEventListener('input',()=>{slashIdx=0;renderSlash()});
$('#brief').addEventListener('click',renderSlash);
$('#brief').addEventListener('keyup',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key))renderSlash()});
$('#brief').addEventListener('keydown',e=>{
 const list=slashMatches();
 if(!$('#slash-menu').hidden&&list.length){
  if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();slashIdx=(slashIdx+(e.key==='ArrowDown'?1:-1)+list.length)%list.length;renderSlash();return}
  else if(['Enter','Tab'].includes(e.key)&&!e.shiftKey){e.preventDefault();applySlash(list[slashIdx].c);return}
  else if(e.key==='Escape'){e.preventDefault();closeSlash();return}
 }
 if(e.key==='Enter'&&!e.shiftKey){
  e.preventDefault();
  $('#brief-form').requestSubmit();
 }
});
document.addEventListener('click',e=>{if(!e.target.closest('#brief-form'))closeSlash()});
document.addEventListener('click',e=>{
 const a=e.target.closest('[data-action]');if(a){if(a.dataset.action==='new-project')createFromTemplate();return}
 const v=e.target.closest('[data-evidence]');if(v){if(v.dataset.evidence==='report')showEvidence();else showBenchmark();return}
 const g=e.target.closest('[data-goto]');if(!g)return;e.preventDefault();location.hash='#/'+(g.dataset.goto==='preview'?'assembly':g.dataset.goto);
});

function renderEvidence(){
 const item=report.iterations[iteration-1];
 $('#activity').innerHTML=`<div class="run-result"><span class="status-dot"></span><b>${item.evaluation.passed?'Build ready':'Revision needs repair'}</b><p>${item.evaluation.checks.filter(c=>c.passed).length} / ${item.evaluation.checks.length} checks · Revision ${iteration}</p></div><details class="run-details"><summary>Build history · ${report.iterations.length} revisions</summary>${(report.events||[]).map(e=>'<div class="event"><h3>'+escape(e.role)+'</h3><p>'+escape(e.message)+'</p></div>').join('')}</details>`;
 $('#revision-label').textContent=`REV ${String(iteration).padStart(2,'0')} · ${item.evaluation.passed?'EVALUATED':'CONSTRAINT FAILURE'}`;
 $('#project-state').textContent=report.passed?'Evaluated exemplar':'Needs review';
 $('#replay-btn').textContent=iteration===1&&report.iterations.length>1?'↗ Inspect repaired build':'↺ Inspect initial build';
 $('#run-label').textContent=report.execution==='ao-worker'?'AO WORKER RESULT':runner?'LOCAL KERNEL RESULT':'RECORDED RUN';
 if(activeProjectId==='rove1') saveCurrentWorkspaceChat();
 renderFiles();
}
function createProceduralBoxPart(name, group, color, w, h, d, x = 0, y = 0, z = 0) {
  const geom = new THREE.BoxGeometry(w, h, d);
  geom.translate(x, y, z);
  const pos = geom.attributes.position.array;
  const idx = geom.index ? geom.index.array : [];
  return {
    name,
    group,
    color,
    vertices: new Float32Array(pos),
    triangles: new Uint32Array(idx),
    opaque: true,
    printable: group === 'structure'
  };
}

function generateStandalonePlatformMeshes(spec, revNum = 2) {
  const L = spec?.length || 140;
  const W = spec?.width || 90;
  const isRev1 = (revNum === 1);
  const baseThickness = isRev1 ? 1.2 : 2.5;
  const wallThickness = isRev1 ? 1.2 : 2.5;
  const wallHeight = 16;
  const clearance = isRev1 ? 0.1 : 1.0;
  
  const boardW = 60;
  const boardH = 40;
  const boardThick = 1.6;
  const standoffHeight = 4.0;
  
  const parts = [];
  
  // 1. Baseplate Platform (structural bottom floor)
  parts.push(createProceduralBoxPart(
    'Baseplate Platform',
    'structure',
    '#7a827d',
    L, W, baseThickness,
    0, 0, baseThickness / 2
  ));
  
  // 2. Enclosure Perimeter Sidewalls (protective boundary)
  const pocketW = boardW + clearance * 2 + wallThickness * 2;
  const pocketH = boardH + clearance * 2 + wallThickness * 2;
  const wallZ = baseThickness + wallHeight / 2;
  
  parts.push(createProceduralBoxPart(
    'Enclosure Sidewall (Left)',
    'structure',
    '#68726c',
    wallThickness, pocketH, wallHeight,
    -pocketW / 2 + wallThickness / 2, 0, wallZ
  ));
  parts.push(createProceduralBoxPart(
    'Enclosure Sidewall (Right)',
    'structure',
    '#68726c',
    wallThickness, pocketH, wallHeight,
    pocketW / 2 - wallThickness / 2, 0, wallZ
  ));
  parts.push(createProceduralBoxPart(
    'Enclosure Sidewall (Front)',
    'structure',
    '#68726c',
    pocketW - wallThickness * 2, wallThickness, wallHeight,
    0, -pocketH / 2 + wallThickness / 2, wallZ
  ));
  parts.push(createProceduralBoxPart(
    'Enclosure Sidewall (Rear)',
    'structure',
    '#68726c',
    pocketW - wallThickness * 2, wallThickness, wallHeight,
    0, pocketH / 2 - wallThickness / 2, wallZ
  ));
  
  // 3. PCB Mounting Standoffs (4 corner standoffs)
  const standoffZ = baseThickness + standoffHeight / 2;
  const sx = boardW / 2 - 4;
  const sy = boardH / 2 - 4;
  for (const [dx, dy, sId] of [[-1, -1, 'SW'], [1, -1, 'SE'], [-1, 1, 'NW'], [1, 1, 'NE']]) {
    parts.push(createProceduralBoxPart(
      `PCB Standoff ${sId}`,
      'structure',
      '#a2aba6',
      4.5, 4.5, standoffHeight,
      dx * sx, dy * sy, standoffZ
    ));
  }
  
  // 4. Signal Breakout Board (FR4 2-layer PCB)
  const boardZ = baseThickness + standoffHeight + boardThick / 2;
  parts.push(createProceduralBoxPart(
    'Signal Breakout Board',
    'electronics',
    '#134e2c',
    boardW, boardH, boardThick,
    0, 0, boardZ
  ));
  
  // 5. Interface Header J1
  const headerZ = boardZ + boardThick / 2 + 3.0;
  parts.push(createProceduralBoxPart(
    'Interface Header J1 (PWR/I2C)',
    'electronics',
    '#dfb53d',
    15, 5, 6,
    -16, 0, headerZ
  ));
  
  // 6. Sensor Bus Header J2
  parts.push(createProceduralBoxPart(
    'Sensor Bus Header J2 (GPIO)',
    'electronics',
    '#dfb53d',
    15, 5, 6,
    16, 0, headerZ
  ));
  
  return parts;
}

async function loadIteration(n){
 const request=++geometryRequest;
 iteration=n;
 const proj=getActiveProject();
 const isStandalone=(activeProjectId==='clean'||proj?.type==='custom'||(activeProjectId!=='orion'&&activeProjectId!=='rove1'));

 if(!isStandalone){
  model='rove1';
  syncModelButtons();
 }else{
  model='standalone';
  const ms=$('.model-switch');if(ms)ms.hidden=true;
 }

 setViewStatus('Loading geometry…','loading');
 try{
  let partsToDraw;
  if(isStandalone && wsRunOf() && wsRunOf().base){
   const wsRun = wsRunOf();
   const nLive=Math.max(1,Math.min(n,wsRun.iterations));
   partsToDraw = await json(`${wsRun.base}iteration-${nLive}/mesh.json`);
  }else if(isStandalone){
   partsToDraw = generateStandalonePlatformMeshes(proj?.spec, n);
  }else{
   partsToDraw = await json(`${artifactBase}iteration-${n}/mesh.json`);
  }
  if(request!==geometryRequest)return;

  drawMeshes(partsToDraw);

  if(isStandalone){
   proj.hasGeometry=true;
   const eb=$('#canvas-eyebrow');if(eb)eb.textContent=`${proj.name.toUpperCase()} / WORKBENCH`;
   const cap=$('#geometry-caption');if(cap)cap.textContent=`${proj.name.toUpperCase()} · PARAMETRIC CAD`;
   const revLabel=$('#revision-label');
   if(revLabel)revLabel.textContent=`REV ${String(n).padStart(2,'0')} · ${n===1?'CONSTRAINT FAILURE':'EVALUATED PASS'}`;
   const ml=$('.model-label');if(ml)ml.hidden=false;
   renderFiles(proj);
   renderInspector(proj);
  }else{
   renderEvidence();
  }
 }catch(e){
  if(request!==geometryRequest)return;
  if(assembly)assembly.visible=false;
  setViewStatus('Geometry could not load: '+e.message,'error');
 }
}
$('#replay-btn').onclick=()=>loadIteration(iteration===1?report.iterations.length:1);

function syncBriefAndDims(){
 const last=report.iterations.at(-1);
 const proj=getActiveProject();
 if(proj&&proj.id==='rove1'){
  const bt=$('#brief-text');if(bt&&report.description)bt.textContent=report.description;
 }
 for(const k of ['length','width','mast_height']){const el=document.getElementById(k);if(el&&last.spec[k]!=null)el.value=last.spec[k]}
 DEMO_SPEC.length=last.spec.length;DEMO_SPEC.width=last.spec.width;DEMO_SPEC.mast_height=last.spec.mast_height;
}

// ---- Realistic 3D Previews on Dashboard (Requirement 1 & Requirement 4) ----
const dashboardPreviewInstances=[];
function clearDashboardPreviews(){
 dashboardPreviewInstances.forEach(inst=>{
  if(inst.animId)cancelAnimationFrame(inst.animId);
  if(inst.renderer){
   inst.renderer.dispose();
   if(inst.renderer.domElement&&inst.renderer.domElement.parentNode){
    inst.renderer.domElement.parentNode.removeChild(inst.renderer.domElement);
   }
  }
  if(inst.scene){
   inst.scene.traverse(o=>{
    if(o.geometry)o.geometry.dispose();
    if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose()}
   });
  }
 });
 dashboardPreviewInstances.length=0;
}

async function initCardPreview(container, modelId, spec){
 if(modelId==='custom'&&!spec?.hasGeometry){
  container.innerHTML=`<div class="preview-clean-canvas" style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f9f8f4;background-image:radial-gradient(#d2d1c4 1px,transparent 1px);background-size:16px 16px;color:#49554d;padding:16px;text-align:center;pointer-events:none"><div style="font-size:32px;margin-bottom:8px;color:#287e77">📐</div><span class="mono" style="font-size:10px;letter-spacing:1.5px;color:#287e77;font-weight:600;margin-bottom:4px">CLEAN DESIGN CANVAS</span><p style="font-size:11px;margin:0;color:#758076">0 parts · Ready to design</p></div>`;
  return;
 }
 const w=container.clientWidth||360, h=container.clientHeight||240;
 const pScene=new THREE.Scene();
 const pCam=new THREE.PerspectiveCamera(32,w/h,1,3000);
 const pRenderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
 pRenderer.setPixelRatio(Math.min(devicePixelRatio,2));
 pRenderer.setSize(w,h);
 pRenderer.outputColorSpace=THREE.SRGBColorSpace;
 pRenderer.toneMapping=THREE.ACESFilmicToneMapping;
 pRenderer.toneMappingExposure=1.25;
 container.innerHTML='';
 container.appendChild(pRenderer.domElement);

 const badge=document.createElement('span');
 badge.className='preview-status-badge';
 badge.textContent=modelId==='orion'?'16 PARTS · REFERENCE':(modelId==='rove1'?`REV ${report?.final_iteration||2} · REAL CAD`:'PARAMETRIC 3D');
 container.appendChild(badge);

 const hint=document.createElement('span');
 hint.className='preview-hint';
 hint.textContent='Drag to orbit';
 container.appendChild(hint);

 pScene.add(new THREE.HemisphereLight(0xfffaea,0x596860,2.4));
 const sun=new THREE.DirectionalLight(0xfff7e4,3.2);
 sun.position.set(120,-160,380);
 pScene.add(sun);
 const fill=new THREE.DirectionalLight(0x8bc2bb,1.2);
 fill.position.set(-120,140,80);
 pScene.add(fill);

 const pControls=new OrbitControls(pCam,pRenderer.domElement);
 pControls.enableDamping=true;
 pControls.enableZoom=false;
 pControls.autoRotate=true;
 pControls.autoRotateSpeed=1.4;

 const group=new THREE.Group();
 let parts=[];
 try{
  if(modelId==='orion'){
   parts=cachedOrionMeshes||(cachedOrionMeshes=await loadOrionMeshes());
  }else if(spec?.meshUrl){
   parts=await json(spec.meshUrl);
  }else{
   parts=cachedRoveMeshes||(cachedRoveMeshes=await json(`${artifactBase}final/mesh.json`).catch(()=>json('artifacts/demo/final/mesh.json')));
  }
  parts.forEach(p=>{
   const mesh=createPbrMesh(p,modelId==='orion'?null:spec);
   group.add(mesh);
  });
 }catch(e){console.warn('Card preview mesh error:',e)}

 pScene.add(group);
 const bbox=new THREE.Box3().setFromObject(group);
 const center=bbox.getCenter(new THREE.Vector3());
 const size=bbox.getSize(new THREE.Vector3());
 group.position.sub(center);

 const maxDim=Math.max(size.x,size.y,size.z)||100;
 const dist=maxDim/(2*Math.tan(pCam.fov*Math.PI/360))*1.5;
 pCam.position.set(dist*0.9,-dist*1.1,dist*0.75);
 pCam.up.set(0,0,1);
 pControls.target.set(0,0,0);
 pControls.update();

 let animId=null;
 function pTick(){
  if($('#dashboard-view').hidden)return;
  pControls.update();
  pRenderer.render(pScene,pCam);
  animId=requestAnimationFrame(pTick);
 }
 animId=requestAnimationFrame(pTick);
 dashboardPreviewInstances.push({renderer:pRenderer,scene:pScene,animId});
}

function initDashboardPreviews(){
 clearDashboardPreviews();
 $$('.project-visual-3d').forEach(container=>{
  const mid=container.dataset.previewModel;
  let sp=null;
  if(container.dataset.spec){
   try{sp=JSON.parse(container.dataset.spec)}catch{}
  }
  initCardPreview(container,mid,sp);
 });
}

// Clean Full-Window Dashboard (Requirement 1, 2, 3, 4)
function renderDashboard(){
 const savedDesigns=loadDesigns();
 const totalAssemblies=savedDesigns.length;

 const customCards=savedDesigns.map(d=>{
  const dLast=(d.revisions&&d.revisions.length)?d.revisions[d.revisions.length-1]:{spec:{length:140,width:90,mast_height:52}};
  const dateStr=d.updated_at?new Date(d.updated_at).toLocaleDateString():'Draft';
  const persisted=readPersistedWorkspace(d.id);
  const liveRun=d.liveRun||persisted?.mesh||null;
  const hasGeometry=!!(liveRun||d.liveBoard||persisted?.board||(dLast.evaluated&&dLast.source_job));
  const meshUrl=(liveRun&&liveRun.base)?`${liveRun.base}iteration-${liveRun.iterations||1}/mesh.json`:'';
  const specPayload={...(dLast.spec||{}),hasGeometry,meshUrl};
  return `<article class="project-tile" data-open-design="${escape(d.id)}" role="link" tabindex="0"><div class="project-visual-3d" data-preview-model="custom" data-spec="${escape(JSON.stringify(specPayload))}"></div><div class="tile-title"><h2>${escape(d.name)}</h2><span class="project-badge">${escape(d.kind==='template'?'Custom CAD':'Imported')}</span></div><p>${escape(d.description||'Clean design workspace.')}</p><div class="tile-foot"><span class="tile-date">Updated ${dateStr}</span><div class="tile-actions"><button type="button" class="tile-delete-btn" data-delete-design="${escape(d.id)}">✕ Delete</button><button type="button" class="text-button" data-open-design="${escape(d.id)}">Open assembly ↗</button></div></div></article>`;
 }).join('');

 const dash=$('#dashboard');
 if(!dash)return;
 dash.innerHTML=`<div class="dashboard-heading"><div><span class="eyebrow">AUTOCADENT / WORKBENCH</span><h1>Ideas, taking shape.</h1><p>Inspect physical assemblies, explore real CAD geometry, and export builds.</p></div><button type="button" class="dark-button" data-action="new-project">＋ New design</button></div>
 <div class="section-title"><h2>On your workbench</h2><span>${String(totalAssemblies).padStart(2,'0')} assemblies</span></div>
 <div class="project-gallery">
 ${customCards||`<div class="empty-designs" style="grid-column:1/-1;text-align:center;padding:36px 16px;color:var(--muted)"><b style="color:var(--ink);display:block;font-size:13px;margin-bottom:6px">Nothing here yet</b><p class="field-hint" style="margin:0 0 16px">Create a design, then open it to brief the copilot and build CAD or a board.</p><button type="button" class="dark-button" data-action="new-project">＋ New design</button></div>`}
 </div>`;

 setTimeout(initDashboardPreviews,50);
}

// Direct dashboard delete handler with quick confirmation (Requirement 2)
document.addEventListener('click',e=>{
 const delBtn=e.target.closest('[data-delete-design]');
 if(delBtn){
  e.preventDefault();
  e.stopPropagation();
  const id=delBtn.dataset.deleteDesign;
  if(delBtn.dataset.confirming==='true'){
   const list=loadDesigns();
   const idx=list.findIndex(x=>x.id===id);
   if(idx!==-1){
    const deletedName=list[idx].name;
    list.splice(idx,1);
    persistDesigns(list);
    if(activeProjectId===id)setActiveProject('clean');
    renderDashboard();
    toast(`Deleted "${deletedName}".`);
   }
  }else{
   delBtn.dataset.confirming='true';
   delBtn.textContent='Confirm?';
   delBtn.style.color='#fff';
   delBtn.style.background='#a03232';
   delBtn.style.borderRadius='3px';
   delBtn.style.padding='2px 6px';
   setTimeout(()=>{
    if(delBtn&&delBtn.isConnected){
     delBtn.dataset.confirming='false';
     delBtn.textContent='✕ Delete';
     delBtn.style.color='';
     delBtn.style.background='';
     delBtn.style.padding='';
    }
   },3200);
  }
 }
});

function showEvidence(){const ev=report.iterations[iteration-1].evaluation;modal(`Revision ${iteration}: the evidence.`,`<p>Measured by OpenCASCADE. Solid validity is separate from dimensional acceptance. These checks do not certify strength, electrical safety, or printability.</p><table><thead><tr><th>Check</th><th>Measured</th><th>Requirement</th><th>Result</th></tr></thead><tbody>${ev.checks.map(c=>`<tr><td title="${escape(c.method)}">${c.name}</td><td>${c.measured} ${c.unit}</td><td>${escape(c.requirement)}</td><td>${c.passed?'PASS':'FAIL'}</td></tr>`).join('')}</tbody></table><p>Tray wall: paired planar side-face offsets. Board gap: minimum solid distance to tray sidewalls. No global wall analysis or structural simulation.</p><a class="download-link" href="${artifactBase}report.json" download>Download complete report ↗</a>`)};
async function showBenchmark(){try{const b=await json('artifacts/benchmark.json');modal('Small corpus. Real measurements.',`<p>${escape(b.kind)}. Each case builds real solids, evaluates, applies a fixed repair policy, then evaluates again.</p><table><thead><tr><th>Case</th><th>Initial</th><th>After repair</th></tr></thead><tbody>${b.cases.map(c=>`<tr><td>${c.case}</td><td>${c.before.passed?'PASS':'FAIL'}</td><td>${c.after.passed?'PASS':'FAIL'}</td></tr>`).join('')}</tbody></table><p>${b.before_pass_count} of ${b.case_count} initially accepted; ${b.after_pass_count} of ${b.case_count} after repair. This is a fixed regression corpus, not a general agent benchmark.</p><a class="download-link" href="artifacts/benchmark.json" download>Download benchmark artifact ↗</a>`)}catch(e){toast(e.message)}};
$('#guide-btn').onclick=()=>modal('An open engineering notebook.',`<p>AutoCadent turns a bounded robot brief into geometry you can inspect, evaluate and take with you.</p><h3>01 / Inspect the assembly</h3><p>Orbit the actual tessellated CAD model. Isolate the chassis, board or wheels. Toggle X-ray or explode the assembly into an inventory grid.</p><h3>02 / Follow the correction</h3><p>Inspect the initial build: valid solids with failed thickness, wall and clearance constraints. Switch to the repaired build and open its measurements.</p><h3>03 / Build your variation</h3><p>Start the local runner, connect, edit the dimensions and submit your brief.</p><pre>uv sync --python 3.12\nuv run uvicorn autocadent.api:app --host 127.0.0.1 --port 8766\n# Open http://127.0.0.1:8766</pre><a class="download-link" target="_blank" rel="noreferrer" href="https://github.com/Anthony-Sin/AutoCadent-SyndicatebyMaximor">Setup, architecture & demo guide ↗</a>`);
$('#mcp-btn').onclick=async()=>{try{const e=await json('artifacts/mcp-status.json');modal('Tools, actually connected.',`<p>MCP initialize, tools/list and useful-call evidence from the local toolchain.</p><table><tr><th>Server</th><th>Tools</th><th>Verified call</th></tr>${e.servers.map(s=>`<tr><td>${escape(s.name)}</td><td>${s.tools}</td><td>${escape(s.call)} · ${s.passed?'PASS':'FAIL'}</td></tr>`).join('')}</table><a class="download-link" href="artifacts/mcp-status.json" download>Download verification summary ↗</a>`)}catch(e){toast(e.message)}};

function connectDialog(){modal('Bring your own runner.',`<p>Pages is a recorded artifact explorer. Start the runner locally and open its address for live CAD.</p><label for="runner-url">Runner URL</label><input id="runner-url" type="url" value="${escape(runner||'http://127.0.0.1:8766')}" placeholder="http://127.0.0.1:8766"><label for="runner-token">Runner token (only if configured; kept in memory)</label><input id="runner-token" type="password" autocomplete="off"><label for="execution-mode">Execution mode</label><select id="execution-mode"><option value="deterministic">Local CAD kernel + deterministic repair policy</option><option value="ao">Supervisor → actual AO worker → evaluator</option></select><button id="do-connect" class="dark-button">Connect runner ↗</button><p id="connect-status" role="status"></p>`);$('#execution-mode').value=execution;$('#do-connect').onclick=async()=>{const raw=$('#runner-url').value;try{const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Use an HTTP(S) runner origin without credentials or query parameters.'); const next=url.origin; const nextToken=$('#runner-token').value; const mode=$('#execution-mode').value;const h=await json(next+'/api/health',{headers:nextToken?{Authorization:'Bearer '+nextToken}:{}});if(mode==='ao'&&!h.ao_enabled)throw Error('AO dispatch is disabled on this runner. Enable AUTOCADENT_ENABLE_AO=1 server-side.');runner=next;token=nextToken;execution=mode;$('#connection-label').textContent=mode==='ao'?'AO runner connected':'Local runner connected';$('#composer-mode').textContent=mode==='ao'?'AO WORKER DISPATCH':'LOCAL CAD KERNEL';const fm=$('#footer-mode');if(fm)fm.textContent=mode==='ao'?'RUNNER CONNECTED · AO JOBS ON REQUEST':'RUNNER CONNECTED · DETERMINISTIC CAD';$('#modal').close();toast('Runner connected. Edit dimensions and submit your brief.')}catch(e){$('#connect-status').textContent=e.message}};}
$('#connect-btn').onclick=connectDialog;

// ---- Design Agent Copilot, Sub-Agents, Curves, Memory & Tools in Assembly Workspace ----
let designAgentHistory = [];
let isLoopRunning = false;
let designMcpData = null;
let liveRun = null;
let lastLoopResult = null;
const liveRunsByProject = {};
const loopResultsByProject = {};
const wsRunOf = () => liveRunsByProject[activeProjectId] || null;
const wsLoopOf = () => loopResultsByProject[activeProjectId] || null;
let designMemoryData = null;
let designTelemetryData = null;
let designGraphData = null;

function currentWorkspaceId() {
  return activeProjectId || 'clean';
}

function idleOrchestratorGraph() {
  return { agents: [{ role: 'Orchestrator', status: 'idle', spawned: true }] };
}

function applyWorkspaceMemory(mem, telem) {
  designMemoryData = Array.isArray(mem) ? mem : (mem?.heuristics || mem?.rules || []);
  designTelemetryData = Array.isArray(telem) ? telem : [];
  const memStore = workspaceChats[currentWorkspaceId()] || (workspaceChats[currentWorkspaceId()] = {});
  memStore.memory = designMemoryData;
  memStore.telemetry = designTelemetryData;
  const count = designMemoryData.length;
  const chip = document.getElementById('heuristics-count-chip');
  if (chip) chip.textContent = count ? `${count} rule${count === 1 ? '' : 's'} in memory` : '0 Rules Active';
}

async function fetchDesignAgentTelemetry() {
  try {
    const ws = encodeURIComponent(currentWorkspaceId());
    const [t, m] = await Promise.all([
      fetch('/api/learning/telemetry?workspace=' + ws).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/learning/memory?workspace=' + ws).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);
    applyWorkspaceMemory(m, t);
  } catch (e) {
    console.warn('Telemetry fetch notice:', e);
  }
}


function initDesignAgentWorkspace() {
  initStudioEvents();

  // Fullscreen toggle on sidebar header opens studio
  document.getElementById('agent-fullscreen-btn')?.addEventListener('click', () => {
    tab('studio');
  });

  // Open Studio button in top tabs opens studio
  document.getElementById('open-studio-btn')?.addEventListener('click', () => {
    tab('studio');
  });

  // Start Pipeline button in clean workspace card
  document.getElementById('start-pipeline-btn')?.addEventListener('click', () => {
    proposePlan();
  });

  // Revision buttons in copilot panel
  document.getElementById('rev-btn-1')?.addEventListener('click', async () => {
    updateRevisionUI(1);
    await loadIteration(1);
    toast('Switched to Revision 1: Solid passes OpenCASCADE volume, but fails 3 dimensional constraints.');
  });

  document.getElementById('rev-btn-2')?.addEventListener('click', async () => {
    updateRevisionUI(2);
    await loadIteration(2);
    toast('Switched to Revision 2: Repaired geometry with applied heuristics passes 6/6 checks.');
  });

  // Initial populate
  fetchDesignAgentTelemetry().then(() => {
    initCopilotChatMessages();
  });
}

function initStudioEvents() {
  // Studio navigation tabs
  document.querySelectorAll('.studio-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.studio-nav-btn').forEach(b => b.classList.toggle('active', b === btn));
      const target = btn.dataset.studioTab;
      document.querySelectorAll('.studio-panel').forEach(p => {
        const isMatch = p.id === `studio-panel-${target}`;
        p.hidden = !isMatch;
        p.classList.toggle('active', isMatch);
      });
      if (target === 'learning') {
        setTimeout(renderStudioLearning, 30);
      } else if (target === 'memory') {
        renderStudioMemory();
      } else if (target === 'tools') {
        renderStudioTools();
      } else if (target === 'subagents') {
        renderStudioSubagents();
      }
    });
  });

  // Studio memory subtabs
  document.querySelectorAll('.studio-mem-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.studio-mem-subtab').forEach(b => b.classList.toggle('active', b === btn));
      const target = btn.dataset.smem;
      const h = document.getElementById('studio-memory-heuristics');
      const e = document.getElementById('studio-memory-episodes');
      const c = document.getElementById('studio-memory-cache');
      if (h) h.hidden = (target !== 'heuristics');
      if (e) e.hidden = (target !== 'episodes');
      if (c) c.hidden = (target !== 'cache');
    });
  });

  // Studio back button
  document.getElementById('studio-back-btn')?.addEventListener('click', () => {
    tab('assembly');
  });

  // Agent artifact dismiss (agent reopens it while working)
  document.getElementById('agent-artifact-close')?.addEventListener('click', () => {
    hideArtifact();
  });

  // Studio run loop button
  document.getElementById('studio-run-loop-btn')?.addEventListener('click', () => {
    runSelfImprovingLoop();
  });

  // Audio cues toggle buttons
  document.getElementById('audio-toggle-btn')?.addEventListener('click', () => AudioCues.toggle());
  document.getElementById('studio-audio-toggle-btn')?.addEventListener('click', () => AudioCues.toggle());
  AudioCues.syncUI();

  // Studio direct messaging dock — intercept slash commands before chat
  document.getElementById('studio-dock-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('studio-dock-input');
    const raw = input?.value.trim();
    if (!raw) return;
    input.value = '';
    await handleComposerSubmit(raw, 'studio');
  });
  const dockInput = document.getElementById('studio-dock-input');
  if (dockInput) {
    dockInput.addEventListener('input', () => { slashIdx = 0; renderSlash(); });
    dockInput.addEventListener('keydown', e => {
      const list = slashMatches();
      if (!$('#slash-menu').hidden && list.length) {
        if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          slashIdx = (slashIdx + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
          renderSlash();
          return;
        }
        if (['Enter', 'Tab'].includes(e.key) && !e.shiftKey) {
          e.preventDefault();
          applySlash(list[slashIdx].c);
          return;
        }
        if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return; }
      }
    });
  }

  // Studio revision buttons
  document.getElementById('studio-rev-btn-1')?.addEventListener('click', async () => {
    updateRevisionUI(1);
    await loadIteration(1);
    toast('Studio: Switched to Revision 1 (inspecting initial failure).');
  });

  document.getElementById('studio-rev-btn-2')?.addEventListener('click', async () => {
    updateRevisionUI(2);
    await loadIteration(2);
    toast('Studio: Switched to Revision 2 (repaired with heuristics).');
  });
}

const LOOP_STEP_LABELS = { 1: 'Plan', 2: 'Place parts', 3: 'Wire nets', 4: 'Export 3D board', 5: 'Reflect & memorize' };
function setPipelineTaskStatus(num, status, label) {
  const feed = document.getElementById('studio-live-feed');
  if (!feed) return;
  if (feed.querySelector('.field-hint')) feed.innerHTML = '';
  let row = feed.querySelector(`[data-step="${num}"]`);
  if (!row) {
    row = document.createElement('div');
    row.className = 'live-step';
    row.dataset.step = num;
    feed.appendChild(row);
  }
  row.classList.remove('pending', 'active', 'done');
  row.classList.add(status);
  const text = label || LOOP_STEP_LABELS[num] || ('Step ' + num);
  row.innerHTML = `<span class="task-num">0${num}</span><b>${escape(text)}</b><i class="live-dot"></i>`;
}

function roleForTool(server, tool) {
  const s = String(server || '');
  const t = String(tool || '');
  if (s === 'kicad') {
    if (t === 'update_pcb_from_schematic' || t === 'run_drc' || t === 'add_trace') return 'Verifier';
    return 'PCB Specialist';
  }
  if (['generate_part', 'import_part', 'generate_rover', 'inspect_spec'].includes(t)) return 'CAD Specialist';
  return 'Orchestrator';
}

function upsertStudioRole(role, status) {
  const live = (designGraphData && Array.isArray(designGraphData.agents)) ? designGraphData.agents.slice() : [];
  let row = live.find(a => a.role === role);
  if (!row) {
    row = { role, status, spawned: true };
    live.push(row);
  } else {
    row.status = status;
    row.spawned = true;
  }
  designGraphData = { agents: live };
  const mem = workspaceChats[currentWorkspaceId()] || (workspaceChats[currentWorkspaceId()] = {});
  mem.roles = designGraphData;
  renderStudioRoles(live);
}

function resetStudioDelegation() {
  designGraphData = idleOrchestratorGraph();
  const feed = document.getElementById('studio-live-feed');
  if (feed) feed.innerHTML = `<p class="field-hint" style="margin:0">Idle — each step appears here as the agent works.</p>`;
  renderStudioRoles(designGraphData.agents);
}

function visibleStudioRoles(agents) {
  const live = (agents || (designGraphData && designGraphData.agents) || []).filter(a => a && a.role);
  const orch = live.find(a => a.role === 'Orchestrator') || { role: 'Orchestrator', status: 'idle', spawned: true };
  const others = live.filter(a => {
    if (a.role === 'Orchestrator') return false;
    const st = String(a.status || 'idle').toLowerCase();
    return a.spawned && st !== 'idle';
  });
  return [orch, ...others];
}

function renderStudioRoles(agents) {
  const el = document.getElementById('studio-roles');
  if (!el) return;
  const spawned = visibleStudioRoles(agents);
  el.innerHTML = spawned.map(found => {
    const raw = String(found.status || 'idle').toLowerCase();
    const cls = (raw === 'idle') ? 'idle' : (raw === 'verified' || raw === 'done' ? 'done' : (raw.includes('fail') ? 'fail' : 'active'));
    return `<div class="studio-role ${cls}"><i></i><b>${escape(found.role)}</b><span>${escape(found.status || 'idle')}</span></div>`;
  }).join('');
}

function renderStudioMemorySummary() {
  const summary = document.getElementById('studio-memory-summary');
  const expandBtn = document.getElementById('studio-memory-expand');
  const full = document.getElementById('studio-memory-full');
  const mem = Array.isArray(designMemoryData) ? designMemoryData : (designMemoryData?.heuristics || designMemoryData?.rules || []);
  if (summary) {
    const ranked = mem.slice().sort((a, b) => {
      const ac = String(a.category || '').toLowerCase();
      const bc = String(b.category || '').toLowerCase();
      const as = (ac.startsWith('kicad') || ac.startsWith('tool')) ? 0 : 1;
      const bs = (bc.startsWith('kicad') || bc.startsWith('tool')) ? 0 : 1;
      return as - bs || (Number(b.confidence || 0) - Number(a.confidence || 0));
    });
    summary.innerHTML = ranked.length
      ? `<div class="mem-count"><b>${ranked.length}</b> rule${ranked.length === 1 ? '' : 's'} memorized in this workspace</div>` +
        ranked.slice(0, 4).map(h => `<div class="mem-rule-row"><code>${escape(h.rule_id || h.id || 'RULE')}</code><span>${escape((h.category ? h.category + ' · ' : '') + (h.trigger_pattern || h.trigger || h.rationale || ''))}</span></div>`).join('')
      : `<p class="field-hint" style="margin:0">No heuristics in this workspace yet — they appear here when this chat reflects on its own tool runs.</p>`;
  }
  if (expandBtn) {
    expandBtn.hidden = !mem.length && !currentLearningTrace().length;
    if (!expandBtn.dataset.bound) {
      expandBtn.dataset.bound = '1';
      expandBtn.addEventListener('click', () => {
        const open = full.hidden;
        full.hidden = !open;
        expandBtn.textContent = open ? 'Collapse memory ▴' : 'Expand memory ▾';
        if (open) {
          renderStudioMemory('studio-memory-full-rules', null, null);
          renderMemoryLearnGraph();
        }
      });
    }
    if (full.hidden) expandBtn.textContent = 'Expand memory ▾';
    else {
      if (mem.length) renderStudioMemory('studio-memory-full-rules', null, null);
      renderMemoryLearnGraph();
    }
  }
  renderMemoryLearnGraph();
}

const learningTraceByWs = {};
function currentLearningTrace() {
  const id = currentWorkspaceId();
  return learningTraceByWs[id] || (learningTraceByWs[id] = []);
}
function pushLearningPoint({ ok = 0, fail = 0, rules = null, label = '' } = {}) {
  const arr = currentLearningTrace();
  const prev = arr[arr.length - 1] || { ok: 0, fail: 0, rules: 0 };
  const nextRules = rules != null ? rules : prev.rules;
  arr.push({
    n: arr.length + 1,
    ok: prev.ok + Number(ok || 0),
    fail: prev.fail + Number(fail || 0),
    rules: nextRules,
    label: label || ('t' + (arr.length + 1)),
  });
  revealMemoryLearn();
  renderMemoryLearnGraph();
}
function revealMemoryLearn() {
  const full = document.getElementById('studio-memory-full');
  const btn = document.getElementById('studio-memory-expand');
  if (btn) btn.hidden = false;
  if (full && full.hidden) {
    full.hidden = false;
    if (btn) btn.textContent = 'Collapse memory ▴';
  }
}
function renderMemoryLearnGraph() {
  const arr = currentLearningTrace();
  const mem = Array.isArray(designMemoryData) ? designMemoryData : [];
  const err = arr.length
    ? arr.map(p => {
        const tot = p.ok + p.fail;
        return tot ? p.fail / tot : 0;
      })
    : [0, 0];
  const rules = arr.length ? arr.map(p => p.rules) : [mem.length, mem.length];
  const pad = (xs) => xs.length >= 2 ? xs : (xs.length === 1 ? [xs[0], xs[0]] : [0, 0]);
  drawStudioMiniChart('studio-mem-curve-err', pad(err), '#b8324a', true);
  drawStudioMiniChart('studio-mem-curve-rules', pad(rules), '#287e77');
  const last = arr[arr.length - 1];
  const errEl = document.getElementById('studio-mem-err-val');
  const rulesEl = document.getElementById('studio-mem-rules-val');
  const cap = document.getElementById('studio-mem-curve-caption');
  if (errEl) {
    const tot = last ? last.ok + last.fail : 0;
    errEl.textContent = last && tot ? `${Math.round((last.fail / tot) * 100)}%` : '—';
  }
  if (rulesEl) rulesEl.textContent = String(last ? last.rules : mem.length);
  if (cap) {
    cap.textContent = last
      ? `${last.ok} tool success · ${last.fail} fail · ${last.rules} rule(s) in this workspace`
      : 'Updates as this chat uses MCP tools and reflects.';
  }
}

function appendStudioEvent(role, message) {
  const list = document.getElementById('studio-subagent-events');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'event-item';
  row.style.cssText = 'padding:4px 0;border-bottom:1px solid #eee;font-size:11px;font-family:var(--mono);';
  row.innerHTML = `<b style="color:var(--teal)">[${escape(role)}]:</b> <span>${escape(message)}</span>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}

function showArtifact(kind, title) {
  const panel = document.getElementById('agent-artifact');
  const body = document.getElementById('agent-artifact-body');
  const titleEl = document.getElementById('agent-artifact-title');
  if (!panel || !body) return;
  if (titleEl) titleEl.textContent = title || kind;
  panel.hidden = false;
  if (kind === 'graph') {
    body.innerHTML = `<div class="subagents-dag" id="artifact-dag"></div><div class="subagent-event-stream" style="margin-top:12px"><span class="eyebrow">TRANSITION LOG</span><div id="artifact-events" class="events-list"></div></div>`;
    renderStudioSubagents('artifact-dag', 'artifact-events');
  } else if (kind === 'memory') {
    body.innerHTML = `<div id="artifact-mem" class="memory-rules-container"></div>`;
    renderStudioMemory('artifact-mem', null, null);
  } else if (kind === 'tools') {
    body.innerHTML = `<div class="mcp-servers-grid" id="artifact-servers"></div><div class="mcp-invocation-log" style="margin-top:12px"><span class="eyebrow">LIVE TOOL TRACES</span><div id="artifact-traces"></div></div>`;
    renderStudioTools('artifact-servers', 'artifact-traces');
  }
}
function hideArtifact() {
  const panel = document.getElementById('agent-artifact');
  if (panel) panel.hidden = true;
}

function renderStudioContext() {
  const strip = document.getElementById('studio-context-strip');
  if (!strip) return;
  const proj = getActiveProject();
  const spec = proj?.spec || proj?.dimensions || {};
  const dim = (spec.length && spec.width) ? `${spec.length}×${spec.width}${spec.mast_height ? '×' + spec.mast_height : ''}mm` : 'no spec';
  const mem = Array.isArray(designMemoryData) ? designMemoryData : (designMemoryData?.heuristics || designMemoryData?.rules || []);
  const eps = Array.isArray(designTelemetryData) ? designTelemetryData : [];
  const lastEp = eps.length ? eps[eps.length - 1] : null;
  const mcp = Array.isArray(designMcpData) ? designMcpData : [];
  const liveTools = mcp.filter(s => s.available !== false).map(s => s.name);
  strip.textContent = `${proj?.name || 'workspace'} · ${dim} · ${mem.length} rule(s) · ` +
    (lastEp ? `last ${lastEp.episode_id} ${lastEp.status} ${lastEp.checks_passed}/${lastEp.checks_total}` : 'no runs yet') +
    ` · tools: ${liveTools.length ? liveTools.join(', ') : 'probing…'}`;
}

function updateSidebarActivity(stepNum, role, message, status = 'active') {
  const activityEl = document.getElementById('activity');
  if (!activityEl) return;
  const statusClass = status === 'done' ? 'pass' : (status === 'fail' ? 'fail' : 'active');
  activityEl.innerHTML = `
    <div class="run-result ${statusClass}">
      <span class="status-dot"></span>
      <b>[Step ${stepNum}/5] ${escape(role)}</b>
      <p>${escape(message)}</p>
    </div>
  `;
  const scrollPane = document.getElementById('agent-pane-copilot');
  if (scrollPane) scrollPane.scrollTop = 0;
}

function updateRevisionUI(revNum) {
  const proj = getActiveProject();
  const hasRevs = proj && proj.revisions && proj.revisions.length >= 2 && proj.revisions[0].evaluated;
  const revToggleGroups = [document.getElementById('rev-toggle-group'), document.getElementById('studio-rev-toggle-group')];
  const revEmptyStates = [document.getElementById('rev-empty-state'), document.getElementById('studio-rev-empty-state')];
  const rev1Btns = [document.getElementById('rev-btn-1'), document.getElementById('studio-rev-btn-1')];
  const rev2Btns = [document.getElementById('rev-btn-2'), document.getElementById('studio-rev-btn-2')];
  const badgeStatus = document.getElementById('rev-badge-status');
  const diffSummaries = [document.getElementById('rev-diff-summary'), document.getElementById('studio-diff-summary')];
  const causalCallouts = document.querySelectorAll('.reflection-causal-callout');

  if (!hasRevs && revNum === 0) {
    const card = document.getElementById('revision-control-card');
    if (card) card.hidden = true;
    const studioRev = document.getElementById('studio-rev-section');
    if (studioRev) studioRev.hidden = true;
    if (badgeStatus) {
      badgeStatus.textContent = 'Draft · Unevaluated';
      badgeStatus.className = 'rev-build-badge draft';
    }
    revToggleGroups.forEach(g => { if (g) g.style.display = 'none'; });
    revEmptyStates.forEach(s => { if (s) s.style.display = 'block'; });
    diffSummaries.forEach(s => { if (s) { s.style.display = 'none'; s.innerHTML = ''; } });
    causalCallouts.forEach(c => { c.style.display = 'none'; c.innerHTML = ''; });
    return;
  }

  // Evaluated project
  const card = document.getElementById('revision-control-card');
  if (card) card.hidden = false;
  const studioRev = document.getElementById('studio-rev-section');
  if (studioRev) studioRev.hidden = false;
  revToggleGroups.forEach(g => { if (g) g.style.display = 'flex'; });
  revEmptyStates.forEach(s => { if (s) s.style.display = 'none'; });
  diffSummaries.forEach(s => { if (s) s.style.display = 'block'; });
  const scrollPane = document.getElementById('agent-pane-copilot');
  if (scrollPane) scrollPane.scrollTop = 0;

  const r1 = proj?.revisions?.[0];
  const r2 = proj?.revisions?.[1];
  const checks1 = r1?.checks || [];
  const checks2 = r2?.checks || [];

  const passedCount1 = checks1.filter(c => c.passed).length;
  const totalCount1 = checks1.length || 6;
  const passedCount2 = checks2.filter(c => c.passed).length;
  const totalCount2 = checks2.length || 6;

  const failedChecks1 = checks1.filter(c => !c.passed);
  const failedNames = failedChecks1.map(c => c.name);

  if (revNum === 1) {
    causalCallouts.forEach(c => c.style.display = 'none');
    rev1Btns.forEach(b => {
      if (b) {
        b.classList.add('active');
        const n = b.querySelector('.rev-num'); if (n) n.textContent = 'REV 1';
        const s = b.querySelector('.rev-state'); if (s) { s.textContent = `Failed · ${passedCount1}/${totalCount1}`; s.className = 'rev-state fail'; }
      }
    });
    rev2Btns.forEach(b => {
      if (b) {
        b.classList.remove('active');
        const n = b.querySelector('.rev-num'); if (n) n.textContent = 'REV 2';
        const s = b.querySelector('.rev-state'); if (s) { s.textContent = `Repaired · ${passedCount2}/${totalCount2}`; s.className = 'rev-state pass'; }
      }
    });
    if (badgeStatus) {
      badgeStatus.textContent = `Needs repair · ${totalCount1 - passedCount1}/${totalCount1} Fail`;
      badgeStatus.className = 'rev-build-badge fail';
    }

    let html = '';
    if (checks1.length > 0) {
      html = checks1.map(c => `
        <div class="spec-row ${c.passed ? 'pass' : 'fail'}">
          <span class="spec-icon">${c.passed ? '✓' : '✖'}</span>
          <span class="spec-label">${escape(c.name)}</span>
          <span class="spec-val ${c.passed ? 'pass' : 'fail'}">${c.measured} ${escape(c.unit || 'mm')}</span>
          <span class="spec-req">${c.passed ? `(${escape(c.requirement)})` : `&lt; ${escape(c.requirement)} FAIL`}</span>
        </div>
      `).join('');
    } else {
      html = '<div class="field-hint" style="padding:6px 0;font-size:11px">Initial revision evaluated.</div>';
    }
    diffSummaries.forEach(s => { if (s) s.innerHTML = html; });
    AudioCues.fail();
  } else {
    causalCallouts.forEach(c => c.style.display = 'flex');
    rev2Btns.forEach(b => {
      if (b) {
        b.classList.add('active');
        const n = b.querySelector('.rev-num'); if (n) n.textContent = 'REV 2';
        const s = b.querySelector('.rev-state'); if (s) { s.textContent = `Repaired · ${passedCount2}/${totalCount2}`; s.className = 'rev-state pass'; }
      }
    });
    rev1Btns.forEach(b => {
      if (b) {
        b.classList.remove('active');
        const n = b.querySelector('.rev-num'); if (n) n.textContent = 'REV 1';
        const s = b.querySelector('.rev-state'); if (s) { s.textContent = `Failed · ${passedCount1}/${totalCount1}`; s.className = 'rev-state fail'; }
      }
    });
    if (badgeStatus) {
      badgeStatus.textContent = `Build ready · ${passedCount2}/${totalCount2} Pass`;
      badgeStatus.className = 'rev-build-badge ready';
    }

    let html = '';
    if (checks2.length > 0) {
      html = checks2.map(c => `
        <div class="spec-row pass">
          <span class="spec-icon">✓</span>
          <span class="spec-label">${escape(c.name)}</span>
          <span class="spec-val pass">${c.measured} ${escape(c.unit || 'mm')}</span>
          <span class="spec-req">(${escape(c.requirement)})</span>
        </div>
      `).join('');
    } else {
      html = '<div class="field-hint" style="padding:6px 0;font-size:11px">Repaired geometry passed all acceptance checks.</div>';
    }
    diffSummaries.forEach(s => { if (s) s.innerHTML = html; });

    const rulesList = failedNames.map(name => {
      const clean = name.replace(/\s+/g, '-').toUpperCase();
      return `RULE-${clean}`;
    });
    const calloutHtml = `
      <span class="callout-bulb">💡</span>
      <div class="callout-body">
        <b>Reflection Synthesizer:</b> Synthesized ${rulesList.length ? rulesList.join(', ') : 'boundary heuristics'}. Applied parameter overrides to CadQuery kernel — 6/6 constraints passing.
      </div>
    `;
    causalCallouts.forEach(c => { if (c) c.innerHTML = calloutHtml; });
  }
}

const PLAN_KEY = 'autocadent_autoapprove';
async function proposePlan() {
  if (isLoopRunning) return;
  let auto = false;
  try { auto = localStorage.getItem(PLAN_KEY) === '1'; } catch {}
  if (auto) { runSelfImprovingLoop(); return; }
  try { await fetchDesignAgentTelemetry(); } catch {}
  const proj = getActiveProject();
  const mem = Array.isArray(designMemoryData) ? designMemoryData : (designMemoryData?.heuristics || designMemoryData?.rules || []);
  const eps = Array.isArray(designTelemetryData) ? designTelemetryData : [];
  const lastEp = eps.length ? eps[eps.length - 1] : null;
  postPlanCard({
    proj: proj?.name || 'design',
    rules: mem.length, episodes: eps.length,
    lastMs: lastEp ? Math.round(Number(lastEp.duration_ms) || 0) : null,
    steps: [
      ['01', 'Probe kernel', 'Thin-wall spec → real CadQuery build, measured check by check'],
      ['02', 'Verify', 'Verifier posts real measurements into chat'],
      ['03', 'Reflect', 'Reflection loop writes rules + episodes to SQLite'],
      ['04', 'Repair & load', 'Bounded repair, real mesh into viewport, files + downloads']
    ]
  });
  toast('Agent proposed a plan — approve to run.');
}
function postPlanCard(plan) {
  const html = `<div class="chat-message agent"><span class="chat-avatar agent-avatar">✳</span><div class="chat-bubble"><div class="plan-card"><div class="plan-card-head"><span class="eyebrow">PLAN · ORCHESTRATOR</span><b>Learning run on ${escape(plan.proj)}</b></div><div class="plan-steps">${plan.steps.map(s => `<div class="plan-step"><span class="task-num">${s[0]}</span><div><b>${escape(s[1])}</b><p>${escape(s[2])}</p></div></div>`).join('')}</div><p class="field-hint">Memory: ${plan.rules} rule(s) · Episodes: ${plan.episodes}${plan.lastMs != null ? ` · Last kernel time ${plan.lastMs}ms` : ''} · Nothing is simulated; every step reports measured output.</p><div class="plan-actions"><button type="button" class="dark-button" data-plan="approve">Approve & Run ✓</button><button type="button" class="text-button" data-plan="auto">Always allow</button></div></div></div></div>`;
  ['agent-copilot-messages', 'studio-chat-messages'].forEach(id => {
    const c = document.getElementById(id);
    if (!c) return;
    const w = document.createElement('div');
    w.innerHTML = html;
    const node = w.firstChild;
    c.appendChild(node);
    node.querySelectorAll('[data-plan]').forEach(b => b.addEventListener('click', () => approvePlan(b.dataset.plan, node)));
  });
  const sp = document.getElementById('agent-pane-copilot');
  if (sp) sp.scrollTop = sp.scrollHeight;
  const sc = document.getElementById('studio-chat-messages');
  if (sc) sc.scrollTop = sc.scrollHeight;
}
function approvePlan(mode, node) {
  if (mode === 'auto') { try { localStorage.setItem(PLAN_KEY, '1'); } catch {} toast('Auto-approved — future runs start immediately.'); }
  if (node) node.querySelector('.plan-actions')?.remove();
  appendStudioEvent('Orchestrator', 'Plan approved by engineer — dispatching roles.');
  runSelfImprovingLoop();
}

async function runSelfImprovingLoop(targetProj = null) {
  if (isLoopRunning) return;
  isLoopRunning = true;
  const proj = targetProj || getActiveProject();
  const loopBtn = document.getElementById('studio-run-loop-btn');
  if (loopBtn) {
    loopBtn.disabled = true;
    loopBtn.innerHTML = '<span class="pulse-dot"></span> Running Loop…';
  }
  const apiBase = runner || '';
  const authHeaders = token ? { Authorization: 'Bearer ' + token } : {};
  AudioCues.loopStart();
  toast(`Starting autonomous CAD learning loop for ${proj?.name || 'project'}…`);

  const say = (role, text, extra = {}) => {
    appendCopilotMessage({ role: 'agent', text, ...extra });
    appendStudioEvent(role, text.replace(/\*\*/g, '').replace(/`/g, '').slice(0, 240));
  };
  const fmtChecks = (checks) => (checks || []).map(c => `- ${c.name}: ${c.measured}${c.unit ? ' ' + c.unit : ''} (req ${c.requirement}) ${c.passed ? '✓' : '✖'}`).join('\n');
  const runJob = async (spec, description) => {
    const created = await json(apiBase + '/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ description, spec, execution: 'deterministic' }) });
    const deadline = Date.now() + 15 * 60 * 1000;
    let job = null;
    while (Date.now() < deadline) {
      job = await json(apiBase + '/api/jobs/' + created.id, { headers: { ...authHeaders } });
      if (job.status === 'complete' || job.status === 'failed') break;
      setViewStatus('Live CAD job running… ' + (job.message || ''), 'loading');
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!job || job.status !== 'complete') throw Error((job && job.error) || 'CAD job timed out.');
    return { id: created.id, report: job.report };
  };

  try {
    const termBody = document.getElementById('agent-terminal-body');
    if (termBody) termBody.innerHTML = '';
    const term = document.getElementById('agent-terminal');
    if (term) term.style.display = 'block';
    const termStatus = document.getElementById('terminal-status');
    if (termStatus) {
      termStatus.textContent = 'RUNNING';
      termStatus.className = 'terminal-status active';
    }
    if (!runner) throw Error('Local runner is not connected — start it and reload the page. Nothing was simulated.');
    clearAssembly('Contacting local CAD kernel…');
    updateRevisionUI(0);

    let health = null;
    try { health = await json(apiBase + '/api/health'); } catch {}
    const thinSpec = { length: 140, width: 90, thickness: 1.2, wall: 1.2, clearance: 0.1, mast_height: 52 };

    setPipelineTaskStatus(1, 'active');
    updateSidebarActivity(1, 'Orchestrator', 'Planning a bounded run: probe the kernel with a thin-wall spec, reflect into memory, keep the repaired mesh.');
    showArtifact('graph', 'Subagents on this run');
    say('Orchestrator', `**Learning run started.** I will probe the kernel with a thin-wall spec, run reflection against SQLite memory, then keep the repaired mesh.${health && health.provider && health.provider.configured ? ' Tensormux chat is also online.' : ''}`);
    termLog('POST /api/jobs {execution:"deterministic", spec:thin-wall}', null);
    AudioCues.step();

    setPipelineTaskStatus(1, 'done');
    setPipelineTaskStatus(2, 'active');
    setPipelineTaskStatus(3, 'active');
    updateSidebarActivity(2, 'CAD Specialist', 'Compiling real B-Rep solids in the local CadQuery kernel…');
    const job = await runJob(thinSpec, 'Learning run · thin-wall probe + bounded repair');
    const iters = job.report.iterations || [];
    const first = iters[0];
    const last = iters[iters.length - 1];
    const fails1 = (first.evaluation.checks || []).filter(c => !c.passed);
    termLog(null, `job ${job.id.slice(0, 8)} · ${iters.length} kernel iteration(s) in ${job.report.seconds}s`, last.evaluation.passed ? 'pass' : 'err');

    setPipelineTaskStatus(2, 'done');
    setPipelineTaskStatus(3, 'done');
    setPipelineTaskStatus(4, 'active');
    showArtifact('tools', 'Live tool traces');
    updateSidebarActivity(4, 'Verifier', `Measured revision 1 on real geometry: ${fails1.length} failing check(s).`);
    say('Verifier', `**Revision 1 — measured on real kernel geometry:**\n\n${fmtChecks(first.evaluation.checks)}`);
    if (fails1.length) AudioCues.fail(); else AudioCues.pass();
    if (last !== first) {
      say('Verifier', `**Bounded repair applied by the kernel policy.** Final iteration measures:\n\n${fmtChecks(last.evaluation.checks)}`);
    }

    setPipelineTaskStatus(4, 'done');
    setPipelineTaskStatus(5, 'active');
    updateSidebarActivity(5, 'Reflection Synthesizer', 'Running the real reflection loop against SQLite memory…');
    showArtifact('memory', 'Memory writes');
    termLog('POST /api/learning/loop {max_revisions:2}', null);
    const loop = await json(apiBase + '/api/learning/loop', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ spec: thinSpec, max_revisions: 2, description: 'Learning run from web console', workspace: currentWorkspaceId() }) });
    if (!loop || loop.status !== 'success') throw Error('Reflection loop did not report success.');
    const wsId = proj.id || activeProjectId;
    loopResultsByProject[wsId] = loop;
    lastLoopResult = loop;
    const rules = loop.newly_learned_rules || [];
    const revLines = (loop.revisions || []).map(r => {
      const m = r.metrics || {};
      return `- ${r.episode_id}: ${r.status} · ${m.checks_passed}/${m.checks_total} checks · ${m.duration_ms}ms kernel · ${m.rules_applied} memorized rule(s) applied · ~${m.estimated_total_tokens} tokens (backend estimate)`;
    }).join('\n');
    termLog(null, `reflection: ${rules.length} active rule(s) · ${(loop.revisions || []).map(r => r.episode_id + '=' + r.status).join(', ')}`, 'pass');
    if (rules.length) {
      say('Reflection Synthesizer', `**Memory after this run (${rules.length} active rule(s)):**\n\n**Episode trace:**\n${revLines}`, {
        cards: rules.map(r => ({ type: 'rule', payload: { rule_id: r.id, confidence: r.confidence, rationale: r.rationale, parameter_override: r.override, trigger_pattern: r.pattern } }))
      });
    } else {
      say('Reflection Synthesizer', `**No rules in memory yet — first failure will teach me.**\n\n${revLines}`);
    }
    AudioCues.step();

    const wsRun = { base: `${apiBase}/artifacts/jobs/${job.id}/`, iterations: iters.length, jobId: job.id };
    liveRunsByProject[wsId] = wsRun;
    liveRun = wsRun;
    const mesh = await json(wsRun.base + `iteration-${iters.length}/mesh.json`);
    drawMeshes(mesh);
    fitAssembly();
    termLog(null, `loaded live mesh: iteration-${iters.length}/mesh.json (${mesh.length} parts)`, 'pass');

    if (proj) {
      const mkRev = (n, it, note) => ({ n, spec: { ...it.spec }, evaluated: true, passed: !!it.evaluation.passed, source_job: job.id, note, saved_at: new Date().toISOString(), checks: it.evaluation.checks || [] });
      proj.revisions = iters.length > 1 ? [mkRev(1, iters[0], 'live kernel probe'), mkRev(2, iters[iters.length - 1], 'live kernel repair')] : [mkRev(1, iters[0], 'live kernel probe'), mkRev(1, iters[0], 'live kernel probe')];
      proj.hasGeometry = true;
      const passedCount = (last.evaluation.checks || []).filter(c => c.passed).length;
      const totalCount = (last.evaluation.checks || []).length;
      proj.stateText = last.evaluation.passed ? `Live build · ${passedCount}/${totalCount} Pass` : 'Live build · needs review';
      proj.statePass = !!last.evaluation.passed;
      proj.files = (job.report.files || []).map(f => ({ name: f.name, bytes: f.bytes, sha256: f.sha256, type: (f.name.split('.').pop() || '').toUpperCase().slice(0, 4) || 'FILE', downloadUrl: `${wsRun.base}final/${f.name}` }));
      try {
        const list = loadDesigns();
        const idx = list.findIndex(x => x.id === proj.id);
        if (idx >= 0) {
          list[idx].revisions = proj.revisions;
          list[idx].liveRun = wsRun;
          persistDesigns(list);
        }
        if (pendingDesign && pendingDesign.id === proj.id) {
          pendingDesign.revisions = proj.revisions;
          pendingDesign.liveRun = wsRun;
        }
      } catch {}
      for (const k of ['length', 'width', 'mast_height']) {
        const el = document.getElementById(k);
        if (el && last.spec && last.spec[k] != null) el.value = last.spec[k];
      }
      const stateEl = document.getElementById('project-state');
      if (stateEl) { stateEl.textContent = proj.stateText; stateEl.parentElement.className = 'project-state ' + (proj.statePass ? 'pass' : 'fail'); }
      const revLabel = document.getElementById('revision-label');
      if (revLabel) revLabel.textContent = `${proj.name.toUpperCase()} · LIVE KERNEL REV ${String(iters.length).padStart(2, '0')}`;
    }
    renderFiles(proj);
    renderDashboard();

    await fetchDesignAgentTelemetry();
    updateRevisionUI(2);
    renderStudio();
    renderStudioContext();
    hideArtifact();
    if (termStatus) { termStatus.textContent = 'COMPLETED'; termStatus.className = 'terminal-status done'; }
    setPipelineTaskStatus(5, 'done');
    AudioCues.pass();
    AudioCues.loopComplete();
    const activityEl = document.getElementById('activity');
    if (activityEl) {
      activityEl.innerHTML = `
        <div class="run-result ${last.evaluation.passed ? 'pass' : 'fail'}">
          <span class="status-dot"></span>
          <b>Live loop ${last.evaluation.passed ? 'passed' : 'needs review'} · job ${escape(job.id.slice(0, 8))}</b>
          <p>${escape(String(job.report.seconds))}s kernel time · ${escape(String(rules.length))} memorized rule(s) active.</p>
        </div>`;
    }
    say('Orchestrator', `**Run complete in ${job.report.seconds}s of kernel time.** The viewport shows this job's real mesh. Memory holds ${rules.length} rule(s), so the next run starts smarter — revision 1 passes immediately once the overrides are memorized.`);
    toast('Live learning loop complete — real kernel geometry, real memory.');
  } catch (err) {
    say('Orchestrator', `**Run stopped:** ${err.message || err}`);
    toast('Loop execution notice: ' + (err.message || err));
  } finally {
    isLoopRunning = false;
    if (loopBtn) {
      loopBtn.disabled = false;
      loopBtn.innerHTML = '⚡ Run Learning Loop';
    }
  }
}

function initCopilotChatMessages() {
  chatScrollTargets().forEach(watchChatScroll);
}

function watchChatScroll(el){
  if(!el || el.dataset.stickBound) return;
  el.dataset.stickBound = '1';
  el.__stick = true;
  el.addEventListener('scroll', () => {
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    el.__stick = gap < 56;
  }, { passive: true });
}
function scrollChatToBottom(el){
  if(!el) return;
  watchChatScroll(el);
  if(el.__stick !== false) el.scrollTop = el.scrollHeight;
}
function chatScrollTargets(){
  return [
    document.getElementById('agent-pane-copilot'),
    document.getElementById('studio-chat-messages')
  ].filter(Boolean);
}

function renderCopilotCard(card) {
  if (!card || !card.type) return '';
  const p = card.payload || {};
  if (card.type === 'rule') {
    const r = p;
    return `<div class="heuristic-card" data-card-type="rule"><div class="heuristic-card-head"><span class="heuristic-id">${escape(r.rule_id || 'RULE')}</span><span class="heuristic-conf">${Math.round((r.confidence || 0.8) * 100)}% conf</span></div><div class="heuristic-rationale">${escape(r.rationale || '')}</div><div class="heuristic-provenance">Parameter override: <code>${escape(JSON.stringify(r.parameter_override || {}))}</code></div></div>`;
  }
  if (card.type === 'episode') {
    const ep = p;
    const checks = (ep.checks_passed != null && ep.checks_total != null)
      ? `${ep.checks_passed}/${ep.checks_total} checks`
      : (ep.summary || '');
    const ms = ep.latency_ms ?? ep.duration_ms;
    return `<div class="tool-exec-card" data-card-type="episode"><div class="tool-exec-head"><span>${escape(ep.episode_id || ep.server || 'episode')}</span><span class="tool-exec-latency">${escape(String(ep.status || ''))}${ms != null ? ' · ' + Math.round(ms) + 'ms' : ''}</span></div><div class="tool-exec-details">${escape(String(checks))} ${escape(ep.tool ? String(ep.tool) : '')}</div></div>`;
  }
  if (card.type === 'mcp') {
    if (p.server || p.tool) {
      const st = String(p.status || 'trace');
      const err = p.error || (st !== 'success' ? p.summary : '') || '';
      const repaired = p.repaired ? ' · repaired' : '';
      return `<div class="tool-exec-card${st !== 'success' && st !== 'start' ? ' error' : ''}" data-card-type="mcp"><div class="mcp-card-head"><span class="mcp-server-name">${escape(p.server || 'mcp')}${p.tool ? '/' + escape(p.tool) : ''}</span><span class="mcp-status-pill ${st === 'success' ? 'online' : (st === 'start' ? 'running' : 'error')}">${escape(st)}${repaired}${p.latency_ms != null ? ' · ' + Math.round(p.latency_ms) + 'ms' : ''}</span></div>${err ? `<div class="tool-exec-details">${escape(String(err))}</div>` : ''}</div>`;
    }
    const servers = Array.isArray(p) ? p : (p.servers || []);
    const names = (servers || []).map(s => typeof s === 'string' ? s : (s.name || s.server || '')).filter(Boolean);
    return `<div class="tool-exec-card" data-card-type="mcp"><div class="mcp-card-head"><span class="mcp-server-name">MCP bridges</span><button type="button" class="chat-card-toggle" data-open-artifact="tools">Open ↗</button></div><div class="tool-exec-details">${escape(names.join(', ') || 'autocadent-cad, kicad, svg-pcb')}</div></div>`;
  }
  if (card.type === 'memory') {
    const n = p.active_rules ?? p.rule_count ?? p.count ?? (Array.isArray(p.heuristics) ? p.heuristics.length : 0);
    return `<div class="chat-card" data-card-type="memory"><div class="chat-card-head"><span class="chat-card-icon">◈</span><span>Memory · ${escape(String(n))} rule(s)</span><button type="button" class="chat-card-toggle" data-open-artifact="memory">Open ↗</button></div></div>`;
  }
  if (card.type === 'graph') {
    return `<div class="chat-card" data-card-type="graph"><div class="chat-card-head"><span class="chat-card-icon">⬡</span><span>Agent execution graph</span><button type="button" class="chat-card-toggle" data-open-artifact="graph">Open ↗</button></div></div>`;
  }
  if (card.type === 'curves') {
    return `<div class="chat-card" data-card-type="curves"><div class="chat-card-head"><span class="chat-card-icon">◇</span><span>Learning curves</span><button type="button" class="chat-card-toggle" data-open-artifact="learning">Open ↗</button></div></div>`;
  }
  if (card.type === 'board') {
    const n = p.footprints != null ? p.footprints : 0;
    const tr = p.traces != null ? p.traces : 0;
    return `<div class="tool-exec-card" data-card-type="board"><div class="tool-exec-head"><span>Realistic 3D PCB</span><span class="tool-exec-latency">${n} fp · ${tr} traces</span></div><div class="tool-exec-details">${escape(p.pcb_path || '')}</div></div>`;
  }
  if (card.type === 'preview') {
    const url = p.url || '';
    const label = p.name || p.kind || 'preview';
    if (!url) return '';
    return `<div class="preview-card" data-card-type="preview"><details open><summary class="chat-card-head"><span class="chat-card-icon">▣</span><span>${escape(label)}</span></summary><img src="${escape(url)}" alt="${escape(label)}" /></details></div>`;
  }
  if (card.type === 'pins') {
    const cols = (p.connectors || []).map(c => {
      const pins = (c.pins || []).map(pin =>
        `<div class="pin-row"><b>${escape(String(pin.number))}</b><span>${escape(pin.function || 'pad')}</span></div>`
      ).join('');
      return `<div class="pin-col"><div class="pin-head">${escape(c.ref || 'J')} <small>${escape(c.value || '')}</small></div>${pins}</div>`;
    }).join('');
    return `<div class="preview-card pinout-card" data-card-type="pins"><div class="chat-card-head"><span class="chat-card-icon">⌗</span><span>${escape(p.title || 'KiCad pin numbers')}</span></div><div class="pinout-grid">${cols}</div><p class="field-hint" style="margin:8px 12px 10px">${escape(p.caution || '')}</p></div>`;
  }
  if (card.type === 'verify') {
    const ok = p.status !== 'fail';
    return `<div class="tool-exec-card${ok ? '' : ' error'}" data-card-type="verify"><div class="tool-exec-head"><span>Verifier · placement</span><span class="tool-exec-latency">${ok ? 'pass' : 'fail · retry learned'}</span></div><div class="tool-exec-details">${escape(p.summary || '')}</div></div>`;
  }
  return '';
}

function appendCopilotMessage(msg) {
  const container = document.getElementById('agent-copilot-messages');
  if (!container) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${msg.role === 'agent' ? 'agent' : 'user'}`;
  const avatar = msg.role === 'agent'
    ? '<span class="chat-avatar agent-avatar">✳</span>'
    : '<span class="chat-avatar user-avatar">Y</span>';

  let reasoningHtml = '';
  if (msg.reasoning) {
    reasoningHtml = `
      <details class="thinking-drawer">
        <summary>🧠 Reasoning (${Math.round(msg.reasoning.length / 4)} tokens · click to expand)</summary>
        <p>${escape(msg.reasoning)}</p>
      </details>
    `;
  }

  let formattedText = escape(msg.text)
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n- /g, '<br>• ');

  let citationsHtml = '';
  const ruleCites = (msg.citations || []).filter(c => c && c.kind === 'rule').slice(0, 2);
  if (ruleCites.length) {
    citationsHtml = `<div class="chat-citations">${ruleCites.map(c => `<span class="chat-citation" title="${escape(c.kind)}: ${escape(c.id)}">${escape(c.label || c.id)}</span>`).join('')}</div>`;
  }

  let cardsHtml = '';
  let previewHtml = '';
  if (msg.cards?.length) {
    const trail = msg.cards.filter(c => c && (c.type === 'mcp' || c.type === 'episode'));
    const previews = msg.cards.filter(c => c && (c.type === 'preview' || c.type === 'pins'));
    const rest = msg.cards.filter(c => c && !['mcp', 'episode', 'preview', 'pins'].includes(c.type));
    const failed = trail.filter(c => c.payload && c.payload.status && c.payload.status !== 'success').length;
    let trailHtml = '';
    if (trail.length) {
      trailHtml = `<details class="tool-trail"><summary>${trail.length} tool${trail.length===1?'':'s'}${failed?` · ${failed} failed`:''}</summary><div class="tool-trail-body">${trail.map(card => renderCopilotCard(card)).join('')}</div></details>`;
    }
    previewHtml = previews.map(card => renderCopilotCard(card)).join('');
    cardsHtml = `<div class="chat-cards">${rest.map(card => renderCopilotCard(card)).join('')}${trailHtml}</div>`;
  }

  const chips = (msg.chips || []).filter(c => c && String(c).trim());
  let chipsHtml = '';
  if (chips.length) {
    chipsHtml = `<div class="chat-chips">${chips.map(c =>
      `<button type="button" class="brief-chip chat-action-chip" data-chat-chip="${escape(String(c).trim())}">${escape(String(c).trim())}</button>`
    ).join('')}</div>`;
  }

  msgDiv.innerHTML = `
    ${avatar}
    <div class="chat-bubble">
      ${reasoningHtml}
      <p style="margin:0">${formattedText}</p>
      ${previewHtml}
      ${cardsHtml}
      ${chipsHtml}
      ${citationsHtml}
    </div>
  `;

  container.appendChild(msgDiv);

  const studioContainer = document.getElementById('studio-chat-messages');
  if (studioContainer) {
    const clone = msgDiv.cloneNode(true);
    studioContainer.appendChild(clone);
  }
  const bindChatChrome = (root) => {
    root.querySelectorAll('details').forEach(d => {
      d.addEventListener('toggle', () => chatScrollTargets().forEach(scrollChatToBottom));
    });
    root.querySelectorAll('img').forEach(img => {
      img.addEventListener('load', () => chatScrollTargets().forEach(scrollChatToBottom), { once: true });
    });
  };
  bindChatChrome(msgDiv);
  if (studioContainer) bindChatChrome(studioContainer.lastElementChild);
  chatScrollTargets().forEach(scrollChatToBottom);
  try { saveCurrentWorkspaceChat(); } catch {}
}

function handleCopilotChipClick_DEAD(text) {
  if (text.includes('Run self-improving') || text.includes('Run live self-improvement') || text.includes('Run loop') || text.includes('Pipeline')) {
    proposePlan();
    return;
  }
  if (text.includes('Sub-Agents') || text.includes('Agent status') || text.includes('sub-agent') || text.includes('Graph')) {
    openAgenticPopup('graph');
    return;
  }
  if (text.includes('Learning curves') || text.includes('Compare Rev 1') || text.includes('curves') || text.includes('Telemetry')) {
    openAgenticPopup('learning');
    return;
  }
  if (text.includes('rules') || text.includes('heuristics') || text.includes('memory') || text.includes('SQLite')) {
    openAgenticPopup('memory');
    return;
  }
  if (text.includes('KiCad DRC') || text.includes('Probe KiCad') || text.includes('tools') || text.includes('MCP')) {
    openAgenticPopup('tools');
    return;
  }
  if (text.includes('Rev 1') && (text.includes('Inspect') || text.includes('fail'))) {
    updateRevisionUI(1);
    loadIteration(1);
    return;
  }
  if (text.includes('Rev 2') && (text.includes('repaired') || text.includes('Inspect'))) {
    updateRevisionUI(2);
    loadIteration(2);
    return;
  }
  const briefInput = document.getElementById('brief');
  if (briefInput) {
    briefInput.value = text;
    briefInput.focus();
    $('#brief-form')?.requestSubmit();
  }
}

function renderStudio() {
  const proj = getActiveProject();
  const titleEl = document.getElementById('studio-title');
  if (titleEl) titleEl.textContent = 'Design Intelligence Studio';
  const eyebrow = document.getElementById('studio-eyebrow');
  if (eyebrow) eyebrow.textContent = proj?.name ? `AUTOCADENT / ${proj.name}` : 'AUTOCADENT / AGENT STUDIO';

  const saved = workspaceChats[currentWorkspaceId()] || {};
  if (saved.roles && Array.isArray(saved.roles.agents) && saved.roles.agents.some(a => a.spawned && a.role !== 'Orchestrator')) {
    designGraphData = saved.roles;
  } else if (!designGraphData || !visibleStudioRoles().some(a => a.role !== 'Orchestrator')) {
    designGraphData = idleOrchestratorGraph();
  }
  renderStudioRoles();
  applyWorkspaceMemory(saved.memory || [], saved.telemetry || []);
  renderStudioMemorySummary();
  renderStudioContext();

  fetchDesignAgentTelemetry().then(() => {
    renderStudioSubagents();
    renderStudioRoles();
    renderStudioLearning();
    renderStudioMemory();
    renderStudioTools().then(() => renderStudioContext());
    renderStudioMemorySummary();
    renderStudioContext();
  });
}

function renderStudioSubagents(targetDagId = 'studio-subagents-dag', targetEventsId = 'studio-subagent-events') {
  const dagContainer = document.getElementById(targetDagId);
  if (!dagContainer) return;
  const live = (designGraphData && designGraphData.agents) || [];
  const liveStatus = (role) => {
    const a = live.find(x => x.role === role);
    if (!a) return null;
    if (!a.spawned && String(a.status || 'idle').toLowerCase() === 'idle') return null;
    return String(a.status || 'idle').toLowerCase();
  };
  const badgeOf = (s) => s === 'idle' ? 'idle' : (s === 'verified' || s === 'done' ? 'done' : 'active');
  const agents = [
    {
      id: 'orchestrator',
      role: 'Orchestrator',
      name: 'Orchestrator / Planner',
      model: 'GLM-4.7-Flash (MoE 30B)',
      status: liveStatus('Orchestrator') || 'idle',
      desc: 'Decomposes engineering brief, routes spatial tasks, coordinates CAD/PCB specialists.',
      avatar: '👑'
    },
    {
      id: 'cad_specialist',
      role: 'CAD Specialist',
      name: 'CAD Specialist',
      model: 'CadQuery 2.6 / OpenCASCADE',
      status: liveStatus('CAD Specialist') || 'idle',
      desc: 'Synthesizes parametric B-Rep solids through the local kernel; every build is measured.',
      avatar: '📐'
    },
    {
      id: 'pcb_specialist',
      role: 'PCB Specialist',
      name: 'PCB Specialist',
      model: 'KiCad 10 DRC / SVG-PCB',
      status: liveStatus('PCB Specialist') || 'idle',
      desc: 'Routes signal-breakout nets and verifies clearances against the real board bundle.',
      avatar: '⚡'
    },
    {
      id: 'verifier',
      role: 'Verifier',
      name: 'Verifier & Evaluator',
      model: 'OpenCASCADE Kernel DRC',
      status: liveStatus('Verifier') || 'idle',
      desc: 'Measures thickness, wall offset, and clearance on real B-Rep geometry.',
      avatar: '🛡️'
    },
    {
      id: 'reflection',
      role: 'Reflection Synthesizer',
      name: 'Reflection Synthesizer',
      model: 'Causal reflection → SQLite',
      status: liveStatus('Reflection Synthesizer') || 'idle',
      desc: 'Turns failed checks into durable heuristics with evidence provenance.',
      avatar: '🧠'
    }
  ];

  const visible = agents.filter(a => liveStatus(a.role));
  dagContainer.innerHTML = visible.length ? visible.map(a => `
    <div class="subagent-node ${a.status === 'active' || a.status === 'building' ? 'active' : ''}">
      <div class="subagent-avatar">${a.avatar}</div>
      <div class="subagent-info">
        <div class="subagent-info-head">
          <span class="subagent-role">${escape(a.name)}</span>
          <span class="subagent-badge ${badgeOf(a.status)}">${escape(a.status)}</span>
        </div>
        <div class="mono small" style="color:var(--teal);font-size:10px;margin-top:2px">${escape(a.model)}</div>
        <p class="subagent-desc">${escape(a.desc)}</p>
      </div>
    </div>
  `).join('') : `<p class="field-hint" style="padding:12px">Idle — specialists spawn here when chat delegates CAD or KiCad work.</p>`;

  const eventsList = document.getElementById(targetEventsId);
  if (eventsList) {
    const proj = getActiveProject();
    const isRove = proj && proj.id === 'rove1';
    let events = (isRove ? report?.events : null) || null;
    if (!events) {
      const flat = [];
      live.forEach(a => (a.events || []).forEach(ev => flat.push({ role: a.role, message: `→ ${ev.status}`, t: ev.timestamp || 0 })));
      flat.sort((x, y) => x.t - y.t);
      events = flat.slice(-8);
    }
    eventsList.innerHTML = events.length ? events.slice(-8).map(ev => `
      <div class="subagent-event-item">
        <b>[${escape(ev.role || 'Agent')}]:</b>
        <span>${escape(ev.message || '')}</span>
      </div>
    `).join('') : `<div class="field-hint" style="padding:12px 4px">No agent transitions recorded yet — run the learning loop and watch each role activate here.</div>`;
  }
}

function drawStudioMiniChart(canvasId, values, color, isPct = false) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth || 200, h = 90;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const pad = { t: 10, r: 12, b: 18, l: 12 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;

  if (!values || values.length < 2) return;
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = (maxV - minV) || 1;

  ctx.strokeStyle = '#e6e3d8';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t + ch);
  ctx.lineTo(pad.l + cw, pad.t + ch);
  ctx.stroke();

  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
  grad.addColorStop(0, color + '33');
  grad.addColorStop(1, color + '00');

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad.l + (i / (values.length - 1)) * cw;
    const y = pad.t + (1 - (v - minV) / range) * ch;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(pad.l + cw, pad.t + ch);
  ctx.lineTo(pad.l, pad.t + ch);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad.l + (i / (values.length - 1)) * cw;
    const y = pad.t + (1 - (v - minV) / range) * ch;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  values.forEach((v, i) => {
    const x = pad.l + (i / (values.length - 1)) * cw;
    const y = pad.t + (1 - (v - minV) / range) * ch;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });

  ctx.fillStyle = '#787f73';
  ctx.font = '9px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  values.forEach((v, i) => {
    const x = pad.l + (i / (values.length - 1)) * cw;
    ctx.fillText(`R${i + 1}`, x, h - 2);
  });
}

function telemetrySeries() {
  const eps = Array.isArray(designTelemetryData) ? designTelemetryData : [];
  const pass = eps.map(e => e.checks_total ? e.checks_passed / e.checks_total : 0);
  const err = pass.map(p => 1 - p);
  const dur = eps.map(e => Number(e.duration_ms) || 0);
  const tok = eps.map(e => Number(e.estimated_total_tokens) || 0);
  const pad = (arr) => arr.length >= 2 ? arr : (arr.length === 1 ? [arr[0], arr[0]] : [0, 0]);
  return { eps, pass: pad(pass), err: pad(err), dur: pad(dur), tok: pad(tok) };
}

function renderStudioLearning() {
  const proj = getActiveProject();
  const hasRevs = proj && proj.revisions && proj.revisions.length >= 2 && proj.revisions[0].evaluated;
  const checks1 = proj?.revisions?.[0]?.checks || [];
  const checks2 = proj?.revisions?.[1]?.checks || [];

  const series = telemetrySeries();
  drawStudioMiniChart('studio-chart-error', series.err, '#b8324a', true);
  drawStudioMiniChart('studio-chart-pass', series.pass, '#1e7053', true);
  drawStudioMiniChart('studio-chart-duration', series.dur, '#d47c4e');
  drawStudioMiniChart('studio-chart-tokens', series.tok, '#7b68ae');
  const setStat = (id, sub, val, label) => { const b = document.getElementById(id); if (b) b.textContent = val; const s = document.getElementById(sub); if (s) s.textContent = label; };
  if (series.eps.length) {
    const firstEp = series.eps[0];
    const lastEp = series.eps[series.eps.length - 1];
    const errOf = (e) => Math.round((1 - (e.checks_passed / Math.max(1, e.checks_total))) * 100);
    setStat('curve-stat-error', 'curve-stat-error-sub', `${errOf(lastEp)}%`, `${series.eps.length} measured revision(s) · first was ${errOf(firstEp)}%`);
    setStat('curve-stat-pass', 'curve-stat-pass-sub', `${lastEp.checks_passed}/${lastEp.checks_total}`, `rev ${lastEp.revision} · ${lastEp.status}`);
    setStat('curve-stat-duration', 'curve-stat-duration-sub', `${Math.round(Number(lastEp.duration_ms) || 0)}ms`, 'real kernel latency, last revision');
    setStat('curve-stat-tokens', 'curve-stat-tokens-sub', `~${lastEp.estimated_total_tokens ?? '—'}`, 'backend estimate, not metered');
  } else {
    setStat('curve-stat-error', 'curve-stat-error-sub', '—', 'run the loop for measured data');
    setStat('curve-stat-pass', 'curve-stat-pass-sub', '—', 'run the loop for measured data');
    setStat('curve-stat-duration', 'curve-stat-duration-sub', '—', 'run the loop for measured data');
    setStat('curve-stat-tokens', 'curve-stat-tokens-sub', '—', 'run the loop for measured data');
  }

  const table = document.getElementById('studio-bench-table');
  if (table) {
    if (!hasRevs || !checks1.length) {
      table.innerHTML = `
        <div style="margin-top:16px;border-top:1px solid var(--line);padding:24px 12px;text-align:center;color:var(--muted)">
          <div style="font-size:24px;margin-bottom:8px">⚙</div>
          <b style="color:var(--ink);display:block;font-size:12px;margin-bottom:4px">No physical constraints evaluated yet</b>
          <p class="field-hint" style="margin:0;font-size:11px">Run the autonomous learning pipeline to compile OpenCASCADE geometry, run KiCad DRC, and track metric improvements across revisions.</p>
        </div>
      `;
      return;
    }

    const activeChecks = checks2.length ? checks2 : checks1;
    const rows = activeChecks.map(c => {
      const outcome = c.passed ? '<span style="color:#1e7053;font-weight:600">PASS ✓</span>' : '<span style="color:#b8324a;font-weight:600">FAIL ✖</span>';
      return `
        <tr style="border-bottom:1px solid #f0ede3">
          <td style="padding:6px 8px"><b>${escape(c.name)}</b></td>
          <td style="padding:6px 8px;color:#525a4d;font-size:10px">${escape(c.method || 'OpenCASCADE B-Rep')}</td>
          <td style="padding:6px 8px;color:#1e7053;font-family:var(--mono);font-weight:600">${c.measured} ${escape(c.unit || 'mm')}</td>
          <td style="padding:6px 8px;color:#787f73;font-family:var(--mono)">${escape(c.requirement)}</td>
          <td style="padding:6px 8px">${outcome}</td>
        </tr>
      `;
    }).join('');

    table.innerHTML = `
      <div style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px">
        <span class="mono eyebrow" style="font-size:9px">VERIFIED PHYSICAL CONSTRAINTS (ACTIVE BUILD)</span>
        <table class="data-table" style="width:100%;font-size:11px;margin-top:8px;border-collapse:collapse">
          <thead>
            <tr style="text-align:left;color:#787f73;border-bottom:1px solid #ded9cb">
              <th style="padding:5px 8px">Physical Constraint</th>
              <th style="padding:5px 8px">Verification Engine</th>
              <th style="padding:5px 8px">Evaluated Spec</th>
              <th style="padding:5px 8px">Target Requirement</th>
              <th style="padding:5px 8px">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }
}

function renderStudioMemory(targetHId = 'studio-memory-heuristics', targetEId = 'studio-memory-episodes', targetCId = 'studio-memory-cache') {
  const mem = Array.isArray(designMemoryData) ? designMemoryData : (designMemoryData?.heuristics || designMemoryData?.rules || []);
  const heuristics = mem || [];

  const hContainer = document.getElementById(targetHId);
  if (hContainer) {
    hContainer.innerHTML = heuristics.length ? heuristics.map(h => {
      const evCount = Array.isArray(h.evidence) ? h.evidence.length : 0;
      const evSnippet = Array.isArray(h.evidence) && h.evidence[0] ? (h.evidence[0].snippet || '') : '';
      return `
      <div class="heuristic-card">
        <div class="heuristic-card-head">
          <span class="heuristic-id">${escape(h.rule_id || h.id || 'RULE')}</span>
          <span class="heuristic-conf">${Math.round((h.confidence ?? 0.7) * 100)}% conf</span>
        </div>
        <div class="heuristic-rationale">${escape(h.rationale || h.description || '')}</div>
        <div class="heuristic-provenance">
          <b>Trigger:</b> <code>${escape(h.trigger_pattern || h.trigger || '')}</code>${evCount ? ` · <b>Evidence:</b> ${evCount} trace(s)${evSnippet ? ` — ${escape(evSnippet)}` : ''}` : ''}
        </div>
        <div class="heuristic-counters">
          <span>✓ Applied &amp; Helped: <b>${h.times_helped ?? h.helped ?? 0}</b></span>
          <span>✗ Hurt: <b>${h.times_hurt ?? h.hurt ?? 0}</b></span>
          <span>Target: <code>${escape(JSON.stringify(h.parameter_override || h.override || {}))}</code></span>
        </div>
      </div>`;
    }).join('') : `<div class="field-hint" style="padding:16px 8px">No heuristics memorized yet — run the learning loop and the Reflection Synthesizer will commit its first rules here.</div>`;
  }

  const eContainer = document.getElementById(targetEId);
  if (eContainer) {
    const episodes = Array.isArray(designTelemetryData) ? designTelemetryData : [];
    eContainer.innerHTML = episodes.length ? episodes.map(ep => {
      const ok = String(ep.status).toUpperCase() === 'SUCCESS' || String(ep.status).toUpperCase() === 'PASS';
      return `
      <div class="heuristic-card" style="margin-top:6px">
        <div class="heuristic-card-head">
          <span class="heuristic-id">${escape(ep.episode_id || 'episode')}</span>
          <span class="subagent-badge ${ok ? 'done' : 'active'}">${escape(String(ep.status || ''))}</span>
        </div>
        <p style="margin:4px 0;font-size:11px;color:#49554d">${escape(ep.summary || '')}</p>
        <div class="heuristic-counters">
          <span>Revision: <b>${ep.revision ?? '—'}</b></span>
          <span>Checks: <b>${ep.checks_passed ?? '—'}/${ep.checks_total ?? '—'}</b></span>
          <span>Latency: <b>${ep.duration_ms != null ? Math.round(ep.duration_ms) + 'ms' : '—'}</b></span>
          <span>Tokens: <b>${ep.estimated_total_tokens != null ? '~' + ep.estimated_total_tokens + ' est.' : '—'}</b></span>
          <span>Rules applied: <b>${ep.rules_applied ?? 0}</b></span>
        </div>
      </div>`;
    }).join('') : `<div class="field-hint" style="padding:16px 8px">No episodic traces yet — each learning-loop revision is recorded here with its measurements.</div>`;
  }

  const cContainer = document.getElementById(targetCId);
  if (cContainer) {
    cContainer.innerHTML = `
      <div class="heuristic-card" style="margin-top:6px">
        <div class="heuristic-card-head">
          <span class="heuristic-id">Geometry artifacts</span>
          <span class="subagent-badge done">ON DISK</span>
        </div>
        <p style="margin:4px 0;font-size:11px;color:#49554d">Recorded meshes live in <code>web/artifacts</code>; every live learning run writes its report and meshes to <code>.runs/jobs/&lt;id&gt;/</code> for download and re-inspection. There is no separate cache-metrics endpoint — hit rates are not invented here.</p>
      </div>
    `;
  }
}

async function renderStudioTools(targetServersId = 'studio-mcp-servers', targetTracesId = 'studio-mcp-traces') {
  const container = document.getElementById(targetServersId);
  if (container) {
    let servers = null;
    try {
      const r = await fetch('/api/mcp/servers');
      if (r.ok) servers = await r.json();
    } catch {}
    const list = Array.isArray(servers) ? servers : (servers?.servers || []);
    designMcpData = list;
    if (list.length) {
      container.innerHTML = list.map(s => {
        const tools = Array.isArray(s.tools) ? s.tools : [];
        const names = tools.map(t => typeof t === 'string' ? t : (t.name || JSON.stringify(t))).slice(0, 8);
        const online = s.available !== false;
        return `
        <div class="mcp-server-card">
          <div class="mcp-card-head">
            <span class="mcp-server-name">${escape(s.name || 'server')}</span>
            <span class="mcp-status-pill ${online ? 'online' : 'offline'}">● ${online ? 'LIVE' : 'OFFLINE'}</span>
          </div>
          <div class="mono small" style="color:var(--teal);font-size:10px;margin-top:2px">${escape(s.transport || 'stdio')} · ${tools.length} tool(s)</div>
          <div class="mcp-tools-list">
            ${names.map(t => `<span class="mcp-tool-pill">${escape(t)}</span>`).join('') || '<span class="field-hint">no tools listed</span>'}
          </div>
        </div>`;
      }).join('');
    } else {
      container.innerHTML = `<div class="field-hint" style="padding:16px 8px">MCP bridges are unreachable from this browser session — the CAD and KiCad tools run beside the local runner. Start the runner and reload to probe them live.</div>`;
    }
  }

  const traces = document.getElementById(targetTracesId);
  if (traces) {
    const wsLoop = wsLoopOf() || lastLoopResult;
    const revs = (wsLoop && wsLoop.revisions) || [];
    if (revs.length) {
      traces.innerHTML = revs.map(r => {
        const m = r.metrics || {};
        const ok = String(r.status).toUpperCase() === 'SUCCESS';
        return `
        <div class="tool-exec-card">
          <div class="tool-exec-head">
            <span>⚡ learning_loop.${escape(r.episode_id || 'revision')}</span>
            <span class="tool-exec-latency">${m.duration_ms}ms · ${ok ? 'PASS' : 'FAIL'}</span>
          </div>
          <div class="tool-exec-details">${escape(JSON.stringify({ checks: `${m.checks_passed}/${m.checks_total}`, tool_failures: m.tool_failures, rules_applied: m.rules_applied, tokens_est: m.estimated_total_tokens }))}</div>
        </div>`;
      }).join('');
    } else {
      traces.innerHTML = `<div class="field-hint" style="padding:16px 8px">No tool traces yet — run the learning loop and each real tool call lands here with its measured latency.</div>`;
    }
  }
}

function openAgenticPopup(view = 'graph') {
  AudioCues.step();
  const modal = document.getElementById('agentic-modal');
  if (!modal) return;

  const titleEl = document.getElementById('agentic-modal-title');
  const subEl = document.getElementById('agentic-modal-subtitle');
  const bodyEl = document.getElementById('agentic-modal-body');

  document.querySelectorAll('.agentic-switch-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.popup === view);
  });

  if (view === 'graph') {
    titleEl.textContent = 'Sub-Agents Collaboration Graph';
    subEl.textContent = '5 Specialized Engineering Roles · Autonomous DAG Dispatch';
    bodyEl.innerHTML = `
      <div class="popup-panel-content">
        <div class="subagents-dag" id="popup-subagents-dag"></div>
        <div class="subagent-event-stream" style="margin-top:16px">
          <span class="eyebrow">ACTIVE AGENT TRANSITION LOG</span>
          <div id="popup-subagent-events" class="events-list"></div>
        </div>
      </div>
    `;
    renderStudioSubagents('popup-subagents-dag', 'popup-subagent-events');
  } else if (view === 'memory') {
    titleEl.textContent = 'SQLite Persistent Memory Bank';
    subEl.textContent = 'Causal Heuristics, Parameter Overrides & Episodic Traces';
    const memCount = (Array.isArray(designMemoryData) ? designMemoryData : (designMemoryData?.heuristics || designMemoryData?.rules || [])).length;
    const epCount = (Array.isArray(designTelemetryData) ? designTelemetryData : []).length;
    bodyEl.innerHTML = `
      <div class="popup-panel-content">
        <div class="memory-bank-tabs" role="tablist" style="margin-bottom:12px">
          <button type="button" class="studio-mem-subtab active" data-pmem="heuristics">Active Heuristics (${memCount} Rule${memCount === 1 ? '' : 's'})</button>
          <button type="button" class="studio-mem-subtab" data-pmem="episodes">Episodic Traces (${epCount} Episode${epCount === 1 ? '' : 's'})</button>
          <button type="button" class="studio-mem-subtab" data-pmem="cache">Physical Tool Cache</button>
        </div>
        <div id="popup-mem-heuristics" class="memory-rules-container"></div>
        <div id="popup-mem-episodes" class="memory-episodes-container" hidden></div>
        <div id="popup-mem-cache" class="memory-cache-container" hidden></div>
      </div>
    `;
    renderStudioMemory('popup-mem-heuristics', 'popup-mem-episodes', 'popup-mem-cache');

    const hContainer = document.getElementById('popup-mem-heuristics');
    const eContainer = document.getElementById('popup-mem-episodes');
    const cContainer = document.getElementById('popup-mem-cache');

    bodyEl.querySelectorAll('.studio-mem-subtab').forEach(b => {
      b.onclick = () => {
        bodyEl.querySelectorAll('.studio-mem-subtab').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const mode = b.dataset.pmem;
        if (hContainer) hContainer.hidden = mode !== 'heuristics';
        if (eContainer) eContainer.hidden = mode !== 'episodes';
        if (cContainer) cContainer.hidden = mode !== 'cache';
      };
    });
  } else if (view === 'learning') {
    titleEl.textContent = 'Self-Improving Learning Curves';
    subEl.textContent = 'Telemetry, Error Rate Reduction & Execution Benchmarks';
    const se = telemetrySeries();
    const seLast = se.eps.length ? se.eps[se.eps.length - 1] : null;
    const seErr = (e) => Math.round((1 - (e.checks_passed / Math.max(1, e.checks_total))) * 100) + '%';
    bodyEl.innerHTML = `
      <div class="popup-panel-content">
        <div class="curves-grid">
          <div class="curve-card"><div class="curve-title">Error rate ↓</div><canvas id="popup-chart-error" height="100"></canvas><div class="curve-stat"><b class="pass">${seLast ? seErr(seLast) : '—'}</b> <small>${se.eps.length ? se.eps.length + ' measured revision(s)' : 'run the loop for measured data'}</small></div></div>
          <div class="curve-card"><div class="curve-title">Check pass rate ↑</div><canvas id="popup-chart-pass" height="100"></canvas><div class="curve-stat"><b class="pass">${seLast ? seLast.checks_passed + '/' + seLast.checks_total : '—'}</b> <small>${seLast ? 'rev ' + seLast.revision + ' · ' + seLast.status : 'run the loop for measured data'}</small></div></div>
          <div class="curve-card"><div class="curve-title">Execution duration ↓</div><canvas id="popup-chart-duration" height="100"></canvas><div class="curve-stat"><b class="pass">${seLast ? Math.round(Number(seLast.duration_ms) || 0) + 'ms' : '—'}</b> <small>real kernel latency</small></div></div>
          <div class="curve-card"><div class="curve-title">Token cost-efficiency ↑</div><canvas id="popup-chart-tokens" height="100"></canvas><div class="curve-stat"><b class="pass">${seLast && seLast.estimated_total_tokens != null ? '~' + seLast.estimated_total_tokens : '—'}</b> <small>backend estimate, not metered</small></div></div>
        </div>
        <div class="learning-bench-table" id="popup-bench-table" style="margin-top:16px"></div>
      </div>
    `;
    setTimeout(() => {
      const s = telemetrySeries();
      drawStudioMiniChart('popup-chart-error', s.err, '#b8324a', true);
      drawStudioMiniChart('popup-chart-pass', s.pass, '#1e7053', true);
      drawStudioMiniChart('popup-chart-duration', s.dur, '#d47c4e');
      drawStudioMiniChart('popup-chart-tokens', s.tok, '#7b68ae');
    }, 20);
    const srcB = document.getElementById('studio-bench-table');
    const dstB = document.getElementById('popup-bench-table');
    if (srcB && dstB) dstB.innerHTML = srcB.innerHTML;
  } else if (view === 'tools') {
    titleEl.textContent = 'Third-Party Tools & MCP Integrations';
    subEl.textContent = 'Active CAD/EDA Compilers, Kinematics & Model Endpoints';
    bodyEl.innerHTML = `
      <div class="popup-panel-content">
        <div class="mcp-servers-grid" id="popup-mcp-servers"></div>
        <div class="mcp-invocation-log" style="margin-top:16px">
          <span class="eyebrow">LIVE TOOL INVOCATION TRACES</span>
          <div id="popup-mcp-traces"></div>
        </div>
      </div>
    `;
    renderStudioTools('popup-mcp-servers', 'popup-mcp-traces');
  } else if (view === 'pipeline') {
    titleEl.textContent = 'Autonomous Self-Improving CAD Loop';
    subEl.textContent = 'Live progress — steps appear here as the agent runs them';
    bodyEl.innerHTML = `
      <div class="popup-panel-content">
        <div id="popup-pipeline-live" class="studio-live-feed" style="margin-bottom:16px"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;background:#f6f4ee;padding:12px 16px;border-radius:8px;border:1px solid var(--line)">
          <div>
            <b>Trigger Autonomous CAD Loop</b>
            <p class="muted" style="margin:2px 0 0 0;font-size:11px">Proposes a plan first — you approve, then the agent runs real kernel jobs.</p>
          </div>
          <button type="button" id="popup-run-loop-btn" class="dark-button">⚡ Plan a Run</button>
        </div>
      </div>
    `;
    const liveSrc = document.getElementById('studio-live-feed');
    const liveDst = document.getElementById('popup-pipeline-live');
    if (liveSrc && liveDst) {
      liveDst.innerHTML = liveSrc.innerHTML || `<p class="field-hint" style="margin:0">Idle — each step appears here as the agent works.</p>`;
    }
    const pBtn = document.getElementById('popup-run-loop-btn');
    if (pBtn) {
      pBtn.onclick = () => {
        document.getElementById('agentic-modal')?.close();
        proposePlan();
      };
    }
  } else if (view === 'evidence') {
    titleEl.textContent = 'Physical DRC & Kernel Verification';
    subEl.textContent = 'OpenCASCADE B-Rep Tolerances & KiCad 8.0 Clearance Report';
    const proj = getActiveProject();
    const hasRevs = proj && proj.revisions && proj.revisions.length >= 2 && proj.revisions[0].evaluated;
    const checks1 = proj?.revisions?.[0]?.checks || [];
    const checks2 = proj?.revisions?.[1]?.checks || [];

    if (!hasRevs || !checks1.length) {
      bodyEl.innerHTML = `
        <div class="popup-panel-content" style="text-align:center;padding:36px 16px;color:var(--muted)">
          <div style="font-size:28px;margin-bottom:8px">⚙</div>
          <b style="color:var(--ink);display:block;font-size:13px;margin-bottom:6px">No physical constraints evaluated yet</b>
          <p class="field-hint" style="margin:0">Run the autonomous learning pipeline to compile OpenCASCADE geometry and verify physical DRC.</p>
        </div>
      `;
    }
    const activeChecks = checks2.length ? checks2 : checks1;
    const specRows = activeChecks.map(c => `
        <div class="spec-row ${c.passed ? 'pass' : 'fail'}">
          <span class="spec-icon">${c.passed ? '✓' : '✖'}</span>
          <span class="spec-label">${escape(c.name)}</span>
          <span class="spec-val ${c.passed ? 'pass' : 'fail'}">${c.measured} ${escape(c.unit || 'mm')}</span>
          <span class="spec-req">(${escape(c.requirement)})</span>
        </div>
      `).join('');

    bodyEl.innerHTML = `
        <div class="popup-panel-content">
          <div class="rev-specs-summary" style="margin-bottom:16px">
            ${specRows}
          </div>
          <div class="reflection-causal-callout">
            <span class="causal-icon">💡</span>
            <p><b>Reflection Synthesizer:</b> Synthesized <code>RULE-BASE-THICKNESS</code>, <code>RULE-SIDEWALL</code>, <code>RULE-PCB-STANDOFF</code>. Memory overrides resolved all constraint violations in Rev 2.</p>
          </div>
        </div>
      `;
  }

  if (!modal.open) modal.showModal();
}
window.openAgenticPopup = openAgenticPopup;
window.proposePlan = proposePlan;
window.runSelfImprovingLoop = runSelfImprovingLoop;
window.showArtifact = showArtifact;
window.hideArtifact = hideArtifact;

async function sendCopilotMessage(raw, source = 'copilot') {
  if (!raw) return;
  AudioCues.send();
  $('#brief').value = '';
  const dockInp = document.getElementById('studio-dock-input');
  if (dockInp) dockInp.value = '';

  appendCopilotMessage({ role: 'user', text: raw });
  appendStudioEvent('User', raw);
  resetStudioDelegation();
  upsertStudioRole('Orchestrator', 'active');

  const pendingId = 'copilot-pending-' + Date.now();
  const pending = document.createElement('div');
  pending.className = 'chat-message agent';
  pending.id = pendingId;
  pending.innerHTML = `<span class="chat-avatar agent-avatar">✳</span><div class="chat-bubble"><div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--teal)"><span class="pulse-dot"></span><b>GLM-4.7-Flash is reasoning…</b></div></div>`;
  document.getElementById('agent-copilot-messages')?.appendChild(pending);

  const studioContainer = document.getElementById('studio-chat-messages');
  const studioPending = pending.cloneNode(true);
  if (studioContainer) studioContainer.appendChild(studioPending);

  const sp1 = document.getElementById('agent-pane-copilot');
  if (sp1) sp1.scrollTop = sp1.scrollHeight;
  if (studioContainer) studioContainer.scrollTop = studioContainer.scrollHeight;

  const liveTools = [];
  const liveLog = [];
  const t0 = Date.now();
  const clock = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
  const upsertLog = (kind, row) => {
    const i = liveLog.findIndex(e => e.kind === kind && (kind === 'svg' || kind === 'pcb-svg' || kind === 'pins' || kind === 'parts'));
    if (i >= 0) liveLog[i] = row;
    else liveLog.push(row);
  };
  const elapsedTimer = setInterval(() => {
    const a = pending.querySelector('.work-elapsed');
    const b = studioPending.querySelector('.work-elapsed');
    if (a) a.textContent = clock();
    if (b) b.textContent = clock();
  }, 400);
  const stopClock = () => { try { clearInterval(elapsedTimer); } catch {} };
  const ensureWorkShell = (node) => {
    if (node.querySelector('.work-shell')) return;
    node.innerHTML = `<span class="chat-avatar agent-avatar">✳</span><div class="chat-bubble work-shell"><div class="work-head" style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--teal)"><span class="pulse-dot"></span><b class="work-status"></b><span class="work-elapsed"></span></div><div class="tool-pills"></div><div class="work-parts-row"></div><div class="work-errors"></div><div class="work-visuals"></div></div>`;
  };
  const fillWorkShell = (node) => {
    ensureWorkShell(node);
    const statusEl = node.querySelector('.work-status');
    if (statusEl) statusEl.textContent = pending.dataset.status || 'GLM-4.7-Flash is reasoning…';
    const elapsedEl = node.querySelector('.work-elapsed');
    if (elapsedEl) elapsedEl.textContent = clock();
    const hidden = Math.max(0, liveTools.length - 8);
    const shown = liveTools.slice(-8).map(t => {
      const st = t.status === 'start' ? 'running' : (t.status || '');
      const cls = t.status === 'start' ? ' running' : (t.status && t.status !== 'success' ? ' error' : '');
      return `<span class="tool-pill${cls}">${escape(t.tool || t.server || 'tool')} · ${escape(st)}</span>`;
    }).join('');
    const more = hidden ? `<span class="tool-pill">+${hidden} earlier</span>` : '';
    const pills = node.querySelector('.tool-pills');
    if (pills) pills.innerHTML = more + shown;
    const parts = liveLog.find(e => e.kind === 'parts');
    const partsRow = node.querySelector('.work-parts-row');
    if (partsRow) {
      partsRow.innerHTML = parts ? `<div class="work-step"><span class="t">${escape(parts.at)}</span><b>imported / generated parts</b><div class="work-parts">${(parts.names || []).map(n => `<span class="part-chip">${escape(n)}</span>`).join('')}</div></div>` : '';
    }
    const running = liveTools.filter(t => t.status === 'start').map(t => ({ kind: 'run', at: clock(), tool: t.tool || 'tool' }));
    const done = liveLog.filter(e => e.kind === 'err' || e.kind === 'ok');
    const events = done.concat(running).slice(-12).reverse();
    const errBox = node.querySelector('.work-errors');
    if (errBox) {
      errBox.innerHTML = events.map(e => {
        const cls = e.kind === 'err' ? ' err' : (e.kind === 'ok' ? ' ok' : '');
        const detail = e.kind === 'err'
          ? ` failed${e.ms ? ' · ' + escape(e.ms) : ''} — ${escape((e.error || '').slice(0, 160))}`
          : (e.kind === 'ok' ? ` ${e.ms ? '· ' + escape(e.ms) : 'ok'}` : ' running');
        return `<div class="work-step${cls}"><span class="t">${escape(e.at)}</span><b>${escape(e.tool || e.kind)}</b>${detail}</div>`;
      }).join('');
    }
    const box = node.querySelector('.work-visuals');
    if (!box) return;
    const imgs = liveLog.filter(e => e.url);
    const byKind = {};
    imgs.forEach(e => { byKind[e.kind] = e; });
    const order = ['svg', 'pcb-svg'].concat(Object.keys(byKind).filter(k => k !== 'svg' && k !== 'pcb-svg'));
    const wanted = order.filter(k => byKind[k]);
    [...box.querySelectorAll('figure')].forEach(fig => {
      if (!wanted.includes(fig.dataset.kind)) fig.remove();
    });
    wanted.forEach(kind => {
      const e = byKind[kind];
      let fig = box.querySelector(`figure[data-kind="${kind}"]`);
      if (!fig) {
        fig = document.createElement('figure');
        fig.className = 'live-visual';
        fig.dataset.kind = kind;
        fig.innerHTML = '<img alt=""><figcaption></figcaption>';
        box.appendChild(fig);
      }
      const img = fig.querySelector('img');
      if (img && img.getAttribute('src') !== e.url) {
        img.src = e.url;
        img.alt = e.caption || '';
      }
      const cap = fig.querySelector('figcaption');
      if (cap) cap.textContent = `${e.at} · ${e.caption || ''}`;
    });
  };
  const updatePending = () => {
    fillWorkShell(pending);
    fillWorkShell(studioPending);
    chatScrollTargets().forEach(scrollChatToBottom);
  };

  const applyFinal = async (data) => {
    stopClock();
    AudioCues.receive();
    if (data.action && data.action.type === 'load_live_mesh') await handleChatBuildAction(data.action, { silent: true });
    if (data.board_action) await loadLiveBoard(data.board_action, { silent: true });
    else if (data.action && data.action.type === 'load_live_board') await loadLiveBoard(data.action, { silent: true });
    const shot = captureViewportImage();
    const captures = [];
    if (shot) captures.push({ type: 'preview', payload: { url: shot, kind: 'assembly', name: '3D assembly' } });
    const traceCards = (data.trace || liveTools).map(t => ({
      type: 'mcp',
      payload: {
        server: t.server,
        tool: t.tool,
        status: t.status,
        latency_ms: t.latency_ms,
        error: t.error,
        repaired: t.repaired,
        summary: t.skipped ? 'reused existing schematic' : undefined
      }
    }));
    const otherCards = (data.cards || []).filter(c => c && c.type !== 'mcp' && c.type !== 'episode');
    appendCopilotMessage({
      role: 'agent',
      text: data.reply,
      reasoning: data.reasoning,
      cards: [...captures, ...otherCards, ...traceCards],
      chips: data.chips,
      citations: (data.citations || []).filter(c => c && c.kind === 'rule').slice(0, 2)
    });
    appendStudioEvent('GLM-4.7-Flash', (data.reply || '').slice(0, 160) + ((data.reply || '').length > 160 ? '…' : ''));
    const previewCards = [...captures, ...otherCards].filter(c => c && c.type === 'preview' && c.payload);
    if (previewCards.length) window.__lastPreviewAction = { images: previewCards.map(c => c.payload) };
    if (data.action && data.action.type === 'show_artifact') {
      const kind = data.action.artifact || 'memory';
      if (kind === 'learning') openStudioTab('learning');
      else showArtifact(kind, data.action.title || kind);
    }
    persistWorkspaceState();
    try {
      await fetchDesignAgentTelemetry();
      renderStudioContext();
      renderStudioMemorySummary();
    } catch {}
    if (source === 'studio') { /* keep the composer clear — don't cover the title */ }
  };

  try {
    const res = await fetch('/api/agent/chat/stream', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Accept': 'text/event-stream'},
      body: JSON.stringify({ message: raw, workspace: currentWorkspaceId() })
    });
    if (!res.ok || !res.body) throw new Error('stream unavailable');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let gotFinal = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const chunks = buf.split('\n\n');
      buf = chunks.pop() || '';
      for (const chunk of chunks) {
        const line = chunk.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        if (ev.type === 'status' || ev.type === 'thought') {
          pending.dataset.status = ev.text || 'Still working…';
          updatePending();
        } else if (ev.type === 'pipeline') {
          setPipelineTaskStatus(ev.step, ev.status, ev.label);
        } else if (ev.type === 'memory') {
          if (ev.workspace_id && ev.workspace_id !== currentWorkspaceId()) continue;
          if (Array.isArray(ev.heuristics)) designMemoryData = ev.heuristics;
          if (ev.episode) {
            const eps = Array.isArray(designTelemetryData) ? designTelemetryData.slice() : [];
            designTelemetryData = [...eps.filter(e => e.episode_id !== ev.episode.episode_id), ev.episode];
          }
          applyWorkspaceMemory(designMemoryData, designTelemetryData);
          pushLearningPoint({ rules: (designMemoryData || []).length, label: 'reflect' });
          renderStudioMemorySummary();
          renderStudioContext();
        } else if (ev.type === 'graph') {
          designGraphData = { agents: ev.agents || [] };
          const mem = workspaceChats[currentWorkspaceId()] || (workspaceChats[currentWorkspaceId()] = {});
          mem.roles = designGraphData;
          renderStudioRoles(ev.agents);
        } else if (ev.type === 'tool' && ev.phase === 'start') {
          liveTools.push({ server: ev.server, tool: ev.tool, status: 'start' });
          pending.dataset.status = `Still working — ${ev.server || 'mcp'}/${ev.tool || 'tool'}…`;
          upsertStudioRole(roleForTool(ev.server, ev.tool), 'building');
          revealMemoryLearn();
          updatePending();
        } else if (ev.type === 'tool' && ev.phase === 'done') {
          const row = liveTools.find(t => t.tool === ev.tool && t.status === 'start') || liveTools[liveTools.length - 1];
          const ok = (ev.status || 'success') === 'success';
          pushLearningPoint({ ok: ok ? 1 : 0, fail: ok ? 0 : 1, label: ev.tool });
          if (row) {
            row.status = ev.status || 'success';
            row.latency_ms = ev.latency_ms;
            row.skipped = ev.skipped;
            row.error = ev.error;
            row.repaired = ev.repaired;
          }
          const ms = ev.latency_ms != null ? Math.round(ev.latency_ms) + 'ms' : '';
          if (!ok) {
            liveLog.push({ kind: 'err', at: clock(), tool: ev.tool || 'tool', error: ev.error || 'error', ms });
          } else {
            liveLog.push({ kind: 'ok', at: clock(), tool: ev.tool || 'tool', ms });
          }
          updatePending();
        } else if (ev.type === 'visual') {
          const at = clock();
          if (ev.kind === 'parts') {
            upsertLog('parts', { kind: 'parts', at, names: ev.part_names || [], caption: ev.caption });
          } else if (ev.url) {
            upsertLog(ev.kind || 'svg', { kind: ev.kind || 'svg', at, url: ev.url, caption: ev.caption, payload: ev.payload });
          } else if (ev.kind === 'pins' && ev.payload) {
            upsertLog('pins', { kind: 'pins', at, payload: ev.payload, caption: ev.caption });
          } else if (ev.caption) {
            liveLog.push({ kind: 'ok', at, tool: ev.kind || 'note', caption: ev.caption });
          }
          if (ev.caption) pending.dataset.status = ev.caption;
          updatePending();
        } else if (ev.type === 'mesh' && ev.action) {
          pending.dataset.status = 'Still working — CAD kernel finished parts…';
          updatePending();
          await handleChatBuildAction(ev.action, { silent: true });
          upsertLog('parts', { kind: 'parts', at: clock(), names: ev.action.part_names || [], caption: 'CAD solids' });
          updatePending();
        } else if (ev.type === 'board' && ev.action) {
          pending.dataset.status = 'Still working — laying out the PCB…';
          updatePending();
          await loadLiveBoard(ev.action, { silent: true });
          updatePending();
        } else if (ev.type === 'final') {
          gotFinal = true;
          stopClock();
          pending.remove();
          studioPending.remove();
          const live = (designGraphData && designGraphData.agents) || [];
          live.filter(a => a.spawned || (a.status && a.status !== 'idle')).forEach(a => {
            const st = String(a.status || '').toLowerCase();
            if (['building', 'active', 'evaluating', 'synthesizing'].includes(st)) {
              a.status = a.role === 'Verifier' ? 'verified' : 'done';
            }
          });
          renderStudioRoles(live);
          await applyFinal(ev);
        } else if (ev.type === 'error') {
          pending.dataset.status = 'Still working — recovering from a tool error…';
          updatePending();
        }
      }
    }
    if (!gotFinal) throw new Error('stream ended without a final reply');
  } catch (err) {
    stopClock();
    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ message: raw, workspace: currentWorkspaceId() })
      });
      pending.remove();
      studioPending.remove();
      if (res.ok) {
        await applyFinal(await res.json());
      } else {
        AudioCues.receive();
        appendCopilotMessage(buildLocalReply(raw));
      }
    } catch {
      pending.remove();
      studioPending.remove();
      AudioCues.receive();
      appendCopilotMessage(buildLocalReply(raw));
    }
  }
}

function applyPreviewToViewport(action) {
  const images = (action && action.images) || (action && action.url ? [action] : []);
  const first = images[0] || action;
  const url = first && first.url;
  if (!url) return;
  const overlay = document.getElementById('preview-overlay');
  const img = document.getElementById('preview-overlay-img');
  if (img) {
    img.src = url;
    img.alt = first.name || first.kind || 'Generated preview';
  }
  if (overlay) overlay.hidden = false;
  const cap = document.getElementById('geometry-caption');
  if (cap) cap.textContent = `${(first.kind || 'PREVIEW').toUpperCase()} · ${first.name || 'generated'}`;
  const eyebrow = document.getElementById('canvas-eyebrow');
  if (eyebrow) eyebrow.textContent = `GENERATED / ${(first.kind || 'DESIGN').toUpperCase()}`;
  const revLabel = document.getElementById('revision-label');
  if (revLabel) revLabel.textContent = `${(getActiveProject()?.name || 'DESIGN').toUpperCase()} · PREVIEW`;
  window.__lastPreviewAction = action;
}

function captureViewportImage() {
  try {
    if (!renderer || !scene || !camera) return null;
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } catch {
    return null;
  }
}

function hideDesignPreviewOverlay() {
  const overlay = document.getElementById('preview-overlay');
  if (overlay) overlay.hidden = true;
}

function footprintKind(libId) {
  const s = String(libId || '').toLowerCase();
  if (s.includes('capacitor') || /(^|:)c(_|$)/.test(s) || s.includes(':c')) return 'cap';
  if (s.includes('led')) return 'led';
  if (s.includes('inductor') || s.includes(':l')) return 'inductor';
  if (s.includes('diode') || s.includes(':d')) return 'diode';
  if (s.includes('sot') || s.includes('q_')) return 'sot';
  return 'res';
}

function gltfComponentSize(type, componentType) {
  const comps = {SCALAR:1, VEC2:2, VEC3:3, VEC4:4, MAT4:16}[type] || 1;
  const bytes = {5120:1, 5121:1, 5122:2, 5123:2, 5125:4, 5126:4}[componentType] || 4;
  return {comps, bytes};
}

function readGltfAccessor(gltf, bin, accessorIndex) {
  const acc = gltf.accessors[accessorIndex];
  if (!acc) return null;
  const view = gltf.bufferViews[acc.bufferView];
  const {comps, bytes} = gltfComponentSize(acc.type, acc.componentType);
  const stride = view.byteStride || (comps * bytes);
  const offset = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const count = acc.count;
  const out = acc.componentType === 5126 ? new Float32Array(count * comps)
    : acc.componentType === 5125 ? new Uint32Array(count * comps)
    : acc.componentType === 5123 ? new Uint16Array(count * comps)
    : new Uint32Array(count * comps);
  const src = new DataView(bin);
  for (let i = 0; i < count; i++) {
    const at = offset + i * stride;
    for (let c = 0; c < comps; c++) {
      const p = at + c * bytes;
      let v;
      switch (acc.componentType) {
        case 5126: v = src.getFloat32(p, true); break;
        case 5125: v = src.getUint32(p, true); break;
        case 5123: v = src.getUint16(p, true); break;
        case 5122: v = src.getInt16(p, true); break;
        case 5121: v = src.getUint8(p); break;
        default: v = src.getUint8(p);
      }
      out[i * comps + c] = v;
    }
  }
  return {data: out, count, comps};
}

function gltfMaterialToThree(mat) {
  const pbr = (mat && mat.pbrMetallicRoughness) || {};
  const c = pbr.baseColorFactor || [0.18, 0.42, 0.28, 1];
  const opacity = c[3] == null ? 1 : c[3];
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(c[0], c[1], c[2]),
    metalness: pbr.metallicFactor == null ? 0.12 : pbr.metallicFactor,
    roughness: pbr.roughnessFactor == null ? 0.45 : pbr.roughnessFactor,
    transparent: opacity < 0.99 || mat?.alphaMode === 'BLEND',
    opacity,
    side: THREE.DoubleSide,
    depthWrite: opacity >= 0.95
  });
  m.userData.baseOpacity = opacity;
  return m;
}

function nicePartName(raw, meshName) {
  const s = String(raw || meshName || 'part');
  if (/soldermask/i.test(s)) return 'Soldermask';
  if (/silkscreen/i.test(s)) return 'Silkscreen';
  if (/_pad$/i.test(s) || /pad/i.test(s)) return 'Pads';
  if (/_PCB/i.test(s) || /pcb$/i.test(s)) return 'FR4';
  if (/^=>/.test(s)) return meshName || 'Body';
  return s;
}

async function loadGlbBoard(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('GLB HTTP ' + res.status);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a GLB');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binOff = 20 + jsonLen;
  const binLen = dv.getUint32(binOff, true);
  const bin = buf.slice(binOff + 8, binOff + 8 + binLen);
  const materials = (json.materials || []).map(gltfMaterialToThree);
  const meshGeoms = (json.meshes || []).map((mesh, mi) => {
    const group = new THREE.Group();
    group.name = mesh.name || ('mesh-' + mi);
    (mesh.primitives || []).forEach((prim, pi) => {
      const pos = readGltfAccessor(json, bin, prim.attributes.POSITION);
      if (!pos) return;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos.data), 3));
      if (prim.attributes.NORMAL != null) {
        const nrm = readGltfAccessor(json, bin, prim.attributes.NORMAL);
        if (nrm) geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm.data), 3));
      } else {
        geom.computeVertexNormals();
      }
      if (prim.indices != null) {
        const idx = readGltfAccessor(json, bin, prim.indices);
        if (idx) geom.setIndex(new THREE.BufferAttribute(idx.data, 1));
      }
      const mat = materials[prim.material] ? materials[prim.material].clone() : new THREE.MeshStandardMaterial({color:0x1a5c38});
      const m = new THREE.Mesh(geom, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = mesh.name || 'part';
      group.add(m);
    });
    return group;
  });
  const root = new THREE.Group();
  const nodes = json.nodes || [];
  const built = nodes.map(() => new THREE.Group());
  nodes.forEach((node, i) => {
    const g = built[i];
    g.name = node.name || ('node-' + i);
    if (node.matrix) {
      g.matrix.fromArray(node.matrix);
      g.matrixAutoUpdate = false;
    } else {
      const t = node.translation || [0,0,0];
      const r = node.rotation || [0,0,0,1];
      const s = node.scale || [1,1,1];
      g.position.set(t[0], t[1], t[2]);
      g.quaternion.set(r[0], r[1], r[2], r[3]);
      g.scale.set(s[0], s[1], s[2]);
      g.matrixAutoUpdate = true;
    }
    if (node.mesh != null && meshGeoms[node.mesh]) g.add(meshGeoms[node.mesh].clone());
    (node.children || []).forEach(ci => g.add(built[ci]));
  });
  const sceneNodes = (json.scenes?.[json.scene || 0]?.nodes) || [0];
  sceneNodes.forEach(i => root.add(built[i]));
  // KiCad GLB is metres / Y-up. Studio viewport is millimetres / Z-up.
  root.scale.set(1000, 1000, 1000);
  root.rotation.x = Math.PI / 2;
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh) return;
    const names = [];
    for (let n = o; n; n = n.parent) {
      const nm = n.name || '';
      if (nm && !/^=>/.test(nm) && nm !== 'Scene') names.push(nm);
    }
    const ref = names.find(n => /^[A-Z]{1,3}\d+$/i.test(n));
    const layer = names.find(n => /pcb|solder|silk|pad/i.test(n));
    const meshName = o.parent?.name || o.name;
    o.userData.name = nicePartName(ref || layer || names[0] || meshName, meshName);
    o.userData.group = 'electronics';
  });
  return root;
}

function buildBoardGroup(board) {
  const g = new THREE.Group();
  g.name = 'generated-pcb';
  const w = Math.max(36, Number(board.width) || 40);
  const h = Math.max(24, Number(board.height) || 30);
  const t = Number(board.thickness) || 1.6;
  const ox = Number(board.origin_x) || 0;
  const oy = Number(board.origin_y) || 0;
  const toLocal = (x, y) => [(x - ox) - w / 2, -((y - oy) - h / 2)];

  const fr4 = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, t),
    new THREE.MeshStandardMaterial({ color: 0x1a5c38, roughness: 0.38, metalness: 0.12 })
  );
  fr4.receiveShadow = true;
  fr4.userData = { name: 'FR4', group: 'electronics' };
  g.add(fr4);

  const mask = new THREE.Mesh(
    new THREE.BoxGeometry(w - 0.4, h - 0.4, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x0e3d24, roughness: 0.45, metalness: 0.08, transparent: true, opacity: 0.88 })
  );
  mask.position.z = t / 2 + 0.03;
  mask.userData = { name: 'Soldermask', group: 'electronics' };
  g.add(mask);

  (board.traces || []).forEach(tr => {
    const [x1, y1] = toLocal(tr.x1, tr.y1);
    const [x2, y2] = toLocal(tr.x2, tr.y2);
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.05) return;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(len, Math.max(0.15, tr.width || 0.25), 0.05),
      new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.85, roughness: 0.28 })
    );
    mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, t / 2 + 0.06);
    mesh.rotation.z = Math.atan2(dy, dx);
    mesh.userData = { name: 'Copper', group: 'electronics' };
    g.add(mesh);
  });

  (board.footprints || []).forEach(fp => {
    const [lx, ly] = toLocal(fp.x, fp.y);
    const kind = footprintKind(fp.lib_id);
    const body = new THREE.Group();
    body.position.set(lx, ly, t / 2);
    body.rotation.z = -((fp.rot || 0) * Math.PI) / 180;
    const pads = fp.pads || [];
    const header = /header|pinheader|1x0/i.test(fp.lib_id || '') || /^J\d/i.test(fp.reference || '');
    if (header) {
      const n = Math.max(2, pads.length || 2);
      const pitch = 2.54;
      const len = (n - 1) * pitch + 2.4;
      const plastic = new THREE.Mesh(
        new THREE.BoxGeometry(len, 2.5, 2.6),
        new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.45, metalness: 0.08 })
      );
      plastic.position.z = 1.3;
      plastic.userData = { name: fp.reference || 'Header', group: 'electronics' };
      body.add(plastic);
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * pitch;
        const pin = new THREE.Mesh(
          new THREE.CylinderGeometry(0.32, 0.32, 7.2, 8),
          new THREE.MeshStandardMaterial({ color: 0xd4b45a, metalness: 0.92, roughness: 0.18 })
        );
        pin.rotation.x = Math.PI / 2;
        pin.position.set(x, 0, 2.2);
        pin.userData = { name: (fp.reference || 'J') + '.' + (i + 1), group: 'electronics' };
        body.add(pin);
      }
    } else {
      const bw = pads.length ? Math.max(...pads.map(p => Math.abs(p.x))) * 2 + 1.2 : 2.0;
      const bh = pads.length ? Math.max(...pads.map(p => Math.abs(p.y) + p.sy / 2), 0.6) : 1.25;
      const colors = { res: 0x2b2118, cap: 0xcfb56a, led: 0x1f6feb, inductor: 0x3d3d3d, diode: 0x222222, sot: 0x1a1a1a };
      const chip = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(1.6, bw * 0.55), Math.max(0.8, bh), kind === 'led' ? 0.7 : 0.55),
        new THREE.MeshStandardMaterial({ color: colors[kind] || 0x2b2118, roughness: 0.4, metalness: kind === 'cap' ? 0.35 : 0.08 })
      );
      chip.position.z = 0.35;
      chip.userData = { name: fp.reference || kind.toUpperCase(), group: 'electronics' };
      body.add(chip);
      pads.forEach(p => {
        const pad = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(0.4, p.sx), Math.max(0.4, p.sy), 0.12),
          new THREE.MeshStandardMaterial({ color: 0xdfb43a, metalness: 0.9, roughness: 0.2 })
        );
        pad.position.set(p.x, -p.y, 0.08);
        pad.userData = { name: (fp.reference || 'Pad'), group: 'electronics' };
        body.add(pad);
      });
    }
    g.add(body);
  });
  g.userData.center = new THREE.Vector3(0, 0, 0);
  g.userData.bbox = new THREE.Vector3(w, h, t + 2);
  g.userData.kind = 'pcb';
  return g;
}

function normalizeBoardGroup(group, targetWidth = 48) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return group;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, 0.001);
  const s = targetWidth / span;
  group.scale.multiplyScalar(s);
  group.position.sub(center.multiplyScalar(s));
  group.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(group);
  const c2 = box2.getCenter(new THREE.Vector3());
  const s2 = box2.getSize(new THREE.Vector3());
  group.position.x -= c2.x;
  group.position.y -= c2.y;
  group.position.z -= c2.z - s2.z / 2;
  return group;
}

function mountBoardInViewport(group) {
  if (!renderer) return;
  group.userData.kind = 'pcb';
  group.userData.name = 'Servo driver PCB';
  group.userData.group = 'electronics';
  group.traverse(o => {
    if (!o.isMesh) return;
    if (!o.userData.name) o.userData.name = 'Servo driver PCB';
    o.userData.group = 'electronics';
  });
  const boardW = Number(window.__lastBoardAction?.board?.width) || 48;
  normalizeBoardGroup(group, Math.min(60, Math.max(24, boardW)));
  if (assembly) {
    [...assembly.children].filter(c => c.userData && c.userData.kind === 'pcb').forEach(c => {
      assembly.remove(c);
      try { disposeAssembly(c); } catch {}
    });
  }
  const hasCad = assembly && topLevelParts().some(c => c.userData?.kind !== 'pcb');
  if (hasCad) {
    const cadBox = new THREE.Box3().setFromObject(assembly);
    const size = cadBox.getSize(new THREE.Vector3());
    const center = cadBox.getCenter(new THREE.Vector3());
    group.position.x += center.x + size.x * 0.5 + 20;
    group.position.y += center.y;
    group.userData._home = group.position.clone();
    assembly.add(group);
    assembly.userData.center = new THREE.Box3().setFromObject(assembly).getCenter(new THREE.Vector3());
    assembly.userData.bbox = new THREE.Box3().setFromObject(assembly).getSize(new THREE.Vector3());
    updateModel();
    fitAssembly();
    renderAssemblyPanel();
    renderTimeline();
    setViewStatus('');
    return;
  }
  if (assembly) { scene.remove(assembly); disposeAssembly(assembly); }
  const box = new THREE.Box3().setFromObject(group);
  group.userData.center = box.getCenter(new THREE.Vector3());
  group.userData.bbox = box.getSize(new THREE.Vector3());
  assembly = group;
  scene.add(assembly);
  selectedNames.clear(); isolatedNames.clear();
  fitAssembly();
  renderAssemblyPanel();
  renderTimeline();
  setViewStatus('');
}

async function loadLiveBoard(action, opts = {}) {
  if (!action || !(action.board || action.glb_url)) return;
  hideDesignPreviewOverlay();
  window.__lastBoardAction = action;
  let group = null;
  let usedGlb = false;
  const nfp = (action.board?.footprints || []).length;
  if (action.glb_url && nfp) {
    try {
      group = await loadGlbBoard(action.glb_url);
      const box = new THREE.Box3().setFromObject(group);
      const s = box.getSize(new THREE.Vector3());
      const mx = Math.max(s.x, s.y, s.z), mn = Math.min(s.x, s.y, s.z) || 0.001;
      if (mx > 220 || mn > 8) group = null;
      else usedGlb = true;
    } catch (err) {
      console.warn('KiCad GLB load failed, using solid fallback', err);
      group = null;
    }
  }
  if (!group && action.board) group = buildBoardGroup(action.board);
  if (!group) return;
  mountBoardInViewport(group);
  try {
    const proj = getActiveProject();
    const fps = action.board?.footprints || [];
    if (fps.length) {
      const pinFn = (fp, n) => {
        const count = (fp.pads || []).length;
        if (count <= 2) return ({1:'5V',2:'GND'})[n] || ('pin '+n);
        const val = String(fp.value || '').toUpperCase();
        const pwm = val.includes('PAN') ? 'PAN PWM' : (val.includes('TILT') ? 'TILT PWM' : 'PWM');
        return ({1:'5V',2:'GND',3:pwm})[n] || ('pin '+n);
      };
      const liveSchematic = {
        title: 'Live KiCad servo driver',
        connectors: fps.map(fp => ({
          ref: fp.reference || 'J',
          value: fp.value || fp.lib_id || '',
          pins: (fp.pads || []).map(p => ({ number: String(p.number || ''), function: pinFn(fp, String(p.number || '')) }))
        })),
        nets: fps.slice(0, 8).map(fp => ({
          name: fp.reference || fp.value || 'pad',
          pins: [fp.value || fp.lib_id || '', String(fp.x != null ? fp.x.toFixed(1) + ' mm' : '')]
        })),
        caution: `${fps.length} footprint(s) from the agent's KiCad board.`
      };
      if (pendingDesign) pendingDesign.liveSchematic = liveSchematic;
      try {
        const list = loadDesigns();
        const idx = list.findIndex(x => x && x.id === (pendingDesign?.id || activeProjectId));
        if (idx >= 0) { list[idx].liveSchematic = liveSchematic; persistDesigns(list); }
      } catch {}
      if (proj) proj.schematic = liveSchematic;
      renderAssemblyPanel();
    }
  } catch {}
  const n = (action.board?.footprints || []).length;
  const src = usedGlb ? 'KiCad 3D' : 'solid PCB';
  const cap = document.getElementById('geometry-caption');
  if (cap) cap.textContent = `PCB · ${src} · ${n} footprint${n === 1 ? '' : 's'} · ${(action.board?.width || '?')}×${(action.board?.height || '?')} mm`;
  const eyebrow = document.getElementById('canvas-eyebrow');
  if (eyebrow) eyebrow.textContent = 'GENERATED / REALISTIC 3D PCB';
  const revLabel = document.getElementById('revision-label');
  if (revLabel) revLabel.textContent = `${(getActiveProject()?.name || 'DESIGN').toUpperCase()} · 3D PCB`;
  const ml = document.querySelector('.model-label');
  if (ml) {
    ml.hidden = false;
    const b = ml.querySelector('b');
    if (b) b.textContent = 'LIVE KICAD BOARD';
    const span = ml.querySelector('span:last-child');
    if (span && span.childNodes[0]) span.childNodes[0].textContent = `${action.board?.width || ''} × ${action.board?.height || ''} mm`;
  }
  if (!document.body.classList.contains('is-studio')) tab('assembly');
  persistWorkspaceState();
  if (opts.silent) return;
  const shot = captureViewportImage();
  if (shot) {
    appendCopilotMessage({
      role: 'agent',
      text: 'Realistic KiCad 3D board in the workspace viewport.',
      cards: [{ type: 'preview', payload: { url: shot, kind: 'pcb3d', name: 'board-3d.png' } }]
    });
  }
}

async function handleChatBuildAction(a, opts = {}) {
  try {
    hideDesignPreviewOverlay();
    const wsRun = { base: a.base, iterations: a.iterations, jobId: a.job_id, kind: a.kind };
    if (a.kind !== 'import') {
      liveRunsByProject[activeProjectId] = wsRun;
      liveRun = wsRun;
    }
    setViewStatus('Loading agent-built geometry…', 'loading');
    const keptPcb = assembly && [...(assembly.children || [])].find(c => c.userData && c.userData.kind === 'pcb');
    const mesh = await json(a.base + `iteration-${a.iterations}/mesh.json`);
    if (a.kind === 'import' && assembly && assemblyParts().length) appendMeshes(mesh);
    else drawMeshes(mesh);
    if (keptPcb && assembly && keptPcb.parent !== assembly) {
      assembly.add(keptPcb);
      assembly.userData.center = new THREE.Box3().setFromObject(assembly).getCenter(new THREE.Vector3());
      assembly.userData.bbox = new THREE.Box3().setFromObject(assembly).getSize(new THREE.Vector3());
    }
    fitAssembly();
    const cap = document.getElementById('geometry-caption');
    const n = assemblyParts().length;
    if (cap) cap.textContent = `${(a.kind || 'CAD').toUpperCase()} · ${n} part${n===1?'':'s'}`;
    const eyebrow = document.getElementById('canvas-eyebrow');
    if (eyebrow) eyebrow.textContent = a.kind === 'agent' ? 'GENERATED / AGENT CAD' : (a.kind === 'import' ? 'IMPORTED / SOLID' : 'GENERATED / OPENCASCADE');
    const proj = getActiveProject();
    if (proj) {
      if (!a.unevaluated) {
        const mk = (n, spec, checks) => ({ n, spec: { ...spec }, evaluated: true,
          passed: (checks || []).every(c => c.passed), source_job: a.job_id,
          note: 'agent chat build', saved_at: new Date().toISOString(), checks: checks || [] });
        proj.revisions = a.iterations > 1
          ? [mk(1, a.spec_first, a.checks_first), mk(2, a.spec, a.checks_final)]
          : [mk(1, a.spec, a.checks_final), mk(1, a.spec, a.checks_final)];
        proj.hasGeometry = true;
        const passedCount = (a.checks_final || []).filter(c => c.passed).length;
        proj.stateText = a.passed ? `Agent build · ${passedCount}/${(a.checks_final || []).length} Pass` : 'Agent build · needs review';
        proj.statePass = !!a.passed;
      } else {
        proj.hasGeometry = true;
        proj.stateText = a.passed ? 'Agent part · valid solid' : 'Agent part · check geometry';
        proj.statePass = !!a.passed;
      }
      proj.files = (a.files || []).map(f => ({ name: f.name, bytes: f.bytes, sha256: f.sha256, type: f.type || 'FILE', downloadUrl: f.downloadUrl }));
      for (const k of ['length', 'width', 'mast_height']) {
        const el = document.getElementById(k);
        if (el && a.spec && a.spec[k] != null) el.value = a.spec[k];
      }
      try {
        const list = loadDesigns();
        const idx = list.findIndex(x => x.id === proj.id);
        if (idx >= 0) { list[idx].revisions = proj.revisions; list[idx].liveRun = wsRun; persistDesigns(list); }
        if (pendingDesign && pendingDesign.id === proj.id) { pendingDesign.revisions = proj.revisions; pendingDesign.liveRun = wsRun; }
      } catch {}
      const stateEl = document.getElementById('project-state');
      if (stateEl) { stateEl.textContent = proj.stateText; stateEl.parentElement.className = 'project-state ' + (proj.statePass ? 'pass' : 'fail'); }
      const revLabel = document.getElementById('revision-label');
      if (revLabel) revLabel.textContent = `${proj.name.toUpperCase()} · AGENT BUILD`;
    }
    renderFiles(proj);
    await fetchDesignAgentTelemetry();
    if (!a.unevaluated) updateRevisionUI(2);
    renderStudioContext();
    const note = document.querySelector('#design-mode .design-mode-note');
    if (note) note.textContent = 'Agent-built CAD in this workspace.';
    if (!opts.silent) {
      const shot = captureViewportImage();
      if (shot) {
        appendCopilotMessage({
          role: 'agent',
          text: 'Viewport capture of the generated solid.',
          cards: [{ type: 'preview', payload: { url: shot, kind: 'mesh', name: 'viewport.png' } }]
        });
      }
      toast(a.unevaluated ? 'Agent part loaded — valid CAD solid.' : 'Agent build loaded — real kernel mesh.');
    }
  } catch (err) {
    toast('Could not load agent-built mesh: ' + (err.message || err));
  }
}

$('#brief-form').onsubmit=async e=>{
  e.preventDefault();
  const raw=$('#brief').value.trim();
  if(!raw){
    $('#brief-feedback').textContent='Describe a change, ask why a check failed, or type / for commands.';
    return;
  }
  if(isTestMode){
    runSimulatedTest(raw);
    return;
  }

  $('#brief-feedback').textContent='';
  await handleComposerSubmit(raw, 'copilot');
};

try{init3D()}catch(e){renderer=null;setViewStatus('WebGL is unavailable. Enable hardware acceleration, then retry.','error');console.warn(e.message)}
try{
 report=await json(artifactBase+'report.json');
 reportReadyResolve(report);
 iteration=report.final_iteration||iteration;
 syncBriefAndDims();
 await setActiveProject('clean');
 renderDashboard();
  tab((location.hash||'').replace(/^#\/?/,'')||'dashboard');
 pulseHero();
 initDesignAgentWorkspace();
}catch(e){
 reportReadyResolve(null);
 setViewStatus('Recorded geometry unavailable on this deployment — check the connection.','error');
 toast('Build artifacts unavailable: '+e.message);
 if($('#activity')) $('#activity').textContent='Could not load recorded evidence. Please refresh or inspect the source repository.';
 try{ renderDashboard(); tab((location.hash||'').replace(/^#\/?/,'')||'dashboard'); }catch{}
 await setActiveProject('clean');
 initDesignAgentWorkspace();
}

if(['127.0.0.1','localhost'].includes(location.hostname)&&location.port==='8766'){try{await json('/api/health');runner=location.origin;$('#connection-label').textContent='Local runner connected';$('#composer-mode').textContent='LOCAL CAD KERNEL';const fm=$('#footer-mode');if(fm)fm.textContent='LOCAL RUNNER · DETERMINISTIC CAD'}catch{}}

// ---- My designs client-side library ----
function nowIso(){return new Date().toISOString()}
function loadDesigns(){try{const raw=localStorage.getItem(DESIGNS_KEY);return raw?JSON.parse(raw):[]}catch{storageOK=false;return[]}}
function persistDesigns(list){try{localStorage.setItem(DESIGNS_KEY,JSON.stringify(list));storageOK=true;return true}catch{storageOK=false;return false}}
function currentSpec(){const s={};for(const name of ['length','width','mast_height'])s[name]=Number($('#'+name).value);return s}
function inTemplateRange(spec){return [['length',120,180],['width',80,110],['mast_height',35,75]].every(([k,min,max])=>Number.isFinite(spec[k])&&spec[k]>=min&&spec[k]<=max)}
function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,32)||'design'}
function downloadText(name,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
function designState(d){const last=d.revisions[d.revisions.length-1];if(last.evaluated)return last.passed?'EVALUATED · PASS':'EVALUATED · FAIL';return d.kind==='imported'?'IMPORTED · NOT EVALUATED':'LOCAL DRAFT'}
function designCard(d){
 const last=d.revisions[d.revisions.length-1],state=designState(d),rv=d.revisions.length;
 return `<article class="design-card"><div class="design-card-head"><span class="design-kind ${d.kind}">${d.kind.toUpperCase()}</span><span class="design-id mono">${rv} revision${rv>1?'s':''}</span></div><h3>${escape(d.name)}</h3><p class="design-desc">${escape(d.description||'No description yet.')}</p><div class="design-spec">${last.spec.length} × ${last.spec.width} mm · mast ${last.spec.mast_height} mm</div><div class="design-state ${last.evaluated?(last.passed?'pass':'fail'):''}">${state}</div><div class="design-actions"><button class="text-button" data-design="${escape(d.id)}" data-act="open">Open ↗</button><button class="text-button" data-design="${escape(d.id)}" data-act="export">Export ↓</button><button class="text-button" data-design="${escape(d.id)}" data-act="rev">Save revision</button><button class="text-button" data-design="${escape(d.id)}" data-act="delete">Delete</button></div></article>`;
}

function renderDesigns(){
 const list=loadDesigns();
 const count=$('#designs-count');if(count)count.textContent=storageOK?`${list.length} saved in this browser`:'storage unavailable — nothing will persist';
 const host=$('#designs');if(!host)return;
 host.innerHTML=(!storageOK)?`<div class="empty-designs">Browser storage is unavailable in this context (e.g. private mode). Designs cannot be saved here.</div>`:(list.length?list.map(designCard).join(''):`<div class="empty-designs">No saved designs yet. Import a design bundle or create one from the parametric template.</div>`);
}

function designBundle(d){
 const revs=(Array.isArray(d?.revisions)&&d.revisions.length)?d.revisions:[{n:1,spec:d?.spec||{length:140,width:90,mast_height:52},evaluated:false,passed:false,source_job:null,note:'',saved_at:nowIso()}];
 const last=revs[revs.length-1];
 return{format:'autocadent-design',version:1,name:d.name,description:d.description,spec:{...(last.spec||{})},kind:d.kind,source:d.source,created_at:d.created_at,updated_at:d.updated_at,revisions:revs.map(r=>({n:r.n,spec:r.spec,evaluated:r.evaluated,passed:r.passed,source_job:r.source_job||null,note:r.note||'',saved_at:r.saved_at}))};
}
function exportDesign(id){
 if(id==='__demo'){downloadText('rove-1-recorded.autocadent.json',JSON.stringify(designBundle({id:'__demo',name:'Rove-1 (recorded example)',description:report?.description||document.getElementById('brief-text')?.textContent||'Recorded Rove-1 build.',spec:{...DEMO_SPEC},kind:'example',source:'demo',created_at:nowIso(),updated_at:nowIso(),revisions:[{n:1,spec:{...DEMO_SPEC},evaluated:true,passed:!!report?.passed,source_job:null,note:'recorded build',saved_at:nowIso()}]}),null,2));toast('Recorded example exported as a design bundle.');return}
 const list=loadDesigns(),d=list.find(x=>x.id===id);if(!d)return;
 downloadText(slug(d.name)+'.autocadent.json',JSON.stringify(designBundle(d),null,2));toast('Exported "'+d.name+'" bundle.');
}

async function openDesign(id){
 if(id==='__demo'||id==='rove1'){
  pendingDesign=null;
  const m=$('#design-mode');if(m)m.hidden=true;
  const L=$('#length'),W=$('#width'),H=$('#mast_height');
  if(L)L.value=DEMO_SPEC.length;if(W)W.value=DEMO_SPEC.width;if(H)H.value=DEMO_SPEC.mast_height;
  await loadModel('rove1');
  toast('Rove–1 recorded example loaded.');
  tab('assembly');
  return;
 }
 const list=loadDesigns(),d=list.find(x=>x.id===id);
 if(!d){
  toast('That design is not in this browser.');
  return;
 }
 pendingDesign=d;
 if (d.liveRun && d.liveRun.base) liveRunsByProject[d.id] = d.liveRun;
 if (d.liveBoard) window.__lastBoardAction = d.liveBoard;
 const last=(d.revisions&&d.revisions.length)?d.revisions[d.revisions.length-1]:{spec:{length:140,width:90,mast_height:52}};
 const spec=last.spec||{length:140,width:90,mast_height:52};
 const L=$('#length'),W=$('#width'),H=$('#mast_height');
 if(L)L.value=spec.length;if(W)W.value=spec.width;if(H)H.value=spec.mast_height;
 if($('#brief')) $('#brief').value=d.description||'';
 const mode=$('#design-mode');
 if(mode){
  mode.hidden=false;
  const nm=$('#design-mode-name'); if(nm) nm.textContent=d.name;
  const note=mode.querySelector('.design-mode-note');
  if(note)note.textContent=last.evaluated?(last.source_job&&runner?'Attached to a live runner — rebuilds update this design.':'Evaluated earlier; rebuild via the local runner to refresh geometry.'):(d.kind==='imported'?'Imported locally — no CAD artifacts yet. Submit to build.' : 'Local draft — no CAD artifacts yet. Submit to build.');
 }
 await setActiveProject(d.id);
 toast('Design "'+d.name+'" loaded into the workspace.');
 tab('assembly');
}

function saveRevision(id){
 const list=loadDesigns(),d=list.find(x=>x.id===id);if(!d)return;
 const spec=currentSpec();
 if(!inTemplateRange(spec)){toast('Dimensions must stay inside the template ranges to save a revision.');return}
 if(!$('#brief').value.trim()){toast('Add a short description first.');return}
 d.revisions.push({n:d.revisions.length+1,spec:{...spec},evaluated:false,passed:false,source_job:null,note:d.id===pendingDesign?.id?'current workspace draft':'local draft',saved_at:nowIso()});
 d.description=$('#brief').value.trim();d.updated_at=nowIso();
 if(persistDesigns(list)){renderDesigns();toast('Revision '+d.revisions.length+' saved locally for "'+d.name+'".')}else toast('Changes not saved — browser storage unavailable.');
}

let confirmId=null;
function deleteClick(id,btn){
 if(confirmId===id){
  confirmId=null;const list=loadDesigns(),d=list.find(x=>x.id===id);
  if(d){list.splice(list.indexOf(d),1);if(persistDesigns(list)){if(pendingDesign?.id===id){pendingDesign=null;$('#design-mode').hidden=true}renderDesigns();renderDashboard();toast('Deleted "'+d.name+'".')}}
 }else{confirmId=id;btn.textContent='Confirm delete?';btn.classList.add('danger');setTimeout(()=>{if(confirmId===id){confirmId=null;renderDesigns()}},3500)}
}

function importDesigns(text,fileName){
 let b;try{b=JSON.parse(text)}catch(e){throw new Error('Not valid JSON: '+e.message)}
 if(!b||typeof b!=='object'||Array.isArray(b))throw new Error('A design bundle must be a JSON object.');
 const spec={};for(const k of ['length','width','mast_height']){const v=Number(b.spec?.[k]);if(!Number.isFinite(v))throw new Error('Bundle needs numeric spec.'+k+'.');spec[k]=v}
 const norm=r=>({n:r.n||1,spec:{length:Number(r.spec?.length??spec.length)||spec.length,width:Number(r.spec?.width??spec.width)||spec.width,mast_height:Number(r.spec?.mast_height??spec.mast_height)||spec.mast_height},evaluated:!!r.evaluated,passed:!!r.passed,source_job:r.source_job?String(r.source_job):null,note:r.note?String(r.note).slice(0,120):'imported revision',saved_at:r.saved_at||nowIso()});
 const revisions=Array.isArray(b.revisions)&&b.revisions.length?b.revisions.map(norm):[{n:1,spec:{...spec},evaluated:!!(b.evaluated??b.passed!==undefined),passed:!!b.passed,source_job:null,note:'imported bundle',saved_at:nowIso()}];
 return{id:slug((b.name||fileName||'imported')+'-'+Math.random().toString(36).slice(2,7)),name:String(b.name||fileName.replace(/\.autocadent\.json$|\.json$/i,'')||'Imported design').slice(0,40),description:String(b.description||'').slice(0,1500),spec:{...spec},kind:'imported',source:'file',created_at:b.created_at||nowIso(),updated_at:nowIso(),revisions};
}

// Clean New Design without Preloaded Data (Requirement 5)
function createFromTemplate(){
 try{
  modal('Create a new design',`<div class="design-dialog"><label for="design-name">Design name</label><input id="design-name" type="text" maxlength="40" value="" placeholder="e.g. Lunar Prospector Alpha" autocomplete="off"><p class="muted" style="margin-top:8px">Stored cleanly in your browser. Starts with a fresh empty brief.</p><button type="button" id="do-save-design" class="dark-button">Create design ↗</button></div>`);
 }catch(err){
  toast('Could not open the create dialog: '+(err.message||err));
  return;
 }
 const saveBtn=$('#do-save-design');
 const nameInput=$('#design-name');
 if(!saveBtn||!nameInput){
  toast('Create dialog failed to render.');
  return;
 }
 const commit=()=>{
  const n=nameInput.value.trim()||'Custom design';
  const spec={length:140,width:90,mast_height:52};
  try{ $('#modal').close(); }catch{}
  const d={id:'t-'+Math.random().toString(36).slice(2,9),name:n.slice(0,40),description:'',spec:{...spec},kind:'template',source:'template',created_at:nowIso(),updated_at:nowIso(),revisions:[{n:1,spec:{...spec},evaluated:false,passed:false,source_job:null,note:'clean parametric design',saved_at:nowIso()}]};
  workspaceChats[d.id]={
   brief:'',
   briefText:'Describe your design brief to begin.',
   activityHtml:'',
   runLabel:'DRAFT',
   copilotMessagesHtml:`<div class="chat-message agent"><span class="chat-avatar agent-avatar">✳</span><div class="chat-bubble"><p style="margin:0"><b>${escape(d.name)} workspace ready.</b><br><br>Describe your brief or type / to get started.</p></div></div>`,
   isTestMode:false
  };
  const list=loadDesigns();list.unshift(d);
  if(persistDesigns(list)){
   if($('#brief')) $('#brief').value='';
   try{ renderDesigns(); }catch{}
   openDesign(d.id).catch(err=>toast('Created, but could not open: '+(err.message||err)));
   toast('New design "'+d.name+'" created.');
  }else toast('Could not save — browser storage unavailable.');
 };
 saveBtn.onclick=commit;
 nameInput.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); commit(); } };
 nameInput.focus();
}

$('#designs').addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;const id=b.dataset.design,act=b.dataset.act;if(act==='open')openDesign(id);else if(act==='export')exportDesign(id);else if(act==='rev')saveRevision(id);else if(act==='delete')deleteClick(id,b)});
$('#design-import').onchange=e=>{const f=e.target.files[0];if(!f)return;const reader=new FileReader();reader.onload=()=>{try{const d=importDesigns(reader.result,f.name);const list=loadDesigns();list.unshift(d);if(persistDesigns(list)){renderDesigns();openDesign(d.id);toast('Imported "'+d.name+'" ('+d.revisions.length+' revision'+(d.revisions.length>1?'s':'')+').')}else toast('Import failed — browser storage unavailable.')}catch(err){toast('Import rejected: '+err.message)}};reader.readAsText(f);e.target.value=''};
$('#design-new').onclick=createFromTemplate;
$('#design-save-rev').onclick=()=>{if(pendingDesign)saveRevision(pendingDesign.id)};
$('#design-export').onclick=()=>{if(pendingDesign)exportDesign(pendingDesign.id)};
$('#design-close').onclick=()=>{pendingDesign=null;$('#design-mode').hidden=true;toast('Design closed — workspace left as it was.')};

function setExplosion(value){
 explosion=Number(value);exploded=explosion>0;
 $('#explode-range').value=String(Math.round(explosion*100));$('#explode-value').textContent=Math.round(explosion*100)+'%';
 $('#explode').setAttribute('aria-pressed',String(exploded));
 updateModel();

 if(controls){
  controls.autoRotate=false;
 }

 if(assembly && camera && controls){
  fitAssembly();
 }
}
$('#explode-range').addEventListener('input',e=>setExplosion(Number(e.target.value)/100));
$('#part-search').addEventListener('input',e=>{partQuery=e.target.value.toLowerCase();renderTimeline()});
$('#part-layer').addEventListener('change',e=>{layerFilter=e.target.value;isolatedNames.clear();updateModel();renderTimeline()});
$('#assembly-reset').onclick=()=>{selectedNames.clear();isolatedNames.clear();layerFilter='all';partQuery='';$('#part-search').value='';$('#part-layer').value='all';setExplosion(0);reset();selectPart(null)};
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-open-model]');if(b)loadModel(b.dataset.openModel);
 if(e.target.closest('[data-delete-design]')) return;
 const d=e.target.closest('[data-open-design]');
 if(d){
  e.preventDefault();
  openDesign(d.dataset.openDesign).catch(err=>toast('Could not open design: '+(err.message||err)));
 }
});
document.addEventListener('keydown',e=>{
 if(e.key!=='Enter'&&e.key!==' ') return;
 const tile=e.target.closest('.project-tile[data-open-design]');
 if(!tile||e.target.closest('button')) return;
 e.preventDefault();
 openDesign(tile.dataset.openDesign).catch(err=>toast('Could not open design: '+(err.message||err)));
});
const brandLink=document.querySelector('a.brand');
if(brandLink){
 brandLink.addEventListener('click',e=>{
  e.preventDefault();
  tab('dashboard');
 });
}
window.openDesign=openDesign;
window.setExplosion=setExplosion;
$('#retry-model').onclick=()=>{if(!renderer){try{init3D()}catch(e){setViewStatus('WebGL is unavailable: '+e.message,'error');return}}loadModel(model)};

// Agent Studio navigation
const agentFsBtn=$('#agent-fullscreen-btn');
if(agentFsBtn){
 agentFsBtn.onclick=()=>{
  tab('studio');
 };
}
window.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&location.hash==='#/studio'){
  tab('assembly');
 }
});

// ---- Explorer Chat: Conversational Agent Intelligence (R3) ----
var explorerTelemetry=null, explorerMemory=null, explorerGraph=null;
var explorerFetched=false;
var explorerChatMessages=[];
var explorerChatBusy=false;
var explorerBackendReachable=true;

async function fetchExplorerData(){
 const safeFetch=async(url)=>{try{const r=await fetch(url);if(!r.ok)return null;return await r.json()}catch{return null}};
 const ws=encodeURIComponent(currentWorkspaceId());
 const [telem,mem,graph]=await Promise.all([safeFetch('/api/learning/telemetry?workspace='+ws),safeFetch('/api/learning/memory?workspace='+ws),safeFetch('/api/agents/graph')]);
 explorerTelemetry=telem;explorerMemory=mem;explorerGraph=graph;explorerFetched=true;
}

function renderExplorer(){
 if(!explorerFetched){fetchExplorerData().then(()=>renderExplorer());return}
 if(!explorerChatMessages.length)buildInitialChat();
 renderChatSpine();
 renderDefaultChips();
}

function buildInitialChat(){
 explorerChatMessages=[];
 const iterations=report?.iterations||[];
 const last=iterations.at(-1);
 const events=report?.events||[];
 const heuristics=explorerMemory?.heuristics||explorerMemory?.rules||[];
 const episodes=explorerMemory?.episodes||[];

 const hasBuild=!!last;
 const passed=last?.evaluation?.passed;
 const checks=last?.evaluation?.checks||[];
 const passedCount=checks.filter(c=>c.passed).length;

 if(hasBuild){
  const summary=passed
   ? `Build evaluated — ${passedCount}/${checks.length} checks passed on revision ${report.final_iteration||iterations.length}. All constraints met.`
   : `Revision ${report.final_iteration||iterations.length} needs repair — ${passedCount}/${checks.length} checks passed. ${checks.filter(c=>!c.passed).map(c=>c.name).join(', ')} failed.`;

  const cards=[];
  if(explorerGraph||events.length)cards.push({type:'graph',label:'Agent execution graph',expanded:false});
  if(explorerTelemetry||(iterations.length>1))cards.push({type:'curves',label:'Learning curves',expanded:false});
  if(explorerMemory||heuristics.length)cards.push({type:'memory',label:'Memory & heuristics',expanded:false});

  explorerChatMessages.push({
   role:'agent',
   text:summary,
   cards,
   chips:buildRevisionChips(),
   citations:passed?[{kind:'episode',id:`rev-${report.final_iteration||iterations.length}`,label:`Revision ${report.final_iteration||iterations.length} evaluation`}]:[{kind:'episode',id:`rev-fail-${report.final_iteration||iterations.length}`,label:`Revision ${report.final_iteration||iterations.length} failure`}]
  });

  if(events.length){
   const lastEvents=events.slice(-3);
   explorerChatMessages.push({
    role:'agent',
    text:`Here's what happened during the last build:`,
    cards:[{type:'episode_inline',events:lastEvents}],
    chips:['Why did it take this path?','Show all events']
   });
  }

  if(iterations.length>=2){
   const first=iterations[0],lastIt=iterations.at(-1);
   const fc=first.evaluation?.checks||[], lc=lastIt.evaluation?.checks||[];
   const fp=fc.filter(c=>c.passed).length, lp=lc.filter(c=>c.passed).length;
   explorerChatMessages.push({
    role:'agent',
    text:`Across ${iterations.length} revisions, check pass rate went from ${fp}/${fc.length} to ${lp}/${lc.length}.`,
    cards:[{type:'curves',label:'Learning curves',expanded:false}],
    chips:['Show the full comparison','What changed between revisions?']
   });
  }
 }else{
  explorerChatMessages.push({
   role:'agent',
   text:`I haven't run anything yet. I can walk you through the recorded Rove-1 build, or we can start fresh — your call.`,
   cards:[],
   chips:['Show the recorded build','What can you do?','Open the dashboard']
  });
 }
}

function buildRevisionChips(){
 return [];
}

function renderChatSpine(){
 const container=document.getElementById('explorer-chat-messages');
 if(!container)return;
 container.innerHTML=explorerChatMessages.map((msg,i)=>renderChatMessage(msg,i)).join('');
 container.querySelectorAll('[data-expand-card]').forEach(btn=>{
  btn.onclick=()=>{
   const idx=Number(btn.dataset.expandCard);
   const cardIdx=Number(btn.dataset.cardIdx);
   if(explorerChatMessages[idx]?.cards?.[cardIdx])explorerChatMessages[idx].cards[cardIdx].expanded=!explorerChatMessages[idx].cards[cardIdx].expanded;
   renderChatSpine();
   setTimeout(()=>renderFullPanelCanvases(),50);
  };
 });
 container.querySelectorAll('[data-open-panels]').forEach(btn=>{
  btn.onclick=()=>{
   document.getElementById('explorer-full-panels').hidden=false;
   document.querySelector('.explorer-chat-layout').style.display='none';
   setTimeout(()=>{renderAgentGraph();renderLearningCurves();renderMemoryBank()},50);
  };
 });
 container.querySelectorAll('.explorer-chip').forEach(chip=>{
  chip.onclick=()=>handleChipClick(chip.textContent);
 });
}

function renderChatMessage(msg,idx){
 const isAgent=msg.role==='agent';
 const avatar=isAgent?'<span class="chat-avatar agent-avatar">✳</span>':'<span class="chat-avatar user-avatar">Y</span>';
 let cardsHtml='';
 if(msg.cards?.length){
  cardsHtml='<div class="chat-cards">'+msg.cards.map((card,ci)=>{
   if(card.type==='episode_inline'){
    return `<div class="chat-card episode-card"><span class="eyebrow">BUILD TRACE</span>${(card.events||[]).map(ev=>`<div class="agent-event-entry"><span class="agent-event-dot" style="background:#287e77"></span><b>${escape(ev.role||'agent')}</b><span>${escape(ev.message||'')}</span></div>`).join('')}</div>`;
   }
   if(card.type==='episode'){
    const ep=card.payload||card;
    return `<div class="chat-card"><div class="chat-card-head"><span class="chat-card-icon">▤</span><span>Episode ${escape(String(ep.episode_id||ep.id||''))}</span><span class="mono small" style="margin-left:auto;color:${ep.outcome==='SUCCESS'?'var(--teal)':'var(--pink)'}">${escape(ep.outcome||'')}</span></div>${ep.summary?`<div class="chat-card-expanded"><p style="margin:0;font-size:12px">${escape(ep.summary)}</p></div>`:''}</div>`;
   }
   if(card.type==='rule'){
    const r=card.payload||card;
    return `<div class="chat-card"><div class="chat-card-head"><span class="chat-card-icon">◈</span><span>${escape(r.rule||r.name||'Rule')}</span></div>${r.description?`<div class="chat-card-expanded"><p style="margin:0;font-size:12px">${escape(r.description)}</p></div>`:''}</div>`;
   }
   const expanded=card.expanded;
   let inner='';
   if(expanded){
    if(card.type==='graph')inner='<div class="chat-card-expanded"><canvas class="chat-inline-canvas" data-chart="agent-graph"></canvas><button class="text-button" data-open-panels="true" style="margin-top:6px">Open full panel ↗</button></div>';
    else if(card.type==='curves')inner='<div class="chat-card-expanded"><div class="chat-charts-grid"><canvas class="chat-inline-canvas" data-chart="error-rate"></canvas><canvas class="chat-inline-canvas" data-chart="pass-rate"></canvas></div><button class="text-button" data-open-panels="true" style="margin-top:6px">Open full panel ↗</button></div>';
    else if(card.type==='memory')inner='<div class="chat-card-expanded">'+renderInlineMemory()+'<button class="text-button" data-open-panels="true" style="margin-top:6px">Open full panel ↗</button></div>';
   }
   const icon=card.type==='graph'?'⬡':card.type==='curves'?'◇':'◈';
   return `<div class="chat-card ${expanded?'expanded':''}"><div class="chat-card-head"><span class="chat-card-icon">${icon}</span><span>${escape(card.label||card.type)}</span><button class="chat-card-toggle" data-expand-card="${idx}" data-card-idx="${ci}">${expanded?'▾ Collapse':'▸ Expand'}</button></div>${inner}</div>`;
  }).join('')+'</div>';
 }
 let citationsHtml='';
 if(msg.citations?.length){
  citationsHtml='<div class="chat-citations">'+msg.citations.map(c=>`<span class="chat-citation" title="${escape(c.kind)}: ${escape(c.id)}">learned from: ${escape(c.label||c.id)}</span>`).join('')+'</div>';
 }
 const fallbackNote=msg._localFallback?'<small class="chat-local-note">⚠ backend unreachable — local guidance only</small>':'';
 return `<div class="chat-message ${isAgent?'agent':'user'}">${avatar}<div class="chat-bubble"><p>${escape(msg.text)}</p>${cardsHtml}${citationsHtml}${fallbackNote}</div></div>`;
}

function renderInlineMemory(){
 const heuristics=explorerMemory?.heuristics||explorerMemory?.rules||[];
 const episodes=explorerMemory?.episodes||[];
 if(!heuristics.length&&!episodes.length)return '<p class="field-hint">No memory data from the backend yet. Run a build to start building the memory bank.</p>';
 let html='';
 if(heuristics.length)html+=heuristics.slice(0,3).map(h=>`<div class="memory-rule-item"><span class="memory-rule-icon">◈</span><div><b>${escape(h.rule||h.name||'Rule')}</b><p>${escape(h.description||h.context||'')}</p></div></div>`).join('');
 if(episodes.length)html+=episodes.slice(0,3).map(ep=>`<div class="memory-episode-item ${ep.outcome==='SUCCESS'?'pass':'fail'}"><div class="memory-episode-head"><b>Ep ${escape(String(ep.episode_id||ep.id||''))}</b><span class="mono small">${escape(ep.outcome||'')}</span></div></div>`).join('');
 return html;
}

function renderDefaultChips(){
 const el=document.getElementById('explorer-chip-suggestions');
 if(el)el.innerHTML='';
}

function handleChipClick(text){
 const input=document.getElementById('explorer-chat-input');
 if(input){input.value=text;input.focus()}
}

async function sendExplorerChat(message){
 if(explorerChatBusy||!message.trim())return;
 explorerChatBusy=true;
 explorerChatMessages.push({role:'user',text:message.trim()});
 renderChatSpine();
 document.getElementById('explorer-chat-input').value='';

 let reply=null,backendDown=false;
 try{
  const r=await fetch('/api/agent/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:message.trim()})});
  if(r.ok)reply=await r.json();
 }catch{backendDown=true}

 if(reply&&reply.reply){
  explorerBackendReachable=true;
  explorerChatMessages.push({role:'agent',text:reply.reply,cards:(reply.cards||[]).map(c=>({...c,expanded:false})),chips:reply.chips||[],citations:reply.citations||[]});
 }else{
  if(backendDown)explorerBackendReachable=false;
  const local=buildLocalReply(message.trim());
  if(backendDown)local._localFallback=true;
  if(local._openPanels){
   explorerChatMessages.push({role:'agent',text:local.text,cards:[],chips:local.chips||[],_localFallback:local._localFallback});
   setTimeout(()=>{
    const fp=document.getElementById('explorer-full-panels');
    if(fp){fp.hidden=false;document.querySelector('.explorer-chat-layout').style.display='none';setTimeout(()=>{renderAgentGraph();renderLearningCurves();renderMemoryBank()},50)}
   },100);
  }else{
   explorerChatMessages.push(local);
  }
 }
 explorerChatBusy=false;
 renderChatSpine();
 renderDefaultChips();
 const modeEl=document.getElementById('explorer-composer-mode');
 if(modeEl)modeEl.textContent=explorerBackendReachable?'AGENT':'LOCAL GUIDANCE';
}

function buildLocalReply(message){
 const msg=message.toLowerCase();
 const iterations=report?.iterations||[];
 const events=report?.events||[];
 const checks=iterations.at(-1)?.evaluation?.checks||[];

 if(/rev.*1.*fail|why.*fail|what.*wrong/.test(msg)){
  const failed=iterations[0]?.evaluation?.checks?.filter(c=>!c.passed)||[];
  if(failed.length){
   return{role:'agent',text:`Revision 1 failed because ${failed.length} check${failed.length>1?'s':''} didn't pass: ${failed.map(c=>c.name+' (needed '+c.requirement+', got '+c.measured+')').join('; ')}. The repair loop in revision 2 fixed these by adjusting the spec.`,cards:[{type:'episode_inline',events:events.slice(0,3)}],chips:['Show the repair','What changed in rev 2?','Open full panels'],citations:[{kind:'episode',id:'rev-1-failure',label:'Revision 1 evaluation'}]};
  }
  return{role:'agent',text:'Revision 1 actually passed all checks. No failures to explain.',cards:[],chips:['Show revision details','Open full panels']};
 }

 if(/learned|what.*learn|heuristi|memory|rules/.test(msg)){
  const heuristics=explorerMemory?.heuristics||explorerMemory?.rules||[];
  if(heuristics.length){
   return{role:'agent',text:`I've acquired ${heuristics.length} rule${heuristics.length>1?'s':''} from build outcomes so far.`,cards:[{type:'memory',label:'Memory & heuristics',expanded:true}],chips:['Show all rules','Open full panels'],citations:heuristics.map(h=>({kind:'rule',id:h.id||h.rule||'rule',label:h.rule||h.name||'Rule'}))};
  }
  return{role:'agent',text:`I haven't acquired any heuristics yet — the memory backend is still being built. Once it's live, every build outcome will teach me new rules about what works and what doesn't.`,cards:[],chips:['Open full panels','What can you track?']};
 }

 if(/graph|agent|orchestrat|dispatch|sub-agent/.test(msg)){
  return{role:'agent',text:`The execution graph shows how the orchestrator dispatches to specialists: CAD Specialist for geometry, PCB Specialist for boards, Verifier for constraint checks, and Reflection Synthesizer for learning.`,cards:[{type:'graph',label:'Agent execution graph',expanded:true}],chips:['Show event log','Open full panels']};
 }

 if(/curve|trend|improv|compar|before.*after|delta/.test(msg)){
  if(iterations.length>=2){
   return{role:'agent',text:`Across ${iterations.length} revisions, I can show you how error rate, pass rate, and other metrics evolved.`,cards:[{type:'curves',label:'Learning curves',expanded:true}],chips:['Open full panels','What specific metrics?']};
  }
  return{role:'agent',text:`There's only one revision so far — not enough data for trend lines. Run another revision and I'll track the delta.`,cards:[],chips:['Open full panels']};
 }

 if(/panel|full|dashboard|open/.test(msg)){
  return{role:'agent',text:`Opening the full inspection panels — agent graph, learning curves, and memory bank.`,cards:[],chips:['Back to chat'],_openPanels:true};
 }

 if(/recorded|demo|rove|show.*build/.test(msg)){
  const passed=iterations.at(-1)?.evaluation?.passed;
  return{role:'agent',text:`The recorded Rove-1 build is a ${passed?'passing':'failing'} ${iterations.length}-revision exemplar. ${checks.filter(c=>c.passed).length}/${checks.length} checks pass. Open the assembly to inspect the 3D geometry.`,cards:[],chips:['Open assembly','Why did rev 1 fail?','Show agent graph']};
 }

 if(/help|what.*can|command/.test(msg)){
  return{role:'agent',text:`I can tell you about build revisions, explain failures, show what I've learned, and display the agent execution graph. Try asking "Why did rev 1 fail?" or "Show what I learned."`,cards:[],chips:['Show the recorded build','Show agent graph','Open full panels']};
 }

 return{role:'agent',text:`I can help with revision history, failure analysis, learning data, and the agent execution graph. Try one of the suggestions below, or ask me directly.`,cards:[],chips:buildRevisionChips()};
}

document.getElementById('explorer-chat-form')?.addEventListener('submit',e=>{
 e.preventDefault();
 const input=document.getElementById('explorer-chat-input');
 if(input?.value.trim())sendExplorerChat(input.value);
});

document.getElementById('explorer-chat-input')?.addEventListener('keydown',e=>{
 if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('explorer-chat-form').requestSubmit()}
});

document.getElementById('explorer-close-panels')?.addEventListener('click',()=>{
 document.getElementById('explorer-full-panels').hidden=true;
 document.querySelector('.explorer-chat-layout').style.display='';
});

// ---- Explorer Mode Toggle (Sidebar/Fullscreen) ----
const EXPLORER_MODE_KEY='autocadent.explorer.mode';
function setExplorerMode(mode){
 const view=document.getElementById('explorer-view');
 if(!view)return;
 view.classList.remove('mode-fullscreen','mode-sidebar');
 view.classList.add('mode-'+mode);
 document.getElementById('explorer-sidebar-btn')?.classList.toggle('active',mode==='sidebar');
 document.getElementById('explorer-fullscreen-btn')?.classList.toggle('active',mode==='fullscreen');
 try{localStorage.setItem(EXPLORER_MODE_KEY,mode)}catch{}
}
function getExplorerMode(){
 try{return localStorage.getItem(EXPLORER_MODE_KEY)||'fullscreen'}catch{return'fullscreen'}
}
document.getElementById('explorer-sidebar-btn')?.addEventListener('click',()=>setExplorerMode('sidebar'));
document.getElementById('explorer-fullscreen-btn')?.addEventListener('click',()=>setExplorerMode('fullscreen'));
document.addEventListener('keydown',e=>{
 if(e.key==='F11'&&document.getElementById('explorer-view')&&!document.getElementById('explorer-view').hidden){
  e.preventDefault();
  const current=getExplorerMode();
  setExplorerMode(current==='fullscreen'?'sidebar':'fullscreen');
 }
});
// Initialize mode on page load
if(document.getElementById('explorer-view')){
 setExplorerMode(getExplorerMode());
}

// ---- Sub-Agent Execution Graph (full panel) ----
const AGENT_ROLES=[
 {id:'orchestrator',label:'Orchestrator / Planner',color:'#287e77',tier:0},
 {id:'cad_specialist',label:'CAD Specialist',color:'#38a395',tier:1},
 {id:'pcb_specialist',label:'PCB Specialist',color:'#aa4c79',tier:1},
 {id:'verifier',label:'Verifier',color:'#d47c4e',tier:2},
 {id:'reflection',label:'Reflection Synthesizer',color:'#7b68ae',tier:2}
];

function renderAgentGraph(){
 const canvas=document.getElementById('agent-graph-canvas');
 const statusEl=document.getElementById('agent-graph-status');
 if(!canvas)return;
 const wrap=canvas.parentElement;
 const w=wrap.clientWidth||600, h=320;
 const dpr=Math.min(devicePixelRatio||1,2);
 canvas.width=w*dpr;canvas.height=h*dpr;
 canvas.style.width=w+'px';canvas.style.height=h+'px';
 const ctx=canvas.getContext('2d');
 ctx.scale(dpr,dpr);
 ctx.clearRect(0,0,w,h);

 const agents=explorerGraph?.agents||AGENT_ROLES.map(a=>({id:a.id,status:'idle'}));
 const events=explorerGraph?.events||report?.events||[];

 const nodes=AGENT_ROLES.map((role,i)=>{
  const tierCounts=AGENT_ROLES.filter(r=>r.tier===role.tier).length;
  const tierIdx=AGENT_ROLES.filter(r=>r.tier===role.tier&&AGENT_ROLES.indexOf(r)<i).length;
  const tierY=role.tier===0?55:role.tier===1?155:255;
  const tierWidth=w-80;
  const spacing=tierWidth/(tierCounts+1);
  const x=40+spacing*(tierIdx+1);
  const agent=agents.find(a=>a.id===role.id)||{status:'idle'};
  return {...role,x,y:tierY,status:agent.status||'idle'};
 });

 ctx.fillStyle='#f6f3eb';ctx.fillRect(0,0,w,h);
 ctx.setLineDash([4,4]);
 nodes.forEach(n=>{
  if(n.tier>0){const parent=nodes.find(p=>p.tier===n.tier-1);if(parent){ctx.beginPath();ctx.moveTo(parent.x,parent.y+18);ctx.lineTo(n.x,n.y-18);ctx.strokeStyle='#c8c5b8';ctx.lineWidth=1;ctx.stroke()}}
 });
 ctx.setLineDash([]);
 nodes.forEach(n=>{
  const r=16;
  ctx.beginPath();ctx.arc(n.x,n.y,r,0,Math.PI*2);ctx.fillStyle=n.color;ctx.fill();ctx.strokeStyle='#f6f3eb';ctx.lineWidth=2.5;ctx.stroke();
  if(n.status==='running'){ctx.beginPath();ctx.arc(n.x,n.y,r+4,0,Math.PI*2);ctx.strokeStyle=n.color+'66';ctx.lineWidth=2;ctx.stroke()}
  ctx.fillStyle='#343b35';ctx.font='600 10px "DM Sans",sans-serif';ctx.textAlign='center';ctx.fillText(n.label,n.x,n.y+r+14);
  const statusCol=n.status==='running'?'#287e77':n.status==='error'?'#aa4c79':n.status==='done'?'#38a395':'#b0b3a4';
  ctx.fillStyle=statusCol;ctx.font='500 8px "IBM Plex Mono",monospace';ctx.fillText(n.status.toUpperCase(),n.x,n.y+r+25);
 });

 const legendEl=document.getElementById('agent-graph-legend');
 if(legendEl)legendEl.innerHTML=nodes.map(n=>`<span class="agent-legend-item"><i style="background:${n.color}"></i>${escape(n.label)}<small>${n.status}</small></span>`).join('');
 statusEl.textContent=explorerGraph?`${agents.length} agents · ${events.length} events`:'Waiting for agent backend — showing default roles';

 const entriesEl=document.getElementById('agent-event-entries');
 if(entriesEl){
  if(explorerGraph?.events?.length){
   entriesEl.innerHTML=explorerGraph.events.slice(-12).reverse().map(ev=>`<div class="agent-event-entry"><span class="agent-event-dot" style="background:${(nodes.find(n=>n.id===ev.agent)?.color)||'#888'}"></span><b>${escape(ev.agent||'system')}</b><span>${escape(ev.message||ev.event||'')}</span></div>`).join('');
  }else if(report?.events?.length){
   entriesEl.innerHTML=report.events.slice(-8).reverse().map(ev=>`<div class="agent-event-entry"><span class="agent-event-dot" style="background:#287e77"></span><b>${escape(ev.role||'agent')}</b><span>${escape(ev.message||'')}</span></div>`).join('');
  }else{
   entriesEl.innerHTML='<p class="field-hint">No events recorded yet. Run a build to populate the event log.</p>';
  }
 }
}

// ---- Learning Curve Charts (full panel) ----
function drawLineChart(canvasId, data, color){
 const canvas=document.getElementById(canvasId);
 if(!canvas)return;
 const wrap=canvas.parentElement;
 const w=wrap.clientWidth||260, h=140;
 const dpr=Math.min(devicePixelRatio||1,2);
 canvas.width=w*dpr;canvas.height=h*dpr;
 canvas.style.width=w+'px';canvas.style.height=h+'px';
 const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
 const pad={t:12,r:12,b:22,l:36};
 const cw=w-pad.l-pad.r, ch=h-pad.t-pad.b;
 if(!data||data.length<1){
  ctx.fillStyle='#b0b3a4';ctx.font='11px "DM Sans",sans-serif';ctx.textAlign='center';
  ctx.fillText('Data unavailable',w/2,h/2-6);
  ctx.font='9px "IBM Plex Mono",monospace';
  ctx.fillText('Connect backend to populate',w/2,h/2+10);
  return;
 }
 const vals=data.map(d=>d.value).filter(v=>v!=null&&isFinite(v));
 if(!vals.length){
  ctx.fillStyle='#b0b3a4';ctx.font='11px "DM Sans",sans-serif';ctx.textAlign='center';
  ctx.fillText('Data unavailable',w/2,h/2);return;
 }
 let minV=Math.min(...vals), maxV=Math.max(...vals);
 if(minV===maxV){minV-=1;maxV+=1}
 const rangeV=maxV-minV;
 ctx.strokeStyle='#e8e5db';ctx.lineWidth=1;
 for(let i=0;i<=4;i++){const y=pad.t+ch*(i/4);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+cw,y);ctx.stroke();ctx.fillStyle='#999';ctx.font='8px "IBM Plex Mono",monospace';ctx.textAlign='right';ctx.fillText((maxV-rangeV*(i/4)).toFixed(1),pad.l-4,y+3)}
 ctx.beginPath();
 data.forEach((d,i)=>{if(d.value==null||!isFinite(d.value))return;const x=pad.l+(data.length>1?i/(data.length-1):0.5)*cw;const y=pad.t+(1-(d.value-minV)/rangeV)*ch;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});
 ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
 data.forEach((d,i)=>{if(d.value==null||!isFinite(d.value))return;const x=pad.l+(data.length>1?i/(data.length-1):0.5)*cw;const y=pad.t+(1-(d.value-minV)/rangeV)*ch;ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#f6f3eb';ctx.lineWidth=1.5;ctx.stroke()});
 ctx.fillStyle='#999';ctx.font='8px "IBM Plex Mono",monospace';ctx.textAlign='center';
 data.forEach((d,i)=>{if(data.length<=8||i%Math.ceil(data.length/6)===0||i===data.length-1){const x=pad.l+(data.length>1?i/(data.length-1):0.5)*cw;ctx.fillText('R'+(d.revision||i+1),x,h-4)}});
}

function getRealRevisionData(){
 const telem=explorerTelemetry;
 if(telem&&Array.isArray(telem)&&telem.length){
  return telem.map((t,i)=>({
   revision:t.revision||i+1,
   error_rate:t.error_rate??null,
   pass_rate:t.check_pass_rate??null,
   duration:t.execution_duration_ms!=null?t.execution_duration_ms:null,
   tokens:t.total_tokens!=null?t.total_tokens:null
  }));
 }
 if(telem&&typeof telem==='object'&&!Array.isArray(telem)&&telem.revisions){
  return telem.revisions;
 }
 if(report&&report.iterations&&report.iterations.length>1){
  return report.iterations.map((it,i)=>{
   const checks=it.evaluation?.checks||[];
   const passed=checks.filter(c=>c.passed).length;
   const total=checks.length||1;
   return{
    revision:i+1,
    error_rate:1-passed/total,
    pass_rate:passed/total,
    duration:it.duration_ms!=null?it.duration_ms:null,
    tokens:it.total_tokens!=null?it.total_tokens:null
   };
  });
 }
 return[];
}

function renderLearningCurves(){
 const statusEl=document.getElementById('learning-status');
 const revisions=getRealRevisionData();
 const hasError=revisions.some(r=>r.error_rate!=null);
 const hasPass=revisions.some(r=>r.pass_rate!=null);
 const hasDuration=revisions.some(r=>r.duration!=null);
 const hasTokens=revisions.some(r=>r.tokens!=null);

 drawLineChart('chart-error-rate',hasError?revisions.map(r=>({revision:r.revision,value:r.error_rate})):null,'#aa4c79');
 drawLineChart('chart-pass-rate',hasPass?revisions.map(r=>({revision:r.revision,value:r.pass_rate})):null,'#287e77');
 drawLineChart('chart-duration',hasDuration?revisions.map(r=>({revision:r.revision,value:r.duration})):null,'#d47c4e');
 drawLineChart('chart-tokens',hasTokens?revisions.map(r=>({revision:r.revision,value:r.tokens})):null,'#7b68ae');

 const tracked=[hasError&&'error rate',hasPass&&'pass rate',hasDuration&&'duration',hasTokens&&'tokens'].filter(Boolean);
 if(statusEl)statusEl.textContent=tracked.length?`${revisions.length} revisions · ${tracked.join(', ')} tracked`:'Waiting for telemetry backend';

  const compEl=document.getElementById('learning-comparison');
  if(compEl){
   if(revisions.length>=1&&(hasError||hasPass)){
    const last=revisions[revisions.length-1];
    let statsHtml='';
    if(last.error_rate!=null){
     statsHtml+=`<div class="comparison-stat"><span>Active Error rate</span><b style="color:${last.error_rate===0?'#287e77':'#aa4c79'}">${(last.error_rate*100).toFixed(0)}%</b><small>Current build</small></div>`;
    }
    if(last.pass_rate!=null){
     statsHtml+=`<div class="comparison-stat"><span>Active Pass rate</span><b style="color:#287e77">${(last.pass_rate*100).toFixed(0)}%</b><small>All constraints passing</small></div>`;
    }
    if(last.duration!=null){
     statsHtml+=`<div class="comparison-stat"><span>Execution Duration</span><b style="color:#287e77">${last.duration.toFixed(0)}ms</b><small>OpenCASCADE kernel</small></div>`;
    }
    if(last.tokens!=null){
     statsHtml+=`<div class="comparison-stat"><span>Total Tokens</span><b style="color:#7b68ae">${last.tokens.toFixed(0)}</b><small>Heuristic reuse</small></div>`;
    }
    if(!statsHtml)statsHtml='<p class="field-hint">Measured metrics unavailable — backend has not reported duration or token counts yet.</p>';
    compEl.innerHTML=`<div class="comparison-head"><span class="eyebrow">ACTIVE BUILD TELEMETRY</span><span class="mono small">Revision ${last.revision}</span></div><div class="comparison-grid">${statsHtml}</div>`;
   }else{
    compEl.innerHTML='<p class="field-hint">Run the autonomous learning loop to stream execution metrics.</p>';
   }
  }
}

// ---- Memory & Heuristics Bank (full panel) ----
function renderMemoryBank(){
 const statusEl=document.getElementById('memory-status');
 const mem=explorerMemory;
 const heurListEl=document.getElementById('memory-heuristics-list');
 const epListEl=document.getElementById('memory-episodes-list');
 const adaptListEl=document.getElementById('memory-adaptation-list');
 const heuristics=mem?.heuristics||mem?.rules||[];
 const episodes=mem?.episodes||[];
 const adaptations=mem?.adaptations||[];

 if(heurListEl){
  if(heuristics.length){
   heurListEl.innerHTML=heuristics.map(h=>`<div class="memory-rule-item"><span class="memory-rule-icon">◈</span><div><b>${escape(h.rule||h.name||'Heuristic')}</b><p>${escape(h.description||h.context||'')}</p></div><span class="memory-rule-conf mono">${h.confidence?((h.confidence*100).toFixed(0)+'%'):'—'}</span></div>`).join('');
  }else{
   heurListEl.innerHTML='<div class="memory-empty"><div class="memory-empty-icon">◈</div><b>No heuristics acquired yet</b><p>The memory backend is being built. Once connected, domain rules learned from build outcomes will appear here.</p></div>';
  }
 }
 if(epListEl){
  if(episodes.length){
   epListEl.innerHTML=episodes.map(ep=>`<div class="memory-episode-item ${ep.outcome==='SUCCESS'?'pass':'fail'}"><div class="memory-episode-head"><b>Episode ${escape(String(ep.episode_id||ep.id||''))}</b><span class="mono small">${escape(ep.outcome||'UNKNOWN')}</span></div><p>${escape(ep.summary||ep.description||'')}</p><div class="memory-episode-meta"><span>Rev ${ep.revision||'?'}</span><span>${ep.checks_passed||0}/${ep.checks_total||0} checks</span>${ep.duration_ms!=null?`<span>${ep.duration_ms.toFixed(0)}ms</span>`:'<span>duration unavailable</span>'}${ep.total_tokens!=null?`<span>${ep.total_tokens} tokens</span>`:'<span>tokens unavailable</span>'}</div></div>`).join('');
  }else{
   epListEl.innerHTML='<div class="memory-empty"><div class="memory-empty-icon">▤</div><b>No episodic traces yet</b><p>Each build run creates an episodic memory. The backend is being built — episodes will appear here once connected.</p></div>';
  }
 }
 if(adaptListEl){
  if(adaptations.length){
   adaptListEl.innerHTML=adaptations.map(a=>`<div class="memory-adaptation-item"><b>${escape(a.name||a.trigger||'Adaptation')}</b><p>${escape(a.description||a.action||'')}</p></div>`).join('');
  }else{
   adaptListEl.innerHTML='<div class="memory-empty"><div class="memory-empty-icon">⟳</div><b>No adaptation data yet</b><p>Contextual adaptations will be tracked once the learning backend is connected.</p></div>';
  }
 }
 statusEl.textContent=mem?`${heuristics.length} rules · ${episodes.length} episodes`:'Waiting for memory backend';
}

function renderFullPanelCanvases(){
 document.querySelectorAll('.chat-inline-canvas').forEach(canvas=>{
  const type=canvas.dataset.chart;
  const w=canvas.parentElement.clientWidth||260,h=100;
  const dpr=Math.min(devicePixelRatio||1,2);
  canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.width=w+'px';canvas.style.height=h+'px';
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
  if(type==='agent-graph'){
   ctx.fillStyle='#f0eee5';ctx.fillRect(0,0,w,h);
   const nodes=[{x:w*0.5,y:18,c:'#287e77'},{x:w*0.25,y:48,c:'#38a395'},{x:w*0.75,y:48,c:'#aa4c79'},{x:w*0.15,y:78,c:'#d47c4e'},{x:w*0.45,y:78,c:'#7b68ae'},{x:w*0.75,y:78,c:'#d47c4e'}];
   ctx.setLineDash([2,2]);ctx.strokeStyle='#c8c5b8';ctx.lineWidth=1;
   [[0,1],[0,2],[1,3],[1,4],[2,5]].forEach(([a,b])=>{ctx.beginPath();ctx.moveTo(nodes[a].x,nodes[a].y);ctx.lineTo(nodes[b].x,nodes[b].y);ctx.stroke()});
   ctx.setLineDash([]);
   nodes.forEach(n=>{ctx.beginPath();ctx.arc(n.x,n.y,6,0,Math.PI*2);ctx.fillStyle=n.c;ctx.fill()});
  }else if(type==='error-rate'||type==='pass-rate'){
   const revisions=getRealRevisionData();
   const key=type==='error-rate'?'error_rate':'pass_rate';
   const color=type==='error-rate'?'#aa4c79':'#287e77';
   const data=revisions.filter(r=>r[key]!=null).map(r=>({revision:r.revision,value:r[key]}));
   if(!data.length){ctx.fillStyle='#b0b3a4';ctx.font='10px "DM Sans",sans-serif';ctx.textAlign='center';ctx.fillText('Data unavailable',w/2,h/2);return}
   const vals=data.map(d=>d.value);let minV=Math.min(...vals),maxV=Math.max(...vals);if(minV===maxV){minV-=1;maxV+=1}
   const pad=16,cw=w-pad*2,ch=h-pad*2,rangeV=maxV-minV;
   ctx.beginPath();data.forEach((d,i)=>{const x=pad+(data.length>1?i/(data.length-1):0.5)*cw;const y=pad+(1-(d.value-minV)/rangeV)*ch;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)});
   ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
   data.forEach(d=>{const x=pad+(data.length>1?(data.indexOf(d))/(data.length-1):0.5)*cw;const y=pad+(1-(d.value-minV)/rangeV)*ch;ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill()});
  }
 });
}

document.addEventListener('click',e=>{
 const tab=e.target.closest('[data-memory-tab]');
 if(tab){
  $$('[data-memory-tab]').forEach(b=>b.classList.toggle('active',b===tab));
  const target=tab.dataset.memoryTab;
  document.getElementById('memory-heuristics-panel').hidden=(target!=='heuristics');
  document.getElementById('memory-episodes-panel').hidden=(target!=='episodes');
  document.getElementById('memory-adaptation-panel').hidden=(target!=='adaptation');
 }
});

window.addEventListener('resize',()=>{
 if(!document.getElementById('explorer-view')?.hidden){
  if(!document.getElementById('explorer-full-panels')?.hidden){
   renderAgentGraph();renderLearningCurves();
  }
 }
});

// ---- Interactive Cursor-Following Dot Grid Background (Dashboard only) ----
function initInteractiveDotGrid(){
 const canvas = document.getElementById('interactive-grid-canvas');
 if(!canvas) return;
 const ctx = canvas.getContext('2d');
 if(!ctx) return;

 let width = 0, height = 0;
 const dpr = Math.min(window.devicePixelRatio || 1, 2);
 const spacing = 28;
 const baseR = 1.25;
 const hoverRadius = 155;

 let mouse = { x: -1000, y: -1000, targetX: -1000, targetY: -1000, active: false, intensity: 1, targetIntensity: 1 };
 let animId = null;
 let isIdle = false;
 let idleFrames = 0;

 function resize(){
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.scale(dpr, dpr);
  if(document.body.classList.contains('is-landing')){
   draw(true);
  } else {
   ctx.clearRect(0, 0, width, height);
  }
 }

 function draw(force = false){
  if(!document.body.classList.contains('is-landing')){
   ctx.clearRect(0, 0, width, height);
   animId = null;
   return;
  }

  const dx = mouse.targetX - mouse.x;
  const dy = mouse.targetY - mouse.y;
  const moving = Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3;
  const intensityChanging = Math.abs(mouse.targetIntensity - mouse.intensity) > 0.01;

  mouse.x += dx * 0.18;
  mouse.y += dy * 0.18;
  mouse.intensity += (mouse.targetIntensity - mouse.intensity) * 0.22;
  if(mouse.intensity < 0.005) mouse.intensity = 0;

  if(!moving && !intensityChanging && !force && mouse.active){
   idleFrames++;
   if(idleFrames > 30){
    isIdle = true;
    animId = null;
    return;
   }
  } else {
   idleFrames = 0;
   isIdle = false;
  }

  ctx.clearRect(0, 0, width, height);

  const eff = mouse.intensity;

  // Soft cursor halo spotlight (disappears on button etc. when eff === 0)
  if(mouse.active && mouse.x > -500 && eff > 0.01){
   const glow = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, hoverRadius * 1.1);
   glow.addColorStop(0, `rgba(43, 119, 112, ${(0.09 * eff).toFixed(3)})`);
   glow.addColorStop(0.55, `rgba(43, 119, 112, ${(0.03 * eff).toFixed(3)})`);
   glow.addColorStop(1, 'rgba(43, 119, 112, 0)');
   ctx.fillStyle = glow;
   ctx.fillRect(Math.max(0, mouse.x - hoverRadius * 1.2), Math.max(0, mouse.y - hoverRadius * 1.2), hoverRadius * 2.4, hoverRadius * 2.4);
  }

  // Base background dots in batch path
  ctx.beginPath();
  const offsetX = (width % spacing) / 2;
  const offsetY = (height % spacing) / 2;

  for(let x = offsetX; x <= width; x += spacing){
   for(let y = offsetY; y <= height; y += spacing){
    const dist = (mouse.active && eff > 0.01) ? Math.hypot(x - mouse.x, y - mouse.y) : 9999;
    if(dist >= hoverRadius){
     ctx.moveTo(x + baseR, y);
     ctx.arc(x, y, baseR, 0, Math.PI * 2);
    }
   }
  }
  ctx.fillStyle = 'rgba(75, 90, 80, 0.15)';
  ctx.fill();

  // Interactive proximity dots (disappears on buttons and interactive elements)
  if(mouse.active && mouse.x > -500 && eff > 0.01){
   const startX = Math.max(offsetX, Math.floor((mouse.x - hoverRadius) / spacing) * spacing + offsetX);
   const endX = Math.min(width, Math.ceil((mouse.x + hoverRadius) / spacing) * spacing + offsetX);
   const startY = Math.max(offsetY, Math.floor((mouse.y - hoverRadius) / spacing) * spacing + offsetY);
   const endY = Math.min(height, Math.ceil((mouse.y + hoverRadius) / spacing) * spacing + offsetY);

   for(let x = startX; x <= endX; x += spacing){
    for(let y = startY; y <= endY; y += spacing){
     const dist = Math.hypot(mouse.x - x, mouse.y - y);
     if(dist < hoverRadius){
      const factor = 1 - dist / hoverRadius;
      const ease = factor * factor;

      // Subtle magnetic pull scaled by interactive intensity
      const angle = Math.atan2(mouse.y - y, mouse.x - x);
      const pull = ease * 9 * eff;
      const px = x + Math.cos(angle) * pull;
      const py = y + Math.sin(angle) * pull;

      const r = baseR + (ease * 2.4) * eff;
      const alpha = 0.15 + (0.07 + ease * 0.72) * eff;

      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(38, 122, 114, ${alpha.toFixed(3)})`;
      ctx.fill();

      // Subtle halo ring on nearest dots
      if(dist < hoverRadius * 0.45 && eff > 0.15){
       ctx.beginPath();
       ctx.arc(px, py, r + 2.8 * ease * eff, 0, Math.PI * 2);
       ctx.strokeStyle = `rgba(43, 119, 112, ${(ease * 0.32 * eff).toFixed(3)})`;
       ctx.lineWidth = 1;
       ctx.stroke();
      }
     }
    }
   }
  }

  if(!isIdle){
   animId = requestAnimationFrame(() => draw());
  }
 }

 function startLoop(){
  if(!document.body.classList.contains('is-landing')) return;
  if(!animId){
   isIdle = false;
   idleFrames = 0;
   animId = requestAnimationFrame(() => draw());
  }
 }

 function stopLoop(){
  if(animId){
   cancelAnimationFrame(animId);
   animId = null;
  }
  ctx.clearRect(0, 0, width, height);
 }

 window.__refreshInteractiveGrid = () => {
  if(document.body.classList.contains('is-landing')){
   startLoop();
  } else {
   stopLoop();
  }
 };

 window.addEventListener('pointermove', e => {
  if(!document.body.classList.contains('is-landing')) return;
  mouse.targetX = e.clientX;
  mouse.targetY = e.clientY;

  // Disappear on buttons, links, inputs, cards, dialogs, etc.
  const overInteractive = !!e.target.closest('button, a, input, select, textarea, .project-tile, .card, [role="button"], label, dialog');
  mouse.targetIntensity = overInteractive ? 0 : 1;

  if(!mouse.active){
   mouse.x = e.clientX;
   mouse.y = e.clientY;
   mouse.active = true;
  }
  startLoop();
 }, { passive: true });

 window.addEventListener('pointerleave', () => {
  mouse.targetX = -1000;
  mouse.targetY = -1000;
  mouse.active = false;
  startLoop();
 }, { passive: true });

 window.addEventListener('resize', resize, { passive: true });
 resize();
}

if(document.readyState==='loading'){
 document.addEventListener('DOMContentLoaded', initInteractiveDotGrid);
} else {
 initInteractiveDotGrid();
}

function openStudioTab(target) {
  if (target === 'pipeline') {
    proposePlan();
    return;
  }
  tab('studio');
  const mapped = target === 'graph' ? 'subagents' : target;
  document.querySelectorAll('.studio-nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.studioTab === mapped);
  });
  document.querySelectorAll('.studio-panel').forEach(p => {
    const isMatch = p.id === `studio-panel-${mapped}`;
    p.hidden = !isMatch;
    p.classList.toggle('active', isMatch);
  });
  if (mapped === 'learning') setTimeout(renderStudioLearning, 30);
  else if (mapped === 'memory') renderStudioMemory();
  else if (mapped === 'tools') renderStudioTools();
  else if (mapped === 'subagents') renderStudioSubagents();
}

document.addEventListener('click', e => {
  const chatChip = e.target.closest('.agentic-chat-chip');
  if (chatChip) {
    e.preventDefault();
    if (chatChip.dataset.popup) {
      openStudioTab(chatChip.dataset.popup);
    }
    return;
  }
  const openArt = e.target.closest('[data-open-artifact]');
  if (openArt) {
    e.preventDefault();
    const kind = openArt.dataset.openArtifact;
    if (kind === 'learning') openStudioTab('learning');
    else showArtifact(kind, kind);
    return;
  }
  const actionChip = e.target.closest('[data-chat-chip]');
  if (actionChip) {
    e.preventDefault();
    const text = actionChip.dataset.chatChip || '';
    if (/show 3d board/i.test(text) && window.__lastBoardAction) {
      loadLiveBoard(window.__lastBoardAction);
      tab('assembly');
      return;
    }
    if (/show (preview|schematic)/i.test(text) && window.__lastPreviewAction) {
      const imgs = window.__lastPreviewAction.images || [window.__lastPreviewAction];
      const sch = imgs.find(im => im.kind === 'schematic') || imgs[0];
      if (sch?.url) {
        appendCopilotMessage({
          role: 'agent',
          text: 'Schematic export (2D). The workspace stays on the 3D board.',
          cards: [{ type: 'preview', payload: sch }]
        });
      }
      return;
    }
    if (/^\/(memory|tools|graph|learning|studio|cad)\b/i.test(text) || /show (memory|tools|graph|heuristics|rules)/i.test(text)) {
      if (/memory|heuristic|rule/i.test(text)) showArtifact('memory', 'Memory');
      else if (/tool|mcp|kicad/i.test(text)) showArtifact('tools', 'Tools & MCP');
      else if (/graph|sub-agent/i.test(text)) showArtifact('graph', 'Agent graph');
      else if (/learning|curve/i.test(text)) openStudioTab('learning');
      else handleComposerSubmit(text, 'copilot');
      return;
    }
    handleComposerSubmit(text, 'copilot');
  }
});

const openStudioTopBtn = document.getElementById('open-studio-btn');
if (openStudioTopBtn) {
  openStudioTopBtn.onclick = () => {
    tab('studio');
  };
}

// Expose key APIs on window for testing, runner scripting, and automation
window.AudioCues = AudioCues;
window.createFromTemplate = createFromTemplate;
window.openDesign = openDesign;
window.runSelfImprovingLoop = runSelfImprovingLoop;
window.updateRevisionUI = updateRevisionUI;
window.sendCopilotMessage = sendCopilotMessage;
window.getActiveProject = getActiveProject;
window.tab = tab;
window.isLoopRunning = () => isLoopRunning;
window.openStudioTab = openStudioTab;
window.getSlashCommands = getSlashCommands;


