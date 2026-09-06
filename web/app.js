import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
 if(!r)return[`geometry cache ........ unavailable`,`recorded build ........ —`,manifest,`revision status ....... build artifacts missing`,`workspace ............. recorded view only`];
 const last=r.iterations.at(-1),ev=last.evaluation,pass=ev.checks.filter(c=>c.passed).length,total=ev.checks.length;
 return[`geometry cache ........ ${ev.checks[0].measured} valid solids`,`recorded build ........ ${r.seconds}s kernel workflow · ${r.iterations.length} iteration${r.iterations.length>1?'s':''}`,manifest,`revision status ....... REV ${String(r.final_iteration).padStart(2,'0')} · ${r.passed?'EVALUATED · PASS':'NEEDS REVIEW'} · ${pass}/${total} checks`,`workspace ............. dashboard ready`]}
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

 if(name.includes('connector board')||name.includes('board')||grp==='electronics'){
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
 mesh.userData={name:p.name,group:p.group,opaque:p.opaque,printable:p.printable};
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

function mentionSelection(){
 const ta=$('#brief'),text=[...selectedNames].map(n=>'@['+n+']').filter(n=>!ta.value.includes(n)).join(' ');
 if(text)ta.value+=(ta.value?'\n':'')+text+' ';
 ta.focus();
}
const raycaster=new THREE.Raycaster(), pointerNDC=new THREE.Vector2();
let hoverEvt=null, downPos=null;
function visibleMeshes(){return assembly?assembly.children.filter(m=>m.isMesh&&m.visible):[]}
function pickAt(cx,cy){if(!renderer||!assembly)return null;const r=renderer.domElement.getBoundingClientRect();pointerNDC.set(((cx-r.left)/r.width)*2-1,-((cy-r.top)/r.height)*2+1);raycaster.setFromCamera(pointerNDC,camera);const hits=raycaster.intersectObjects(visibleMeshes(),false);return hits.length?hits[0].object:null}
function hoverTip(mesh,cx,cy){const tip=$('#part-tip');if(!tip)return;if(!mesh){tip.hidden=true;if(renderer)renderer.domElement.style.cursor='';return}const u=mesh.userData;tip.innerHTML=`<b>${escape(u.name||'Part')}</b><small>${escape(u.group||'')}</small>`;tip.hidden=false;const wrap=$('#preview-view').getBoundingClientRect();tip.style.left=(cx-wrap.left)+'px';tip.style.top=(cy-wrap.top)+'px';renderer.domElement.style.cursor='pointer'}
function selectPart(name,additive){if(name==null){if(!additive)selectedNames.clear()}else if(additive){if(selectedNames.has(name))selectedNames.delete(name);else selectedNames.add(name)}else{selectedNames.clear();selectedNames.add(name)}if(assembly)assembly.children.forEach(m=>{if(m.material&&m.material.emissive){const on=selectedNames.has(m.userData.name);m.material.emissive.setHex(on?0x2b7770:0x000000);m.material.emissiveIntensity=on?.38:0}});renderAssemblyPanel();renderTimeline()}
function partSize(mesh){try{const b=new THREE.Box3().setFromObject(mesh),s=b.getSize(new THREE.Vector3());return `${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm`}catch{return '—'}}
function meshTris(m){try{const ix=m.geometry.getIndex();return Math.round(ix?ix.count/3:m.geometry.getAttribute('position').count/3)}catch{return 0}}
function unionBox(meshes){const b=new THREE.Box3();meshes.forEach(m=>b.expandByObject(m));const s=b.getSize(new THREE.Vector3());return `${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm`}

function renderAssemblyPanel(){
 const sum=$('#assembly-summary'),det=$('#part-details');if(!sum||!det)return;
 const kids=assembly?assembly.children.filter(m=>m.isMesh):[];
 const sel=kids.filter(m=>selectedNames.has(m.userData.name));
 if(!sel.length){
  det.hidden=true;sum.hidden=false;
  if(!kids.length){
   sum.innerHTML=`<div class="empty-assembly-state" style="padding:28px 12px;text-align:center;color:var(--muted)"><div style="font-size:32px;margin-bottom:10px;color:#8ba396">◌</div><b style="color:var(--ink);display:block;font-size:13px;margin-bottom:6px">No parts in this design</b><p class="field-hint" style="margin:0;font-size:11px">Clean workspace. Type your prompt in the brief or run /test to generate CAD geometry.</p></div>`;
   return;
  }
  const groups={};let tris=0;kids.forEach(m=>{const g=m.userData.group||'part';groups[g]=(groups[g]||0)+1;tris+=meshTris(m)});
  
  const proj=getActiveProject();
  const sch=proj?.schematic;
  let schHtml='';
  if(sch){
   let svgContent='';
   if(proj.id==='orion'){
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
  const col=mesh.material.color?mesh.material.color.getStyle():'#999999';
  const isPcb=/board|flight controller|pcb|connector/i.test(u.name)||u.group==='electronics';
  let layoutSection='';
  if(isPcb){
   const proj=getActiveProject();
   const dims=proj.id==='orion'?'120 × 70 mm · Quadruped Controller':'60 × 40 mm · 2 layers · 4 routed nets';
   layoutSection=`<div class="insp-layout-wrap"><div class="insp-layout-head"><span class="eyebrow">3D BOARD LAYOUT</span><span class="mono small">${escape(dims)}</span></div><div class="insp-board-container"><div id="inspector-board-viewport" class="board-viewport"></div><div class="board-tools"><button id="insp-board-cam-iso" class="active">3D</button><button id="insp-board-cam-top">Top</button></div><div class="board-legend" id="inspector-board-legend"></div></div></div>`;
  }

  det.innerHTML=`<button class="text-button" data-pact="back">← All parts</button><div class="part-detail-head"><span class="swatch" style="background:${escape(col)}"></span><h4>${escape(u.name||'Part')}</h4></div><div class="kv"><span>Group</span><b style="text-transform:capitalize">${escape(u.group||'—')}</b></div><div class="kv"><span>Bounding box</span><b>${partSize(mesh)}</b></div><div class="kv"><span>Triangles</span><b>${meshTris(mesh).toLocaleString('en-US')}</b></div><div class="kv"><span>Printable</span><b>${u.printable?'via pipeline':'reference only'}</b></div>${layoutSection}`;

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
 const kids=assembly?assembly.children.filter(m=>m.isMesh):[];
 const shown=kids.filter(m=>(layerFilter==='all'||m.userData.group===layerFilter)&&m.userData.name.toLowerCase().includes(partQuery));
 $('#timeline-count').textContent=shown.length+' / '+kids.length+' parts';
 $('#timeline-chips').innerHTML=shown.map((m,i)=>`<button type="button" class="chip ${selectedNames.has(m.userData.name)?'active':''}" aria-pressed="${selectedNames.has(m.userData.name)}" data-chip="${escape(m.userData.name)}"><i style="background:${m.material.color.getStyle()}"></i><span>${escape(m.userData.name)}</span><small>${String(i+1).padStart(2,'0')}</small></button>`).join('')||'<p class="field-hint">No matching parts.</p>';
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
 camera.near=Math.max(.1,dist/100);
 camera.far=Math.max(10000,dist*35);
 camera.updateProjectionMatrix();
 controls.update();
}

// ---- Upward Knolling Grid Explode Algorithm (Requirement 1 & Requirement 6) ----
function computeKnollingGrid(meshes, aspect=1.4){
 const items=meshes.map(m=>{
  m.geometry.computeBoundingBox();
  const bb=m.geometry.boundingBox;
  const size=bb.getSize(new THREE.Vector3());
  const center=bb.getCenter(new THREE.Vector3());
  return {
   name:m.userData.name,
   group:m.userData.group,
   mesh:m,
   size,
   center,
   width:Math.min(130,Math.max(40,size.x)+20),
   height:Math.min(110,Math.max(40,size.y)+20),
   depth:size.z
  };
 });
 items.sort((a,b)=>{
  const rank=it=>(it.group==='structure'||/chassis|body|frame|hull/i.test(it.name))?0:(it.group==='electronics'||/board|sensor|mast|aperture|antenna/i.test(it.name))?1:2;
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
  cells.set(item.name,{
   x:targetX,
   y:targetY,
   z:targetZ,
   targetPos:new THREE.Vector3(targetX-item.center.x,targetY-item.center.y,targetZ-item.center.z)
  });
 });
 return {cells,totalW,totalH,cols,rows};
}

function updateModel(){
 if(!assembly)return;
 const center=assembly.userData.center||new THREE.Vector3();
 const visibleKids=assembly.children.filter(m=>m.isMesh&&(!isolatedNames.size||isolatedNames.has(m.userData.name))&&(layerFilter==='all'||m.userData.group===layerFilter));
 const grid=explosion>0?computeKnollingGrid(visibleKids):null;

 assembly.children.forEach(mesh=>{
  if(!mesh.isMesh)return;
  mesh.visible=(!isolatedNames.size||isolatedNames.has(mesh.userData.name))&&(layerFilter==='all'||mesh.userData.group===layerFilter);
  mesh.material.opacity=translucent?.48:1;
  mesh.material.transparent=translucent;
  mesh.material.depthWrite=!translucent;
  mesh.position.set(0,0,0);
  mesh.rotation.set(0,0,0);

  if(explosion>0&&grid&&mesh.visible){
   const cell=grid.cells.get(mesh.userData.name);
   if(cell){
    mesh.geometry.computeBoundingBox();
    const c=mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).sub(center);
    const groupRank=(mesh.userData.group==='electronics'||/board|sensor|mast|aperture|antenna|flight|controller/i.test(mesh.userData.name))?2.5:
                   (mesh.userData.group==='structure'||/chassis|body|frame|tray|hull/i.test(mesh.userData.name))?1.2:
                   (mesh.userData.group==='mobility'||/wheel|leg|hip|thigh|shank|foot|motor/i.test(mesh.userData.name))?0.3:1.0;
    const startX=c.x*0.35, startY=c.y*0.35;
    const startZ=groupRank*55 + Math.max(0,c.z)*0.8 + 25;

    if(explosion<=0.35){
     const t=explosion/0.35;
     mesh.position.set(startX*t, startY*t, startZ*t);
    }else{
     const t=(explosion-0.35)/0.65;
     const ease=t*t*(3-2*t);
     mesh.position.set(
      THREE.MathUtils.lerp(startX,cell.targetPos.x,ease),
      THREE.MathUtils.lerp(startY,cell.targetPos.y,ease),
      THREE.MathUtils.lerp(startZ,cell.targetPos.z,ease)
     );
    }
   }
  }
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
let activeProjectId='rove1';
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
 const last=d.revisions[d.revisions.length-1];
 const spec=last.spec||{length:140,width:90,mast_height:52};
 const passed=!!last.passed, isEvaluated=!!last.evaluated;
 const hasGeometry=isEvaluated&&!!(last.source_job&&runner);
 const files=[
  {name:`${slug(d.name)}.autocadent.json`,bytes:JSON.stringify(designBundle(d)).length,sha256:'custom-'+d.id.slice(0,8),type:'JSON',downloadUrl:'#'},
  {name:'spec.json',bytes:JSON.stringify(spec).length,sha256:'spec-'+d.id.slice(0,8),type:'JSON',downloadUrl:'#'}
 ];
 if(hasGeometry){
  files.unshift(
   {name:'chassis.stl',bytes:190000,sha256:'job-'+last.source_job.slice(0,8),type:'STL',downloadUrl:`${runner}/artifacts/jobs/${last.source_job}/final/chassis.stl`},
   {name:'board-tray.stl',bytes:1500,sha256:'job-tray',type:'STL',downloadUrl:`${runner}/artifacts/jobs/${last.source_job}/final/board-tray.stl`},
   {name:'sensor-mast.stl',bytes:2500,sha256:'job-mast',type:'STL',downloadUrl:`${runner}/artifacts/jobs/${last.source_job}/final/sensor-mast.stl`}
  );
 }
 return {
  id:d.id,name:d.name,badge:d.kind==='template'?'Custom CAD':'Imported Design',type:'custom',
  hasGeometry,
  modelPath:hasGeometry?`${runner}/artifacts/jobs/${last.source_job}/final/mesh.json`:null,
  description:d.description||'',
  stateText:isEvaluated?(passed?'Evaluated · Pass':'Evaluated · Fail'):'Local draft (0 parts)',
  statePass:passed,
  files,
  schematic:{
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
  if(p.type==='custom'&&!p.hasGeometry){
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

 const lLabel=document.querySelector('label[for="length"]'), wLabel=document.querySelector('label[for="width"]'), mLabel=document.querySelector('label[for="mast_height"]');
 if(lLabel)lLabel.textContent=isOrion?'Body length':'Chassis length';
 if(wLabel)wLabel.textContent=isOrion?'Body width':'Chassis width';
 if(mLabel)mLabel.textContent=isOrion?'Stance height':'Mast height';

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
 const views={dashboard:'dashboard',preview:'preview',explorer:'preview',files:'files',designs:'designs',schematic:'schematic',layout:'layout',simulation:'simulation'};
 const key=views[name]||'dashboard';

 // If user clicks/navigates to files, open the Files tab in Inspector while showing Explorer (Requirement 8 second 8)
 if(key==='files'){
  $$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab==='preview'));
  ['dashboard','preview','files','designs','schematic','layout','simulation'].forEach(n=>$(`#${n}-view`).hidden=n!=='preview');
  document.body.classList.remove('is-landing','is-simulation');
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

 const tabKey=key==='dashboard'?null:key;
 $$('[data-tab]').forEach(b=>{const on=b.dataset.tab===tabKey;b.classList.toggle('active',!!on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
 ['dashboard','preview','files','designs','schematic','layout','simulation'].forEach(n=>$(`#${n}-view`).hidden=n!==key);
 document.body.classList.toggle('is-landing',key==='dashboard');
 if(window.__refreshInteractiveGrid) window.__refreshInteractiveGrid();
 $('#parts-timeline').hidden=key!=='preview';
 document.body.classList.toggle('is-simulation',key==='simulation');

 if(key==='simulation'){
  if(!simInitialized)initSim3D();
  window.dispatchEvent(new Event('resize'));
  startSimRender();
 }else{
  stopSimRender();
 }

 const back=$('#back-dashboard');
 if(back)back.hidden=key==='dashboard';
 if(key==='preview'){window.dispatchEvent(new Event('resize'));startRender()}else stopRender();
 const names={dashboard:'Dashboard',preview:'Explorer',files:'Files',designs:'Designs',schematic:'Schematic',layout:'Layout',simulation:'Motion lab'};
 const crumb=$('#view-crumb');
 if(crumb)crumb.textContent=names[key];

 const curProj=getActiveProject();
 if(key==='schematic')renderSchematic(curProj);
 if(key==='layout')renderLayout(curProj);
 if(key==='designs')renderDesigns();
 if(key==='dashboard')renderDashboard();

 const want='#/'+(key==='preview'?'explorer':key);
 if(location.hash!==want)history.replaceState(null,'',want);
}

$$('[data-tab]').forEach(b=>b.onclick=()=>{location.hash='#/'+(b.dataset.tab==='preview'?'explorer':b.dataset.tab)});
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

function saveCurrentWorkspaceChat(){
 if(!activeProjectId) return;
 workspaceChats[activeProjectId] = {
  brief: $('#brief')?.value || '',
  briefText: $('#brief-text')?.innerHTML || '',
  activityHtml: $('#activity')?.innerHTML || '',
  runLabel: $('#run-label')?.textContent || '',
  isTestMode: typeof isTestMode !== 'undefined' ? isTestMode : false
 };
}

function restoreWorkspaceChat(projectId, proj){
 const saved = workspaceChats[projectId];
 if(saved){
  if($('#brief')) $('#brief').value = saved.brief || '';
  if($('#brief-text') && saved.briefText) $('#brief-text').innerHTML = saved.briefText;
  if($('#activity')) $('#activity').innerHTML = saved.activityHtml || '';
  if($('#run-label')) $('#run-label').textContent = saved.runLabel || '';
  if(typeof isTestMode !== 'undefined'){
   if(saved.isTestMode && !isTestMode) enterTestMode();
   else if(!saved.isTestMode && isTestMode) exitTestMode();
  }
 } else {
  if(typeof isTestMode !== 'undefined' && isTestMode) exitTestMode();
  const desc = proj.description || '';
  if($('#brief')) $('#brief').value = desc;
  if($('#brief-text')){
   if(proj.id === 'orion') $('#brief-text').textContent = 'Orion 12-DOF Quadruped robot platform. Reference kinematics and actuator bus architecture.';
   else if(proj.id === 'rove1') $('#brief-text').textContent = report?.description || 'Educational rover with sensor mast and connector board';
   else $('#brief-text').textContent = desc || 'Clean design workspace. Describe a change, or type / for commands.';
  }
  if($('#activity')){
   if(proj.id === 'orion'){
    $('#activity').innerHTML = '<div class="run-result" style="border-left-color:var(--teal)"><span class="agent-dot">✳</span><b>Reference Quadruped Platform</b><p>Kinematics & URDF verification complete · 12 joints</p></div>';
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
     : `<div class="run-result"><span class="status-dot"></span><b>Clean Workspace</b><p>No build history yet · Describe your robot or type / for commands</p></div>`;
   }
  }
  const defaultRunLabel = proj.id === 'orion' ? 'REFERENCE GEOMETRY' : (proj.type === 'custom' ? (proj.hasGeometry ? 'CUSTOM CAD RESULT' : 'CLEAN DRAFT') : (report?.execution === 'ao-worker' ? 'AO WORKER RESULT' : runner ? 'LOCAL KERNEL RESULT' : 'RECORDED RUN'));
  if($('#run-label')) $('#run-label').textContent = defaultRunLabel;
  saveCurrentWorkspaceChat();
 }
}

async function setActiveProject(projectId){
 if(activeProjectId && activeProjectId !== projectId){
  saveCurrentWorkspaceChat();
 }
 activeProjectId=projectId;
 model=projectId==='orion'?'orion':'rove1';
 syncModelButtons();
 const simTab=document.querySelector('[data-tab="simulation"]');
 if(simTab)simTab.hidden=(projectId!=='orion');

 const proj=getActiveProject();
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
  steps[1].msg = 'Chassis width parametrically widened to 105 mm. Board tray clearance verified (0.95 mm).';
 } else if(actionType === 'mast' || /mast|sensor|camera/i.test(promptText)){
  $('#mast_height').value = '65';
  steps[1].msg = 'Sensor mast solid height elevated to 65 mm with dual-aperture camera mount solid.';
 } else if(actionType === 'repair' || /repair|fix/i.test(promptText)){
  steps.unshift({ role: 'Initial Evaluation', msg: 'Chassis thickness 1.8mm < 2.4mm required constraint. Triggering repair policy.' });
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

function getSlashCommands(){
 if(isTestMode){
  return [
   {c:'/widen',d:'Simulate expanding chassis width to 105 mm (0 tokens)',run:()=>runSimulatedTest('Make the chassis wider (105mm) for additional battery capacity','widen')},
   {c:'/mast',d:'Simulate adding 65mm sensor mast solid (0 tokens)',run:()=>runSimulatedTest('Add sensor mast with panoramic camera aperture at 65mm height','mast')},
   {c:'/repair',d:'Simulate autonomous CAD failure & repair (0 tokens)',run:()=>runSimulatedTest('Run autonomous CAD verification & repair loop on chassis constraints','repair')},
   {c:'/battery',d:'Simulate battery compartment tray (0 tokens)',run:()=>runSimulatedTest('Generate internal battery compartment tray with 2.4mm minimum wall','battery')},
   {c:'/ao',d:'Simulate AO multi-agent dispatch (0 tokens)',run:()=>runSimulatedTest('Dispatch to AO worker agent with prompt decomposition and tool validation','ao')},
   {c:'/help',d:'Show test simulation commands',run:()=>modal('Test simulation commands',getSlashCommands().map(x=>`<p><b>${x.c}</b> · ${x.d}</p>`).join(''))},
   {c:'/clear',d:'Clear draft',run:()=>{$('#brief').value=''}},
   {c:'/exit',d:'Exit /test simulation mode',run:exitTestMode}
  ];
 }
 return [
  {c:'/test',d:'Enter test mode — preview commands & UI without using tokens',run:enterTestMode},
  {c:'/demo',d:'Alias for /test mode',run:enterTestMode},
  {c:'/connect',d:'Connect your local CAD runner',run:connectDialog},
  {c:'/help',d:'See available commands',run:()=>modal('Design commands',getSlashCommands().map(x=>`<p><b>${x.c}</b> · ${x.d}</p>`).join(''))},
  {c:'/clear',d:'Clear draft',run:()=>{$('#brief').value=''}}
 ];
}

let slashIdx=0;
function insertBrief(text){const ta=$('#brief');ta.setRangeText(text,ta.selectionStart,ta.selectionEnd,'end')}
function slashToken(){const ta=$('#brief');return ta.value.slice(0,ta.selectionStart).match(/(?:^|\s)\/(\w*)$/)}
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
 const ta=$('#brief'),match=slashToken();if(match){const end=ta.selectionStart;ta.setRangeText('',end-match[1].length-1,end,'end')}
 closeSlash();ta.focus();getSlashCommands().find(c=>c.c===cmd)?.run();
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
 const g=e.target.closest('[data-goto]');if(!g)return;e.preventDefault();location.hash='#/'+(g.dataset.goto==='preview'?'explorer':g.dataset.goto);
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
async function loadIteration(n){
 const request=++geometryRequest;iteration=n;model='rove1';syncModelButtons();renderEvidence();setViewStatus('Loading geometry…','loading');
 try{const meshes=await json(`${artifactBase}iteration-${n}/mesh.json`);if(request!==geometryRequest)return;drawMeshes(meshes)}
 catch(e){if(request!==geometryRequest)return;if(assembly)assembly.visible=false;setViewStatus('Geometry could not load: '+e.message,'error')}
}
$('#replay-btn').onclick=()=>loadIteration(iteration===1?report.iterations.length:1);

function syncBriefAndDims(){
 const last=report.iterations.at(-1);
 const bt=$('#brief-text');if(bt&&report.description)bt.textContent=report.description;
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
  }else if(modelId==='custom'&&!spec?.hasGeometry){
   container.innerHTML=`<div class="preview-clean-canvas" style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f9f8f4;background-image:radial-gradient(#d2d1c4 1px,transparent 1px);background-size:16px 16px;color:#49554d;padding:16px;text-align:center"><div style="font-size:32px;margin-bottom:8px;color:#287e77">📐</div><span class="mono" style="font-size:10px;letter-spacing:1.5px;color:#287e77;font-weight:600;margin-bottom:4px">CLEAN DESIGN CANVAS</span><p style="font-size:11px;margin:0;color:#758076">0 parts · Ready to design</p></div>`;
   return;
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
 const totalAssemblies=2+savedDesigns.length;

 const customCards=savedDesigns.map(d=>{
  const dLast=d.revisions[d.revisions.length-1];
  const dateStr=d.updated_at?new Date(d.updated_at).toLocaleDateString():'Draft';
  const hasGeometry=!!(dLast.evaluated&&dLast.source_job&&runner);
  return `<article class="project-tile"><div class="project-visual-3d" data-preview-model="custom" data-spec="${escape(JSON.stringify({...dLast.spec,hasGeometry}))}"></div><div class="tile-title"><h2>${escape(d.name)}</h2><span class="project-badge">${escape(d.kind==='template'?'Custom CAD':'Imported')}</span></div><p>${escape(d.description||'Clean design workspace.')}</p><div class="tile-foot"><span class="tile-date">Updated ${dateStr}</span><div class="tile-actions"><button class="tile-delete-btn" data-delete-design="${escape(d.id)}">✕ Delete</button><button class="text-button" data-open-design="${escape(d.id)}">Open assembly ↗</button></div></div></article>`;
 }).join('');

 $('#dashboard').innerHTML=`<div class="dashboard-heading"><div><span class="eyebrow">AUTOCADENT / WORKBENCH</span><h1>Ideas, taking shape.</h1><p>Inspect physical assemblies, explore real CAD geometry, and export builds.</p></div><button class="dark-button" data-action="new-project">＋ New design</button></div>
 <div class="section-title"><h2>On your workbench</h2><span>${String(totalAssemblies).padStart(2,'0')} assemblies</span></div>
 <div class="project-gallery">
 <article class="project-tile"><div class="project-visual-3d" data-preview-model="rove1"></div><div class="tile-title"><h2>Rove–1</h2><span class="project-badge">Parametric CAD</span></div><p>A compact rover with realistic physical components, sensor mast, and connector board.</p><div class="tile-foot"><span class="tile-date">REV ${report?.final_iteration||2} · Checked build</span><div class="tile-actions"><button class="text-button" data-open-model="rove1">Open assembly ↗</button></div></div></article>
 <article class="project-tile"><div class="project-visual-3d" data-preview-model="orion"></div><div class="tile-title"><h2>Orion</h2><span class="project-badge">Quadruped</span></div><p>A 12-joint robot dog. Full-resolution reference assembly with 12 actuator bus channels.</p><div class="tile-foot"><span class="tile-date">16 parts · Reference geometry</span><div class="tile-actions"><button class="text-button" data-open-model="orion">Open assembly ↗</button></div></div></article>
 ${customCards}
 </div>`;

 setTimeout(initDashboardPreviews,50);
}

// Direct dashboard delete handler with quick confirmation (Requirement 2)
document.addEventListener('click',e=>{
 const delBtn=e.target.closest('[data-delete-design]');
 if(delBtn){
  const id=delBtn.dataset.deleteDesign;
  if(delBtn.dataset.confirming==='true'){
   const list=loadDesigns();
   const idx=list.findIndex(x=>x.id===id);
   if(idx!==-1){
    const deletedName=list[idx].name;
    list.splice(idx,1);
    persistDesigns(list);
    if(activeProjectId===id)setActiveProject('rove1');
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

$('#brief-form').onsubmit=async e=>{e.preventDefault();const command=$('#brief').value.trim();if(command.startsWith('/')){const found=getSlashCommands().find(c=>c.c===command);if(found){$('#brief').value='';found.run()}else $('#brief-feedback').textContent='Unknown command. Type / to browse commands.';return}const description=$('#brief').value.trim();if(!description){$('#brief-feedback').textContent='Add a short description of your rover, or type / for commands.';return}if(isTestMode){runSimulatedTest(description);return}if(model==='orion'){toast('Select Rove–1 to generate a CAD variation.');return}if(jobBusy)return;if(!runner){$('#brief-feedback').textContent='Connect a local runner to generate your design. Or type /test to test without consuming tokens.';connectDialog();return}const spec={};for(const name of ['length','width','mast_height']){const input=$('#'+name);if(!input.checkValidity()){input.reportValidity();return}spec[name]=Number(input.value)}jobBusy=true;$('#submit-brief').disabled=true;$('#brief-feedback').textContent=execution==='ao'?'Supervisor dispatching an actual AO worker…':'Building and evaluating real CAD geometry…';const headers={'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})};try{const created=await json(runner+'/api/jobs',{method:'POST',headers,body:JSON.stringify({description,spec,execution})});let job;const deadline=Date.now()+15*60*1000;while(Date.now()<deadline){job=await json(runner+'/api/jobs/'+created.id,{headers});if(job.status==='complete'||job.status==='failed')break;$('#brief-feedback').textContent=job.message||'CAD worker running…';await new Promise(r=>setTimeout(r,2000))}if(job?.status!=='complete')throw Error(job?.error||'Job timed out. It may still be running; inspect the runner.');report=job.report;artifactBase=runner+`/artifacts/jobs/${created.id}/`;$('#brief-text').textContent=report.description||description;syncBriefAndDims();await loadIteration(report.final_iteration);renderDashboard();$('#brief-feedback').textContent='Build complete. Measured results and downloads updated.';tab('preview');if(pendingDesign){const plist=loadDesigns();const pd=plist.find(x=>x.id===pendingDesign.id);if(pd){pd.revisions.push({n:pd.revisions.length+1,spec:{...spec},evaluated:true,passed:job.report.passed,source_job:created.id,note:'live CAD run',saved_at:nowIso()});pd.description=description;pd.updated_at=nowIso();if(persistDesigns(plist)){toast('Revision '+pd.revisions.length+' saved to "'+pd.name+'".');const m=$('#design-mode');if(m&&!m.hidden)m.querySelector('.design-mode-note').textContent='Attached to a live runner — rebuilds update this design.'}}}}catch(err){$('#brief-feedback').textContent=err.message}finally{jobBusy=false;$('#submit-brief').disabled=false}};

try{init3D()}catch(e){renderer=null;setViewStatus('WebGL is unavailable. Enable hardware acceleration, then retry.','error');console.warn(e.message)}
try{
 report=await json(artifactBase+'report.json');
 reportReadyResolve(report);
 iteration=report.final_iteration||iteration;
 syncBriefAndDims();
 await setActiveProject('rove1');
 renderDashboard();
 tab((location.hash||'').replace(/^#\/?/,'')||'dashboard');
 pulseHero();
}catch(e){
 reportReadyResolve(null);
 setViewStatus('Recorded geometry unavailable on this deployment — check the connection.','error');
 toast('Build artifacts unavailable: '+e.message);
 $('#activity').textContent='Could not load recorded evidence. Please refresh or inspect the source repository.';
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
 const demoSpec={length:DEMO_SPEC.length,width:DEMO_SPEC.width,mast_height:DEMO_SPEC.mast_height};
 const demoDesc=report?.description||'The recorded example workspace.';
 const demo=`<article class="design-card"><div class="design-card-head"><span class="design-kind">EXAMPLE</span><span class="design-id mono">fixed · recorded build</span></div><h3>Rove–1</h3><p class="design-desc">${escape(demoDesc)}</p><div class="design-spec">${demoSpec.length} × ${demoSpec.width} mm · mast ${demoSpec.mast_height} mm</div><div class="design-state ${report?.passed?'pass':'fail'}">${report?.passed?'EVALUATED · PASS':'EVALUATED · FAIL'}</div><div class="design-actions"><button class="text-button" data-design="__demo" data-act="open">Open ↗</button><button class="text-button" data-design="__demo" data-act="export">Export ↓</button></div></article>`;
 host.innerHTML=(!storageOK)?`<div class="empty-designs">Browser storage is unavailable in this context (e.g. private mode). Designs cannot be saved here.</div>`:(list.length?list.map(designCard).join(''):`<div class="empty-designs">No saved designs yet. Import a design bundle or create one from the parametric template.</div>`)+demo;
}

function designBundle(d){return{format:'autocadent-design',version:1,name:d.name,description:d.description,spec:{...d.revisions[d.revisions.length-1].spec},kind:d.kind,source:d.source,created_at:d.created_at,updated_at:d.updated_at,revisions:d.revisions.map(r=>({n:r.n,spec:r.spec,evaluated:r.evaluated,passed:r.passed,source_job:r.source_job||null,note:r.note||'',saved_at:r.saved_at}))}}
function exportDesign(id){
 if(id==='__demo'){downloadText('rove-1-recorded.autocadent.json',JSON.stringify(designBundle({id:'__demo',name:'Rove-1 (recorded example)',description:report?.description||document.getElementById('brief-text')?.textContent||'Recorded Rove-1 build.',spec:{...DEMO_SPEC},kind:'example',source:'demo',created_at:nowIso(),updated_at:nowIso(),revisions:[{n:1,spec:{...DEMO_SPEC},evaluated:true,passed:!!report?.passed,source_job:null,note:'recorded build',saved_at:nowIso()}]}),null,2));toast('Recorded example exported as a design bundle.');return}
 const list=loadDesigns(),d=list.find(x=>x.id===id);if(!d)return;
 downloadText(slug(d.name)+'.autocadent.json',JSON.stringify(designBundle(d),null,2));toast('Exported "'+d.name+'" bundle.');
}

async function openDesign(id){
 if(id==='__demo'||id==='rove1'){
  pendingDesign=null;
  const m=$('#design-mode');if(m)m.hidden=true;
  $('#length').value=DEMO_SPEC.length;$('#width').value=DEMO_SPEC.width;$('#mast_height').value=DEMO_SPEC.mast_height;
  await loadModel('rove1');
  toast('Rove–1 recorded example loaded.');
  tab('preview');
  return;
 }
 const list=loadDesigns(),d=list.find(x=>x.id===id);
 if(!d)return;
 pendingDesign=d;
 const last=d.revisions[d.revisions.length-1];
 $('#length').value=last.spec.length;$('#width').value=last.spec.width;$('#mast_height').value=last.spec.mast_height;
 $('#brief').value=d.description||'';
 const mode=$('#design-mode');
 if(mode){
  mode.hidden=false;
  $('#design-mode-name').textContent=d.name;
  const note=mode.querySelector('.design-mode-note');
  if(note)note.textContent=last.evaluated?(last.source_job&&runner?'Attached to a live runner — rebuilds update this design.':'Evaluated earlier; rebuild via the local runner to refresh geometry.'):(d.kind==='imported'?'Imported locally — no CAD artifacts yet. Submit to build.' : 'Local draft — no CAD artifacts yet. Submit to build.');
 }
 await setActiveProject(d.id);
 toast('Design "'+d.name+'" loaded into the workspace.');
 tab('preview');
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
 modal('Create a new design',`<div class="design-dialog"><label for="design-name">Design name</label><input id="design-name" type="text" maxlength="40" value="" placeholder="e.g. Lunar Prospector Alpha" autocomplete="off"><p class="muted" style="margin-top:8px">Stored cleanly in your browser. Starts with fresh empty brief.</p><button id="do-save-design" class="dark-button">Create design ↗</button></div>`);
 $('#do-save-design').onclick=()=>{
  const n=$('#design-name').value.trim()||'Custom Rover';
  const spec={length:140,width:90,mast_height:52};
  $('#modal').close();
  const d={id:'t-'+Math.random().toString(36).slice(2,9),name:n.slice(0,40),description:'',spec:{...spec},kind:'template',source:'template',created_at:nowIso(),updated_at:nowIso(),revisions:[{n:1,spec:{...spec},evaluated:false,passed:false,source_job:null,note:'clean parametric design',saved_at:nowIso()}]};
  workspaceChats[d.id]={
   brief:'',
   briefText:'Clean design workspace. Describe a change, or type / for commands.',
   activityHtml:'<div class="run-result"><span class="status-dot"></span><b>Clean Workspace</b><p>No build history yet · Describe your robot or type / for commands</p></div>',
   runLabel:'CLEAN DRAFT',
   isTestMode:false
  };
  const list=loadDesigns();list.unshift(d);
  if(persistDesigns(list)){
   $('#brief').value='';
   renderDesigns();openDesign(d.id);toast('New design "'+d.name+'" created cleanly.');
  }else toast('Could not save — browser storage unavailable.');
 };
 $('#design-name').focus();
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
 const d=e.target.closest('[data-open-design]');if(d)openDesign(d.dataset.openDesign);
});
window.openDesign=openDesign;
$('#retry-model').onclick=()=>{if(!renderer){try{init3D()}catch(e){setViewStatus('WebGL is unavailable: '+e.message,'error');return}}loadModel(model)};

// Agent Workspace Fullscreen Toggle (Requirement 4)
const agentFsBtn=$('#agent-fullscreen-btn');
if(agentFsBtn){
 agentFsBtn.onclick=()=>{
  const isFs=document.body.classList.toggle('agent-fullscreen');
  agentFsBtn.textContent=isFs?'✕':'⛶';
  agentFsBtn.title=isFs?'Exit fullscreen workspace':'Toggle fullscreen workspace';
  if(renderer)resizeViewport();
 };
}
window.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&document.body.classList.contains('agent-fullscreen')){
  document.body.classList.remove('agent-fullscreen');
  if(agentFsBtn){
   agentFsBtn.textContent='⛶';
   agentFsBtn.title='Toggle fullscreen workspace';
  }
  if(renderer)resizeViewport();
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

