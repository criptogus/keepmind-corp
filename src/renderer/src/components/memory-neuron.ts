import * as THREE from 'three'
// Shared textures keep 800 neurons lightweight. Dendrites are visual anatomy;
// graph edges remain the actual Markdown relationships supplied by MCP.
const neuronTextures: THREE.CanvasTexture[] = [];
const neuronMaterials = new Map();
function neuronTexture(variant: number) {
  if (neuronTextures[variant]) return neuronTextures[variant];
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  let seed = 131 + variant * 977;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const stroke = (x: number,y: number,angle: number,length: number,width: number,depth: number) => {
    const bend=(rand()-.5)*.5, endX=x+Math.cos(angle+bend)*length, endY=y+Math.sin(angle+bend)*length;
    ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+Math.cos(angle)*length*.65,y+Math.sin(angle)*length*.65,endX,endY);ctx.stroke();
    if(depth>0){stroke(endX,endY,angle-.32-rand()*.3,length*.47,width*.62,depth-1);stroke(endX,endY,angle+.32+rand()*.3,length*.47,width*.62,depth-1)}
  };
  ctx.strokeStyle='rgba(230,255,255,.95)';ctx.lineCap='round';ctx.shadowColor='rgba(150,240,255,.75)';ctx.shadowBlur=5;
  for(let i=0;i<7;i++){const a=i*Math.PI*2/7+variant*.37;stroke(128+Math.cos(a)*10,128+Math.sin(a)*10,a,38+rand()*19,3,2)}
  // One long, thinner axon, with a branching terminal.
  stroke(128,128,variant*.67+.2,66,2,1);
  ctx.beginPath();for(let i=0;i<14;i++){const a=i*Math.PI*2/14,r=i%2?11:19;const x=128+Math.cos(a)*r,y=128+Math.sin(a)*r;i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.closePath();
  ctx.fillStyle='rgba(220,255,255,.9)';ctx.shadowBlur=14;ctx.fill();
  ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(128,128,4,6,variant,0,Math.PI*2);ctx.fill();
  return neuronTextures[variant]=new THREE.CanvasTexture(canvas);
}
export function makeMemoryNeuron(node: { id: string; links: number },color: string) {
  let hash=0;for(const c of node.id)hash=(hash*31+c.charCodeAt(0))>>>0;
  const variant=hash%6,key=color+':'+variant;
  if(!neuronMaterials.has(key))neuronMaterials.set(key,new THREE.SpriteMaterial({map:neuronTexture(variant),color,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
  const neuron=new THREE.Group(),cell=new THREE.Sprite(neuronMaterials.get(key));
  cell.scale.setScalar(13+Math.min(Math.sqrt(node.links),7));
  neuron.add(cell);return neuron;
}
