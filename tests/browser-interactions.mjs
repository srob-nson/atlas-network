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
const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
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
  await evaluate(`localStorage.removeItem('titan-workspace-v2'); localStorage.setItem('titan-project-v1', JSON.stringify({name:'Interaction test', zones:[{id:'network',name:'Network',x:0,y:0,w:36,h:38},{id:'workspace',name:'Workspace',x:36,y:38,w:64,h:62}],assets:[{id:'core',name:'Core',type:'switch',placed:true,x:23,y:16,zoneId:'network',rackId:''},{id:'switch',name:'Switch',type:'switch',placed:true,x:70,y:25,rackId:''}],cables:[{id:'c2',from:'core',to:'switch'}]}))`); await send('Page.reload', { ignoreCache: true }); await wait(800);
  assert.equal(await evaluate('document.querySelector(".inspector").hidden'), true, 'details are initially closed');
  let point = await assetPoint();
  await mouse('mouseMoved', point.x, point.y); await mouse('mousePressed', point.x, point.y, 1); await mouse('mouseReleased', point.x, point.y);
  assert.equal(await evaluate('document.querySelector(".inspector").hidden'), false, 'selecting equipment opens details');
  await evaluate('document.querySelector("[data-action=place-asset]").click()');
  assert.equal(await evaluate('document.querySelector(".inspector").hidden'), true, 'placement leaves the plan unobstructed');
  await evaluate('document.querySelector("[data-action=cancel-mode]").click()');
  assert.equal(await evaluate('document.querySelector(".inspector").hidden'), false, 'cancelling placement restores details');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate('document.querySelector(".inspector").hidden'), true, 'Escape closes details');
  await evaluate('document.querySelector("#scene [data-asset=core]").focus()');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  assert.equal(await evaluate('document.querySelector(".inspector").hidden'), false, 'keyboard selection opens details');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  const cableBefore = await evaluate('document.querySelector("[data-cable=c2]").getAttribute("points")');
  point = await assetPoint();
  const dx = 13 * point.a + 29.6 * point.c, dy = 13 * point.b + 29.6 * point.d;
  await mouse('mouseMoved', point.x, point.y); await mouse('mousePressed', point.x, point.y, 1);
  await mouse('mouseMoved', point.x + dx, point.y + dy, 1); await mouse('mouseReleased', point.x + dx, point.y + dy);
  let asset = await evaluate('JSON.parse(localStorage.getItem("titan-workspace-v2")).projects[0].buildings[0].floors[0].assets.find(a => a.id === "core")');
  assert.ok(Math.abs(asset.x - 35) < 1 && Math.abs(asset.y - 24) < 1, 'dragging follows the pointer without jumping');
  assert.equal(asset.zoneId, 'network', 'dragging assigns the containing zone');
  assert.notEqual(await evaluate('document.querySelector("[data-cable=c2]").getAttribute("points")'), cableBefore, 'connected cable redraws');
  assert.equal(await evaluate('document.querySelector(".inspector").hidden'), false, 'dragging selects the device');
  await send('Page.reload', { ignoreCache: true }); await wait(600);
  asset = await evaluate('JSON.parse(localStorage.getItem("titan-workspace-v2")).projects[0].buildings[0].floors[0].assets.find(a => a.id === "core")');
  assert.ok(Math.abs(asset.x - 35) < 1 && Math.abs(asset.y - 24) < 1, 'position survives a reload');
  await evaluate('document.querySelector("[data-action=show-connections]").click(); document.querySelector("[data-cable-select=c2]").click()');
  assert.equal(await evaluate('document.querySelectorAll(".route-editor circle").length'), 441, 'editing shows a floor grid');
  await evaluate('document.querySelector("[data-action=add-point]").click()');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  let route = await evaluate('JSON.parse(localStorage.getItem("titan-workspace-v2")).projects[0].cables.find(c => c.id === "c2").waypoints');
  assert.equal(route.length, 1, 'keyboard adds a fixed waypoint');
  assert.equal(route[0].x % 5, 0, 'waypoint remains on the grid');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  route = await evaluate('JSON.parse(localStorage.getItem("titan-workspace-v2")).projects[0].cables.find(c => c.id === "c2").waypoints');
  assert.deepEqual(route, [], 'keyboard removes the waypoint');
  await evaluate('document.querySelector("[data-action=close-inspector]").click()');
  const anchor = await evaluate(`(() => { const s = document.querySelector('#scene'), r = s.getBoundingClientRect(), x = r.left+r.width*.4, y = r.top+r.height*.4, p = new DOMPoint(x,y).matrixTransform(s.getScreenCTM().inverse()); s.dispatchEvent(new WheelEvent('wheel', {clientX:x, clientY:y, deltaY:-120, bubbles:true, cancelable:true})); const q = new DOMPoint(x,y).matrixTransform(s.getScreenCTM().inverse()); return Math.hypot(p.x-q.x,p.y-q.y); })()`);
  assert.ok(anchor < 1, 'wheel zoom keeps the pointer anchored');
  await evaluate('document.querySelector("[data-action=reset-view]").click()');
  await evaluate(`document.querySelector('[data-view="plan"]').click(); document.querySelector('[data-action="rotate"]').click(); document.querySelector('[data-action="zoom-in"]').click()`);
  point = await assetPoint();
  const planDx = -192 * point.a + 94 * point.c, planDy = -192 * point.b + 94 * point.d;
  await mouse('mouseMoved', point.x, point.y); await mouse('mousePressed', point.x, point.y, 1);
  await mouse('mouseMoved', point.x + planDx, point.y + planDy, 1); await mouse('mouseReleased', point.x + planDx, point.y + planDy);
  asset = await evaluate('JSON.parse(localStorage.getItem("titan-workspace-v2")).projects[0].buildings[0].floors[0].assets.find(a => a.id === "core")');
  assert.ok(Math.abs(asset.x - 55) < 1 && Math.abs(asset.y - 54) < 1, 'dragging accounts for plan rotation and zoom');
  assert.equal(asset.zoneId, 'network', 'dragging preserves the assigned zone');
  await evaluate('document.querySelector("[data-action=close-inspector]").click()');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate('document.querySelector("#scene").scrollIntoView({block:"center"})'); await wait(300);
  point = await assetPoint();
  const touchDx = -32 * point.a + 23.5 * point.c, touchDy = -32 * point.b + 23.5 * point.d;
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, id: 1 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + touchDx, y: point.y + touchDy, id: 1 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  asset = await evaluate('JSON.parse(localStorage.getItem("titan-workspace-v2")).projects[0].buildings[0].floors[0].assets.find(a => a.id === "core")');
  assert.ok(Math.abs(asset.x - 60) < 1 && Math.abs(asset.y - 59) < 1, 'touch dragging moves equipment');
  assert.deepEqual(exceptions, [], 'no uncaught browser errors');
  console.log('Browser interaction checks passed.');
} finally {
  if (originalProject !== undefined) {
    await evaluate(`{ const value = ${JSON.stringify(originalProject)}; if (value === null) localStorage.removeItem("titan-workspace-v2"); else localStorage.setItem("titan-workspace-v2", value); }`);
    await send('Page.reload', { ignoreCache: true });
  }
  socket.close();
}
