import { TYPES, parseInventory, autoPlaceFloor, safeManagementUrl, restoreProject, placeAsset, cableRoute, assignRacks, initializePorts, defaultPorts } from './model.js?v=8';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const typeName = type => ({ cabinet: 'Cabinet', switch: 'Switch', router: 'Router', firewall: 'Firewall', access_point: 'Access point', patch_panel: 'Patch panel' })[type] || type;
const typeIcon = type => type === 'access_point' ? 'nodes' : type === 'cabinet' ? 'layers' : 'box';
const uid = () => crypto.randomUUID();
const storageKey = 'network-atlas-project-v1';

const demo = {
  name: 'Northstar Campus', floorName: 'Ground floor', planImage: '', demo: true,
  zones: [
    { id: 'network', name: 'Network room', x: 0, y: 0, w: 36, h: 38 },
    { id: 'office', name: 'Open office', x: 36, y: 0, w: 64, h: 42 },
    { id: 'meeting', name: 'Meeting rooms', x: 0, y: 38, w: 36, h: 62 },
    { id: 'workspace', name: 'Collaboration', x: 36, y: 42, w: 64, h: 58 }
  ],
  assets: [
    { id: 'rack', name: 'RACK-01', type: 'cabinet', zoneId: 'network', model: '42U network cabinet', ip: '', managementUrl: '', x: 14, y: 16, placed: true },
    { id: 'core', name: 'CORE-SW-01', type: 'switch', zoneId: 'network', model: '48-port core switch', ip: '10.20.0.1', managementUrl: 'https://10.20.0.1/', x: 23, y: 16, placed: true },
    { id: 'firewall', name: 'FW-01', type: 'firewall', zoneId: 'network', model: 'Edge firewall', ip: '10.20.0.2', managementUrl: 'https://10.20.0.2/', x: 27, y: 26, placed: true },
    { id: 'switch', name: 'DIST-SW-02', type: 'switch', zoneId: 'office', model: '24-port access switch', ip: '10.20.1.2', managementUrl: '', x: 70, y: 25, placed: true },
    { id: 'ap1', name: 'AP-01', type: 'access_point', zoneId: 'office', model: 'Wireless access point', ip: '10.20.1.11', managementUrl: '', x: 53, y: 27, placed: true },
    { id: 'ap2', name: 'AP-02', type: 'access_point', zoneId: 'meeting', model: 'Wireless access point', ip: '10.20.1.12', managementUrl: '', x: 19, y: 69, placed: true },
    { id: 'ap3', name: 'AP-03', type: 'access_point', zoneId: 'workspace', model: 'Wireless access point', ip: '10.20.1.13', managementUrl: '', x: 72, y: 73, placed: true }
  ],
  cables: [
    { id: 'c1', from: 'core', to: 'firewall' }, { id: 'c2', from: 'core', to: 'switch' },
    { id: 'c3', from: 'switch', to: 'ap1' }, { id: 'c4', from: 'core', to: 'ap2' }, { id: 'c5', from: 'switch', to: 'ap3' }
  ]
};

let project;
try { project = localStorage.getItem(storageKey) ? restoreProject(JSON.parse(localStorage.getItem(storageKey))) : structuredClone(demo); }
catch { project = structuredClone(demo); }
project.assets = initializePorts(assignRacks(project.assets), project.cables);
let rackView = '', rackDevice = '', pendingPort = null;
let selected = { kind: null, id: null };
let view = '3d', rotation = 0, zoom = 1, mode = 'select';
let pan = { x: 0, y: 0 }, pointIndex = null;
let drag = null, ignoreSceneClick = false, inspectorOpen = false;
let toastTimer;

function toast(message, duration = 3500) {
  const element = $('#toast'); element.textContent = message; element.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('visible'), duration);
}
function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(project)); $('#save-status').textContent = 'Saved locally'; return true; }
  catch { $('#save-status').textContent = 'Not saved — export project'; toast('Browser storage is full. Export your project to avoid losing changes.', 8000); return false; }
}
function assetById(id) { return project.assets.find(asset => asset.id === id); }
function selectedAsset() { return selected.kind === 'asset' ? assetById(selected.id) : null; }
function selectedCable() { return selected.kind === 'cable' ? project.cables.find(c => c.id === selected.id) : null; }
function typeOptions(type) { return TYPES.map(value => `<option value="${value}" ${value === type ? 'selected' : ''}>${typeName(value)}</option>`).join(''); }
function setMode(next, message) {
  mode = next;
  $('#hint-text').textContent = message || 'Select or drag equipment';
  $('#cancel-mode').hidden = next === 'select';
  $('#scene').style.cursor = next === 'select' ? 'default' : 'crosshair';
}

function render() {
  $('#sidebar-project').textContent = project.name;
  $('#project-kind').textContent = project.demo ? 'Example project · local' : 'Local project';
  $('#breadcrumb-project').textContent = project.name;
  $('#canvas-subtitle').textContent = `${project.floorName} · ${view === '3d' ? '3D view' : 'Plan view'}`;
  $('#side-asset-count').textContent = String(project.assets.length).padStart(2, '0');
  $('#side-rack-count').textContent = String(project.assets.filter(a => a.type === 'cabinet').length).padStart(2, '0');
  $('#side-cable-count').textContent = String(project.cables.length).padStart(2, '0');
  $('#equipment-count').textContent = project.assets.length;
  $('#asset-cards').innerHTML = project.assets.slice(0, 3).map(asset => `<button class="asset-card ${selected.kind === 'asset' && selected.id === asset.id ? 'active' : ''}" data-asset-select="${esc(asset.id)}"><span class="asset-card-icon">${icon(typeIcon(asset.type))}</span><span class="asset-card-text"><strong>${esc(asset.name)}</strong><small>${esc(typeName(asset.type))}</small></span><span class="asset-card-status" title="${asset.placed ? 'Placed' : 'Unplaced'}"></span></button>`).join('') || '<p class="detail-note">Add equipment or import an inventory to get started.</p>';
  $('#inventory-list').innerHTML = project.assets.map(asset => `<button class="inventory-row" data-asset-select="${esc(asset.id)}"><span class="inventory-asset-icon">${icon(typeIcon(asset.type))}</span><div><strong>${esc(asset.name)}</strong><small>${esc(typeName(asset.type))}</small></div><span class="badge ${asset.placed ? '' : 'gray'}">${asset.placed ? 'Placed' : 'Unplaced'}</span>${icon('chevron')}</button>`).join('') || '<p class="detail-note">No equipment yet. Add an item or import a CSV inventory.</p>';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#zoom-level').textContent = `${Math.round(zoom * 100)}%`;
  renderInspector(); renderScene();
}

function renderInspector() {
  const target = $('#inspector-content'), asset = selectedAsset(), cable = selectedCable();
  $('.inspector').hidden = !inspectorOpen || (!asset && !cable);
  if (asset) {
    const url = safeManagementUrl(asset.managementUrl);
    target.innerHTML = `<div class="inspector-eyebrow">SELECTED EQUIPMENT</div><div class="detail-hero"><span class="detail-icon">${icon(typeIcon(asset.type))}</span><div><h3>${esc(asset.name)}</h3><p>${esc(typeName(asset.type))}</p></div></div><div class="detail-badges"><span class="badge"><i></i>${asset.rackId ? 'In rack' : asset.placed ? 'Placed on plan' : 'Ready to place'}</span></div><div class="detail-divider"></div><div class="detail-heading"><strong>Equipment details</strong><span>EDITABLE</span></div><form id="asset-form"><label class="field"><span>Equipment name</span><input name="name" value="${esc(asset.name)}" required maxlength="80"></label><label class="field"><span>Equipment type</span><select name="type">${typeOptions(asset.type)}</select></label>${asset.type !== 'cabinet' && asset.type !== 'access_point' ? `<label class="field"><span>Cabinet / rack</span><select name="rackId"><option value="">Unassigned</option>${project.assets.filter(a => a.type === 'cabinet').map(a => `<option value="${esc(a.id)}" ${asset.rackId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}<label class="field"><span>Model / description</span><input name="model" value="${esc(asset.model)}" placeholder="e.g. 48-port switch" maxlength="120"></label><label class="field"><span>IP address</span><input name="ip" value="${esc(asset.ip)}" placeholder="e.g. 10.20.0.1" maxlength="80"></label><label class="field"><span>Management URL</span><input name="managementUrl" type="url" value="${esc(asset.managementUrl)}" placeholder="https://" maxlength="500"></label></form><div class="detail-divider"></div><div class="detail-heading"><strong>Actions</strong><span>${project.cables.filter(c => c.from === asset.id || c.to === asset.id).length} CONNECTIONS</span></div><div class="detail-actions">${!asset.rackId ? `<button class="detail-button primary-action" data-action="place-asset">${icon('pin')} ${asset.placed ? 'Move on floor plan' : 'Place on floor plan'}</button>` : ''}${asset.type === 'cabinet' ? `<button class="detail-button" data-rack-open="${esc(asset.id)}">${icon('layers')} Open rack view</button>` : ''}<button class="detail-button" data-action="connect-asset">${icon('link')} Connect to equipment</button>${url ? `<a class="detail-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('external')} Open management interface</a>` : ''}<button class="detail-button danger" data-action="delete-asset">${icon('trash')} Remove equipment</button></div>`;
  } else if (cable) {
    target.innerHTML = `<div class="inspector-eyebrow">SELECTED CABLE</div><h3>${esc(assetById(cable.from)?.name)} → ${esc(assetById(cable.to)?.name)}</h3><p class="detail-note">Click a segment to add a point. Drag points onto the grid, or focus a point and use arrow keys. Delete removes it.</p><div class="detail-actions"><button class="detail-button" data-action="add-point">Add point</button><button class="detail-button" data-action="remove-point" ${pointIndex === null ? 'disabled' : ''}>Remove selected point</button><button class="detail-button" data-action="reset-route">Reset automatic route</button></div>`;
  } else {
    target.innerHTML = `<div class="empty-inspector">${icon('layers')}<h3>Nothing selected</h3><p>Select equipment on the floor plan to see its details.</p></div>`;
  }
}

const round = n => Math.round(n * 100) / 100;
function rotated(x, y) {
  if (rotation === 1) return [100 - y, x];
  if (rotation === 2) return [100 - x, 100 - y];
  if (rotation === 3) return [y, 100 - x];
  return [x, y];
}
function unrotated(x, y) {
  if (rotation === 1) return [y, 100 - x];
  if (rotation === 2) return [100 - x, 100 - y];
  if (rotation === 3) return [100 - y, x];
  return [x, y];
}
function point(x, y, z = 0) {
  const [a, b] = rotated(x, y);
  return view === '3d' ? [500 + (a - b) * 3.25, 138 + (a + b) * 1.48 - z * 2.3] : [180 + a * 6.4, 65 + b * 4.7];
}
function points(coords) { return coords.map(([x, y, z = 0]) => point(x, y, z).map(round).join(',')).join(' '); }
function poly(coords, fill, extra = '') { return `<polygon points="${points(coords)}" fill="${fill}" ${extra}/>`; }
function box(x, y, w, d, h, colors, extra = '') {
  if (view === 'plan') return poly([[x,y],[x+w,y],[x+w,y+d],[x,y+d]], colors[0], extra);
  return `<g ${extra}>${poly([[x+w,y,0],[x+w,y+d,0],[x+w,y+d,h],[x+w,y,h]], colors[1])}${poly([[x,y+d,0],[x+w,y+d,0],[x+w,y+d,h],[x,y+d,h]], colors[2])}${poly([[x,y,h],[x+w,y,h],[x+w,y+d,h],[x,y+d,h]], colors[0], 'stroke="#ffffff" stroke-opacity=".35" stroke-width=".8"')}</g>`;
}
function svgText(x, y, value, opts = '') { return `<text class="scene-text" x="${round(x)}" y="${round(y)}" ${opts}>${esc(value)}</text>`; }
function demoFurniture() {
  if (!project.demo) return '';
  const desk = (x,y,w=10,d=5) => box(x,y,w,d,1.5,['#f4f0e6','#d9ded4','#d2d9cf']);
  const seat = (x,y) => box(x,y,3,3,1.6,['#d7e4d9','#becfc0','#c9d9cb']);
  let out = '';
  for (const [x,y] of [[47,8],[66,8],[47,21],[66,21],[45,53],[62,53],[78,53],[45,76],[62,76]]) out += desk(x,y,9,5) + seat(x+3,y+7);
  out += desk(9,52,15,8) + seat(8,62) + seat(15,62) + seat(22,62);
  out += desk(10,84,14,7) + seat(10,93) + seat(19,93);
  return out;
}
function demoWalls() {
  if (!project.demo || view !== '3d') return '';
  const c = ['#f7faf6','#ccd9ce','#d9e5da'];
  return box(0,0,100,1.2,13,c) + box(0,0,1.2,100,13,c) + box(35,0,1.2,16,12,c) + box(35,25,1.2,32,12,c) + box(35,68,1.2,32,12,c) + box(0,37,18,1.2,12,c) + box(27,37,9,1.2,12,c) + box(36,41,25,1.2,11,c) + box(72,41,28,1.2,11,c);
}
function assetShape(asset) {
  const isSelected = selected.kind === 'asset' && selected.id === asset.id;
  const size = asset.type === 'cabinet' ? 6.8 : asset.type === 'access_point' ? 4 : 5.2;
  const height = asset.type === 'cabinet' ? 18 : asset.type === 'access_point' ? 2.3 : 4.5;
  const colors = isSelected ? ['#79b995','#3a785d','#4b8a6c'] : asset.type === 'cabinet' ? ['#6c9280','#496b5b','#547965'] : ['#a6c9b1','#6f9b7e','#83af90'];
  const [sx, sy] = point(asset.x, asset.y, height);
  let graphic = box(asset.x-size/2, asset.y-size/2, size, size, height, colors);
  if (asset.type === 'cabinet' && view === '3d') {
    for (let i = 0; i < 4; i++) {
      const line = [[asset.x-size/2+0.7,asset.y+size/2,3+i*3],[asset.x+size/2-0.7,asset.y+size/2,3+i*3]].map(p => point(...p).map(round).join(',')).join(' ');
      graphic += `<polyline points="${line}" fill="none" stroke="#9ab9a4" stroke-width="1.2" opacity=".8"/>`;
    }
  }
  graphic += `<circle cx="${round(sx)}" cy="${round(sy-4)}" r="${isSelected ? 5 : 3.8}" fill="#ffffff" stroke="${isSelected ? '#448c69' : '#83b89a'}" stroke-width="2"/><circle cx="${round(sx)}" cy="${round(sy-4)}" r="1.5" fill="#4c9470"/>`;
  if (isSelected) {
    const label = asset.name.length > 20 ? asset.name.slice(0, 19) + '…' : asset.name;
    const width = Math.max(94, label.length * 6.2 + 24);
    graphic += `<line x1="${round(sx)}" y1="${round(sy-10)}" x2="${round(sx)}" y2="${round(sy-27)}" stroke="#78a98a" stroke-width="1.3"/><rect x="${round(sx-width/2)}" y="${round(sy-49)}" width="${round(width)}" height="22" rx="5" fill="#fff" stroke="#d9e8da" filter="url(#tagShadow)"/>${svgText(sx, sy-35, label, 'text-anchor="middle" font-size="9" font-weight="700" fill="#426e55"')}`;
  } else graphic += svgText(sx + 8, sy - 7, asset.name, 'font-size="8" font-weight="700" fill="#557d65" stroke="#f7faf6" stroke-width="3" paint-order="stroke"');
  return `<g class="asset-shape" data-asset="${esc(asset.id)}" tabindex="0" role="button" aria-label="${esc(asset.name)}"><title>${esc(asset.name)} · ${esc(typeName(asset.type))}</title>${graphic}</g>`;
}
function renderScene() {
  const scene = $('#scene');
  const width = 900 / zoom, height = 500 / zoom;
  scene.setAttribute('viewBox', `${500-width/2 + pan.x} ${285-height/2 + pan.y} ${width} ${height}`);
  const floor = [[0,0],[100,0],[100,100],[0,100]];
  const p00 = point(0,0), p10 = point(100,0), p01 = point(0,100);
  const matrix = `${round((p10[0]-p00[0])/100)} ${round((p10[1]-p00[1])/100)} ${round((p01[0]-p00[0])/100)} ${round((p01[1]-p00[1])/100)} ${round(p00[0])} ${round(p00[1])}`;
  let out = `<defs><filter id="floorShadow" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="12"/></filter><filter id="tagShadow" x="-30%" y="-50%" width="160%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#355b42" flood-opacity=".12"/></filter><clipPath id="floorClip">${poly(floor, '#fff')}</clipPath></defs>`;
  if (view === '3d') {
    const shadow = floor.map(([x,y]) => { const [a,b] = point(x,y); return `${round(a+8)},${round(b+20)}`; }).join(' ');
    out += `<polygon points="${shadow}" fill="#829c86" opacity=".14" filter="url(#floorShadow)"/>`;
    const ground = floor.map(([x,y]) => point(x,y));
    out += `<polygon points="${ground[1].map(round).join(',')} ${ground[2].map(round).join(',')} ${round(ground[2][0])},${round(ground[2][1]+13)} ${round(ground[1][0])},${round(ground[1][1]+13)}" fill="#c8d7c8"/><polygon points="${ground[2].map(round).join(',')} ${ground[3].map(round).join(',')} ${round(ground[3][0])},${round(ground[3][1]+13)} ${round(ground[2][0])},${round(ground[2][1]+13)}" fill="#d4e1d2"/>`;
  }
  out += poly(floor, '#f1f5ed', 'stroke="#b9cbbb" stroke-width="1.5" data-floor="true"');
  if (project.planImage) out += `<image href="${esc(project.planImage)}" x="0" y="0" width="100" height="100" preserveAspectRatio="none" transform="matrix(${matrix})" opacity=".8" pointer-events="none"/>`;
  out += demoFurniture() + demoWalls();
  const editing = selectedCable();
  if (editing) {
    out += '<g class="route-editor" pointer-events="none">';
    for (let x = 0; x <= 100; x += 5) for (let y = 0; y <= 100; y += 5) {
      const [px, py] = point(x, y); out += `<circle cx="${round(px)}" cy="${round(py)}" r="1.5" fill="#688f78" opacity=".55"/>`;
    }
    out += '</g>';
  }
  for (const cable of project.cables) {
    const from = assetById(cable.from), to = assetById(cable.to);
    const a = assetById(from?.rackId) || from, b = assetById(to?.rackId) || to;
    if (!a?.placed || !b?.placed || a.id === b.id) continue;
    const fixed = [a, ...(cable.waypoints || []), b];
    const path = points(cableRoute(a, cable.waypoints || [], b));
    out += `<polyline data-cable="${esc(cable.id)}" tabindex="0" role="button" aria-label="Cable ${esc(a.name)} to ${esc(b.name)}" points="${path}" fill="none" stroke="${cable === editing ? '#b3742f' : esc(cable.color || '#d9a667')}" stroke-width="${cable === editing ? 3 : 2.1}" stroke-linejoin="round" stroke-linecap="round"/>`;
    fixed.slice(1).forEach((next, i) => {
      const segment = points(cableRoute(fixed[i], [], next));
      out += `<polyline class="route-hit" data-cable-hit="${esc(cable.id)}" data-segment="${i}" points="${segment}" fill="none" stroke="transparent" stroke-width="16"/>`;
    });
  }
  out += project.assets.filter(a => a.placed && !a.rackId).sort((a,b) => { const [ax,ay] = rotated(a.x,a.y), [bx,by] = rotated(b.x,b.y); return ax+ay-bx-by; }).map(assetShape).join('');
  if (editing) (editing.waypoints || []).forEach((p, i) => { const [x,y] = point(p.x,p.y); out += `<circle class="route-handle route-editor" data-point="${i}" tabindex="0" role="button" aria-label="Cable point ${i + 1}, x ${p.x}, y ${p.y}" cx="${round(x)}" cy="${round(y)}" r="${i === pointIndex ? 7 : 5}" fill="#fff" stroke="#a66524" stroke-width="2"/>`; });
  scene.innerHTML = out;
}

function closeDialogs() { pendingPort = null; document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); }
function showConnections() {
  $('#connection-list').innerHTML = project.cables.map(cable => `<div class="inventory-row"><span class="inventory-asset-icon">${icon('link')}</span><div><button class="cable-select" data-cable-select="${esc(cable.id)}"><strong>${esc(assetById(cable.from)?.name || 'Unknown')} → ${esc(assetById(cable.to)?.name || 'Unknown')}</strong><small>Edit cable route</small></button></div><button class="tool-button" data-remove-cable="${esc(cable.id)}" title="Remove cable" aria-label="Remove cable">${icon('trash')}</button></div>`).join('') || '<p class="detail-note">There are no cables in this project yet.</p>';
  closeDialogs(); $('#connections-dialog').showModal();
}
function drawRackCables() {
  const frame = $('.rack-frame'), svg = $('#rack-cables');
  if (!frame || !svg) return;
  const rect = svg.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  svg.innerHTML = project.cables.map(c => {
    const nodes = [...frame.querySelectorAll('[data-port-device]')];
    const a = nodes.find(n => n.dataset.portDevice === c.from && n.dataset.portName === c.fromPort);
    const b = nodes.find(n => n.dataset.portDevice === c.to && n.dataset.portName === c.toPort);
    if (!a || !b) return '';
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
    const x1 = ar.left + ar.width / 2 - rect.left, y1 = ar.top + ar.height / 2 - rect.top;
    const x2 = br.left + br.width / 2 - rect.left, y2 = br.top + br.height / 2 - rect.top;
    return `<path d="M ${x1} ${y1} C ${x1} ${(y1+y2)/2}, ${x2} ${(y1+y2)/2}, ${x2} ${y2}" stroke="${esc(c.color || '#d9a667')}" stroke-width="3"><title>${esc(c.label || 'Connection')}: ${esc(c.fromPort)} → ${esc(c.toPort)}</title></path>`;
  }).join('');
}
function portColor(assetId, portName) {
  const cable = project.cables.find(c => (c.from === assetId && c.fromPort === portName) || (c.to === assetId && c.toPort === portName));
  if (!cable) return '';
  const color = /^#[0-9a-f]{6}$/i.test(cable.color) ? cable.color : '#d9a667';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const ink = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000' : '#fff';
  return ` style="--port-color:${color};--port-ink:${ink}"`;
}
function rackColorControl(deviceId, portName) {
  const cable = project.cables.find(c => (c.from === deviceId && c.fromPort === portName) || (c.to === deviceId && c.toPort === portName));
  if (!cable) return '';
  const color = /^#[0-9a-f]{6}$/i.test(cable.color) ? cable.color : '#d9a667';
  return `<label class="field rack-color"><span>Connection colour</span><input type="color" id="connection-color" data-cable-id="${esc(cable.id)}" data-device-id="${esc(deviceId)}" data-port-name="${esc(portName)}" value="${color}"></label>`;
}
function showRacks(id = '', deviceId = '', portName = '') {
  if (rackView !== id) pendingPort = null;
  rackView = id; rackDevice = deviceId;
  initializePorts(project.assets, project.cables);
  const rack = assetById(id);
  $('#rack-title').textContent = rack?.name || 'Racks';
  $('#rack-description').textContent = rack ? 'Double-click a free port to connect it, or a connected port to remove its connection.' : 'Choose a rack to see its devices.';
  const content = $('#rack-content');
  if (!rack) {
    content.innerHTML = project.assets.filter(a => a.type === 'cabinet').map(a => `<button class="inventory-row" data-rack-open="${esc(a.id)}"><span class="inventory-asset-icon">${icon('layers')}</span><div><strong>${esc(a.name)}</strong><small>${project.assets.filter(d => d.rackId === a.id).length} devices</small></div>${icon('chevron')}</button>`).join('') || '<p class="detail-note">Add a cabinet to get started.</p>';
  } else {
    const devices = project.assets.filter(a => a.rackId === rack.id);
    content.innerHTML = `<button class="text-button" data-rack-open="">← All racks</button><p class="rack-connect-hint" role="status">${pendingPort ? `Selected ${esc(assetById(pendingPort.device)?.name)} · ${esc(pendingPort.port)}. Choose a destination below or double-click another port. <button class="text-button" data-action="cancel-port">Cancel</button>` : 'Double-click a free port to connect it, or a connected port to remove its connection. Keyboard: focus a port and press Enter.'}</p><div class="rack-frame"><svg id="rack-cables" aria-hidden="true"></svg>${devices.map(a => `<div class="rack-panel rack-${esc(a.type)} ${a.id === deviceId ? 'active' : ''}"><div class="rack-bezel"><span class="rack-brand">${a.type === 'switch' ? 'FORTISWITCH' : a.type === 'firewall' ? 'FORTIGATE' : esc(typeName(a.type).toUpperCase())}</span><span class="rack-leds" aria-hidden="true">● ● ●</span><button class="rack-device-name" data-rack-device="${esc(a.id)}"><strong>${esc(a.name)}</strong><small>${esc(a.model || typeName(a.type))}</small></button></div><div class="panel-ports">${a.ports.map(p => `<button class="rack-port ${pendingPort?.device === a.id && pendingPort.port === p.name ? 'armed' : ''} ${a.id === deviceId && p.name === portName ? 'active' : ''} ${project.cables.some(c => (c.from === a.id && c.fromPort === p.name) || (c.to === a.id && c.toPort === p.name)) ? 'connected' : ''}" ${portColor(a.id, p.name)} data-port-device="${esc(a.id)}" data-port-name="${esc(p.name)}" title="${esc(p.name)} · ${esc(p.speed)}" aria-label="${esc(a.name)}, port ${esc(p.name)}, ${esc(p.speed)}">${esc(p.name)}</button>`).join('')}</div></div>`).join('') || '<p class="detail-note">No devices assigned to this rack.</p>'}</div><div class="rack-controls">${pendingPort ? `<label class="field rack-color"><span>Connection colour</span><input type="color" id="connection-color" value="${esc(pendingPort.color || '#d9a667')}"></label><label class="field"><span>Connect ${esc(assetById(pendingPort.device)?.name)} · ${esc(pendingPort.port)} to</span><select id="connect-to"><option value="">Choose a device and port</option>${project.assets.filter(a => a.id !== pendingPort.device && a.type !== 'cabinet').map(a => a.ports.filter(p => !project.cables.some(c => (c.from === a.id && c.fromPort?.toLowerCase() === p.name.toLowerCase()) || (c.to === a.id && c.toPort?.toLowerCase() === p.name.toLowerCase()))).map(p => `<option value="${esc(JSON.stringify([a.id, p.name]))}">${esc(a.name)} · ${esc(p.name)}</option>`).join('')).join('')}</select></label>` : rackColorControl(deviceId, portName)}</div>`;
  }
  if (!$('#rack-dialog').open) { closeDialogs(); $('#rack-dialog').showModal(); }
  requestAnimationFrame(drawRackCables);
}
function chooseAsset(id) {
  selected = { kind: 'asset', id }; inspectorOpen = true; setMode('select'); closeDialogs(); render();
  if (assetById(id)?.type === 'cabinet') showRacks(id);
}
function chooseCable(id) { selected = { kind: 'cable', id }; pointIndex = null; inspectorOpen = true; setMode('select'); closeDialogs(); render(); }
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function projectFilename() { return project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'network-atlas'; }
function worldFromEvent(event) {
  const svg = $('#scene'), pt = svg.createSVGPoint(); pt.x = event.clientX; pt.y = event.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  let x, y;
  if (view === '3d') { const a = (p.x - 500) / 3.25, b = (p.y - 138) / 1.48; x = (a + b) / 2; y = (b - a) / 2; }
  else { x = (p.x - 180) / 6.4; y = (p.y - 65) / 4.7; }
  [x, y] = unrotated(x, y);
  return [x, y];
}
function worldAt(event) {
  const [x, y] = worldFromEvent(event);
  return x >= 0 && x <= 100 && y >= 0 && y <= 100 ? [round(x), round(y)] : null;
}
function handleSceneClick(event) {
  if (ignoreSceneClick) { ignoreSceneClick = false; return; }
  const assetNode = event.target.closest('[data-asset]');
  if (mode === 'connect') {
    const from = selectedAsset(), to = assetNode && assetById(assetNode.dataset.asset);
    if (!to || to.id === from?.id) { toast('Select a different placed equipment item.'); return; }
    if (project.cables.some(c => (c.from === from.id && c.to === to.id) || (c.from === to.id && c.to === from.id))) { toast('These items are already connected.'); return; }
    project.cables.push({ id: uid(), from: from.id, to: to.id, waypoints: [] }); save(); inspectorOpen = true; setMode('select'); render(); toast(`Connected ${from.name} to ${to.name}.`); return;
  }
  if (mode === 'place') {
    const location = worldAt(event), asset = selectedAsset();
    if (!location || !asset) { toast('Choose a point inside the floor plan.'); return; }
    Object.assign(asset, { ...placeAsset(asset, [], ...location), zoneId: asset.zoneId });
    save(); inspectorOpen = true; setMode('select'); render(); toast(`${asset.name} placed on the floor plan.`); return;
  }
  const cableNode = event.target.closest('[data-cable], [data-cable-hit]');
  if (cableNode) { chooseCable(cableNode.dataset.cable || cableNode.dataset.cableHit); return; }
  if (assetNode) chooseAsset(assetNode.dataset.asset);
}

$('#scene').addEventListener('click', handleSceneClick);
const pointers = new Map();
function svgPosition(x, y) {
  const svg = $('#scene'), p = svg.createSVGPoint(); p.x = x; p.y = y;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}
function snap(event) { const [x,y] = worldFromEvent(event); return { x: Math.max(0, Math.min(100, Math.round(x / 5) * 5)), y: Math.max(0, Math.min(100, Math.round(y / 5) * 5)) }; }
function cancelDrag() {
  if (!drag) return;
  if (drag.kind === 'asset') Object.assign(assetById(drag.id), drag.original);
  if (drag.kind === 'point') { const cable = project.cables.find(c => c.id === drag.id); cable.waypoints = drag.original; if (drag.inserted) pointIndex = null; }
  if (drag.kind === 'pan') pan = drag.original;
  drag = null; $('#scene').classList.remove('dragging'); renderScene();
}
function zoomAt(value, x, y) {
  const before = svgPosition(x, y); zoom = Math.max(.6, Math.min(1.8, value)); renderScene();
  const after = svgPosition(x, y); pan.x += before.x - after.x; pan.y += before.y - after.y; render();
}
$('#scene').addEventListener('wheel', event => { if (event.ctrlKey || event.metaKey) return; event.preventDefault(); zoomAt(zoom * Math.exp(-event.deltaY * .001), event.clientX, event.clientY); }, { passive: false });
$('#scene').addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  $('#scene').setPointerCapture(event.pointerId);
  if (pointers.size === 2) {
    cancelDrag(); const [a,b] = [...pointers.values()];
    drag = { kind: 'pinch', distance: Math.hypot(a.x-b.x,a.y-b.y), zoom, center: [(a.x+b.x)/2,(a.y+b.y)/2] };
    return;
  }
  if (mode !== 'select') return;
  const node = event.target.closest('[data-asset]'), asset = node && assetById(node.dataset.asset);
  const handle = event.target.closest('[data-point]'), hit = event.target.closest('[data-cable-hit]');
  const base = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, moved: false };
  if (handle && selectedCable()) {
    pointIndex = Number(handle.dataset.point);
    drag = { ...base, kind: 'point', id: selected.id, original: structuredClone(selectedCable().waypoints || []) };
  } else if (hit && selectedCable()?.id === hit.dataset.cableHit) {
    const cable = selectedCable(), original = structuredClone(cable.waypoints || []);
    pointIndex = Number(hit.dataset.segment); cable.waypoints ||= []; cable.waypoints.splice(pointIndex, 0, snap(event));
    drag = { ...base, kind: 'point', id: cable.id, original, inserted: true }; renderScene();
  } else if (hit) {
    drag = { ...base, kind: 'cable', id: hit.dataset.cableHit };
  } else if (asset?.placed) {
    drag = { ...base, kind: 'asset', id: asset.id, start: worldFromEvent(event), original: { ...asset } };
  } else if (!hit && !event.target.closest('[data-cable]')) {
    drag = { ...base, kind: 'pan', target: event.target, start: svgPosition(event.clientX,event.clientY), original: { ...pan } };
  }
});
$('#scene').addEventListener('pointermove', event => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (drag?.kind === 'pinch' && pointers.size >= 2) {
    const [a,b] = [...pointers.values()], center = [(a.x+b.x)/2,(a.y+b.y)/2];
    const before = svgPosition(...drag.center), after = svgPosition(...center); pan.x += before.x-after.x; pan.y += before.y-after.y;
    renderScene(); zoomAt(drag.zoom * Math.hypot(a.x-b.x,a.y-b.y) / drag.distance, ...center); drag.center = center; return;
  }
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.moved && Math.hypot(event.clientX-drag.clientX,event.clientY-drag.clientY) < 4) return;
  drag.moved = true; $('#scene').classList.add('dragging');
  if (drag.kind === 'asset') { const [x,y] = worldFromEvent(event), asset = assetById(drag.id); Object.assign(asset, { ...placeAsset(asset, [], drag.original.x+x-drag.start[0], drag.original.y+y-drag.start[1]), zoneId: drag.original.zoneId }); }
  if (drag.kind === 'point') selectedCable().waypoints[pointIndex] = snap(event);
  if (drag.kind === 'pan') { const p = svgPosition(event.clientX,event.clientY); pan.x += drag.start.x-p.x; pan.y += drag.start.y-p.y; }
  renderScene();
});
$('#scene').addEventListener('pointerup', event => {
  pointers.delete(event.pointerId);
  if (drag?.kind === 'pinch') { drag = null; ignoreSceneClick = true; setTimeout(() => { ignoreSceneClick = false; }, 0); return; }
  if (!drag || event.pointerId !== drag.pointerId) return;
  const done = drag; drag = null; $('#scene').classList.remove('dragging');
  if (done.kind === 'asset') { ignoreSceneClick = true; setTimeout(() => { ignoreSceneClick = false; }, 0); if (done.moved) save(); chooseAsset(done.id); }
  else if (done.kind === 'point') { ignoreSceneClick = true; setTimeout(() => { ignoreSceneClick = false; }, 0); if (done.moved || done.inserted) save(); render(); }
  else if (done.kind === 'cable') { ignoreSceneClick = true; setTimeout(() => { ignoreSceneClick = false; }, 0); chooseCable(done.id); }
  else if (done.kind === 'pan') { ignoreSceneClick = true; setTimeout(() => { ignoreSceneClick = false; }, 0); if (!done.moved) { ignoreSceneClick = false; handleSceneClick({ target: done.target, clientX: event.clientX, clientY: event.clientY }); ignoreSceneClick = true; } }
});
$('#scene').addEventListener('pointercancel', event => { pointers.delete(event.pointerId); cancelDrag(); });
$('#scene').addEventListener('keydown', event => {
  const handle = event.target.closest('[data-point]'), cable = selectedCable();
  if (handle && cable) {
    pointIndex = Number(handle.dataset.point);
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
      const p = cable.waypoints[pointIndex], dx = event.key === 'ArrowLeft' ? -5 : event.key === 'ArrowRight' ? 5 : 0, dy = event.key === 'ArrowUp' ? -5 : event.key === 'ArrowDown' ? 5 : 0;
      p.x = Math.max(0,Math.min(100,p.x+dx)); p.y = Math.max(0,Math.min(100,p.y+dy)); save(); render(); $('#scene [data-point="'+pointIndex+'"]').focus(); event.preventDefault(); return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') { cable.waypoints.splice(pointIndex,1); pointIndex = null; save(); render(); event.preventDefault(); return; }
  }
  if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('[data-asset], [data-cable]')) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});

function connectRackPort(device, port) {
  const source = pendingPort && assetById(pendingPort.device), target = assetById(device);
  const free = (id, name) => !project.cables.some(c => (c.from === id && c.fromPort?.toLowerCase() === name.toLowerCase()) || (c.to === id && c.toPort?.toLowerCase() === name.toLowerCase()));
  if (!source || !target || source.id === target.id || !source.ports.some(p => p.name === pendingPort.port) || !target.ports.some(p => p.name === port) || !free(source.id, pendingPort.port) || !free(device, port)) { toast('Choose a free port on a different device.'); return; }
  project.cables.push({ id: uid(), from: source.id, fromPort: pendingPort.port, to: device, toPort: port, waypoints: [], label: '', color: pendingPort.color || '#d9a667' });
  pendingPort = null; save(); render(); showRacks(rackView, device, port); toast('Ports connected.');
}
function selectRackPort(button) {
  const device = button.dataset.portDevice, port = button.dataset.portName;
  const cable = project.cables.find(c => (c.from === device && c.fromPort?.toLowerCase() === port.toLowerCase()) || (c.to === device && c.toPort?.toLowerCase() === port.toLowerCase()));
  if (cable) { project.cables = project.cables.filter(c => c !== cable); pendingPort = null; save(); render(); showRacks(rackView, device, port); toast('Connection removed.'); return; }
  if (!pendingPort) { pendingPort = { device, port }; showRacks(rackView, device, port); return; }
  if (pendingPort.device === device && pendingPort.port === port) { pendingPort = null; showRacks(rackView, device, port); return; }
  connectRackPort(device, port);
}
document.addEventListener('focusin', event => {
  const port = event.target.closest('[data-port-device]');
  if (port && !pendingPort) $('.rack-controls').innerHTML = rackColorControl(port.dataset.portDevice, port.dataset.portName);
});
document.addEventListener('dblclick', event => {
  const port = event.target.closest('[data-port-device]');
  if (port) { event.preventDefault(); selectRackPort(port); }
});

document.addEventListener('click', event => {
  const rackButton = event.target.closest('[data-rack-open]');
  if (rackButton) { showRacks(rackButton.dataset.rackOpen); return; }
  const portButton = event.target.closest('[data-port-device]');
  if (portButton) { if (event.detail === 0) selectRackPort(portButton); else if (!pendingPort) $('.rack-controls').innerHTML = rackColorControl(portButton.dataset.portDevice, portButton.dataset.portName); return; }
  const rackDeviceButton = event.target.closest('[data-rack-device]');
  if (rackDeviceButton) { showRacks(rackView, rackDeviceButton.dataset.rackDevice); return; }
  const cableButton = event.target.closest('[data-cable-select]');
  if (cableButton) { chooseCable(cableButton.dataset.cableSelect); return; }
  const assetButton = event.target.closest('[data-asset-select]');
  if (assetButton) { chooseAsset(assetButton.dataset.assetSelect); return; }
  const removeCable = event.target.closest('[data-remove-cable]');
  if (removeCable) { project.cables = project.cables.filter(c => c.id !== removeCable.dataset.removeCable); save(); render(); showConnections(); toast('Connection removed.'); return; }
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) { view = viewButton.dataset.view; render(); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) { if (!event.target.closest('#project-menu')) $('#project-menu').hidden = true; return; }
  if (action !== 'project-menu') $('#project-menu').hidden = true;
  const asset = selectedAsset();
  switch (action) {
    case 'project-menu': $('#project-menu').hidden = !$('#project-menu').hidden; break;
    case 'focus-canvas': $('#canvas-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
    case 'inventory': closeDialogs(); $('#inventory-dialog').showModal(); break;
    case 'cancel-port': pendingPort = null; showRacks(rackView, rackDevice); break;
    case 'show-racks': showRacks(); break;
    case 'show-connections': showConnections(); break;
    case 'close-dialog': closeDialogs(); break;
    case 'close-inspector': selected = { kind: null, id: null }; inspectorOpen = false; setMode('select'); render(); break;
    case 'import-csv': $('#inventory-file').click(); break;
    case 'upload-plan': $('#plan-file').click(); break;
    case 'import-project': $('#project-file').click(); break;
    case 'cancel-mode': inspectorOpen = !!selected.id; setMode('select'); renderInspector(); break;
    case 'add-asset': {
      const added = { id: uid(), name: 'New equipment', type: 'switch', zoneId: '', model: '', ip: '', managementUrl: '', placed: false };
      project.assets.push(added); project.assets = assignRacks(project.assets); selected = { kind: 'asset', id: added.id }; inspectorOpen = true; closeDialogs(); save(); setMode('select'); render(); toast('Equipment added. Edit its details and place it on the plan.'); break;
    }
    case 'place-asset': if (asset) { inspectorOpen = false; renderInspector(); setMode('place', `Choose a position for ${asset.name}`); $('#canvas-card').scrollIntoView({ behavior: 'smooth', block: 'center' }); } break;
    case 'connect-asset':
      if (!asset?.placed) toast('Place this equipment on the plan first.');
      else { inspectorOpen = false; renderInspector(); setMode('connect', `Select equipment to connect to ${asset.name}`); $('#canvas-card').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      break;
    case 'delete-asset':
      if (asset && confirm(`Remove ${asset.name} and its connections?`)) { project.assets = project.assets.filter(a => a.id !== asset.id); project.cables = project.cables.filter(c => c.from !== asset.id && c.to !== asset.id); project.assets.forEach(a => { if (a.rackId === asset.id) a.rackId = ''; }); selected = { kind: null, id: null }; save(); setMode('select'); render(); toast('Equipment removed.'); }
      break;
    case 'auto-place': {
      const before = project.assets.filter(a => a.placed).length;
      project.assets = autoPlaceFloor(project.assets);
      const count = project.assets.filter(a => a.placed).length - before;
      save(); render(); toast(count ? `Placed ${count} equipment item${count === 1 ? '' : 's'} on the floor plan.` : 'All floor equipment is already placed.'); break;
    }
    case 'add-point': { const cable = selectedCable(); if (cable) { const from = assetById(cable.from), to = assetById(cable.to), a = assetById(from?.rackId) || from, b = assetById(to?.rackId) || to; if (!a?.placed || !b?.placed || a.id === b.id) { toast('Place both ends on the floor plan to edit this route.'); break; } cable.waypoints ||= []; cable.waypoints.push({ x: Math.round((a.x+b.x)/10)*5, y: Math.round((a.y+b.y)/10)*5 }); pointIndex = cable.waypoints.length-1; save(); render(); $('#scene [data-point="'+pointIndex+'"]').focus(); } break; }
    case 'remove-point': { const cable = selectedCable(); if (cable && pointIndex !== null) { cable.waypoints.splice(pointIndex,1); pointIndex = null; save(); render(); } break; }
    case 'reset-route': { const cable = selectedCable(); if (cable) { cable.waypoints = []; pointIndex = null; save(); render(); } break; }
    case 'rotate': rotation = (rotation + 1) % 4; render(); break;
    case 'zoom-in': zoom = Math.min(1.8, round(zoom + .2)); render(); break;
    case 'zoom-out': zoom = Math.max(.6, round(zoom - .2)); render(); break;
    case 'reset-view': rotation = 0; zoom = 1; pan = { x: 0, y: 0 }; render(); break;
    case 'export-project': download(`${projectFilename()}.json`, JSON.stringify(project, null, 2), 'application/json'); toast('Project exported.'); break;
    case 'export-svg': {
      const copy = $('#scene').cloneNode(true); copy.querySelectorAll('.route-editor, .route-hit').forEach(node => node.remove()); copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); copy.setAttribute('font-family', 'Inter, Arial, sans-serif');
      download(`${projectFilename()}-floor-plan.svg`, new XMLSerializer().serializeToString(copy), 'image/svg+xml'); toast('Diagram exported as SVG.'); break;
    }
    case 'rename-project': {
      const name = prompt('Project name', project.name)?.trim();
      if (name) { project.name = name.slice(0, 80); save(); render(); }
      break;
    }
    case 'new-project':
      if (confirm('Start a blank project? Export the current project first if you want to keep a backup.')) {
        project = { name: 'Untitled project', floorName: 'Ground floor', planImage: '', demo: false, zones: [], assets: [], cables: [] };
        selected = { kind: 'asset', id: null }; rotation = 0; zoom = 1; pan = { x: 0, y: 0 }; setMode('select'); save(); render(); toast('Blank project created. Upload a floor plan and add equipment.');
      }
      break;
  }
});

document.addEventListener('change', event => {
  const field = event.target, asset = selectedAsset();
  if (field.id === 'connection-color') {
    if (pendingPort && !field.dataset.cableId) pendingPort.color = field.value;
    else { const cable = project.cables.find(c => c.id === field.dataset.cableId); if (cable) { cable.color = field.value; save(); showRacks(rackView, field.dataset.deviceId, field.dataset.portName); render(); } }
    return;
  }
  if (field.id === 'connect-to' && field.value) { const [device, port] = JSON.parse(field.value); connectRackPort(device, port); return; }
  if (field.closest('#asset-form') && asset) {
    const key = field.name, value = field.value.trim();
    if (key === 'name' && !value) { toast('Equipment name cannot be empty.'); render(); return; }
    if (key === 'managementUrl' && value && !safeManagementUrl(value)) { toast('Use a complete http:// or https:// management URL.'); render(); return; }
    if (key === 'type' && !TYPES.includes(value)) return;
    const defaultLayout = key === 'type' && JSON.stringify(asset.ports) === JSON.stringify(defaultPorts(asset.type));
    asset[key] = key === 'managementUrl' ? safeManagementUrl(value) : value;
    if (defaultLayout) { asset.ports = defaultPorts(value); initializePorts([asset], project.cables); }
    if (key === 'type') {
      if (asset.type !== 'cabinet') { project.assets.forEach(a => { if (a.rackId === asset.id) a.rackId = ''; }); delete asset.rackId; }
      else project.assets.forEach(a => { if (!a.rackId) delete a.rackId; });
      project.assets = assignRacks(project.assets);
    }
    save(); render();
  }

});

$('#inventory-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('Inventory CSV must be smaller than 2 MB.');
    const result = parseInventory(await file.text(), project.zones, false);
    project.assets.push(...result.assets); if (result.assets.some(a => a.type === 'cabinet')) project.assets.forEach(a => { if (!a.rackId) delete a.rackId; }); project.assets = assignRacks(project.assets); save(); render();
    toast(`Imported ${result.assets.length} equipment item${result.assets.length === 1 ? '' : 's'}.`);
    if (result.errors.length) alert(`Inventory notes:\n\n${result.errors.slice(0, 30).join('\n')}${result.errors.length > 30 ? `\n…and ${result.errors.length - 30} more.` : ''}`);
  } catch (error) { alert(error.message); }
  event.target.value = '';
});
$('#plan-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP floor plan.');
    if (file.size > 2_000_000) throw new Error('Floor plan must be smaller than 2 MB for browser storage.');
    const image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read the floor plan.')); reader.readAsDataURL(file); });
    project.planImage = image; project.demo = false; save(); render(); toast('Floor plan uploaded.');
  } catch (error) { alert(error.message); }
  event.target.value = '';
});
$('#project-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error('Project file must be smaller than 5 MB.');
    const imported = restoreProject(JSON.parse(await file.text()));
    if (confirm('Replace the current project with this file? Export the current project first if you need a backup.')) {
      project = imported; selected = { kind: null, id: null }; rotation = 0; zoom = 1; pan = { x: 0, y: 0 }; setMode('select'); save(); render(); toast('Project imported.');
    }
  } catch (error) { alert(`Could not import project: ${error.message}`); }
  event.target.value = '';
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (drag) { cancelDrag(); pointers.clear(); return; }
  if (mode !== 'select') { inspectorOpen = !!selected.id; setMode('select'); renderInspector(); }
  else if (!$('.inspector').hidden) { selected = { kind: null, id: null }; inspectorOpen = false; render(); }
});
render();

window.addEventListener('resize', drawRackCables);

$('#rack-dialog').addEventListener('close', () => { pendingPort = null; });
