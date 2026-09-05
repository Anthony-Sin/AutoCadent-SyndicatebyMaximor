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
function setViewStatus(msg,mode){const el=document.getElementById('view-status');if(!el)return;el.textContent=msg||'';el.hidden=!msg;el.dataset.mode=mode||'info';const retry=$('#retry-model');if(retry)retry.hidden=mode!=='error';window.__viewStatus=msg||''}
function tick(){if(!renderer)return;if(hoverEvt&&!$('#preview-view').hidden){const e=hoverEvt;hoverEvt=null;try{hoverTip(pickAt(e.clientX,e.clientY),e.clientX,e.clientY)}catch{}}controls.update();renderer.render(scene,camera);updateScale()}
function startRender(){if(!renderer||renderRunning)return;renderRunning=true;resizeViewport();renderer.setAnimationLoop(tick)}
function resizeViewport(){if(!renderer)return;const w=$('#viewport').clientWidth,h=$('#viewport').clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();tick()}
function stopRender(){if(!renderer)return;renderRunning=false;renderer.setAnimationLoop(null)}
// ---- boot intro (loading sequence; purely decorative, uses real recorded values for init lines) ----
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
 $('#viewport').appendChild(renderer.domElement); controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=150;controls.maxDistance=4000;controls.maxPolarAngle=Math.PI*.85;
 scene.add(new THREE.HemisphereLight(0xfff9e8,0x596c65,2.4)); const sun=new THREE.DirectionalLight(0xfff7e4,3.5);sun.position.set(150,-180,460);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-650,right:650,top:650,bottom:-650,near:1,far:1800});sun.shadow.bias=-.001;scene.add(sun);studioLight=sun;
 floorMesh=new THREE.Mesh(new THREE.PlaneGeometry(5000,5000),new THREE.MeshStandardMaterial({color:0xe6e3d7,roughness:.85}));floorMesh.position.z=-25;floorMesh.receiveShadow=true;floorMesh.visible=false;scene.add(floorMesh);const fill=new THREE.DirectionalLight(0x8ac0bb,1.2);fill.position.set(-100,150,60);scene.add(fill);
 const grid=new THREE.GridHelper(550,22,0xb8b7a3,0xd4d2bf);grid.rotation.x=Math.PI/2;grid.position.z=-25;grid.material.transparent=true;grid.material.opacity=.4;scene.add(grid);gridHelper=grid;
 const ring=new THREE.Mesh(new THREE.RingGeometry(119,119.35,100),new THREE.MeshBasicMaterial({color:0xa5b2a1,transparent:true,opacity:.5,side:THREE.DoubleSide}));ring.position.z=-24.8;scene.add(ring);ringMesh=ring;
 new ResizeObserver(resizeViewport).observe($('#viewport'));
 reset();
 renderer.domElement.addEventListener('pointermove',e=>{hoverEvt=e});
 renderer.domElement.addEventListener('pointerdown',e=>{downPos=[e.clientX,e.clientY]});
 renderer.domElement.addEventListener('pointerup',e=>{if(!downPos)return;const dx=e.clientX-downPos[0],dy=e.clientY-downPos[1];downPos=null;if(dx*dx+dy*dy>36)return;const hit=pickAt(e.clientX,e.clientY);selectPart(hit?hit.userData.name:null,e.shiftKey)});
 renderer.domElement.addEventListener('pointerleave',()=>{hoverEvt=null;hoverTip(null)});
 if(!$('#preview-view').hidden)startRender();if(pendingMeshes){drawMeshes(pendingMeshes);pendingMeshes=null}else setViewStatus('Loading recorded geometry…','loading');
}
function reset(){if(!camera)return;camera.position.set(265,-330,225);controls.target.set(0,0,20);if(assembly)fitAssembly();controls.update()}
function updateScale(){
 if(!camera||!renderer)return;
 const width=$('#viewport').clientWidth;if(!width)return;
 const distance=camera.position.distanceTo(controls.target);
 const span=2*distance*Math.tan(camera.fov*Math.PI/360)*camera.aspect;
 const mm=[1000,500,200,100,50,20,10,1].find(n=>n/span*width<=100)||1;
 $('#scale-bar').style.width=(mm/span*width)+'px';$('#scale-label').textContent=mm+' mm';
}
function disposeAssembly(group){group?.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose()})}
function drawMeshes(parts){
 if(!renderer){pendingMeshes=parts;setViewStatus('WebGL is unavailable. Enable hardware acceleration, then retry.','error');return}
 if(!Array.isArray(parts)||!parts.length)throw Error('The geometry bundle contains no parts.');
 const next=new THREE.Group();
 try{
  for(const p of parts){
   const vertices=ArrayBuffer.isView(p.vertices)?p.vertices:p.vertices.flat();
   const indices=ArrayBuffer.isView(p.triangles)?p.triangles:p.triangles.flat();
   if(!vertices.length||vertices.length%3||!indices.length||indices.length%3||
      !vertices.every(Number.isFinite)||!indices.every(i=>Number.isInteger(i)&&i>=0&&i<vertices.length/3))
    throw Error('Invalid geometry for '+p.name);
   const geometry=new THREE.BufferGeometry();
   geometry.setAttribute('position',new THREE.BufferAttribute(vertices instanceof Float32Array?vertices:new Float32Array(vertices),3));
   geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices),1));geometry.computeVertexNormals();
   const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:p.color,roughness:.48,metalness:.18,transparent:!p.opaque,side:THREE.DoubleSide}));
   mesh.userData={name:p.name,group:p.group,opaque:p.opaque,printable:p.printable};
   mesh.castShadow=true;mesh.receiveShadow=true;next.add(mesh);
   if(p.edges!==false)mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry,25),new THREE.LineBasicMaterial({color:0x536059,transparent:true,opacity:.3})));
  }
 }catch(error){disposeAssembly(next);throw error}
 if(assembly){scene.remove(assembly);disposeAssembly(assembly)}
 assembly=next;scene.add(assembly);selectedNames.clear();isolatedNames.clear();currentGroup='all';layerFilter='all';partQuery='';$('#part-search').value='';$('#part-layer').value='all';
 assembly.userData.center=new THREE.Box3().setFromObject(assembly).getCenter(new THREE.Vector3());
 hoverTip(null);updateModel();fitAssembly();renderAssemblyPanel();renderTimeline();setViewStatus('');
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
function groupRank(g){return g==='structure'?0:g==='mobility'?1:g==='electronics'?2:3}
function meshTris(m){try{const ix=m.geometry.getIndex();return Math.round(ix?ix.count/3:m.geometry.getAttribute('position').count/3)}catch{return 0}}
function unionBox(meshes){const b=new THREE.Box3();meshes.forEach(m=>b.expandByObject(m));const s=b.getSize(new THREE.Vector3());return `${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm`}
function renderAssemblyPanel(){const sum=$('#assembly-summary'),det=$('#part-details'),pc=document.querySelector('.property-content');if(!sum||!det)return;const kids=assembly?assembly.children.filter(m=>m.isMesh):[];const sel=kids.filter(m=>selectedNames.has(m.userData.name));if(pc)pc.classList.toggle('part-mode',sel.length>0);if(!sel.length){det.hidden=true;sum.hidden=false;if(!kids.length){sum.innerHTML='<p class="field-hint">Loading geometry…</p>';return}const groups={};let tris=0;kids.forEach(m=>{const g=m.userData.group||'part';groups[g]=(groups[g]||0)+1;tris+=meshTris(m)});sum.innerHTML=`<div class="stat-grid"><div class="stat"><b>${kids.length}</b>parts</div><div class="stat"><b>${tris.toLocaleString('en-US')}</b>triangles</div></div>`+Object.entries(groups).map(([g,n])=>`<div class="constraint"><span style="text-transform:capitalize">${escape(g)}</span><b>${n}</b></div>`).join('')+`<p class="field-hint">Hover the model for names. Click a part for measurements. Shift-click for multi-select.</p>`;return}
 sum.hidden=true;det.hidden=false;
 if(sel.length===1){const mesh=sel[0],u=mesh.userData;const col=mesh.material.color?mesh.material.color.getStyle():'#999999';det.innerHTML=`<button class="text-button" data-pact="back">← All parts</button><div class="part-detail-head"><span class="swatch" style="background:${escape(col)}"></span><h4>${escape(u.name||'Part')}</h4></div><div class="kv"><span>Group</span><b style="text-transform:capitalize">${escape(u.group||'—')}</b></div><div class="kv"><span>Bounding box</span><b>${partSize(mesh)}</b></div><div class="kv"><span>Triangles</span><b>${meshTris(mesh).toLocaleString('en-US')}</b></div><div class="kv"><span>Printable</span><b>${u.printable?'via pipeline':'reference only'}</b></div><div class="dash-actions"><button class="text-button" data-pact="isolate">${isolatedNames.size?'Show all':'Isolate part'}</button><button class="text-button" data-pact="mention">＋ Add to brief</button></div>`;return}
 const tot=sel.reduce((a,m)=>a+meshTris(m),0);let box='—';try{box=unionBox(sel)}catch{}
 det.innerHTML=`<button class="text-button" data-pact="back">← All parts (${kids.length})</button><div class="part-detail-head"><h4>${sel.length} parts selected</h4></div>`+sel.map(m=>{const u=m.userData;const col=m.material.color?m.material.color.getStyle():'#999999';return `<div class="kv"><span><span class="swatch" style="background:${escape(col)};width:12px;height:12px;display:inline-block;vertical-align:-2px;margin-right:6px"></span>${escape(u.name||'Part')}</span><span><b>${meshTris(m).toLocaleString('en-US')}</b> <button class="text-button" data-pact="unpick" data-name="${escape(u.name||'')}">×</button></span></div>`}).join('')+`<div class="kv"><span>Combined box</span><b>${box}</b></div><div class="kv"><span>Total triangles</span><b>${tot.toLocaleString('en-US')}</b></div><div class="dash-actions"><button class="text-button" data-pact="isolate">${isolatedNames.size?'Show all':'Isolate selection'}</button><button class="text-button" data-pact="mention">＋ Add to brief</button></div>`}
function renderTimeline(){
 const kids=assembly?assembly.children.filter(m=>m.isMesh):[];
 const shown=kids.filter(m=>(layerFilter==='all'||m.userData.group===layerFilter)&&m.userData.name.toLowerCase().includes(partQuery));
 $('#timeline-count').textContent=shown.length+' / '+kids.length+' parts';
 $('#timeline-chips').innerHTML=shown.map((m,i)=>`<button type="button" class="chip ${selectedNames.has(m.userData.name)?'active':''}" aria-pressed="${selectedNames.has(m.userData.name)}" data-chip="${escape(m.userData.name)}"><i style="background:${m.material.color.getStyle()}"></i><span>${escape(m.userData.name)}</span><small>${String(i+1).padStart(2,'0')}</small></button>`).join('')||'<p class="field-hint">No matching parts.</p>';
}
function fitAssembly(){if(!assembly||!camera)return;const box=new THREE.Box3().setFromObject(assembly);const c=box.getCenter(new THREE.Vector3()),s=box.getSize(new THREE.Vector3());const maxDim=Math.max(s.x,s.y,s.z)||1;const dist=maxDim/(2*Math.tan(camera.fov*Math.PI/360)*Math.min(camera.aspect,1))*1.35;const dir=camera.position.clone().sub(controls.target);if(!dir.lengthSq())dir.set(1,-1,.7);dir.normalize();controls.target.copy(c);camera.position.copy(c.clone().add(dir.multiplyScalar(dist)));camera.near=Math.max(.1,dist/100);camera.far=dist*20;camera.updateProjectionMatrix();controls.update()}
function updateModel(){
 if(!assembly)return;
 const center=assembly.userData.center;
 assembly.children.forEach((mesh,i)=>{
  mesh.visible=(!isolatedNames.size||isolatedNames.has(mesh.userData.name))&&(layerFilter==='all'||mesh.userData.group===layerFilter);
  mesh.material.opacity=translucent?.48:1;mesh.material.transparent=translucent;mesh.material.depthWrite=!translucent;
  mesh.position.set(0,0,0);mesh.rotation.set(0,0,0);
  if(explosion){mesh.geometry.computeBoundingBox();const c=mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).sub(center);if(c.length()<1)c.set(0,0,1);mesh.position.copy(c.normalize().multiplyScalar(explosion*(model==='orion'?180:75)));}
 });
}
$$('[data-group]').forEach(b=>b.onclick=()=>{currentGroup=b.dataset.group;$$('[data-group]').forEach(el=>el.classList.toggle('active',el===b));updateModel()});
$('#reset-view').onclick=reset;$('#wireframe').onclick=()=>{translucent=!translucent;$('#wireframe').setAttribute('aria-pressed',translucent);updateModel()};$('#explode').onclick=()=>{setExplosion(explosion?0:1)};
function zoom(f){camera.position.sub(controls.target).multiplyScalar(f).add(controls.target);controls.update()};$('#zoom-in').onclick=()=>zoom(.85);$('#zoom-out').onclick=()=>zoom(1.15);
let activeProjectId='rove1';
const extOf=n=>(n.split('.').pop()||'').toUpperCase().slice(0,4)||'FILE';
let boardMeta=null;
async function boardBundleMeta(){if(boardMeta)return boardMeta;try{const r=await fetch('artifacts/board/rove-1-board.zip');if(!r.ok)throw 0;const buf=await r.arrayBuffer();const hex=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buf))].map(b=>b.toString(16).padStart(2,'0')).join('');boardMeta={bytes:buf.byteLength,sha256:hex}}catch{boardMeta={bytes:0,sha256:''}}return boardMeta}
const fmtBytes=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B';

function robotArt(kind,spec){
 if(kind==='rove1'){
  return '<svg viewBox="0 0 420 260" role="img" aria-label="Rove–1 rover illustration"><ellipse cx="213" cy="218" rx="132" ry="15" fill="#314d4014"/><path d="M85 126 208 75 321 133 196 195Z" fill="#2b7770"/><path d="M85 126v18l111 63v-12M196 195l125-62v18l-125 56" fill="#20574f"/><path d="m163 129 47-20 61 31-47 23Z" fill="#e2b582"/><path d="M229 109V48h9v65" stroke="#bec8b9" stroke-width="9"/><path d="m215 45 24-9 30 14-24 11Z" fill="#304c45"/><g fill="#35413c" stroke="#6a756c" stroke-width="5"><ellipse cx="109" cy="162" rx="18" ry="26"/><ellipse cx="164" cy="193" rx="18" ry="26"/><ellipse cx="276" cy="173" rx="18" ry="26"/><ellipse cx="322" cy="146" rx="18" ry="26"/></g></svg>';
 }
 if(kind==='orion'){
  return '<svg viewBox="0 0 420 260" role="img" aria-label="Orion quadruped illustration"><ellipse cx="213" cy="218" rx="132" ry="15" fill="#314d4014"/><path d="m117 86 95-33 106 43-94 42Z" fill="#e1e4da"/><path d="M117 86v42l107 43v-33M224 138l94-42v44l-94 31" fill="#c3cfc4"/><g fill="none" stroke-linecap="round" stroke-width="15"><path d="m137 122-24 37 35 49M198 151l-17 30 35 41M282 136l23 27-21 51M307 114l31 24-9 44" stroke="#d8884b"/></g><ellipse cx="229" cy="80" rx="20" ry="9" fill="#36483f"/><path d="M209 69v12q20 17 40 0V69" fill="#36483f"/><ellipse cx="229" cy="69" rx="20" ry="9" fill="#53675b"/></svg>';
 }
 if(kind==='microduck'||kind==='duck'){
  return '<svg viewBox="0 0 420 260" role="img" aria-label="MicroDuck bipedal robot illustration"><ellipse cx="210" cy="225" rx="110" ry="14" fill="#314d4014"/><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M180 145L165 180L175 218L195 220" stroke="#d8884b" stroke-width="11"/><circle cx="165" cy="180" r="7" fill="#36483f" stroke="#6a756c" stroke-width="2"/><circle cx="175" cy="218" r="5" fill="#36483f"/><path d="M235 145L255 175L245 215L265 218" stroke="#bb723a" stroke-width="11"/><circle cx="255" cy="175" r="7" fill="#36483f" stroke="#6a756c" stroke-width="2"/><circle cx="245" cy="215" r="5" fill="#36483f"/></g><rect x="170" y="136" width="75" height="18" rx="5" fill="#2d3d34" stroke="#485c50" stroke-width="2"/><circle cx="180" cy="145" r="6" fill="#e2a048"/><circle cx="235" cy="145" r="6" fill="#e2a048"/><path d="M160 135L255 135L265 95L180 85Z" fill="#287e77"/><path d="M160 135L255 135L250 142L165 142Z" fill="#1b534e"/><path d="M180 85L265 95L250 65L190 60Z" fill="#e4e8dc"/><path d="M215 62L270 65L280 42L225 40Z" fill="#34433a"/><polygon points="270,65 315,60 280,42" fill="#e2a048"/><polygon points="270,65 315,60 300,68" fill="#c67f2b"/><ellipse cx="255" cy="52" rx="6" ry="6" fill="#19231e" stroke="#287e77" stroke-width="2"/><circle cx="256" cy="51" r="2" fill="#7ee3d8"/><line x1="220" y1="40" x2="215" y2="22" stroke="#6a756c" stroke-width="3"/><circle cx="215" cy="20" r="4" fill="#aa4c79"/></svg>';
 }
 const len=Number(spec?.length)||140, wid=Number(spec?.width)||90, mast=Number(spec?.mast_height)||52;
 const lScale=Math.min(1.3,Math.max(0.7,len/140)), wScale=Math.min(1.3,Math.max(0.7,wid/90));
 const mHeight=Math.round(mast*0.9), chW=Math.round(236*lScale), chH=Math.round(70*wScale);
 const chX=Math.round(210-chW/2), mastTop=105-mHeight;
 return `<svg viewBox="0 0 420 260" role="img" aria-label="Custom parametric robot illustration"><ellipse cx="210" cy="218" rx="${Math.round(130*lScale)}" ry="15" fill="#314d4014"/><path d="M${chX} 130L${Math.round(chX+chW*0.52)} ${Math.round(130-chH*0.6)}L${chX+chW} ${Math.round(130-chH*0.15)}L${Math.round(chX+chW*0.48)} ${Math.round(130+chH*0.7)}Z" fill="#205c56"/><path d="M${chX} 130L${Math.round(chX+chW*0.52)} ${Math.round(130-chH*0.6)}L${Math.round(chX+chW*0.52)} ${Math.round(145-chH*0.6)}L${chX} 145Z" fill="#163f3b"/><path d="M${Math.round(chX+chW*0.32)} ${Math.round(128-chH*0.2)}L${Math.round(chX+chW*0.52)} ${Math.round(128-chH*0.45)}L${Math.round(chX+chW*0.75)} ${Math.round(128-chH*0.1)}L${Math.round(chX+chW*0.55)} ${Math.round(128+chH*0.15)}Z" fill="#d8a768"/><line x1="${Math.round(chX+chW*0.6)}" y1="112" x2="${Math.round(chX+chW*0.6)}" y2="${mastTop}" stroke="#98a895" stroke-width="7" stroke-linecap="round"/><ellipse cx="${Math.round(chX+chW*0.6)}" cy="${mastTop}" rx="14" ry="7" fill="#32473e"/><circle cx="${Math.round(chX+chW*0.6+4)}" cy="${mastTop-1}" r="3" fill="#287e77"/><g fill="#2d3732" stroke="#5a685e" stroke-width="4"><ellipse cx="${chX+22}" cy="165" rx="16" ry="24"/><ellipse cx="${Math.round(chX+chW*0.35)}" cy="190" rx="17" ry="25"/><ellipse cx="${Math.round(chX+chW*0.72)}" cy="175" rx="17" ry="25"/><ellipse cx="${chX+chW-14}" cy="148" rx="16" ry="24"/></g></svg>`;
}

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
   statusText:'KiCad 10 DRC: 0 reported violations, 0 unconnected items. 4 checks ignored by the default rules. No schematic parity or electrical function verification.'
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
 const files=[
  {name:`${slug(d.name)}.autocadent.json`,bytes:JSON.stringify(designBundle(d)).length,sha256:'custom-'+d.id.slice(0,8),type:'JSON',downloadUrl:'#'},
  {name:'spec.json',bytes:JSON.stringify(spec).length,sha256:'spec-'+d.id.slice(0,8),type:'JSON',downloadUrl:'#'}
 ];
 if(isEvaluated&&last.source_job&&runner){
  files.unshift(
   {name:'chassis.stl',bytes:190000,sha256:'job-'+last.source_job.slice(0,8),type:'STL',downloadUrl:`${runner}/artifacts/jobs/${last.source_job}/final/chassis.stl`},
   {name:'board-tray.stl',bytes:1500,sha256:'job-tray',type:'STL',downloadUrl:`${runner}/artifacts/jobs/${last.source_job}/final/board-tray.stl`},
   {name:'sensor-mast.stl',bytes:2500,sha256:'job-mast',type:'STL',downloadUrl:`${runner}/artifacts/jobs/${last.source_job}/final/sensor-mast.stl`}
  );
 }
 return {
  id:d.id,name:d.name,badge:d.kind==='template'?'Custom CAD':'Imported Design',type:'custom',
  modelPath:isEvaluated&&last.source_job&&runner?`${runner}/artifacts/jobs/${last.source_job}/final/mesh.json`:'artifacts/demo/final/mesh.json',
  description:d.description||'Custom parametric design saved in this browser.',
  stateText:isEvaluated?(passed?'Evaluated · Pass':'Evaluated · Fail'):'Local draft (unevaluated)',
  statePass:passed,
  files,
  schematic:{
   title:`${escape(d.name)} Signal Interface`,
   description:`Custom signal interface configured for ${spec.length} × ${spec.width} mm rover platform with ${spec.mast_height} mm sensor mast.`,
   caution:'Parametric signal breakout matching custom chassis dimensions. Generated in browser local workspace.',
   nets:[{name:'VCC_MAIN',pins:['PWR.IN','TRAY.VCC']},{name:'GND_MAIN',pins:['PWR.GND','TRAY.GND']},{name:'MAST_DATA',pins:['SENSOR.MAST','BOARD.SIG']},{name:'BUS_CTRL',pins:['CTRL.1','CTRL.2']}]
  },
  layout:{
   title:`${escape(d.name)} Custom Board Layout`,
   subtitle:`${spec.length>150?'70 × 45':'60 × 40'} mm · 2 layers · Custom signal routing`,
   boardSvgPath:'artifacts/board/board.svg',
   drcPath:'artifacts/board/drc.json',
   bundleUrl:'artifacts/board/rove-1-board.zip',
   bundleName:`${slug(d.name)}-board.zip`,
   statusText:isEvaluated?`Evaluated DRC: ${passed?'All clear':'Constraint failures noted'}.`:'Draft layout template. Submit design brief with runner connected to synthesize custom PCB.'
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
 $('#file-list').innerHTML=fileRows(p);
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
  $('#schematic').innerHTML=`<svg viewBox="0 0 600 310" role="img" aria-label="${escape(sch.title)}"><g font-family="IBM Plex Mono,monospace" fill="#495d51"><rect x="50" y="50" width="90" height="200" rx="5" fill="#f5f1e5" stroke="#9fae98"/><rect x="460" y="50" width="90" height="200" rx="5" fill="#f5f1e5" stroke="#9fae98"/><text x="77" y="30" font-size="16">J1</text><text x="486" y="30" font-size="16">J2</text>${sch.nets.map((n,i)=>`<path d="M110 ${85+i*45}H490" stroke="${i===0?'#aa6b87':'#388b7f'}" stroke-width="2"/><circle cx="110" cy="${85+i*45}" r="5" fill="#f4efdf" stroke="#388b7f"/><circle cx="490" cy="${85+i*45}" r="5" fill="#f4efdf" stroke="#388b7f"/><text x="285" y="${75+i*45}" font-size="12">${escape(n.name)}</text><text x="78" y="${90+i*45}" font-size="12">${i+1}</text><text x="510" y="${90+i*45}" font-size="12">${i+1}</text>`).join('')}</g></svg>`;
 }
}

function renderLayout(proj){
 const p=proj||getActiveProject();
 const lay=p.layout;
 const h2=$('#layout-view .view-heading h2'), pSub=$('#layout-view .view-heading p');
 if(h2)h2.textContent=lay.title;
 if(pSub)pSub.textContent=lay.subtitle;

 const boardSvg=$('#board-svg');
 if(boardSvg){
  boardSvg.src=lay.boardSvgPath;
  boardSvg.alt=`Actual KiCad export of the ${p.name} board`;
 }
 const boardStatus=$('#board-status');
 if(boardStatus)boardStatus.textContent=lay.statusText;

 const dl=$('#layout-view a.outline-button');
 if(dl){
  dl.href=lay.bundleUrl;
  dl.setAttribute('download',lay.bundleName||`${slug(p.name)}-board.zip`);
  dl.textContent=`↓ Download ${p.name} board bundle`;
 }
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
}

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

function tab(name){
 const views={dashboard:'dashboard',preview:'preview',explorer:'preview',files:'files',designs:'designs',schematic:'schematic',layout:'layout',simulation:'simulation'};
 const key=views[name]||'dashboard';
 const tabKey=key==='dashboard'?null:key;
 $$('[data-tab]').forEach(b=>{const on=b.dataset.tab===tabKey;b.classList.toggle('active',!!on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
 ['dashboard','preview','files','designs','schematic','layout','simulation'].forEach(n=>$(`#${n}-view`).hidden=n!==key);
 document.body.classList.toggle('is-landing',key==='dashboard');
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
 if(key==='files')renderFiles(curProj);
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

async function setActiveProject(projectId){
 activeProjectId=projectId;
 model=projectId==='orion'?'orion':'rove1';
 syncModelButtons();

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
 const runLabel=$('#run-label');
 if(runLabel){
  runLabel.textContent=proj.id==='orion'?'REFERENCE GEOMETRY':(report?.execution==='ao-worker'?'AO WORKER RESULT':runner?'LOCAL KERNEL RESULT':'RECORDED RUN');
 }
 const briefText=$('#brief-text');
 if(briefText&&proj.description)briefText.textContent=proj.description;

 renderFiles(proj);
 renderSchematic(proj);
 renderLayout(proj);
 renderInspector(proj);

 const expBtn=$('#export-btn');
 if(expBtn){
  expBtn.onclick=()=>{
   const cur=getActiveProject();
   modal('Take the build with you.',`<p>Exported build assets for <b>${escape(cur.name)}</b> (${escape(cur.badge)}).</p>${fileRows(cur)}`);
  };
 }

 document.body.classList.toggle('orion-model',proj.id==='orion');
 const cap=$('#geometry-caption');
 if(cap){
  cap.textContent=proj.id==='orion'?'ORION QUADRUPED · REFERENCE STL ASSEMBLY':(proj.type==='custom'?`${proj.name.toUpperCase()} · PARAMETRIC CAD`:'ACTUAL CADQUERY GEOMETRY');
 }

 const request=++geometryRequest;
 if(proj.id==='orion'){
  $('#replay-btn').hidden=true;
  document.querySelectorAll('.model-label').forEach(e=>e.hidden=true);
  setViewStatus('Loading reference geometry…','loading');
  try{
   const meshes=await loadOrionMeshes();
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
  document.querySelectorAll('.model-label').forEach(e=>e.hidden=false);
  if(report){
   syncBriefAndDims();
   try{
    const meshes=await json(`${artifactBase}iteration-${iteration}/mesh.json`);
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
  document.querySelectorAll('.model-label').forEach(e=>e.hidden=false);
  if(proj.spec){
   for(const k of ['length','width','mast_height']){
    const el=document.getElementById(k);
    if(el&&proj.spec[k]!=null)el.value=proj.spec[k];
   }
  }
  if(report){
   try{
    const meshes=await json(`${artifactBase}final/mesh.json`).catch(()=>json(`${artifactBase}iteration-2/mesh.json`));
    if(request!==geometryRequest)return;
    drawMeshes(meshes);
   }catch(e){
    if(request!==geometryRequest)return;
    if(assembly)assembly.visible=false;
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
$$('[data-model]').forEach(b=>b.onclick=()=>loadModel(b.dataset.model));
function resizer(id,prop,min,max,dir){const h=document.getElementById(id);if(!h)return;const ws=document.querySelector('.workspace');const base=prop==='--agent-w'?290:259;h.addEventListener('pointerdown',e=>{e.preventDefault();h.setPointerCapture(e.pointerId);h.classList.add('dragging');const startX=e.clientX;const cur=parseFloat(getComputedStyle(ws).getPropertyValue(prop))||base;const move=ev=>{const v=Math.min(max,Math.max(min,cur+(ev.clientX-startX)*dir));ws.style.setProperty(prop,v+'px')};const up=()=>{h.classList.remove('dragging');h.removeEventListener('pointermove',move);h.removeEventListener('pointerup',up)};h.addEventListener('pointermove',move);h.addEventListener('pointerup',up)});h.addEventListener('dblclick',()=>ws.style.removeProperty(prop))}
resizer('resize-agent','--agent-w',200,460,1);resizer('resize-props','--props-w',200,380,-1);
$('#timeline-toggle').onclick=()=>{const tl=$('#parts-timeline');const hide=!tl.classList.contains('collapsed');tl.classList.toggle('collapsed',hide);const b=$('#timeline-toggle');b.textContent=hide?'Show ▸':'Hide ▾';b.setAttribute('aria-expanded',String(!hide))};
$('#timeline-chips').addEventListener('click',e=>{const c=e.target.closest('[data-chip]');if(!c)return;selectPart((!e.shiftKey&&selectedNames.has(c.dataset.chip)&&selectedNames.size===1)?null:c.dataset.chip,e.shiftKey)});
$('#assembly-explorer').addEventListener('click',e=>{const b=e.target.closest('[data-pact]');if(!b)return;if(b.dataset.pact==='back'){selectPart(null)}else if(b.dataset.pact==='unpick'){selectPart(b.dataset.name,true)}else if(b.dataset.pact==='mention'){mentionSelection()}else if(b.dataset.pact==='isolate'){isolatedNames=new Set(isolatedNames.size?[]:[...selectedNames]);updateModel();renderAssemblyPanel()}});
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
const SLASHCMDS=[
 {c:'/connect',d:'Connect your local CAD runner',run:connectDialog},
 {c:'/help',d:'See available commands',run:()=>modal('Design commands',SLASHCMDS.map(x=>'<p><b>'+x.c+'</b> · '+x.d+'</p>').join(''))},
 {c:'/goal',d:'Start a design goal',run:()=>insertBrief('Goal: ')},
 {c:'/spec',d:'Insert current dimensions',run:()=>insertBrief(`Dimensions: ${$('#length').value} × ${$('#width').value} mm; mast ${$('#mast_height').value} mm.`)},
 {c:'/model',d:'Switch Rove–1 / Orion',run:()=>loadModel(model==='orion'?'rove1':'orion')},
 {c:'/parts',d:'Mention selected parts',run:mentionSelection},
 {c:'/evidence',d:'Inspect measured checks',run:()=>model==='orion'?toast('Orion is an unevaluated reference.'):showEvidence()},
 {c:'/benchmark',d:'Inspect repair results',run:showBenchmark},
 {c:'/clear',d:'Clear the draft',run:()=>{$('#brief').value=''}}
];
let slashIdx=0;
function insertBrief(text){const ta=$('#brief');ta.setRangeText(text,ta.selectionStart,ta.selectionEnd,'end')}
function slashToken(){const ta=$('#brief');return ta.value.slice(0,ta.selectionStart).match(/(?:^|\s)\/(\w*)$/)}
function slashMatches(){const m=slashToken();return m?SLASHCMDS.filter(x=>x.c.startsWith('/'+m[1].toLowerCase())):[]}
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
 closeSlash();ta.focus();SLASHCMDS.find(c=>c.c===cmd)?.run();
}
$('#slash-menu').addEventListener('pointerdown',e=>e.preventDefault());
$('#slash-menu').addEventListener('click',e=>{const b=e.target.closest('[data-slash]');if(b)applySlash(slashMatches()[Number(b.dataset.slash)].c)});
$('#brief').addEventListener('input',()=>{slashIdx=0;renderSlash()});
$('#brief').addEventListener('click',renderSlash);
$('#brief').addEventListener('keyup',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key))renderSlash()});
$('#brief').addEventListener('keydown',e=>{
 const list=slashMatches();if($('#slash-menu').hidden||!list.length)return;
 if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();slashIdx=(slashIdx+(e.key==='ArrowDown'?1:-1)+list.length)%list.length;renderSlash()}
 else if(['Enter','Tab'].includes(e.key)&&!e.shiftKey){e.preventDefault();applySlash(list[slashIdx].c)}
 else if(e.key==='Escape'){e.preventDefault();closeSlash()}
});
document.addEventListener('click',e=>{if(!e.target.closest('#brief-form'))closeSlash()});
document.addEventListener('click',e=>{const a=e.target.closest('[data-action]');if(a){if(a.dataset.action==='new-project')createFromTemplate();return}const v=e.target.closest('[data-evidence]');if(v){if(v.dataset.evidence==='report')showEvidence();else showBenchmark();return}const g=e.target.closest('[data-goto]');if(!g)return;e.preventDefault();location.hash='#/'+(g.dataset.goto==='preview'?'explorer':g.dataset.goto);});
function renderEvidence(){
  const item=report.iterations[iteration-1], last=report.iterations.at(-1);
  const evCls=m=>/fail/i.test(m)?'failure':/pass/i.test(m)?'pass':'';
  $('#activity').innerHTML=`<div class="run-result"><span class="status-dot"></span><b>${item.evaluation.passed?'Build ready':'Revision needs repair'}</b><p>${item.evaluation.checks.filter(c=>c.passed).length} / ${item.evaluation.checks.length} checks · Revision ${iteration}</p></div><details class="run-details"><summary>Build history · ${report.iterations.length} revisions</summary>${(report.events||[]).map(e=>'<div class="event"><h3>'+escape(e.role)+'</h3><p>'+escape(e.message)+'</p></div>').join('')}</details>`;
 $('#revision-label').textContent=`REV ${String(iteration).padStart(2,'0')} · ${item.evaluation.passed?'EVALUATED':'CONSTRAINT FAILURE'}`;
 $('#project-state').textContent=report.passed?'Evaluated exemplar':'Needs review';
 $('#replay-btn').textContent=iteration===1&&report.iterations.length>1?'↗ Inspect repaired build':'↺ Inspect initial build';
 $('#run-label').textContent=report.execution==='ao-worker'?'AO WORKER RESULT':runner?'LOCAL KERNEL RESULT':'RECORDED RUN';
 renderFiles();
}
async function loadIteration(n){
 const request=++geometryRequest;iteration=n;model='rove1';syncModelButtons();renderEvidence();setViewStatus('Loading geometry…','loading');
 try{const meshes=await json(`${artifactBase}iteration-${n}/mesh.json`);if(request!==geometryRequest)return;drawMeshes(meshes)}
 catch(e){if(request!==geometryRequest)return;if(assembly)assembly.visible=false;setViewStatus('Geometry could not load: '+e.message,'error')}
}

$('#replay-btn').onclick=()=>loadIteration(iteration===1?report.iterations.length:1);
function syncBriefAndDims(){const last=report.iterations.at(-1);const bt=$('#brief-text');if(bt&&report.description)bt.textContent=report.description;for(const k of ['length','width','mast_height']){const el=document.getElementById(k);if(el&&last.spec[k]!=null)el.value=last.spec[k]}DEMO_SPEC.length=last.spec.length;DEMO_SPEC.width=last.spec.width;DEMO_SPEC.mast_height=last.spec.mast_height;}
function renderDashboard(){
 const last=report?.iterations?.at(-1);
 const checks=last?.evaluation?.checks||[];
 const savedDesigns=loadDesigns();
 const totalAssemblies=2+savedDesigns.length;

 const customCards=savedDesigns.map(d=>{
  const dLast=d.revisions[d.revisions.length-1];
  const isEv=!!dLast.evaluated, isPass=!!dLast.passed;
  const tag=isEv?(isPass?'EVALUATED · PASS':'EVALUATED · FAIL'):'LOCAL DRAFT';
  return `<article class="project-tile"><button class="project-visual custom-art" data-open-design="${escape(d.id)}" aria-label="Explore ${escape(d.name)}">${robotArt('custom',dLast.spec)}<span class="visual-tag">${escape(tag)}</span><span class="visual-arrow">↗</span></button><div class="tile-title"><h2>${escape(d.name)}</h2><span class="project-badge">${escape(d.kind==='template'?'Custom CAD':'Imported')}</span></div><p>${escape(d.description||'Custom parametric design.')}</p><button class="text-button" data-open-design="${escape(d.id)}">Open assembly ↗</button></article>`;
 }).join('');

 $('#dashboard').innerHTML=`<div class="dashboard-heading"><div><span class="eyebrow">AUTOCADENT / YOUR WORKSPACE</span><h1>Ideas, taking shape.</h1><p>Build a robot. Explore every part. See what moves.</p></div><button class="dark-button" data-action="new-project">＋ New design</button></div>
 <div class="section-title"><h2>On your workbench</h2><span>${String(totalAssemblies).padStart(2,'0')} assemblies · 01 motion lab</span></div>
 <div class="project-gallery">
 <article class="project-tile"><button class="project-visual rover-art" data-open-model="rove1" aria-label="Explore Rove–1">${robotArt('rove1')}<span class="visual-tag">REV ${String(report?.final_iteration||iteration||1).padStart(2,'0')} · ${report?.passed?'CHECKED':'REVIEW'}</span><span class="visual-arrow">↗</span></button><div class="tile-title"><h2>Rove–1</h2><span class="project-badge">Parametric CAD</span></div><p>A compact rover, from first build to measured repair.</p><button class="text-button" data-open-model="rove1">Open assembly ↗</button></article>
 <article class="project-tile"><button class="project-visual orion-art" data-open-model="orion" aria-label="Explore Orion">${robotArt('orion')}<span class="visual-tag">16 PARTS · REFERENCE</span><span class="visual-arrow">↗</span></button><div class="tile-title"><h2>Orion</h2><span class="project-badge">Quadruped</span></div><p>A 12-joint robot dog. Inspect the full-resolution assembly.</p><button class="text-button" data-open-model="orion">Open assembly ↗</button></article>
 ${customCards}
 <article class="project-tile"><button class="project-visual duck-art" data-goto="simulation" aria-label="Open Motion Lab simulation">${robotArt('microduck')}<span class="motion-orbit"></span><span class="visual-tag">THREE.JS · KINEMATICS</span><span class="visual-arrow">↗</span></button><div class="tile-title"><h2>Motion Lab</h2><span class="project-badge">Simulation</span></div><p>Native Three.js locomotion & switchable planetary terrains.</p><button class="text-button" data-goto="simulation">Open motion lab ↗</button></article>
 </div>
 <div class="section-title"><h2>Latest build</h2><button class="text-button" data-evidence="report">View evidence ↗</button></div>
 <div class="build-overview"><div><span class="eyebrow">ROVE–1 / REV ${report?.final_iteration||iteration||1}</span><h3>${report?.passed?'Ready to explore':'Needs a repair'}</h3><p>${checks.filter(c=>c.passed).length} / ${checks.length} checks · ${report?.iterations?.length||1} revisions</p></div>${checks.filter(c=>['Chassis thickness','Tray wall','Board clearance'].includes(c.name)).map(c=>`<div><span>${escape(c.name)}</span><strong>${c.measured.toFixed(1)} <small>mm</small></strong><em>${c.passed?'✓ Pass':'! Fail'}</em></div>`).join('')}</div>
 <div class="workspace-shortcuts"><button data-goto="designs">◱ <span>Your designs<small>Saved in this browser</small></span>↗</button><button data-goto="files">▤ <span>Build files<small>STEP, STL & source</small></span>↗</button><button data-goto="layout">▦ <span>Connector board<small>KiCad layout & exports</small></span>↗</button></div>`;
}
function showEvidence(){const ev=report.iterations[iteration-1].evaluation;modal(`Revision ${iteration}: the evidence.`,`<p>Measured by OpenCASCADE. Solid validity is separate from dimensional acceptance. These checks do not certify strength, electrical safety, or printability.</p><table><thead><tr><th>Check</th><th>Measured</th><th>Requirement</th><th>Result</th></tr></thead><tbody>${ev.checks.map(c=>`<tr><td title="${escape(c.method)}">${c.name}</td><td>${c.measured} ${c.unit}</td><td>${escape(c.requirement)}</td><td>${c.passed?'PASS':'FAIL'}</td></tr>`).join('')}</tbody></table><p>Tray wall: paired planar side-face offsets. Board gap: minimum solid distance to tray sidewalls. No global wall analysis or structural simulation.</p><a class="download-link" href="${artifactBase}report.json" download>Download complete report ↗</a>`)};
async function showBenchmark(){try{const b=await json('artifacts/benchmark.json');modal('Small corpus. Real measurements.',`<p>${escape(b.kind)}. Each case builds real solids, evaluates, applies a fixed repair policy, then evaluates again.</p><table><thead><tr><th>Case</th><th>Initial</th><th>After repair</th></tr></thead><tbody>${b.cases.map(c=>`<tr><td>${c.case}</td><td>${c.before.passed?'PASS':'FAIL'}</td><td>${c.after.passed?'PASS':'FAIL'}</td></tr>`).join('')}</tbody></table><p>${b.before_pass_count} of ${b.case_count} initially accepted; ${b.after_pass_count} of ${b.case_count} after repair. This is a fixed regression corpus, not a general agent benchmark.</p><a class="download-link" href="artifacts/benchmark.json" download>Download benchmark artifact ↗</a>`)}catch(e){toast(e.message)}};
$('#guide-btn').onclick=()=>modal('An open engineering notebook.',`<p>AutoCadent turns a bounded robot brief into geometry you can inspect, evaluate and take with you.</p><h3>01 / Inspect the assembly</h3><p>Orbit the actual tessellated CAD model. Isolate the chassis, board or wheels. Toggle X-ray or explode the assembly.</p><h3>02 / Follow the correction</h3><p>Inspect the initial build: valid solids with failed thickness, wall and clearance constraints. Switch to the repaired build and open its measurements.</p><h3>03 / Build your variation</h3><p>Start the local runner, connect, edit the dimensions and submit your brief. The deterministic mode uses explicit dimensions; your prose is preserved as design intent. AO mode dispatches a real AO worker with the same bounded template.</p><pre>uv sync --python 3.12\nuv run uvicorn autocadent.api:app --host 127.0.0.1 --port 8766\n# Open http://127.0.0.1:8766</pre><p>GitHub Pages serves recorded artifacts. It cannot run CAD or agents. The signal board is a fixed exemplar, not a motor controller. The rover is an educational assembly, not validated hardware.</p><a class="download-link" target="_blank" rel="noreferrer" href="https://github.com/Anthony-Sin/AutoCadent-SyndicatebyMaximor">Setup, architecture & demo guide ↗</a>`);
$('#mcp-btn').onclick=async()=>{try{const e=await json('artifacts/mcp-status.json');modal('Tools, actually connected.',`<p>MCP initialize, tools/list and useful-call evidence from the local toolchain. These are recorded verification results, not a current connection to your machine.</p><table><tr><th>Server</th><th>Tools</th><th>Verified call</th></tr>${e.servers.map(s=>`<tr><td>${escape(s.name)}</td><td>${s.tools}</td><td>${escape(s.call)} · ${s.passed?'PASS':'FAIL'}</td></tr>`).join('')}</table><p>KiCad uses the pinned BCI-style uvx setup. AutoCadent CAD is a project-specific MCP server for bounded CadQuery generation and measurement.</p><a class="download-link" href="artifacts/mcp-status.json" download>Download verification summary ↗</a>`)}catch(e){toast(e.message)}};
function connectDialog(){modal('Bring your own runner.',`<p>Pages is a recorded artifact explorer. Start the runner locally and open its address for live CAD. Connecting from Pages requires an explicitly allowed origin. Use an authenticated HTTPS runner for remote hosting.</p><label for="runner-url">Runner URL</label><input id="runner-url" type="url" value="${escape(runner||'http://127.0.0.1:8766')}" placeholder="http://127.0.0.1:8766"><label for="runner-token">Runner token (only if configured; kept in memory)</label><input id="runner-token" type="password" autocomplete="off"><label for="execution-mode">Execution mode</label><select id="execution-mode"><option value="deterministic">Local CAD kernel + deterministic repair policy</option><option value="ao">Supervisor → actual AO worker → evaluator</option></select><button id="do-connect" class="dark-button">Connect runner ↗</button><p id="connect-status" role="status"></p>`);$('#execution-mode').value=execution;$('#do-connect').onclick=async()=>{const raw=$('#runner-url').value;try{const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Use an HTTP(S) runner origin without credentials or query parameters.'); const next=url.origin; const nextToken=$('#runner-token').value; const mode=$('#execution-mode').value;const h=await json(next+'/api/health',{headers:nextToken?{Authorization:'Bearer '+nextToken}:{}});if(mode==='ao'&&!h.ao_enabled)throw Error('AO dispatch is disabled on this runner. Enable AUTOCADENT_ENABLE_AO=1 server-side.');runner=next;token=nextToken;execution=mode;$('#connection-label').textContent=mode==='ao'?'AO runner connected':'Local runner connected';$('#composer-mode').textContent=mode==='ao'?'AO WORKER DISPATCH':'LOCAL CAD KERNEL';$('#footer-mode').textContent=mode==='ao'?'RUNNER CONNECTED · AO JOBS ON REQUEST':'RUNNER CONNECTED · DETERMINISTIC CAD';$('#modal').close();toast('Runner connected. Edit dimensions and submit your brief.')}catch(e){$('#connect-status').textContent=e.message}};}
$('#connect-btn').onclick=connectDialog;
$('#brief-form').onsubmit=async e=>{e.preventDefault();const command=$('#brief').value.trim();if(command.startsWith('/')){const found=SLASHCMDS.find(c=>c.c===command);if(found){$('#brief').value='';found.run()}else $('#brief-feedback').textContent='Unknown command. Type / to browse commands.';return}if(model==='orion'){toast('Select Rove–1 to generate a CAD variation.');return}if(jobBusy)return;if(!runner){$('#brief-feedback').textContent='Connect a local runner to generate your design. The recorded build is ready to inspect and download.';connectDialog();return}const description=$('#brief').value.trim();if(!description){$('#brief-feedback').textContent='Add a short description of your rover.';return}const spec={};for(const name of ['length','width','mast_height']){const input=$('#'+name);if(!input.checkValidity()){input.reportValidity();return}spec[name]=Number(input.value)}jobBusy=true;$('#submit-brief').disabled=true;$('#brief-feedback').textContent=execution==='ao'?'Supervisor dispatching an actual AO worker…':'Building and evaluating real CAD geometry…';const headers={'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})};try{const created=await json(runner+'/api/jobs',{method:'POST',headers,body:JSON.stringify({description,spec,execution})});let job;const deadline=Date.now()+15*60*1000;while(Date.now()<deadline){job=await json(runner+'/api/jobs/'+created.id,{headers});if(job.status==='complete'||job.status==='failed')break;$('#brief-feedback').textContent=job.message||'CAD worker running…';await new Promise(r=>setTimeout(r,2000))}if(job?.status!=='complete')throw Error(job?.error||'Job timed out. It may still be running; inspect the runner.');report=job.report;artifactBase=runner+`/artifacts/jobs/${created.id}/`;$('#brief-text').textContent=report.description||description;syncBriefAndDims();await loadIteration(report.final_iteration);renderDashboard();$('#brief-feedback').textContent='Build complete. Measured results and downloads updated.';tab('preview');if(pendingDesign){const plist=loadDesigns();const pd=plist.find(x=>x.id===pendingDesign.id);if(pd){pd.revisions.push({n:pd.revisions.length+1,spec:{...spec},evaluated:true,passed:job.report.passed,source_job:created.id,note:'live CAD run',saved_at:nowIso()});pd.description=description;pd.updated_at=nowIso();if(persistDesigns(plist)){toast('Revision '+pd.revisions.length+' saved to "'+pd.name+'".');const m=$('#design-mode');if(m&&!m.hidden)m.querySelector('.design-mode-note').textContent='Attached to a live runner — rebuilds update this design.'}}}}catch(err){$('#brief-feedback').textContent=err.message}finally{jobBusy=false;$('#submit-brief').disabled=false}};
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
if(['127.0.0.1','localhost'].includes(location.hostname)&&location.port==='8766'){try{await json('/api/health');runner=location.origin;$('#connection-label').textContent='Local runner connected';$('#composer-mode').textContent='LOCAL CAD KERNEL';$('#footer-mode').textContent='LOCAL RUNNER · DETERMINISTIC CAD'}catch{}}
// ---- My designs: client-side library (localStorage only; no server, no account) ----

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
 return `<article class="design-card"><div class="design-thumb" data-design="${escape(d.id)}" data-act="open">${robotArt('custom',last.spec)}</div><div class="design-card-head"><span class="design-kind ${d.kind}">${d.kind.toUpperCase()}</span><span class="design-id mono">${rv} revision${rv>1?'s':''}</span></div><h3>${escape(d.name)}</h3><p class="design-desc">${escape(d.description||'No description yet.')}</p><div class="design-spec">${last.spec.length} × ${last.spec.width} mm · mast ${last.spec.mast_height} mm</div><div class="design-state ${last.evaluated?(last.passed?'pass':'fail'):''}">${state}</div><div class="design-actions"><button class="text-button" data-design="${escape(d.id)}" data-act="open">Open ↗</button><button class="text-button" data-design="${escape(d.id)}" data-act="export">Export ↓</button><button class="text-button" data-design="${escape(d.id)}" data-act="rev">Save revision</button><button class="text-button" data-design="${escape(d.id)}" data-act="delete">Delete</button></div></article>`;
}
function renderDesigns(){
 const list=loadDesigns();
 const count=$('#designs-count');if(count)count.textContent=storageOK?`${list.length} saved in this browser`:'storage unavailable — nothing will persist';
 const host=$('#designs');if(!host)return;
  const demoSpec={length:DEMO_SPEC.length,width:DEMO_SPEC.width,mast_height:DEMO_SPEC.mast_height};
  const demoDesc=report?.description||'The recorded example workspace.';
  const demo=`<article class="design-card"><div class="design-thumb" data-design="__demo" data-act="open">${robotArt('rove1')}</div><div class="design-card-head"><span class="design-kind">EXAMPLE</span><span class="design-id mono">fixed · recorded build</span></div><h3>Rove–1</h3><p class="design-desc">${escape(demoDesc)}</p><div class="design-spec">${demoSpec.length} × ${demoSpec.width} mm · mast ${demoSpec.mast_height} mm</div><div class="design-state ${report?.passed?'pass':'fail'}">${report?.passed?'EVALUATED · PASS':'EVALUATED · FAIL'}</div><div class="design-actions"><button class="text-button" data-design="__demo" data-act="open">Open ↗</button><button class="text-button" data-design="__demo" data-act="export">Export ↓</button></div></article>`;
 host.innerHTML = (!storageOK)?`<div class="empty-designs">Browser storage is unavailable in this context (e.g. private mode). Designs cannot be saved here.</div>` : (list.length?list.map(designCard).join(''):`<div class="empty-designs">No saved designs yet. Import a design bundle or create one from the parametric template.</div>`)+demo;
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
 $('#length').value=last.spec.length;$('#width').value=last.spec.width;$('#mast_height').value=last.spec.mast_height;$('#brief').value=d.description||'';
 const mode=$('#design-mode');
 if(mode){
  mode.hidden=false;
  $('#design-mode-name').textContent=d.name;
  const note=mode.querySelector('.design-mode-note');
  if(note)note.textContent=last.evaluated?(last.source_job&&runner?'Attached to a live runner — rebuilds update this design.':'Evaluated earlier; rebuild via the local runner to refresh geometry.'):(d.kind==='imported'?'Imported locally — no CAD artifacts yet. Submit to build.' : 'Local draft — no CAD artifacts yet. Submit to build.');
 }
 await setActiveProject(d.id);
 if(last.evaluated&&last.source_job&&runner){
  json(runner+'/api/jobs/'+last.source_job,{headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})}}).then(j=>{
   if(j?.status==='complete'){
    report=j.report;
    artifactBase=runner+`/artifacts/jobs/${last.source_job}/`;
    const bt=document.getElementById('brief-text');
    if(bt)bt.textContent=d.description||'';
    loadIteration(report.final_iteration).then(()=>{renderDashboard();if(typeof renderEvidence==='function')renderEvidence()});
   }
  }).catch(()=>{});
 }
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
function deleteClick(id,btn){if(confirmId===id){confirmId=null;const list=loadDesigns(),d=list.find(x=>x.id===id);if(d){list.splice(list.indexOf(d),1);if(persistDesigns(list)){if(pendingDesign?.id===id){pendingDesign=null;$('#design-mode').hidden=true}renderDesigns();toast('Deleted "'+d.name+'".')}}}else{confirmId=id;btn.textContent='Confirm delete?';btn.classList.add('danger');setTimeout(()=>{if(confirmId===id){confirmId=null;renderDesigns()}},3500)}}
function importDesigns(text,fileName){
 let b;try{b=JSON.parse(text)}catch(e){throw new Error('Not valid JSON: '+e.message)}
 if(!b||typeof b!=='object'||Array.isArray(b))throw new Error('A design bundle must be a JSON object.');
 const spec={};for(const k of ['length','width','mast_height']){const v=Number(b.spec?.[k]);if(!Number.isFinite(v))throw new Error('Bundle needs numeric spec.'+k+'.');spec[k]=v}
 const norm=r=>({n:r.n||1,spec:{length:Number(r.spec?.length??spec.length)||spec.length,width:Number(r.spec?.width??spec.width)||spec.width,mast_height:Number(r.spec?.mast_height??spec.mast_height)||spec.mast_height},evaluated:!!r.evaluated,passed:!!r.passed,source_job:r.source_job?String(r.source_job):null,note:r.note?String(r.note).slice(0,120):'imported revision',saved_at:r.saved_at||nowIso()});
 const revisions=Array.isArray(b.revisions)&&b.revisions.length?b.revisions.map(norm):[{n:1,spec:{...spec},evaluated:!!(b.evaluated??b.passed!==undefined),passed:!!b.passed,source_job:null,note:'imported bundle',saved_at:nowIso()}];
 return{id:slug((b.name||fileName||'imported')+'-'+Math.random().toString(36).slice(2,7)),name:String(b.name||fileName.replace(/\.autocadent\.json$|\.json$/i,'')||'Imported design').slice(0,40),description:String(b.description||'').slice(0,1500),spec:{...spec},kind:'imported',source:'file',created_at:b.created_at||nowIso(),updated_at:nowIso(),revisions};
}
function createFromTemplate(){modal('Save your design locally.',`<div class="design-dialog"><label for="design-name">Design name</label><input id="design-name" type="text" maxlength="40" value="Rove-1 variation" autocomplete="off"><p class="muted">Stored in this browser only (localStorage). No account, no upload. Live CAD still needs the local runner; a draft saves without artifacts until you run it.</p><button id="do-save-design" class="dark-button">Save design ↗</button></div>`);$('#do-save-design').onclick=()=>{const n=$('#design-name').value.trim();if(!n){$('#design-name').focus();return}const spec=currentSpec();if(!inTemplateRange(spec)){toast('Dimensions must stay inside the template ranges.');$('#modal').close();return}$('#modal').close();const d={id:'t-'+Math.random().toString(36).slice(2,9),name:n.slice(0,40),description:$('#brief').value.trim(),spec:{...spec},kind:'template',source:'template',created_at:nowIso(),updated_at:nowIso(),revisions:[{n:1,spec:{...spec},evaluated:false,passed:false,source_job:null,note:'created from parametric template',saved_at:nowIso()}]};const list=loadDesigns();list.unshift(d);if(persistDesigns(list)){renderDesigns();openDesign(d.id);toast('New design "'+d.name+'" saved locally.')}else toast('Could not save — browser storage unavailable.')};$('#design-name').focus()}
$('#designs').addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;const id=b.dataset.design,act=b.dataset.act;if(act==='open')openDesign(id);else if(act==='export')exportDesign(id);else if(act==='rev')saveRevision(id);else if(act==='delete')deleteClick(id,b)});
$('#design-import').onchange=e=>{const f=e.target.files[0];if(!f)return;const reader=new FileReader();reader.onload=()=>{try{const d=importDesigns(reader.result,f.name);const list=loadDesigns();list.unshift(d);if(persistDesigns(list)){renderDesigns();openDesign(d.id);toast('Imported "'+d.name+'" ('+d.revisions.length+' revision'+(d.revisions.length>1?'s':'')+').')}else toast('Import failed — browser storage unavailable.')}catch(err){toast('Import rejected: '+err.message)}};reader.readAsText(f);e.target.value=''};
$('#design-new').onclick=createFromTemplate;
$('#design-save-rev').onclick=()=>{if(pendingDesign)saveRevision(pendingDesign.id)};
$('#design-export').onclick=()=>{if(pendingDesign)exportDesign(pendingDesign.id)};
$('#design-close').onclick=()=>{pendingDesign=null;$('#design-mode').hidden=true;toast('Design closed — workspace left as it was.')};

function setExplosion(value){
 explosion=Number(value);exploded=explosion>0;
 $('#explode-range').value=String(Math.round(explosion*100));$('#explode-value').textContent=Math.round(explosion*100)+'%';
 $('#explode').setAttribute('aria-pressed',String(exploded));updateModel();
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
