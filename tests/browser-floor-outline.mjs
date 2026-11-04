// Run against a local preview with Chrome's debugging port on 9223.
import assert from 'node:assert/strict';
import { browserEvaluate } from './browser-storage.mjs';

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
const evaluate = browserEvaluate(send);
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
  originalProject = await evaluate('localStorage.getItem("titan-workspace-v2")');
  await evaluate(`localStorage.setItem('titan-workspace-v2', JSON.stringify({projects:[{name:'Outline test',buildings:[{id:'b',name:'Building',floors:[{id:'f',floorName:'Ground',planImage:'data:image/png;base64,iVBORw0KGgo=',zones:[],assets:[]}]}],cables:[]}]})); location.reload()`); await wait(600);
  await evaluate(`document.querySelector('[data-action="trace-outline"]').click(); const scene = document.querySelector('#scene'); for (const [x,y] of [[10,10],[90,10],[90,40],[40,40],[40,90],[10,90]]) { const p = new DOMPoint(500+(x-y)*3.25,138+(x+y)*1.48).matrixTransform(scene.getScreenCTM()); scene.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:p.x,clientY:p.y})); } document.querySelector('[data-action="finish-outline"]').click();`);
  let floors = await evaluate(`JSON.parse(localStorage.getItem('titan-workspace-v2')).projects[0].buildings[0].floors`);
  assert.equal(floors[0].outline.length, 6);
  assert.equal(await evaluate(`document.querySelector('[data-floor]').getAttribute('points').split(' ').length`), 6);
  await evaluate(`document.querySelector('[data-action="new-floor"]').click(); document.querySelector('#question-input').value='Upper'; document.querySelector('#question-form').requestSubmit()`);
  floors = await evaluate(`JSON.parse(localStorage.getItem('titan-workspace-v2')).projects[0].buildings[0].floors`);
  assert.deepEqual(floors[1].outline, floors[0].outline);
  assert.equal(floors[1].planImage, '');
  await send('Page.reload', {ignoreCache:true}); await wait(600);
  assert.equal(await evaluate(`document.querySelector('[data-floor]').getAttribute('points').split(' ').length`), 6);
  console.log('Floor outline tracing and inheritance passed.');
} finally {
  if (originalProject !== undefined) await evaluate(`{ const value = ${JSON.stringify(originalProject)}; if (value === null) localStorage.removeItem("titan-workspace-v2"); else localStorage.setItem("titan-workspace-v2", value); location.reload(); }`);
  socket.close();
}
