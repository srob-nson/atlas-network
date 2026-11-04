// Run against a local preview and Chrome debugging port 9223. Uses and clears the preview browser storage.
import assert from 'node:assert/strict';
const pages = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const page = pages.find(p => p.url.startsWith('http://127.0.0.1:5173'));
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0; const pending = new Map();
socket.onmessage = e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method,params={}) => new Promise(resolve => { const n=++id; pending.set(n,resolve); socket.send(JSON.stringify({id:n,method,params})); });
const evaluate = expression => send('Runtime.evaluate',{expression,returnByValue:true}).then(r => { if(r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description); return r.result.value; });
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' }); await new Promise(r => setTimeout(r, 800));
await evaluate(`localStorage.removeItem('titan-workspace-v2'); localStorage.removeItem('titan-project-v1'); localStorage.setItem('network-atlas-project-v1', JSON.stringify({name:'Pan test',zones:[],assets:[{id:'ap',name:'Access point',type:'access_point',placed:true,x:50,y:50}],cables:[]})); location.reload()`);
await new Promise(r => setTimeout(r, 800));
assert.equal(await evaluate(`document.title`), 'Titan — Spatial network design');
assert.equal(await evaluate(`document.querySelector('#breadcrumb-project').textContent`), 'Pan test');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await evaluate(`document.querySelector('#scene').scrollIntoView({block:'center'})`);
await evaluate(`document.querySelector('[data-view="plan"]').click()`);
const fits = await evaluate(`(() => { const scene = document.querySelector('#scene'), bounds = scene.getBoundingClientRect(), floor = scene.querySelector('[data-floor]').getBoundingClientRect(); return floor.left > bounds.left && floor.right < bounds.right && floor.top > bounds.top && floor.bottom < bounds.bottom; })()`);
assert.ok(fits, 'the entire floor fits with space around it in plan view');
await evaluate(`document.querySelector('[data-view="3d"]').click()`);
assert.equal(await evaluate(`document.querySelector('#zoom-level').textContent`), '90%');
const initial = await evaluate(`(() => { const s=document.querySelector('#scene'), p=new DOMPoint(500,286).matrixTransform(s.getScreenCTM()); return { x:p.x, y:p.y }; })()`);
const target = await evaluate(`(() => { const s=document.querySelector('#scene'), p=new DOMPoint(500,205).matrixTransform(s.getScreenCTM()); return {x:p.x,y:p.y}; })()`);
async function drag(a,b) { await send('Input.dispatchMouseEvent',{type:'mouseMoved',...a}); await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...a}); await send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,clickCount:1,...b}); await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...b}); }
await drag(target,{x:target.x+40,y:target.y+25});
const moved = await evaluate(`(() => { const p=new DOMPoint(500,286).matrixTransform(document.querySelector('#scene').getScreenCTM()); return { x:p.x,y:p.y }; })()`);
assert.ok(Math.abs(moved.x-initial.x-40)<1 && Math.abs(moved.y-initial.y-25)<1, 'floor follows a drag');
const point = await evaluate(`(() => {const r=document.querySelector('[data-asset="ap"] circle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
await drag(point,{x:point.x+15,y:point.y+8});
const asset = await evaluate(`JSON.parse(localStorage.getItem('titan-workspace-v2')).projects[0].buildings[0].floors[0].assets[0]`);
assert.ok(asset.x !== 50 || asset.y !== 50, 'dragging equipment still moves it');
await evaluate(`document.querySelector('[data-action="reset-view"]').click()`);
assert.equal(await evaluate(`document.querySelector('#zoom-level').textContent`), '90%');
const reset = await evaluate(`(() => {const p=new DOMPoint(500,286).matrixTransform(document.querySelector('#scene').getScreenCTM());return {x:p.x,y:p.y}})()`);
assert.ok(Math.hypot(reset.x-initial.x,reset.y-initial.y)<1, 'reset restores the initial position');
for (const [ctrlKey, deltaY, deltaMode] of [[false, -120, 0], [true, -30, 0], [false, 3, 1]]) {
  const result = await evaluate(`(() => { const scene=document.querySelector('#scene'), r=scene.getBoundingClientRect(), x=r.left+r.width*.35, y=r.top+r.height*.4, p=new DOMPoint(x,y).matrixTransform(scene.getScreenCTM().inverse()), before=scene.getAttribute('viewBox'), event=new WheelEvent('wheel',{clientX:x,clientY:y,deltaY:${deltaY},deltaMode:${deltaMode},ctrlKey:${ctrlKey},bubbles:true,cancelable:true}); scene.dispatchEvent(event); const q=new DOMPoint(x,y).matrixTransform(scene.getScreenCTM().inverse()); return {before,after:scene.getAttribute('viewBox'),distance:Math.hypot(p.x-q.x,p.y-q.y),prevented:event.defaultPrevented}; })()`);
  assert.notEqual(result.before, result.after, 'wheel and trackpad gestures change zoom');
  assert.ok(result.distance < 1, 'zoom stays centred on the pointer');
  assert.equal(result.prevented, true, 'gesture does not scroll the page');
}
console.log('Floor panning, equipment dragging, reset and wheel zoom passed'); socket.close();
