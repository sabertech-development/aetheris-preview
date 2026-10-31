import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { EffectComposer } from './vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/addons/postprocessing/OutputPass.js';

// Decorative real-time models. Public content remains rendered by Rust/Leptos.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const unitY = new THREE.Vector3(0, 1, 0);
const sphere = new THREE.SphereGeometry(1, 28, 20);
const rod = new THREE.CylinderGeometry(1, 1, 1, 16);
const chrome = new THREE.MeshStandardMaterial({color:0xbacbdf, metalness:.92, roughness:.23});
const graphite = new THREE.MeshStandardMaterial({color:0x182538, metalness:.85, roughness:.28});
const blue = new THREE.MeshPhysicalMaterial({color:0x1669dc, metalness:.5, roughness:.2, clearcoat:1});
const ice = new THREE.MeshPhysicalMaterial({color:0x71d6ed, metalness:.45, roughness:.19, clearcoat:1});
const gold = new THREE.MeshStandardMaterial({color:0xdfa46a, metalness:.76, roughness:.25});
const white = new THREE.MeshStandardMaterial({color:0xe3ebf7, metalness:.3, roughness:.22});
const vec = (x,y,z) => new THREE.Vector3(x,y,z);
const neon = new THREE.MeshStandardMaterial({color:0x4bcfff,emissive:0x16aaff,emissiveIntensity:2.5,metalness:.4,roughness:.2});

// Moving light is an illustrative accent, not a scientific measurement.
function energyTrail(group,sample,color=0x40bbff){
  const count=100,positions=new Float32Array(count*3),weights=new Float32Array(count);
  for(let i=0;i<count;i++)weights[i]=Math.pow(1-i/count,1.7);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('weight',new THREE.BufferAttribute(weights,1));
  const material=new THREE.ShaderMaterial({uniforms:{tint:{value:new THREE.Color(color).multiplyScalar(3)}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`attribute float weight; varying float vWeight; void main(){vWeight=weight;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=(2.+weight*9.)*(7./-p.z);}`,
    fragmentShader:`uniform vec3 tint;varying float vWeight;void main(){float d=length(gl_PointCoord-.5)*2.;float a=pow(max(0.,1.-d),2.)*vWeight;gl_FragColor=vec4(tint,a);}`});
  const particles=new THREE.Points(geometry,material);particles.frustumCulled=false;group.add(particles);
  return t=>{for(let i=0;i<count;i++){const p=sample(((t-i*.0025)%1+1)%1);positions.set([p.x,p.y,p.z],i*3);}geometry.attributes.position.needsUpdate=true;};
}

function atmosphere(scene) {
  const layer=new THREE.Group();scene.add(layer);
  const vertices=[];
  // Deterministic dust field: depth cues without a network request or large asset.
  for(let i=0;i<190;i++){
    const angle=i*2.39996,r=2.6+(Math.sin(i*37.13)+1)*1.8;
    vertices.push(Math.cos(angle)*r,Math.sin(angle)*r*.85,-1.5-Math.abs(Math.cos(i*13.7))*3);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  const dust=new THREE.Points(geometry,new THREE.PointsMaterial({color:0x78baff,size:.026,transparent:true,opacity:.7,depthWrite:false}));layer.add(dust);
  const grid=new THREE.GridHelper(20,40,0x2866aa,0x153457);grid.position.y=-3.4;grid.position.z=-3;grid.material.transparent=true;grid.material.opacity=.24;layer.add(grid);
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
  const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(64,64,0,64,64,64);
  gradient.addColorStop(0,'rgba(49,121,255,.26)');gradient.addColorStop(.35,'rgba(35,73,228,.12)');gradient.addColorStop(1,'rgba(9,20,70,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const texture=new THREE.CanvasTexture(canvas);
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));glow.position.set(0,0,-3);glow.scale.set(10,10,1);layer.add(glow);
  const flowGeometry=new THREE.BufferGeometry(),flowSeeds=[],flowEnds=[];
  for(let i=0;i<160;i++){flowSeeds.push(i*.918,i*.918);flowEnds.push(0,1);}
  flowGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(160*6),3));flowGeometry.setAttribute('seed',new THREE.Float32BufferAttribute(flowSeeds,1));flowGeometry.setAttribute('tail',new THREE.Float32BufferAttribute(flowEnds,1));
  const flowMaterial=new THREE.ShaderMaterial({uniforms:{time:{value:0}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`attribute float seed;attribute float tail;uniform float time;varying float fade;void main(){float a=seed+time*.23-tail*.045;float r=3.1+.8*sin(seed*4.7);vec3 p=vec3(cos(a)*r,sin(a)*r*.86,sin(seed*2.3+a)*1.9-1.);fade=.25+.25*sin(seed)*sin(seed);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
    fragmentShader:`varying float fade;void main(){gl_FragColor=vec4(.2,.55,1.5,fade);}`});
  const flow=new THREE.LineSegments(flowGeometry,flowMaterial);flow.frustumCulled=false;layer.add(flow);
  return {layer,animate(t){dust.rotation.z=t*.032;dust.position.y=Math.sin(t*.35)*.15;flowMaterial.uniforms.time.value=t;glow.material.opacity=.8+Math.sin(t*.22)*.1;},dispose(){flowGeometry.dispose();flowMaterial.dispose();geometry.dispose();dust.material.dispose();grid.geometry.dispose();grid.material.dispose();texture.dispose();glow.material.dispose();}};
}

function ball(group, position, radius, material) {
  const mesh = new THREE.Mesh(sphere, material);
  mesh.position.copy(position); mesh.scale.setScalar(radius); group.add(mesh); return mesh;
}
function bond(group, a, b, radius, material) {
  const mesh = new THREE.Mesh(rod, material);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.scale.set(radius, a.distanceTo(b), radius);
  mesh.quaternion.setFromUnitVectors(unitY, b.clone().sub(a).normalize());
  group.add(mesh); return mesh;
}
function torus(group, radius, thickness, material, rotationX=0) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius,thickness,16,100),material);
  mesh.rotation.x=rotationX; group.add(mesh); return mesh;
}
function dna() {
  const root = new THREE.Group(), model = new THREE.Group(); root.add(model);
  const count=25, height=5.4, radius=.94;
  const point=(t,offset)=>vec(radius*Math.cos(t*Math.PI*4.2+offset),(t-.5)*height,radius*Math.sin(t*Math.PI*4.2+offset));
  for(let strand=0;strand<2;strand++){
    const points=Array.from({length:181},(_,i)=>point(i/180,strand*Math.PI));
    const curve=new THREE.CatmullRomCurve3(points);
    model.add(new THREE.Mesh(new THREE.TubeGeometry(curve,220,.105,12,false),strand?chrome:blue));
    for(let i=0;i<count;i++) ball(model,point(i/(count-1),strand*Math.PI),.12,strand?chrome:blue);
  }
  for(let i=0;i<count;i++){
    const a=point(i/(count-1),0), b=point(i/(count-1),Math.PI), mid=a.clone().lerp(b,.5);
    bond(model,a,mid,.065,i%2?ice:gold); bond(model,mid,b,.065,i%2?gold:ice);
    ball(model,mid,.084,chrome);
  }
  root.rotation.z=-.35; root.rotation.x=.12;
  const lightA=energyTrail(model,t=>point(t,0));
  const lightB=energyTrail(model,t=>point(1-t,Math.PI),0xae80ff);
  return {root, animate(t){model.rotation.y=t*.25;lightA(t*.12);lightB(t*.12+.5);}};
}
function molecule(){
  // Tetrahedral diamond-lattice fragment: carbon sites and nearest-neighbor bonds.
  const root=new THREE.Group(), model=new THREE.Group();root.add(model);
  const sites=[],basis=[[0,0,0],[0,.5,.5],[.5,0,.5],[.5,.5,0],[.25,.25,.25],[.25,.75,.75],[.75,.25,.75],[.75,.75,.25]];
  for(let x=0;x<2;x++)for(let y=0;y<2;y++)for(let z=0;z<2;z++)for(const p of basis){
    const v=vec((x+p[0]-.8)*1.95,(y+p[1]-.8)*1.95,(z+p[2]-.8)*1.95);
    if(v.length()<2.1)sites.push(v);
  }
  sites.forEach((p,i)=>ball(model,p,.21,i%5===0?ice:i%3===0?blue:chrome));
  for(let i=0;i<sites.length;i++)for(let j=i+1;j<sites.length;j++){
    const distance=sites[i].distanceTo(sites[j]);
    if(distance<.87)bond(model,sites[i],sites[j],.055,chrome);
  }
  root.rotation.z=.18;
  const lights=[];
  for(let i=0;i<sites.length;i+=5){const a=sites[i],b=sites.find(p=>p!==a&&p.distanceTo(a)<.87);if(b)lights.push(energyTrail(model,t=>a.clone().lerp(b,t),i%2?0x48caff:0xb091ff));}
  return {root,animate(t){model.rotation.set(.3+Math.sin(t*.17)*.18,t*.18,.1);lights.forEach((light,i)=>light(t*.28+i*.17));}};
}
function gyroscope(){
  const root=new THREE.Group(), outer=new THREE.Group(), inner=new THREE.Group(), rotor=new THREE.Group();
  root.add(outer);outer.add(inner);inner.add(rotor);
  torus(outer,2.15,.115,chrome);
  torus(outer,2.15,.027,blue).position.z=.115;
  torus(inner,1.73,.11,blue);
  torus(inner,1.73,.025,chrome).position.z=.11;
  torus(outer,2.15,.018,neon).position.z=.125;
  torus(inner,1.73,.018,neon).position.z=.125;
  for(const side of [-1,1]){
    bond(outer,vec(side*1.72,0,0),vec(side*2.25,0,0),.14,graphite);
    ball(outer,vec(side*2.23,0,0),.18,chrome);
    bond(inner,vec(0,side*1.18,0),vec(0,side*1.83,0),.12,chrome);
  }
  const disc=new THREE.Mesh(new THREE.CylinderGeometry(1.23,1.23,.24,80),graphite);
  disc.rotation.x=Math.PI/2;rotor.add(disc);
  torus(rotor,1.17,.15,chrome);torus(rotor,.93,.035,gold).position.z=.14;
  for(let i=0;i<12;i++){
    const a=i*Math.PI/6;bond(rotor,vec(.34*Math.cos(a),.34*Math.sin(a),.16),vec(1.05*Math.cos(a),1.05*Math.sin(a),.16),.045,chrome);
    ball(rotor,vec(1.17*Math.cos(a),1.17*Math.sin(a),.13),.047,graphite);
  }
  bond(rotor,vec(0,0,-.7),vec(0,0,.7),.13,chrome);
  ball(rotor,vec(0,0,.22),.3,blue);ball(rotor,vec(0,0,.66),.17,gold);
  root.rotation.set(.35,-.45,-.3);
  const light=energyTrail(outer,t=>vec(2.15*Math.cos(t*Math.PI*2),2.15*Math.sin(t*Math.PI*2),.15));
  return {root,animate(t){outer.rotation.y=t*.23;inner.rotation.x=.15+Math.sin(t*.36)*.8;rotor.rotation.z=t*1.15;light(t*.22);}};
}

function plasma(){
  const root=new THREE.Group(),model=new THREE.Group();root.add(model);
  const materials=[];
  // Fresnel glass and flowing discharge filaments; an illustrative plasma globe.
  const glass=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.FrontSide,
    vertexShader:`varying vec3 n;varying vec3 eye;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);eye=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
    fragmentShader:`varying vec3 n;varying vec3 eye;void main(){float edge=pow(1.-abs(dot(normalize(n),normalize(eye))),3.8);gl_FragColor=vec4(vec3(.18,.36,1.4),edge*.66+.012);}`});materials.push(glass);
  ball(model,vec(0,0,0),2.3,glass);
  const electrode=new THREE.MeshStandardMaterial({color:0x6d3ad2,emissive:0x7223ff,emissiveIntensity:2,metalness:.6,roughness:.23});materials.push(electrode);
  ball(model,vec(0,0,0),.26,electrode);
  const core=torus(model,.34,.024,neon);core.rotation.x=Math.PI/2;
  bond(model,vec(0,-2.65,0),vec(0,-.28,0),.065,graphite);
  const base=new THREE.Mesh(new THREE.CylinderGeometry(.88,1.08,.22,64),graphite);base.position.y=-2.7;model.add(base);
  torus(model,.91,.025,neon,Math.PI/2).position.y=-2.6;
  const tube=new THREE.CylinderGeometry(1,1,1,7,56,true);
  for(let i=0;i<24;i++){
    const y=1-2*(i+.5)/24,a=i*2.399963,r=Math.sqrt(1-y*y),direction=vec(Math.cos(a)*r,y,Math.sin(a)*r);
    const material=new THREE.ShaderMaterial({uniforms:{time:{value:0},seed:{value:i*.81},direction:{value:direction},tint:{value:new THREE.Color(i%3===0?0x57bdff:i%3===1?0xb568ff:0x687dff).multiplyScalar(3.2)}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:`uniform float time;uniform float seed;uniform vec3 direction;varying float along;vec3 path(float t){vec3 side=normalize(cross(direction,vec3(.17,.93,.21)));vec3 up=cross(direction,side);float wave=sin(t*3.14159);return direction*(.25+t*2.04)+wave*(side*(sin(t*18.+time*1.8+seed)*.09+sin(t*7.-time*.9+seed)*.15)+up*sin(t*13.-time*1.3+seed)*.12);}void main(){float t=uv.y;along=t;vec3 p=path(t);vec3 tangent=normalize(path(t+.001)-p);vec3 side=normalize(cross(tangent,vec3(.21,.85,.37)));vec3 up=cross(tangent,side);float radius=.009+.008*(1.-t);p+=(position.x*side+position.z*up)*radius;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
      fragmentShader:`uniform vec3 tint;varying float along;void main(){gl_FragColor=vec4(tint,.65+.25*sin(along*3.14159));}`});
    materials.push(material);model.add(new THREE.Mesh(tube,material));
    ball(model,direction.clone().multiplyScalar(2.29),.035,neon);
  }
  root.rotation.z=-.12;
  return {root,dispose(){materials.forEach(m=>m.dispose());},animate(t){model.rotation.y=t*.12;materials.forEach(m=>{if(m.uniforms?.time)m.uniforms.time.value=t;});core.rotation.z=t*.4;}};
}

function mount(figure){
  if(figure.dataset.initialized)return;
  figure.dataset.initialized='true';
  let renderer;
  try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}catch{return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,matchMedia('(max-width:700px)').matches?1.25:1.5));
  renderer.setClearColor(0x010207,1);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.88;
  const scene=new THREE.Scene();
  const pmrem=new THREE.PMREMGenerator(renderer), room=new RoomEnvironment();
  const env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.8;
  room.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xc4dfff,0x07101f,.6));
  for(const [color,intensity,pos] of [[0xe4f2ff,2,[3,5,5]],[0x287dff,2.5,[-4,1,2]],[0x8bcbff,1.5,[1,-3,-3]]]){
    const light=new THREE.DirectionalLight(color,intensity);light.position.set(...pos);scene.add(light);
  }
  const camera=new THREE.PerspectiveCamera(35,1,.1,50);camera.position.set(0,.1,9.6);
  const composer=new EffectComposer(renderer);
  const renderPass=new RenderPass(scene,camera),bloom=new UnrealBloomPass(new THREE.Vector2(600,500),.28,.45,1.8),output=new OutputPass();
  composer.addPass(renderPass);composer.addPass(bloom);composer.addPass(output);
  const ambience=atmosphere(scene), pivot=new THREE.Group();scene.add(pivot);
  let object=({dna,molecule,gyroscope,plasma}[figure.dataset.model]||dna)();pivot.add(object.root);
  const pointer={x:0,y:0},rotation={x:0,y:0};let dragging=false,previousX=0,previousY=0,zoom=1,reveal=1;
  const host=figure.querySelector('.science-canvas');host.append(renderer.domElement);
  let width=0,height=0,visible=true,paused=false,localPaused=false,time=1.7,last=0,frame=0,speed=3;
  const resize=new ResizeObserver(()=>{width=host.clientWidth;height=host.clientHeight;if(!height)return;renderer.setSize(width,height,false);composer.setSize(width,height);camera.aspect=width/height;camera.position.z=camera.aspect<.85?11.4:9.6;const wide=figure.parentElement.classList.contains('hero')&&width>700&&!figure.classList.contains('scene-expanded');pivot.position.x=wide?camera.aspect*1.35:0;ambience.layer.position.x=pivot.position.x;camera.updateProjectionMatrix();draw();});resize.observe(host);
  const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;});intersection.observe(figure);
  const site=figure.closest('.site');
  const pauseObserver=new MutationObserver(()=>{paused=site.classList.contains('motion-paused');});pauseObserver.observe(site,{attributes:true,attributeFilter:['class']});
  function releaseObject(){object.dispose?.();const disposed=new Set();object.root.traverse(node=>{if(node.geometry&&node.geometry!==sphere&&node.geometry!==rod&&!disposed.has(node.geometry)){node.geometry.dispose();disposed.add(node.geometry);}if(node.isPoints)node.material.dispose();});pivot.remove(object.root);}
  const labels={plasma:'PHYSICS / PLASMA GLOBE',dna:'DNA / DOUBLE HELIX',molecule:'CHEMISTRY / CRYSTAL STRUCTURE',gyroscope:'PHYSICS / GYROSCOPIC MOTION'};
  figure.querySelectorAll('[data-select-model]').forEach(button=>button.addEventListener('click',()=>{
    const model=button.dataset.selectModel;if(model===figure.dataset.model)return;
    releaseObject();object=({dna,molecule,gyroscope,plasma}[model])();pivot.add(object.root);time=1.7;rotation.x=rotation.y=0;zoom=1;reveal=paused||localPaused||reducedMotion.matches?1:.72;
    figure.dataset.model=model;figure.querySelector('.model-label').textContent=labels[model];
    const fallback=figure.querySelector('.science-fallback');fallback.src=`/public/science-${model}.png`;fallback.alt=`Three-dimensional ${model} illustration`;
    figure.querySelectorAll('[data-select-model]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));draw();
  }));
  host.addEventListener('pointerdown',event=>{dragging=true;previousX=event.clientX;previousY=event.clientY;host.setPointerCapture(event.pointerId);host.classList.add('dragging');});
  const endDrag=()=>{dragging=false;host.classList.remove('dragging');};host.addEventListener('pointerup',endDrag);host.addEventListener('pointercancel',endDrag);
  host.addEventListener('pointermove',event=>{const box=host.getBoundingClientRect();pointer.x=(event.clientX-box.left)/box.width-.5;pointer.y=(event.clientY-box.top)/box.height-.5;if(dragging){rotation.y+=(event.clientX-previousX)*.009;rotation.x+=(event.clientY-previousY)*.006;previousX=event.clientX;previousY=event.clientY;pivot.rotation.set(rotation.x,rotation.y,0);draw();}});
  host.addEventListener('pointerleave',()=>{pointer.x=0;pointer.y=0;});
  let expanded=false;const inertSiblings=[];
  const expandButton=figure.querySelector('[data-view="expand"]');
  const escapeView=event=>{if(event.key==='Escape'&&expanded){event.preventDefault();toggleExpand();}};
  function toggleExpand(){expanded=!expanded;figure.classList.toggle('scene-expanded',expanded);document.body.classList.toggle('exhibit-open',expanded);expandButton.setAttribute('aria-expanded',String(expanded));expandButton.setAttribute('aria-label',expanded?'Close science exhibit':'Expand science exhibit');expandButton.textContent=expanded?'×':'⛶';if(expanded){figure.setAttribute('role','dialog');figure.setAttribute('aria-modal','true');figure.setAttribute('aria-label','Interactive science exhibit');let current=figure;while(current&&current!==site){for(const sibling of current.parentElement.children)if(sibling!==current&&!sibling.inert){sibling.inert=true;inertSiblings.push(sibling);}current=current.parentElement;}}else{figure.removeAttribute('role');figure.removeAttribute('aria-modal');figure.removeAttribute('aria-label');inertSiblings.splice(0).forEach(el=>el.inert=false);}expandButton.focus();}
  figure.addEventListener('keydown',event=>{escapeView(event);if(expanded&&event.key==='Tab'){const items=[...figure.querySelectorAll('button,[tabindex="0"]')];if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1).focus();}else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0].focus();}}});
  function changeView(action){if(action==='in')zoom=Math.min(1.3,zoom+.1);if(action==='out')zoom=Math.max(.75,zoom-.1);if(action==='expand')toggleExpand();if(action==='speed'){speed=speed===3?1:speed===1?2:3;const button=figure.querySelector('[data-view="speed"]');button.textContent=`${speed}×`;button.setAttribute('aria-label',`Animation speed ${speed} times. Change speed`);}if(action==='motion'){localPaused=!localPaused;const button=figure.querySelector('[data-view="motion"]');button.setAttribute('aria-pressed',String(localPaused));button.setAttribute('aria-label',localPaused?'Resume exhibit animation':'Pause exhibit animation');button.textContent=localPaused?'▷':'Ⅱ';}if(action==='reset'){zoom=1;rotation.x=rotation.y=0;pivot.rotation.set(0,0,0);}draw();}
  figure.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>changeView(button.dataset.view)));
  host.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(event.key)){event.preventDefault();if(event.key==='ArrowLeft')rotation.y-=.2;if(event.key==='ArrowRight')rotation.y+=.2;if(event.key==='ArrowUp')rotation.x-=.2;if(event.key==='ArrowDown')rotation.x+=.2;if(event.key==='+'||event.key==='=')changeView('in');if(event.key==='-')changeView('out');if(event.key==='Home')changeView('reset');pivot.rotation.set(rotation.x,rotation.y,0);draw();}});
  function draw(){object.animate(time);ambience.animate(time);pivot.scale.setScalar(zoom*reveal);composer.render();figure.classList.add('science-ready');}
  function tick(now){
    if(!figure.isConnected){cancelAnimationFrame(frame);resize.disconnect();intersection.disconnect();pauseObserver.disconnect();releaseObject();ambience.dispose();env.dispose();bloom.dispose();output.dispose();composer.dispose();renderer.dispose();return;}
    const delta=Math.min((now-last)/1000,.05);last=now;
    if(visible&&!document.hidden&&!paused&&!localPaused&&!reducedMotion.matches){if(!dragging)time+=delta*speed;reveal+=(1-reveal)*.1;if(!dragging){pivot.rotation.y+=(rotation.y+pointer.x*.5+Math.sin(time*.16)*.08-pivot.rotation.y)*.045;pivot.rotation.x+=(rotation.x-pointer.y*.25-pivot.rotation.x)*.045;}pivot.position.y=Math.sin(time*.55)*.1;draw();}
    frame=requestAnimationFrame(tick);
  }
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();figure.classList.remove('science-ready');});
  draw();frame=requestAnimationFrame(tick);
}
function scan(){document.querySelectorAll('.science-scene').forEach(mount);}
// Leptos replaces the prerendered tree when WASM is ready.
window.addEventListener('TrunkApplicationStarted',scan);
if(window.wasmBindings)scan();




