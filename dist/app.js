import { rackUI, portUI } from './rack.js';
import { canAssignRack, TYPES, parseInventory, autoPlace, safeManagementUrl, restoreProject, placeAsset } from './model.js?v=3';

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
let selected = { kind: null, id: null };
let view = '3d', rotation = 0, zoom = 1, panX = 0, panY = 0, mode = 'select', zoneStart = null;
const touches = new Map();
let pan = null, pinch = null;
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
function zoneFor(asset) { return project.zones.find(zone => zone.id === asset.zoneId); }
function assetById(id) { return project.assets.find(asset => asset.id === id); }
function selectedAsset() { return selected.kind === 'asset' ? assetById(selected.id) : null; }
function currentZone() { return selected.kind === 'zone' ? project.zones.find(zone => zone.id === selected.id) : null; }
function zoneOptions(id) { return `<option value="">Unassigned</option>${project.zones.map(z => `<option value="${esc(z.id)}" ${z.id === id ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}`; }
function typeOptions(type) { return TYPES.map(value => `<option value="${value}" ${value === type ? 'selected' : ''}>${typeName(value)}</option>`).join(''); }
function setMode(next, message) {
  mode = next; zoneStart = null;
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
  $('#side-cable-count').textContent = String(project.cables.length).padStart(2, '0');
  $('#equipment-count').textContent = project.assets.length;
  $('#zone-list').innerHTML = project.zones.map(zone => `<button class="zone-item ${selected.kind === 'zone' && selected.id === zone.id ? 'active' : ''}" data-zone-select="${esc(zone.id)}"><span class="zone-dot"></span><span>${esc(zone.name)}</span><small>${project.assets.filter(a => a.zoneId === zone.id).length}</small></button>`).join('');
  $('#asset-cards').innerHTML = project.assets.slice(0, 3).map(asset => `<button class="asset-card ${selected.kind === 'asset' && selected.id === asset.id ? 'active' : ''}" data-asset-select="${esc(asset.id)}"><span class="asset-card-icon">${icon(typeIcon(asset.type))}</span><span class="asset-card-text"><strong>${esc(asset.name)}</strong><small>${esc(typeName(asset.type))} · ${esc(zoneFor(asset)?.name || 'Unassigned')}</small></span><span class="asset-card-status" title="${asset.placed ? 'Placed' : 'Unplaced'}"></span></button>`).join('') || '<p class="detail-note">Add equipment or import an inventory to get started.</p>';
  $('#inventory-list').innerHTML = project.assets.map(asset => `<button class="inventory-row" data-asset-select="${esc(asset.id)}"><span class="inventory-asset-icon">${icon(typeIcon(asset.type))}</span><div><strong>${esc(asset.name)}</strong><small>${esc(typeName(asset.type))} · ${esc(zoneFor(asset)?.name || 'Unassigned')}</small></div><span class="badge ${asset.placed ? '' : 'gray'}">${asset.placed ? 'Placed' : 'Unplaced'}</span>${icon('chevron')}</button>`).join('') || '<p class="detail-note">No equipment yet. Add an item or import a CSV inventory.</p>';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#zoom-level').textContent = `${Math.round(zoom * 100)}%`;
  renderInspector(); renderScene();
}

const openRack = rackUI(() => project, save, render, canAssignRack);
const openPorts = portUI(() => project, save, render);
function renderInspector() {
  const target = $('#inspector-content'), asset = selectedAsset(), zone = currentZone(), cable = selected.kind === 'cable' && project.cables.find(c => c.id === selected.id);
  $('.inspector').hidden = !inspectorOpen || (!asset && !zone && !cable);
  if (asset) {
    const url = safeManagementUrl(asset.managementUrl);
    target.innerHTML = `<div class="inspector-eyebrow">SELECTED EQUIPMENT</div><div class="detail-hero"><span class="detail-icon">${icon(typeIcon(asset.type))}</span><div><h3>${esc(asset.name)}</h3><p>${esc(typeName(asset.type))}</p></div></div><div class="detail-badges"><span class="badge"><i></i>${asset.placed ? 'Placed on plan' : 'Ready to place'}</span><span class="badge gray">${esc(zoneFor(asset)?.name || 'Unassigned')}</span></div><div class="detail-divider"></div><div class="detail-heading"><strong>Equipment details</strong><span>EDITABLE</span></div><form id="asset-form"><label class="field"><span>Equipment name</span><input name="name" value="${esc(asset.name)}" required maxlength="80"></label><label class="field"><span>Equipment type</span><select name="type">${typeOptions(asset.type)}</select></label><label class="field"><span>Floor zone</span><select name="zoneId">${zoneOptions(asset.zoneId)}</select></label><label class="field"><span>Model / description</span><input name="model" value="${esc(asset.model)}" placeholder="e.g. 48-port switch" maxlength="120"></label><label class="field"><span>IP address</span><input name="ip" value="${esc(asset.ip)}" placeholder="e.g. 10.20.0.1" maxlength="80"></label><label class="field"><span>Management URL</span><input name="managementUrl" type="url" value="${esc(asset.managementUrl)}" placeholder="https://" maxlength="500"></label></form><div class="detail-divider"></div><div class="detail-heading"><strong>Actions</strong><span>${project.cables.filter(c => c.from === asset.id || c.to === asset.id).length} CONNECTIONS</span></div><div class="detail-actions"><button class="detail-button primary-action" data-action="place-asset">${icon('pin')} ${asset.placed ? 'Move on floor plan' : 'Place on floor plan'}</button><button class="detail-button" data-action="connect-asset">${icon('link')} Connect to equipment</button>${url ? `<a class="detail-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('external')} Open management interface</a>` : ''}<button class="detail-button danger" data-action="delete-asset">${icon('trash')} Remove equipment</button></div>`;
    target.querySelector('.detail-actions').insertAdjacentHTML('beforeend', `<button class="detail-button" data-action="ports">Manage ports</button>${asset.type === 'cabinet' ? '<button class="detail-button" data-action="rack">Open cabinet front</button>' : ''}`);
  } else if (cable) {
    target.innerHTML = `<div class="inspector-eyebrow">SELECTED CABLE</div><div class="detail-hero"><span class="detail-icon">${icon('link')}</span><div><h3>${esc(assetById(cable.from)?.name)} → ${esc(assetById(cable.to)?.name)}</h3><p>Network cable</p></div></div><div class="detail-divider"></div><p class="detail-note">Add points in route order, then drag them on the grid.</p><div class="detail-actions"><button class="detail-button primary-action" data-action="add-waypoint">Add waypoint</button><button class="detail-button" data-action="reset-route">Reset automatic route</button>${(cable.waypoints || []).map((p, i) => `<button class="detail-button" data-remove-waypoint="${i}">Remove waypoint ${i + 1} (${p.x}, ${p.y})</button>`).join('')}</div>`;
  } else if (zone) {
    target.innerHTML = `<div class="inspector-eyebrow">SELECTED FLOOR ZONE</div><div class="detail-hero"><span class="detail-icon">${icon('layers')}</span><div><h3>${esc(zone.name)}</h3><p>${project.assets.filter(a => a.zoneId === zone.id).length} assigned equipment items</p></div></div><div class="detail-divider"></div><div class="detail-heading"><strong>Zone boundaries</strong><span>% OF PLAN</span></div><form id="zone-form"><label class="field"><span>Zone name</span><input name="name" value="${esc(zone.name)}" maxlength="80" required></label><div class="field-row"><label class="field"><span>Left</span><input name="x" type="number" min="0" max="99" step="1" value="${Math.round(zone.x)}"></label><label class="field"><span>Top</span><input name="y" type="number" min="0" max="99" step="1" value="${Math.round(zone.y)}"></label></div><div class="field-row"><label class="field"><span>Width</span><input name="w" type="number" min="1" max="100" step="1" value="${Math.round(zone.w)}"></label><label class="field"><span>Height</span><input name="h" type="number" min="1" max="100" step="1" value="${Math.round(zone.h)}"></label></div></form><p class="detail-note">Zones guide automatic placement. Adjust their boundaries to match your floor plan.</p><div class="detail-divider"></div><button class="detail-button danger" data-action="delete-zone">${icon('trash')} Remove zone</button>`;
  } else {
    target.innerHTML = `<div class="empty-inspector">${icon('layers')}<h3>Nothing selected</h3><p>Select a zone or equipment on the floor plan to see its details.</p></div>`;
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
  scene.setAttribute('viewBox', `${500 + panX-width/2} ${285 + panY-height/2} ${width} ${height}`);
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
  const zoneColors = ['#e2eee1','#f1eee2','#e8f1e9','#edf1e7','#e5eeea','#f4eee4'];
  project.zones.forEach((z, i) => {
    const active = selected.kind === 'zone' && selected.id === z.id;
    out += poly([[z.x,z.y],[z.x+z.w,z.y],[z.x+z.w,z.y+z.h],[z.x,z.y+z.h]], zoneColors[i % zoneColors.length], `class="zone-shape" data-zone="${esc(z.id)}" fill-opacity="${project.planImage ? '.2' : '.72'}" stroke="${active ? '#68a681' : '#d4e1d4'}" stroke-width="${active ? '2' : '1'}"`);
    const [x,y] = point(z.x + z.w/2, z.y + z.h/2);
    out += svgText(x, y + 2, z.name.toUpperCase(), 'text-anchor="middle" font-size="9" font-weight="700" letter-spacing="1" fill="#9caf9e" opacity=".85"');
  });
  out += demoFurniture() + demoWalls();
  if (selected.kind === 'cable') {
    for (let i = 0; i <= 100; i += 5) {
      out += `<polyline points="${points([[i,0],[i,100]])}" fill="none" stroke="#6e9b7c" stroke-width=".5" opacity=".45" pointer-events="none"/><polyline points="${points([[0,i],[100,i]])}" fill="none" stroke="#6e9b7c" stroke-width=".5" opacity=".45" pointer-events="none"/>`;
    }
  }
  for (const cable of project.cables) {
    const a = assetById(cable.from), b = assetById(cable.to);
    if (!a?.placed || !b?.placed) continue;
    const waypoints = cable.waypoints || [];
    const path = points(waypoints.length ? [[a.x,a.y], ...waypoints.map(p => [p.x,p.y]), [b.x,b.y]] : [[a.x,a.y],[b.x,a.y],[b.x,b.y]]);
    out += `<polyline points="${path}" fill="none" stroke="#fff8e8" stroke-width="5" stroke-linejoin="round" opacity=".8" pointer-events="none"/><polyline data-cable="${esc(cable.id)}" points="${path}" fill="none" stroke="#d9a667" stroke-width="${selected.kind === 'cable' && selected.id === cable.id ? '4' : '2.1'}" stroke-linejoin="round" stroke-linecap="round" style="cursor:pointer" tabindex="0" role="button" aria-label="Cable from ${esc(a.name)} to ${esc(b.name)}"/>`;
  }
  out += project.assets.filter(a => a.placed).sort((a,b) => { const [ax,ay] = rotated(a.x,a.y), [bx,by] = rotated(b.x,b.y); return ax+ay-bx-by; }).map(assetShape).join('');
  const cable = selected.kind === 'cable' && project.cables.find(c => c.id === selected.id);
  if (cable) (cable.waypoints || []).forEach((p, i) => { const [x,y] = point(p.x,p.y); out += `<circle data-waypoint="${i}" cx="${round(x)}" cy="${round(y)}" r="6" fill="#fff" stroke="#b37632" stroke-width="2" style="cursor:grab"><title>Drag waypoint ${i + 1}</title></circle>`; });
  scene.innerHTML = out;
}

function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); }
function showConnections() {
  $('#connection-list').innerHTML = project.cables.map(cable => `<div class="inventory-row"><span class="inventory-asset-icon">${icon('link')}</span><div><strong>${esc(assetById(cable.from)?.name || 'Unknown')} → ${esc(assetById(cable.to)?.name || 'Unknown')}</strong><small>Network cable</small></div><button class="tool-button" data-remove-cable="${esc(cable.id)}" title="Remove cable" aria-label="Remove cable">${icon('trash')}</button></div>`).join('') || '<p class="detail-note">There are no cables in this project yet.</p>';
  closeDialogs(); $('#connections-dialog').showModal();
}
function connectionPorts(from, to) {
  const dialog = document.createElement('dialog'); dialog.className = 'inventory-dialog';
  const choices = asset => `<option value="">Equipment only</option>${(asset.ports || []).map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}`;
  dialog.innerHTML = `<form><h2>Connect equipment</h2><label class="field">${esc(from.name)} port<select name="fromPort">${choices(from)}</select></label><label class="field">${esc(to.name)} port<select name="toPort">${choices(to)}</select></label><button class="button primary">Connect</button> <button type="button" data-cancel>Cancel</button></form>`;
  document.body.append(dialog);
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault(); const data = new FormData(event.target), fromPort = data.get('fromPort'), toPort = data.get('toPort');
    const duplicate = project.cables.some(c => (c.from === from.id && c.to === to.id && (c.fromPort || '') === fromPort && (c.toPort || '') === toPort) || (c.from === to.id && c.to === from.id && (c.fromPort || '') === toPort && (c.toPort || '') === fromPort));
    if (duplicate) { toast('This connection already exists. Choose different ports.'); return; }
    project.cables.push({ id: uid(), from: from.id, to: to.id, fromPort, toPort, waypoints: [] }); dialog.close(); save(); inspectorOpen = true; setMode('select'); render(); toast(`Connected ${from.name} to ${to.name}.`);
  };
  dialog.showModal();
}
function chooseAsset(id) {
  selected = { kind: 'asset', id }; inspectorOpen = true; setMode('select'); closeDialogs(); render();
}
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
  const zoneNode = event.target.closest('[data-zone]');
  const cableNode = event.target.closest('[data-cable]');
  if (mode === 'waypoint') {
    const location = worldAt(event), cable = project.cables.find(c => c.id === selected.id);
    if (!location || !cable) { toast('Choose a point inside the floor plan.'); return; }
    (cable.waypoints ||= []).push({x: Math.round(location[0] / 5) * 5, y: Math.round(location[1] / 5) * 5});
    save(); inspectorOpen = true; setMode('select'); render(); return;
  }
  if (mode === 'connect') {
    const from = selectedAsset(), to = assetNode && assetById(assetNode.dataset.asset);
    if (!to || to.id === from?.id) { toast('Select a different placed equipment item.'); return; }
    connectionPorts(from, to); return;
  }
  if (mode === 'place') {
    const location = worldAt(event), asset = selectedAsset();
    if (!location || !asset) { toast('Choose a point inside the floor plan.'); return; }
    Object.assign(asset, placeAsset(asset, project.zones, ...location));
    save(); inspectorOpen = true; setMode('select'); render(); toast(`${asset.name} placed on the floor plan.`); return;
  }
  if (mode === 'zone') {
    const location = worldAt(event);
    if (!location) { toast('Choose a point inside the floor plan.'); return; }
    if (!zoneStart) { zoneStart = location; $('#hint-text').textContent = 'Choose the opposite corner of the new zone'; return; }
    const x = Math.min(zoneStart[0], location[0]), y = Math.min(zoneStart[1], location[1]);
    const w = Math.abs(zoneStart[0] - location[0]), h = Math.abs(zoneStart[1] - location[1]);
    if (w < 2 || h < 2) { toast('Choose two corners with more space between them.'); return; }
    const zone = { id: uid(), name: `Zone ${project.zones.length + 1}`, x, y, w: round(w), h: round(h) };
    project.zones.push(zone); selected = { kind: 'zone', id: zone.id }; inspectorOpen = true; save(); setMode('select'); render(); toast('Zone added. Name it in the details panel.'); return;
  }
  if (cableNode) { selected = { kind: 'cable', id: cableNode.dataset.cable }; inspectorOpen = true; render(); }
  else if (assetNode) chooseAsset(assetNode.dataset.asset);
  else if (zoneNode) { selected = { kind: 'zone', id: zoneNode.dataset.zone }; inspectorOpen = true; render(); }
}

function scenePoint(clientX, clientY) {
  const svg = $('#scene'), pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
function zoomAt(value, x, y) {
  const before = scenePoint(x, y);
  zoom = Math.max(.6, Math.min(1.8, value));
  renderScene();
  const after = scenePoint(x, y);
  panX += before.x - after.x; panY += before.y - after.y;
  render();
}
$('#scene').addEventListener('wheel', event => {
  event.preventDefault();
  zoomAt(zoom * Math.exp(-event.deltaY * .001), event.clientX, event.clientY);
}, { passive: false });
$('#scene').addEventListener('click', handleSceneClick);
let waypointDrag = null;
$('#scene').addEventListener('pointerdown', event => {
  const node = event.target.closest('[data-waypoint]');
  if (!node || mode !== 'select' || !event.isPrimary || event.button !== 0) return;
  const cable = project.cables.find(c => c.id === selected.id), index = Number(node.dataset.waypoint);
  if (!cable?.waypoints?.[index]) return;
  waypointDrag = { pointerId: event.pointerId, cable, index, original: {...cable.waypoints[index]} };
  $('#scene').setPointerCapture(event.pointerId);
});
$('#scene').addEventListener('pointermove', event => {
  if (pinch) return;
  if (!waypointDrag || waypointDrag.pointerId !== event.pointerId) return;
  const [x,y] = worldFromEvent(event);
  waypointDrag.cable.waypoints[waypointDrag.index] = {x: Math.max(0, Math.min(100, Math.round(x / 5) * 5)), y: Math.max(0, Math.min(100, Math.round(y / 5) * 5))};
  renderScene();
});
$('#scene').addEventListener('pointerup', event => {
  if (!waypointDrag || waypointDrag.pointerId !== event.pointerId) return;
  waypointDrag = null; ignoreSceneClick = true; setTimeout(() => { ignoreSceneClick = false; }, 0); save(); render();
});
$('#scene').addEventListener('pointercancel', event => {
  if (!waypointDrag || waypointDrag.pointerId !== event.pointerId) return;
  waypointDrag.cable.waypoints[waypointDrag.index] = waypointDrag.original; waypointDrag = null; render();
});
$('#scene').addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch') {
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 2) {
      if (waypointDrag) { waypointDrag.cable.waypoints[waypointDrag.index] = waypointDrag.original; waypointDrag = null; }
      if (drag) { Object.assign(assetById(drag.id), drag.original); drag = null; $('#scene').classList.remove('dragging'); }
      pan = null;
      const [a, b] = [...touches.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      $('#scene').setPointerCapture(event.pointerId); renderScene(); return;
    }
  }
  const node = event.target.closest('[data-asset]');
  const asset = node && assetById(node.dataset.asset);
  if (mode !== 'select' || !event.isPrimary || event.button !== 0 || event.target.closest('[data-waypoint], [data-cable]')) return;
  if (asset?.placed) drag = { id: asset.id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, start: worldFromEvent(event), original: { ...asset }, moved: false };
  else pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, zoneId: event.target.closest('[data-zone]')?.dataset.zone };
  $('#scene').setPointerCapture(event.pointerId);
});
$('#scene').addEventListener('pointermove', event => {
  if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && touches.size === 2) {
    const [a, b] = [...touches.values()], x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    const before = scenePoint(pinch.x, pinch.y), after = scenePoint(x, y);
    panX += before.x - after.x; panY += before.y - after.y;
    zoomAt(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance, x, y);
    pinch.x = x; pinch.y = y; return;
  }
  if (pan && event.pointerId === pan.pointerId) {
    if (!pan.moved && Math.hypot(event.clientX - pan.x, event.clientY - pan.y) < 4) return;
    pan.moved = true;
    const before = scenePoint(pan.x, pan.y), after = scenePoint(event.clientX, event.clientY);
    panX += before.x - after.x; panY += before.y - after.y;
    pan.x = event.clientX; pan.y = event.clientY; renderScene(); return;
  }
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4) return;
  drag.moved = true; $('#scene').classList.add('dragging');
  const [x, y] = worldFromEvent(event), asset = assetById(drag.id);
  Object.assign(asset, placeAsset(asset, project.zones, drag.original.x + x - drag.start[0], drag.original.y + y - drag.start[1]));
  renderScene();
});
$('#scene').addEventListener('pointerup', event => {
  touches.delete(event.pointerId);
  if (pinch) { pinch = null; pan = null; ignoreSceneClick = true; setTimeout(() => { ignoreSceneClick = false; }, 0); return; }
  if (pan && event.pointerId === pan.pointerId) {
    if (pan.moved || pan.zoneId) { ignoreSceneClick = true; setTimeout(() => { ignoreSceneClick = false; }, 0); }
    if (!pan.moved && pan.zoneId) { selected = { kind: 'zone', id: pan.zoneId }; inspectorOpen = true; render(); }
    pan = null; return;
  }
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { id, moved } = drag; drag = null; $('#scene').classList.remove('dragging');
  ignoreSceneClick = true; setTimeout(() => { ignoreSceneClick = false; }, 0);
  if (moved) save();
  chooseAsset(id);
});
$('#scene').addEventListener('pointercancel', event => {
  touches.delete(event.pointerId); pinch = null; pan = null;
  if (!drag || event.pointerId !== drag.pointerId) return;
  Object.assign(assetById(drag.id), drag.original); drag = null; $('#scene').classList.remove('dragging'); renderScene();
});
$('#scene').addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('[data-asset], [data-cable]')) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});

document.addEventListener('click', event => {
  const removeWaypoint = event.target.closest('[data-remove-waypoint]');
  if (removeWaypoint && selected.kind === 'cable') { const cable = project.cables.find(c => c.id === selected.id); cable?.waypoints?.splice(Number(removeWaypoint.dataset.removeWaypoint), 1); save(); render(); return; }
  const assetButton = event.target.closest('[data-asset-select]');
  if (assetButton) { chooseAsset(assetButton.dataset.assetSelect); return; }
  const zoneButton = event.target.closest('[data-zone-select]');
  if (zoneButton) { selected = { kind: 'zone', id: zoneButton.dataset.zoneSelect }; inspectorOpen = true; setMode('select'); render(); return; }
  const removeCable = event.target.closest('[data-remove-cable]');
  if (removeCable) { project.cables = project.cables.filter(c => c.id !== removeCable.dataset.removeCable); save(); render(); showConnections(); toast('Connection removed.'); return; }
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) { view = viewButton.dataset.view; render(); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) { if (!event.target.closest('#project-menu')) $('#project-menu').hidden = true; return; }
  if (action !== 'project-menu') $('#project-menu').hidden = true;
  const asset = selectedAsset(), zone = currentZone();
  switch (action) {
    case 'add-waypoint': inspectorOpen = false; renderInspector(); setMode('waypoint', 'Choose a point on the floor plan'); break;
    case 'reset-route': { const cable = project.cables.find(c => c.id === selected.id); if (cable) { cable.waypoints = []; save(); render(); } break; }
    case 'project-menu': $('#project-menu').hidden = !$('#project-menu').hidden; break;
    case 'focus-canvas': $('#canvas-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
    case 'inventory': closeDialogs(); $('#inventory-dialog').showModal(); break;
    case 'show-connections': showConnections(); break;
    case 'close-dialog': closeDialogs(); break;
    case 'close-inspector': selected = { kind: null, id: null }; inspectorOpen = false; setMode('select'); render(); break;
    case 'import-csv': $('#inventory-file').click(); break;
    case 'upload-plan': $('#plan-file').click(); break;
    case 'import-project': $('#project-file').click(); break;
    case 'add-zone': closeDialogs(); inspectorOpen = false; renderInspector(); setMode('zone', 'Choose the first corner of the new zone'); $('#canvas-card').scrollIntoView({ behavior: 'smooth', block: 'center' }); break;
    case 'cancel-mode': inspectorOpen = !!selected.id; setMode('select'); renderInspector(); break;
    case 'add-asset': {
      const added = { id: uid(), name: 'New equipment', type: 'switch', zoneId: '', model: '', ip: '', managementUrl: '', placed: false };
      project.assets.push(added); selected = { kind: 'asset', id: added.id }; inspectorOpen = true; closeDialogs(); save(); setMode('select'); render(); toast('Equipment added. Edit its details and place it on the plan.'); break;
    }
    case 'place-asset': if (asset) { inspectorOpen = false; renderInspector(); setMode('place', `Choose a position for ${asset.name}`); $('#canvas-card').scrollIntoView({ behavior: 'smooth', block: 'center' }); } break;
    case 'connect-asset':
      if (!asset?.placed) toast('Place this equipment on the plan first.');
      else { inspectorOpen = false; renderInspector(); setMode('connect', `Select equipment to connect to ${asset.name}`); $('#canvas-card').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      break;
    case 'rack': if (asset) openRack(asset.id); break;
    case 'ports': if (asset) openPorts(asset.id); break;
    case 'delete-asset':
      if (asset && confirm(`Remove ${asset.name} and its connections?`)) { project.assets.forEach(a => { if (a.cabinetId === asset.id) { a.cabinetId = ''; a.rackUnit = null; } }); project.assets = project.assets.filter(a => a.id !== asset.id); project.cables = project.cables.filter(c => c.from !== asset.id && c.to !== asset.id); selected = { kind: null, id: null }; save(); setMode('select'); render(); toast('Equipment removed.'); }
      break;
    case 'delete-zone':
      if (zone && confirm(`Remove ${zone.name}? Equipment will remain on the plan but become unassigned.`)) { project.zones = project.zones.filter(z => z.id !== zone.id); project.assets.forEach(a => { if (a.zoneId === zone.id) a.zoneId = ''; }); selected = { kind: null, id: null }; save(); render(); toast('Zone removed.'); }
      break;
    case 'auto-place': {
      const before = project.assets.filter(a => a.placed).length;
      project.assets = autoPlace(project.assets, project.zones);
      const count = project.assets.filter(a => a.placed).length - before;
      const unassigned = project.assets.filter(a => !a.placed && !zoneFor(a)).length;
      save(); render(); toast(count ? `Placed ${count} equipment item${count === 1 ? '' : 's'} in assigned zones.${unassigned ? ` ${unassigned} still need a zone.` : ''}` : unassigned ? `${unassigned} equipment item${unassigned === 1 ? ' needs' : 's need'} a zone before auto-placement.` : 'All assigned equipment is already placed.'); break;
    }
    case 'rotate': rotation = (rotation + 1) % 4; render(); break;
    case 'zoom-in': zoom = Math.min(1.8, round(zoom + .2)); render(); break;
    case 'zoom-out': zoom = Math.max(.6, round(zoom - .2)); render(); break;
    case 'reset-view': rotation = 0; zoom = 1; panX = 0; panY = 0; render(); break;
    case 'export-project': download(`${projectFilename()}.json`, JSON.stringify(project, null, 2), 'application/json'); toast('Project exported.'); break;
    case 'export-svg': {
      const copy = $('#scene').cloneNode(true); copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); copy.setAttribute('font-family', 'Inter, Arial, sans-serif');
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
        selected = { kind: 'asset', id: null }; rotation = 0; zoom = 1; panX = 0; panY = 0; setMode('select'); save(); render(); toast('Blank project created. Upload a floor plan and add zones.');
      }
      break;
  }
});

document.addEventListener('change', event => {
  const field = event.target, asset = selectedAsset(), zone = currentZone();
  if (field.closest('#asset-form') && asset) {
    const key = field.name, value = field.value.trim();
    if (key === 'name' && !value) { toast('Equipment name cannot be empty.'); render(); return; }
    if (key === 'managementUrl' && value && !safeManagementUrl(value)) { toast('Use a complete http:// or https:// management URL.'); render(); return; }
    if (key === 'type' && !TYPES.includes(value)) return;
    if (key === 'type' && value !== asset.type && (asset.cabinetId || project.assets.some(a => a.cabinetId === asset.id))) { toast('Unassign rack equipment before changing its type.'); render(); return; }
    asset[key] = key === 'managementUrl' ? safeManagementUrl(value) : value;
    if (key === 'zoneId' && asset.placed) {
      const assigned = zoneFor(asset);
      if (assigned && !(asset.x >= assigned.x && asset.x <= assigned.x + assigned.w && asset.y >= assigned.y && asset.y <= assigned.y + assigned.h)) asset.placed = false;
    }
    save(); render();
  }
  if (field.closest('#zone-form') && zone) {
    if (field.name === 'name') { if (!field.value.trim()) { toast('Zone name cannot be empty.'); render(); return; } zone.name = field.value.trim(); }
    else {
      const value = Number(field.value), next = { ...zone, [field.name]: value };
      if (!Number.isFinite(value) || next.x < 0 || next.y < 0 || next.w <= 0 || next.h <= 0 || next.x + next.w > 100 || next.y + next.h > 100) { toast('Zone boundaries must fit within the floor plan.'); render(); return; }
      zone[field.name] = value;
    }
    save(); render();
  }
});

$('#inventory-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('Inventory CSV must be smaller than 2 MB.');
    const result = parseInventory(await file.text(), project.zones);
    project.assets.push(...result.assets); save(); render();
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
    project.planImage = image; project.demo = false; save(); render(); toast('Floor plan uploaded. Adjust existing zones to match it.');
  } catch (error) { alert(error.message); }
  event.target.value = '';
});
$('#project-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error('Project file must be smaller than 5 MB.');
    const imported = restoreProject(JSON.parse(await file.text()));
    if (confirm('Replace the current project with this file? Export the current project first if you need a backup.')) {
      project = imported; selected = { kind: null, id: null }; rotation = 0; zoom = 1; panX = 0; panY = 0; setMode('select'); save(); render(); toast('Project imported.');
    }
  } catch (error) { alert(`Could not import project: ${error.message}`); }
  event.target.value = '';
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (mode !== 'select') { inspectorOpen = !!selected.id; setMode('select'); renderInspector(); }
  else if (!$('.inspector').hidden) { selected = { kind: null, id: null }; inspectorOpen = false; render(); }
});
render();
