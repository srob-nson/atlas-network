// Run against a local preview with Chrome's debugging port on 9223.
import assert from 'node:assert/strict';

const pages = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const page = pages.find(item => item.type === 'page' && item.url.startsWith('http://127.0.0.1:5173'));
assert.ok(page, 'open the preview in Chrome first');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let next = 0;
const pending = new Map(), exceptions = [];
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
  message.error ? reject(new Error(message.error.message)) : resolve(message.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const mouse = (type, x, y, buttons = 0, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount });
const assetPoint = () => evaluate(`(() => {
  const svg = document.querySelector('#scene');
  const rect = svg.querySelector('[data-asset="core"] circle').getBoundingClientRect();
  const matrix = svg.getScreenCTM();
  return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d};
})()`);

let originalProject;
try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  originalProject = await evaluate('localStorage.getItem("titan-workspace-v2")');
  await evaluate(`localStorage.setItem('titan-workspace-v2', JSON.stringify({projects:[{name:'Test',buildings:[{id:'b',name:'Building',floors:[{id:'f',floorName:'Floor',zones:[],assets:[{id:'a',name:'A',type:'access_point',placed:true,x:20,y:20},{id:'b',name:'B',type:'access_point',placed:true,x:70,y:70},{id:'c',name:'C',type:'access_point',placed:true,x:70,y:20}]}]}],cables:[]}]})); location.reload()`); await wait(600);
  async function doubleClick(id) {
    for (let count = 1; count <= 2; count++) {
      const p = await evaluate(`(() => { const r = document.querySelector('[data-asset="${id}"] circle').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await mouse('mouseMoved', p.x, p.y); await mouse('mousePressed', p.x, p.y, 1, count); await mouse('mouseReleased', p.x, p.y, 0, count);
    }
  }
  const cables = () => evaluate(`JSON.parse(localStorage.getItem('titan-workspace-v2')).projects[0].cables`);
  await doubleClick('a');
  assert.match(await evaluate(`document.querySelector('#hint-text').textContent`), /double.click/i);
  await doubleClick('b');
  assert.equal((await cables()).length, 1, 'double clicks connect equipment with inspector initially closed');
  await doubleClick('b'); await doubleClick('c');
  assert.equal((await cables()).length, 2, 'double clicks connect equipment with inspector open');
  await doubleClick('b'); await doubleClick('c');
  assert.equal((await cables()).length, 2, 'duplicate connections are rejected');
  console.log('Floor double-click connections passed.');
} finally {
  if (originalProject !== undefined) await evaluate(`{ const value = ${JSON.stringify(originalProject)}; if (value === null) localStorage.removeItem("titan-workspace-v2"); else localStorage.setItem("titan-workspace-v2", value); location.reload(); }`);
  socket.close();
}
