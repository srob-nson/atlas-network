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
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' }); await new Promise(r=>setTimeout(r,1000));
await evaluate('localStorage.clear(); location.reload()'); await new Promise(r=>setTimeout(r,1000));
await evaluate(`document.querySelector('[data-action="show-racks"]').click(); document.querySelector('[data-rack-open="rack"]').click()`);
async function double(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`); const p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); for (const count of [1,2]) { await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:count,...p}); await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:count,...p}); } }
await double('[data-port-device="core"][data-port-name="1"]');
assert.equal(await evaluate(`document.querySelectorAll('.rack-port.armed').length`),1);
await double('[data-port-device="firewall"][data-port-name="1"]');
await new Promise(r=>setTimeout(r,100));
assert.equal(await evaluate(`document.querySelectorAll('#rack-cables path').length`),1);
assert.equal(await evaluate(`JSON.parse(localStorage.getItem('network-atlas-project-v1')).cables.filter(c=>c.fromPort==='1' && c.toPort==='1').length`),1);
await evaluate(`document.querySelector('[data-rack-device="core"]').click(); const project=JSON.parse(localStorage.getItem('network-atlas-project-v1')); const cable=project.cables.find(c=>c.fromPort==='1' && c.toPort==='1'); document.querySelector('[data-edit-port="'+cable.id+'"]').click(); const f=document.querySelector('#port-form'); f.elements.color.value='#2368ae'; f.requestSubmit()`);
await new Promise(r=>setTimeout(r,100));
const check = await evaluate(`(() => {
  const path=document.querySelector('#rack-cables path'), svg=path.ownerSVGElement, matrix=svg.getScreenCTM();
  const point=position => { const p=path.getPointAtLength(position).matrixTransform(matrix); return [p.x,p.y]; };
  const center=selector => { const r=document.querySelector(selector).getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2]; };
  const first=document.querySelector('[data-port-device="core"][data-port-name="1"]'), second=document.querySelector('[data-port-device="firewall"][data-port-name="1"]');
  return { start:point(0), end:point(path.getTotalLength()), a:center('[data-port-device="core"][data-port-name="1"]'), b:center('[data-port-device="firewall"][data-port-name="1"]'), colors:[getComputedStyle(first).backgroundColor, getComputedStyle(second).backgroundColor], stroke:path.getAttribute('stroke') };
})()`);
for (const [actual, expected] of [[check.start,check.a], [check.end,check.b]]) assert.ok(Math.hypot(actual[0]-expected[0],actual[1]-expected[1]) < 0.5, JSON.stringify(check));
assert.deepEqual(check.colors, ['rgb(35, 104, 174)', 'rgb(35, 104, 174)']);
assert.equal(check.stroke, '#2368ae');
console.log('Rack cable alignment and endpoint colours passed'); socket.close();
