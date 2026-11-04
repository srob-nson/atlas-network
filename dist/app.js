import { TYPES, parseInventory, autoPlaceFloor, safeManagementUrl, restoreHierarchy, serializeProject, configurePorts, assignRack, placeAsset, cableRoute, assignRacks, initializePorts, moveAssetToFloor, deployAsset } from './model.js?v=16';
import { loadWorkspace, storeWorkspace } from './storage.js';
import { validateProject } from './validation.js?v=1';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const typeName = type => ({ cabinet: 'Cabinet', switch: 'Switch', router: 'Router', firewall: 'Firewall', access_point: 'Access point', patch_panel: 'Patch panel', plc: 'PLC', rtu: 'RTU', hmi: 'HMI', engineering_workstation: 'Engineering workstation', server: 'Server', workstation: 'Workstation', ip_camera: 'IP camera', nvr: 'Network video recorder', access_controller: 'Access controller', sensor: 'Sensor', meter: 'Meter', drive: 'Drive', ied: 'IED', gateway: 'Gateway', printer: 'Printer', other: 'Other IP device' })[type] || type;
const typeIcon = type => type === 'access_point' ? 'nodes' : type === 'cabinet' ? 'layers' : 'box';
const uid = () => crypto.randomUUID();
const storageKey = 'titan-project-v1';
const legacyStorageKey = 'network-atlas-project-v1';

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
    { id: 'core', name: 'CORE-SW-01', type: 'switch', zoneId: 'network', model: 'Core switch', ip: '10.20.0.1', managementUrl: 'https://10.20.0.1/', x: 23, y: 16, placed: true, ports: [{ name: '1', speed: 'Unknown' }, { name: '2', speed: 'Unknown' }] },
    { id: 'firewall', name: 'FW-01', type: 'firewall', zoneId: 'network', model: 'Edge firewall', ip: '10.20.0.2', managementUrl: 'https://10.20.0.2/', x: 27, y: 26, placed: true, ports: [{ name: '1', speed: 'Unknown' }, { name: '2', speed: 'Unknown' }] },
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

const workspaceKey = 'titan-workspace-v2';
let workspace, loadError = false, migrated = null, upgrade = false;
try {
  let raw = await loadWorkspace();
  if (!raw) {
    const saved = localStorage.getItem(workspaceKey);
    const legacy = localStorage.getItem(storageKey) ?? localStorage.getItem(legacyStorageKey);
    raw = saved ? JSON.parse(saved) : { projects: [legacy ? JSON.parse(legacy) : demo] };
    if (saved) migrated = [workspaceKey, saved];
    else if (legacy) migrated = [localStorage.getItem(storageKey) !== null ? storageKey : legacyStorageKey, legacy];
  }
  if (!Array.isArray(raw.projects) || !raw.projects.length) throw new Error('Invalid workspace');
  upgrade = raw.projects.some(p => p.schemaVersion !== 3);
  const index = value => Number.isInteger(value) && value >= 0 ? value : 0;
  workspace = { projects: raw.projects.map(restoreHierarchy), projectIndex: index(raw.projectIndex), buildingIndex: index(raw.buildingIndex), floorIndex: index(raw.floorIndex) };
} catch { loadError = true; workspace = { projects: [restoreHierarchy(demo)], projectIndex: 0, buildingIndex: 0, floorIndex: 0 }; }
let currentProject, building, floor, project;
function selectFloor() {
  workspace.projectIndex = Math.min(workspace.projectIndex, workspace.projects.length - 1);
  currentProject = workspace.projects[workspace.projectIndex];
  workspace.buildingIndex = Math.min(workspace.buildingIndex, currentProject.buildings.length - 1);
  building = currentProject.buildings[workspace.buildingIndex];
  workspace.floorIndex = Math.min(workspace.floorIndex, building.floors.length - 1);
  floor = building.floors[workspace.floorIndex];
  project = floor;
  Object.defineProperties(project, {
    name: { configurable: true, get: () => currentProject.name, set: value => { currentProject.name = value; } },
    cables: { configurable: true, get: () => currentProject.cables, set: value => { currentProject.cables = value; } }
  });
  floor.assets = initializePorts(assignRacks(floor.assets), currentProject.cables);
}
selectFloor();
function allFloors() { return currentProject.buildings.flatMap(b => b.floors.map(f => ({ building: b, floor: f }))); }
function allAssets() { return allFloors().flatMap(({ floor }) => floor.assets); }
function assetLocation(id) { return allFloors().find(({ floor }) => floor.assets.some(a => a.id === id)); }
function globalAsset(id) { return allAssets().find(a => a.id === id); }
function locationName(id) { const at = assetLocation(id); return at ? `${at.building.name} / ${at.floor.floorName}` : 'Unknown'; }
function crossFloor(cable) { return assetLocation(cable.from)?.floor !== assetLocation(cable.to)?.floor; }
function blankFloor(name = 'Ground floor') { return { id: uid(), floorName: name, planImage: '', demo: false, zones: [], assets: [] }; }
function resetSelection() { selected = { kind: null, id: null }; inspectorOpen = false; rotation = 0; zoom = defaultZoom; pan = { x: 0, y: 0 }; closeDialogs(); setMode('select'); }
let rackView = '', rackDevice = '', pendingPort = null;
let selected = { kind: null, id: null };
const defaultZoom = .9;
let view = '3d', rotation = 0, zoom = defaultZoom, mode = 'select';
let pan = { x: 0, y: 0 }, pointIndex = null;
let drag = null, ignoreSceneClick = false, inspectorOpen = false, lastAssetClick = null, outlineDraft = [];
let toastTimer;

function toast(message, duration = 3500) {
  const element = $('#toast'); element.textContent = message; element.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('visible'), duration);
}
let saveQueue = Promise.resolve(), saveNumber = 0, unsaved = false;
function save() {
  const number = ++saveNumber;
  const snapshot = JSON.parse(JSON.stringify({ ...workspace, projects: workspace.projects.map(serializeProject) }));
  unsaved = true;
  $('#save-status').textContent = 'Saving…';
  const result = saveQueue.then(async () => {
    if (loadError) throw new Error('Existing browser data could not be loaded.');
    await storeWorkspace(snapshot);
  }).then(() => {
    if (number === saveNumber) { unsaved = false; $('#save-status').textContent = 'Saved locally'; }
    return true;
  }).catch(() => {
    if (number === saveNumber) { $('#save-status').textContent = 'Not saved — export project'; toast('Could not save browser data. Export your projects before leaving.', 10000); }
    return false;
  });
  saveQueue = result;
  return result;
}
window.addEventListener('beforeunload', event => { if (unsaved) { event.preventDefault(); event.returnValue = ''; } });
function assetById(id) { return project.assets.find(asset => asset.id === id); }
function selectedAsset() { return selected.kind === 'asset' ? assetById(selected.id) : null; }
function selectedCable() { return selected.kind === 'cable' ? project.cables.find(c => c.id === selected.id) : null; }
function typeOptions(type) { return TYPES.map(value => `<option value="${value}" ${value === type ? 'selected' : ''}>${typeName(value)}</option>`).join(''); }
function setMode(next, message) {
  mode = next;
  $('#hint-text').textContent = message || 'Drag the floor to pan · drag equipment to move it';
  $('#cancel-mode').hidden = next === 'select';
  $('#outline-controls').hidden = next !== 'outline';
  $('#scene').style.cursor = next === 'select' ? '' : 'crosshair';
}

function render() {
  $('#project-select').innerHTML = workspace.projects.map((p, i) => `<option value="${i}" ${i === workspace.projectIndex ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  $('#building-select').innerHTML = currentProject.buildings.map((b, i) => `<option value="${i}" ${i === workspace.buildingIndex ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  $('#floor-select').innerHTML = building.floors.map((f, i) => `<option value="${i}" ${i === workspace.floorIndex ? 'selected' : ''}>${esc(f.floorName)}</option>`).join('');
  $('#floor-eyebrow').textContent = project.floorName.toUpperCase();
  $('#breadcrumb-project').textContent = project.name;
  $('#canvas-subtitle').textContent = `${project.floorName} · ${view === '3d' ? '3D view' : 'Plan view'}`;
  $('#side-asset-count').textContent = String(allAssets().length).padStart(2, '0');
  $('#side-rack-count').textContent = String(project.assets.filter(a => a.type === 'cabinet').length).padStart(2, '0');
  $('#side-cable-count').textContent = String(project.cables.length).padStart(2, '0');
  $('#equipment-count').textContent = project.assets.length;
  $('#asset-cards').innerHTML = project.assets.slice(0, 3).map(asset => `<button class="asset-card ${selected.kind === 'asset' && selected.id === asset.id ? 'active' : ''}" data-asset-select="${esc(asset.id)}"><span class="asset-card-icon">${icon(typeIcon(asset.type))}</span><span class="asset-card-text"><strong>${esc(asset.name)}</strong><small>${esc(typeName(asset.type))}</small></span><span class="asset-card-status" title="${asset.placed ? 'Placed' : 'Unplaced'}"></span></button>`).join('') || '<p class="detail-note">Add equipment or import an inventory to get started.</p>';
  $('#inventory-list').innerHTML = allAssets().map(asset => `<button class="inventory-row" data-asset-select="${esc(asset.id)}"><span class="inventory-asset-icon">${icon(typeIcon(asset.type))}</span><div><strong>${esc(asset.name)}</strong><small>${esc(typeName(asset.type))} · ${esc(locationName(asset.id))}</small></div><span class="badge ${asset.placed ? '' : 'gray'}">${asset.placed ? 'Placed' : 'Unplaced'}</span>${icon('chevron')}</button>`).join('') || '<p class="detail-note">No equipment yet. Add an item or import a CSV inventory.</p>';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#zoom-level').textContent = `${Math.round(zoom * 100)}%`;
  renderInspector(); renderScene();
}

const rackDrafts = new WeakMap();
function rackFields(asset) {
  if (asset.type === 'cabinet') return `<label class="field"><span>Rack capacity (U)</span><input name="rackUnits" type="number" min="1" max="512" value="${asset.rackUnits ?? ''}" placeholder="Unknown"></label>`;
  const draft = rackDrafts.get(asset);
  return `<div class="field-row"><label class="field"><span>Starting U</span><input name="rackStart" type="number" min="1" max="512" value="${draft?.rackStart ?? asset.rackStart ?? ''}" placeholder="Unknown"></label><label class="field"><span>Height (U)</span><input name="rackHeight" type="number" min="1" max="512" value="${draft?.rackHeight ?? asset.rackHeight ?? ''}" placeholder="Unknown"></label></div>`;
}
function portFields(asset) {
  if (asset.type === 'cabinet') return '';
  return `<label class="field"><span>Number of ports</span><input name="portCount" type="number" min="0" max="512" value="${asset.ports.length}"></label><div class="detail-heading"><strong>Interfaces</strong></div>${asset.ports.map((port, i) => `<fieldset class="port-fields"><legend>Port ${i + 1}</legend><label class="field"><span>Interface name</span><input data-port-index="${i}" data-port-field="name" value="${esc(port.name)}" maxlength="80" required></label><div class="field-row"><label class="field"><span>Speed</span><input data-port-index="${i}" data-port-field="speed" value="${esc(port.speed)}" maxlength="80"></label><label class="field"><span>Media</span><input data-port-index="${i}" data-port-field="media" value="${esc(port.media)}" maxlength="80"></label></div><label class="field"><span>PoE role</span><select data-port-index="${i}" data-port-field="poe">${[['unknown','Unknown'],['source','Supplies power'],['powered','Receives power'],['none','No PoE']].map(([value, label]) => `<option value="${value}" ${port.poe === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></fieldset>`).join('')}`;
}

function engineeringFields(asset) {
  if (asset.type === 'cabinet') return '';
  return `<div class="field-row"><label class="field"><span>Network</span><input name="network" value="${esc(asset.network)}" maxlength="120" placeholder="Unknown"></label><label class="field"><span>VRF</span><input name="vrf" value="${esc(asset.vrf)}" maxlength="120" placeholder="Unknown"></label></div><div class="field-row"><label class="field"><span>PoE budget (W)</span><input name="poeBudget" type="number" min="0" step="any" value="${asset.poeBudget ?? ''}" placeholder="Unknown"></label><label class="field"><span>PoE demand (W)</span><input name="poeDemand" type="number" min="0" step="any" value="${asset.poeDemand ?? ''}" placeholder="Unknown"></label></div>`;
}

function renderInspector() {
  const target = $('#inspector-content'), asset = selectedAsset(), cable = selectedCable();
  $('.inspector').hidden = !inspectorOpen || (!asset && !cable);
  if (asset) {
    const url = safeManagementUrl(asset.managementUrl);
    target.innerHTML = `<div class="inspector-eyebrow">SELECTED EQUIPMENT</div><div class="detail-hero"><span class="detail-icon">${icon(typeIcon(asset.type))}</span><div><h3>${esc(asset.name)}</h3><p>${esc(typeName(asset.type))}</p></div></div><div class="detail-badges"><span class="badge"><i></i>${asset.rackId ? 'In rack' : asset.placed ? 'Placed on plan' : 'Ready to place'}</span></div><div class="detail-divider"></div><div class="detail-heading"><strong>Equipment details</strong><span>EDITABLE</span></div><form id="asset-form"><label class="field"><span>Building / floor</span><select id="asset-floor">${allFloors().map(({building: b, floor: f}) => `<option value="${esc(f.id)}" ${f === floor ? 'selected' : ''}>${esc(b.name)} / ${esc(f.floorName)}</option>`).join('')}</select></label><label class="field"><span>Equipment name</span><input name="name" value="${esc(asset.name)}" required maxlength="80"></label><label class="field"><span>Equipment type</span><select name="type">${typeOptions(asset.type)}</select></label>${asset.type !== 'cabinet' ? `<label class="field"><span>Cabinet / rack</span><select name="rackId"><option value="">Unassigned</option>${project.assets.filter(a => a.type === 'cabinet').map(a => `<option value="${esc(a.id)}" ${asset.rackId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}${rackFields(asset)}<label class="field"><span>Vendor</span><input name="vendor" value="${esc(asset.vendor)}" maxlength="120"></label><label class="field"><span>Model / description</span><input name="model" value="${esc(asset.model)}" placeholder="e.g. 48-port switch" maxlength="120"></label><label class="field"><span>IP address</span><input name="ip" value="${esc(asset.ip)}" placeholder="e.g. 10.20.0.1" maxlength="80"></label>${engineeringFields(asset)}<label class="field"><span>Management URL</span><input name="managementUrl" type="url" value="${esc(asset.managementUrl)}" placeholder="https://" maxlength="500"></label>${portFields(asset)}</form><div class="detail-divider"></div><div class="detail-heading"><strong>Actions</strong><span>${project.cables.filter(c => c.from === asset.id || c.to === asset.id).length} CONNECTIONS</span></div><div class="detail-actions">${!asset.rackId ? `<button class="detail-button primary-action" data-action="place-asset">${icon('pin')} ${asset.placed ? 'Move on floor plan' : 'Place on floor plan'}</button>` : ''}${asset.type === 'cabinet' ? `<button class="detail-button" data-rack-open="${esc(asset.id)}">${icon('layers')} Open rack view</button>` : ''}<button class="detail-button" data-action="connect-asset">${icon('link')} Connect to equipment</button><label class="field"><span>Connect to another floor</span><select id="cross-floor-connect"><option value="">Choose equipment</option>${allAssets().filter(a => a.id !== asset.id && assetLocation(a.id)?.floor !== floor).map(a => `<option value="${esc(a.id)}">${esc(a.name)} · ${esc(locationName(a.id))}</option>`).join('')}</select></label>${url ? `<a class="detail-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('external')} Open management interface</a>` : ''}<button class="detail-button danger" data-action="delete-asset">${icon('trash')} Remove equipment</button></div>`;
  } else if (cable) {
    target.innerHTML = `<div class="inspector-eyebrow">SELECTED CABLE</div><h3>${esc(globalAsset(cable.from)?.name)} → ${esc(globalAsset(cable.to)?.name)}</h3><p class="detail-note">${esc(cable.fromPort || 'Interface unspecified')} → ${esc(cable.toPort || 'Interface unspecified')}</p><button class="detail-button" data-action="edit-connection-ports">Choose interfaces</button>${crossFloor(cable) ? `<p class="detail-note">${esc(locationName(cable.from))} → ${esc(locationName(cable.to))}</p><p class="detail-note">Cross-floor connection; physical route is not shown.</p>` : `<p class="detail-note">Click a segment to add a point. Drag points onto the grid, or focus a point and use arrow keys. Delete removes it.</p><div class="detail-actions"><button class="detail-button" data-action="add-point">Add point</button><button class="detail-button" data-action="remove-point" ${pointIndex === null ? 'disabled' : ''}>Remove selected point</button><button class="detail-button" data-action="reset-route">Reset automatic route</button></div>`}`;
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
  const size = asset.type === 'cabinet' ? 5.1 : asset.type === 'access_point' ? 3 : 3.9;
  const height = asset.type === 'cabinet' ? 13.5 : asset.type === 'access_point' ? 1.7 : 3.4;
  const colors = isSelected ? ['#79b995','#3a785d','#4b8a6c'] : asset.type === 'cabinet' ? ['#6c9280','#496b5b','#547965'] : ['#a6c9b1','#6f9b7e','#83af90'];
  const [sx, sy] = point(asset.x, asset.y, height);
  let graphic = box(asset.x-size/2, asset.y-size/2, size, size, height, colors);
  if (asset.type === 'cabinet' && view === '3d') {
    for (let i = 0; i < 4; i++) {
      const line = [[asset.x-size/2+0.5,asset.y+size/2,2.25+i*2.25],[asset.x+size/2-0.5,asset.y+size/2,2.25+i*2.25]].map(p => point(...p).map(round).join(',')).join(' ');
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
  const floor = project.outline?.length ? project.outline : [[0,0],[100,0],[100,100],[0,100]];
  const p00 = point(0,0), p10 = point(100,0), p01 = point(0,100);
  const matrix = `${round((p10[0]-p00[0])/100)} ${round((p10[1]-p00[1])/100)} ${round((p01[0]-p00[0])/100)} ${round((p01[1]-p00[1])/100)} ${round(p00[0])} ${round(p00[1])}`;
  let out = `<defs><filter id="floorShadow" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="12"/></filter><filter id="tagShadow" x="-30%" y="-50%" width="160%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#355b42" flood-opacity=".12"/></filter><clipPath id="floorClip">${poly(floor, '#fff')}</clipPath></defs>`;
  if (view === '3d') {
    const shadow = floor.map(([x,y]) => { const [a,b] = point(x,y); return `${round(a+8)},${round(b+20)}`; }).join(' ');
    out += `<polygon points="${shadow}" fill="#829c86" opacity=".14" filter="url(#floorShadow)"/>`;
    const ground = floor.map(([x,y]) => point(x,y));
    for (let i = 0; i < ground.length; i++) {
      const a = ground[i], b = ground[(i + 1) % ground.length];
      if (b[0] > a[0]) out += `<polygon points="${a.map(round).join(',')} ${b.map(round).join(',')} ${round(b[0])},${round(b[1]+13)} ${round(a[0])},${round(a[1]+13)}" fill="#c8d7c8"/>`;
    }
  }
  out += poly(floor, '#f1f5ed', 'stroke="#b9cbbb" stroke-width="1.5" data-floor="true"');
  if (project.planImage) out += `<g ${mode === 'outline' ? '' : 'clip-path="url(#floorClip)"'} pointer-events="none"><image href="${esc(project.planImage)}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet" transform="matrix(${matrix})" opacity=".8"/></g>`;
  if (mode === 'outline' && outlineDraft.length) {
    out += `<polyline points="${points(outlineDraft)}" fill="none" stroke="#277754" stroke-width="3" stroke-dasharray="7 4" pointer-events="none"/>`;
    for (const [x,y] of outlineDraft) { const [px,py] = point(x,y); out += `<circle cx="${round(px)}" cy="${round(py)}" r="5" fill="#277754" stroke="white" stroke-width="2" pointer-events="none"/>`; }
  }
  out += demoFurniture() + demoWalls();
  const editing = selectedCable() && !crossFloor(selectedCable()) ? selectedCable() : null;
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
  for (const cable of project.cables.filter(crossFloor)) {
    const local = assetById(cable.from) || assetById(cable.to);
    const marker = assetById(local?.rackId) || local;
    if (!marker?.placed) continue;
    const [x, y] = point(marker.x, marker.y);
    const other = local.id === cable.from ? cable.to : cable.from;
    out += `<g data-cable="${esc(cable.id)}" tabindex="0" role="button" aria-label="Connection to ${esc(globalAsset(other)?.name)} on ${esc(locationName(other))}"><circle cx="${round(x + 18)}" cy="${round(y - 20)}" r="8" fill="${esc(cable.color || '#d9a667')}" stroke="#fff" stroke-width="2"/><title>Connected to ${esc(globalAsset(other)?.name)} · ${esc(locationName(other))}</title></g>`;
  }
  out += project.assets.filter(a => a.placed && !a.rackId).sort((a,b) => { const [ax,ay] = rotated(a.x,a.y), [bx,by] = rotated(b.x,b.y); return ax+ay-bx-by; }).map(assetShape).join('');
  if (editing) (editing.waypoints || []).forEach((p, i) => { const [x,y] = point(p.x,p.y); out += `<circle class="route-handle route-editor" data-point="${i}" tabindex="0" role="button" aria-label="Cable point ${i + 1}, x ${p.x}, y ${p.y}" cx="${round(x)}" cy="${round(y)}" r="${i === pointIndex ? 7 : 5}" fill="#fff" stroke="#a66524" stroke-width="2"/>`; });
  scene.innerHTML = out;
}

function closeDialogs() { pendingPort = null; document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); }
let validationFindings = [];
function validationTargetLabel(ref) {
  if (ref.kind === 'device' || ref.kind === 'rack') return globalAsset(ref.id)?.name || '';
  if (ref.kind === 'port') {
    const device = globalAsset(ref.deviceId), port = device?.ports.find(p => p.id === ref.id);
    return port ? `${device.name} · ${port.name}` : '';
  }
  if (ref.kind === 'connection') {
    const cable = project.cables.find(c => c.id === ref.id);
    return cable ? `${globalAsset(cable.from)?.name || 'Unknown'} → ${globalAsset(cable.to)?.name || 'Unknown'}` : '';
  }
  return '';
}
function showValidation() {
  const order = { error: 0, warning: 1, missing: 2 }, names = { error: 'Error', warning: 'Warning', missing: 'Missing information' };
  validationFindings = validateProject(serializeProject(currentProject)).sort((a, b) => order[a.severity] - order[b.severity]);
  $('#validation-list').innerHTML = validationFindings.map((item, i) => `<section class="validation-finding" data-finding-code="${esc(item.code)}" data-severity="${esc(item.severity)}"><strong>${names[item.severity]}</strong><p>${esc(item.message)}</p><div>${item.targets.map((ref, j) => { const label = validationTargetLabel(ref); return label ? `<button class="text-button validation-link" data-validation-target="${i}:${j}" data-target-kind="${esc(ref.kind)}" data-target-id="${esc(ref.id)}">${esc(label)}</button>` : ''; }).join('')}</div></section>`).join('') || '<p class="detail-note">No findings for this project.</p>';
  closeDialogs(); $('#validation-dialog').showModal();
}
function openValidationTarget(ref) {
  if (ref.kind === 'connection') { chooseCable(ref.id); return; }
  const id = ref.kind === 'port' ? ref.deviceId : ref.id;
  const device = globalAsset(id); if (!device) return;
  chooseAsset(id);
  if (ref.kind === 'port') {
    const index = assetById(id)?.ports.findIndex(port => port.id === ref.id);
    const input = document.querySelector(`[data-port-index="${index}"][data-port-field="name"]`);
    input?.scrollIntoView({ block: 'center' }); input?.focus();
  }
}
let connectionDraft = null;
function portAvailable(device, port, except = null) {
  return !project.cables.some(c => c !== except && ((c.from === device.id && (c.fromPortId === port.id || c.fromPort?.toLowerCase() === port.name.toLowerCase())) || (c.to === device.id && (c.toPortId === port.id || c.toPort?.toLowerCase() === port.name.toLowerCase()))));
}
function openConnection(from, to, cable = null) {
  if (!from || !to || from.id === to.id || from.type === 'cabinet' || to.type === 'cabinet') { toast('Choose two different devices.'); return; }
  const sources = from.ports.filter(p => portAvailable(from, p, cable)), destinations = to.ports.filter(p => portAvailable(to, p, cable));
  if (!sources.length || !destinations.length) { toast('Both devices need a free interface. Configure ports in equipment details.'); return; }
  connectionDraft = { from: from.id, to: to.id, cable };
  $('#connect-from-label').textContent = `${from.name} interface`;
  $('#connect-to-label').textContent = `${to.name} interface`;
  $('#connect-from').innerHTML = '<option value="">Choose interface</option>' + sources.map(p => `<option value="${esc(p.id)}" ${cable && (cable.fromPortId === p.id || cable.fromPort === p.name) ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  $('#connect-destination').innerHTML = '<option value="">Choose interface</option>' + destinations.map(p => `<option value="${esc(p.id)}" ${cable && (cable.toPortId === p.id || cable.toPort === p.name) ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  closeDialogs(); $('#connect-dialog').showModal();
}
$('#connect-form').addEventListener('submit', event => {
  event.preventDefault();
  const draft = connectionDraft, from = globalAsset(draft?.from), to = globalAsset(draft?.to);
  const a = from?.ports.find(p => p.id === $('#connect-from').value), b = to?.ports.find(p => p.id === $('#connect-destination').value);
  if (!a || !b || !portAvailable(from, a, draft.cable) || !portAvailable(to, b, draft.cable)) { toast('Choose free interfaces on both devices.'); return; }
  const cable = draft.cable || { id: uid(), from: from.id, to: to.id, waypoints: [] };
  Object.assign(cable, { fromPort: a.name, fromPortId: a.id, toPort: b.name, toPortId: b.id });
  if (!draft.cable) project.cables.push(cable);
  connectionDraft = null; closeDialogs(); setMode('select'); save(); render(); toast('Connection updated.');
});
function showConnections() {
  $('#connection-list').innerHTML = project.cables.map(cable => `<div class="inventory-row"><span class="inventory-asset-icon">${icon('link')}</span><div><button class="cable-select" data-cable-select="${esc(cable.id)}"><strong>${esc(globalAsset(cable.from)?.name || 'Unknown')} → ${esc(globalAsset(cable.to)?.name || 'Unknown')}</strong><small>${esc(cable.fromPort || "Interface unspecified")} · ${esc(locationName(cable.from))} → ${esc(cable.toPort || "Interface unspecified")} · ${esc(locationName(cable.to))}</small></button></div><button class="tool-button" data-remove-cable="${esc(cable.id)}" title="Remove cable" aria-label="Remove cable">${icon('trash')}</button></div>`).join('') || '<p class="detail-note">There are no cables in this project yet.</p>';
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
  initializePorts(allAssets(), project.cables);
  const rack = assetById(id);
  $('#rack-title').textContent = rack?.name || 'Racks';
  $('#rack-description').textContent = rack ? 'Double-click a free port to connect it, or a connected port to remove its connection.' : 'Choose a rack to see its devices.';
  const content = $('#rack-content');
  if (!rack) {
    content.innerHTML = project.assets.filter(a => a.type === 'cabinet').map(a => `<button class="inventory-row" data-rack-open="${esc(a.id)}"><span class="inventory-asset-icon">${icon('layers')}</span><div><strong>${esc(a.name)}</strong><small>${project.assets.filter(d => d.rackId === a.id).length} devices</small></div>${icon('chevron')}</button>`).join('') || '<p class="detail-note">Add a cabinet to get started.</p>';
  } else {
    const devices = project.assets.filter(a => a.rackId === rack.id).sort((a, b) => (b.rackStart || 0) - (a.rackStart || 0));
    content.innerHTML = `<button class="text-button" data-rack-open="">← All racks</button><p class="rack-connect-hint" role="status">${pendingPort ? `Selected ${esc(assetById(pendingPort.device)?.name)} · ${esc(pendingPort.port)}. Choose a destination below or double-click another port. <button class="text-button" data-action="cancel-port">Cancel</button>` : 'Double-click a free port to connect it, or a connected port to remove its connection. Keyboard: focus a port and press Enter.'}</p><div class="rack-frame"><svg id="rack-cables" aria-hidden="true"></svg>${devices.map(a => `<div class="rack-panel rack-${esc(a.type)} ${a.id === deviceId ? 'active' : ''}"><div class="rack-bezel"><span class="rack-brand">${esc(a.vendor || typeName(a.type).toUpperCase())}</span><span class="rack-leds" aria-hidden="true">● ● ●</span><button class="rack-device-name" data-rack-device="${esc(a.id)}"><strong>${esc(a.name)}</strong><small>${esc(a.model || typeName(a.type))} · ${a.rackStart && a.rackHeight ? `U${a.rackStart}–${a.rackStart + a.rackHeight - 1}` : 'Position unknown'}</small></button></div><div class="panel-ports">${a.ports.map(p => `<button class="rack-port ${pendingPort?.device === a.id && pendingPort.port === p.name ? 'armed' : ''} ${a.id === deviceId && p.name === portName ? 'active' : ''} ${project.cables.some(c => (c.from === a.id && c.fromPort === p.name) || (c.to === a.id && c.toPort === p.name)) ? 'connected' : ''}" ${portColor(a.id, p.name)} data-port-device="${esc(a.id)}" data-port-name="${esc(p.name)}" title="${esc(p.name)} · ${esc(p.speed)}" aria-label="${esc(a.name)}, port ${esc(p.name)}, ${esc(p.speed)}">${esc(p.name)}</button>`).join('')}</div></div>`).join('') || '<p class="detail-note">No devices assigned to this rack.</p>'}</div><div class="rack-controls">${pendingPort ? `<label class="field rack-color"><span>Connection colour</span><input type="color" id="connection-color" value="${esc(pendingPort.color || '#d9a667')}"></label><label class="field"><span>Connect ${esc(assetById(pendingPort.device)?.name)} · ${esc(pendingPort.port)} to</span><select id="connect-to"><option value="">Choose a device and port</option>${allAssets().filter(a => a.id !== pendingPort.device && a.type !== 'cabinet').map(a => a.ports.filter(p => !project.cables.some(c => (c.from === a.id && c.fromPort?.toLowerCase() === p.name.toLowerCase()) || (c.to === a.id && c.toPort?.toLowerCase() === p.name.toLowerCase()))).map(p => `<option value="${esc(JSON.stringify([a.id, p.name]))}">${esc(a.name)} · ${esc(locationName(a.id))} · ${esc(p.name)}</option>`).join('')).join('')}</select></label>` : rackColorControl(deviceId, portName)}</div>`;
  }
  if (!$('#rack-dialog').open) { closeDialogs(); $('#rack-dialog').showModal(); }
  requestAnimationFrame(drawRackCables);
}
function chooseAsset(id) {
  const at = assetLocation(id);
  if (!at) return;
  if (at.floor !== floor) { workspace.buildingIndex = currentProject.buildings.indexOf(at.building); workspace.floorIndex = at.building.floors.indexOf(at.floor); selectFloor(); resetSelection(); save(); }
  selected = { kind: 'asset', id }; inspectorOpen = true; setMode('select'); closeDialogs(); render();
  if (assetById(id)?.type === 'cabinet') showRacks(id);
}
function chooseCable(id) {
  const cable = currentProject.cables.find(c => c.id === id);
  if (!cable) return;
  if (!assetById(cable.from) && !assetById(cable.to)) {
    const at = assetLocation(cable.from);
    workspace.buildingIndex = currentProject.buildings.indexOf(at.building);
    workspace.floorIndex = at.building.floors.indexOf(at.floor);
    selectFloor(); resetSelection(); save();
  }
  selected = { kind: 'cable', id }; pointIndex = null; inspectorOpen = true; setMode('select'); closeDialogs(); render();
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function projectFilename() { return project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'titan'; }
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
    inspectorOpen = true; setMode('select'); render(); openConnection(from, to); return;
  }
  if (mode === 'double-connect') return;
  if (mode === 'outline') {
    const location = worldAt(event);
    if (!location) { toast('Choose a point within the plan area.'); return; }
    if (outlineDraft.length >= 200) { toast('The outline can have up to 200 points.'); return; }
    outlineDraft.push(location); renderScene(); return;
  }
  if (mode === 'place') {
    const location = worldAt(event), asset = selectedAsset();
    if (!location || !asset) { toast('Choose a point inside the floor plan.'); return; }
    deployAsset(project.assets, asset, ...location);
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
$('#scene').addEventListener('wheel', event => { event.preventDefault(); const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? $('#scene').clientHeight : 1); zoomAt(zoom * Math.exp(-delta * .001), event.clientX, event.clientY); }, { passive: false });
$('#scene').addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  $('#scene').setPointerCapture(event.pointerId);
  if (pointers.size === 2) {
    cancelDrag(); const [a,b] = [...pointers.values()];
    drag = { kind: 'pinch', distance: Math.hypot(a.x-b.x,a.y-b.y), zoom, center: [(a.x+b.x)/2,(a.y+b.y)/2] };
    return;
  }
  const node = event.target.closest('[data-asset]'), asset = node && assetById(node.dataset.asset);
  if (mode !== 'select' && mode !== 'double-connect') return;
  if (mode === 'double-connect' && !asset) return;
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
  drag.moved = true;
  if (mode === 'double-connect') return;
  if (mode === 'outline') {
    const location = worldAt(event);
    if (!location) { toast('Choose a point within the plan area.'); return; }
    if (outlineDraft.length >= 200) { toast('The outline can have up to 200 points.'); return; }
    outlineDraft.push(location); renderScene(); return;
  }
  $('#scene').classList.add('dragging');
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
  if (done.kind === 'asset') {
    ignoreSceneClick = true; setTimeout(() => { ignoreSceneClick = false; }, 0);
    const isDouble = !done.moved && event.pointerType === 'mouse' && lastAssetClick?.id === done.id && event.timeStamp - lastAssetClick.time < 500 && Math.hypot(event.clientX - lastAssetClick.x, event.clientY - lastAssetClick.y) < 8;
    lastAssetClick = !done.moved && !isDouble ? { id: done.id, time: event.timeStamp, x: event.clientX, y: event.clientY } : null;
    if (isDouble && mode === 'select') {
      const asset = assetById(done.id); selected = { kind: 'asset', id: asset.id };
      setMode('double-connect', `Double-click another equipment item to connect to ${asset.name}`);
    } else if (isDouble && mode === 'double-connect') {
      setMode('connect'); ignoreSceneClick = false; handleSceneClick({ target: document.querySelector(`[data-asset="${CSS.escape(done.id)}"]`) });
      if (mode === 'connect') setMode('double-connect', `Double-click another equipment item to connect to ${selectedAsset().name}`);
      ignoreSceneClick = true;
    } else if (mode === 'select') { if (done.moved) save(); chooseAsset(done.id); }
  }
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
  const source = pendingPort && assetById(pendingPort.device), target = globalAsset(device);
  const free = (id, name) => !project.cables.some(c => (c.from === id && c.fromPort?.toLowerCase() === name.toLowerCase()) || (c.to === id && c.toPort?.toLowerCase() === name.toLowerCase()));
  if (!source || !target || source.id === target.id || !source.ports.some(p => p.name === pendingPort.port) || !target.ports.some(p => p.name === port) || !free(source.id, pendingPort.port) || !free(device, port)) { toast('Choose a free port on a different device.'); return; }
  project.cables.push({ id: uid(), from: source.id, fromPort: pendingPort.port, fromPortId: source.ports.find(p => p.name === pendingPort.port).id, to: device, toPort: port, toPortId: target.ports.find(p => p.name === port).id, waypoints: [], label: '', color: pendingPort.color || '#d9a667' });
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
  const validationLink = event.target.closest('[data-validation-target]');
  if (validationLink) { const [i, j] = validationLink.dataset.validationTarget.split(':').map(Number); const ref = validationFindings[i]?.targets[j]; if (ref) openValidationTarget(ref); return; }
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
    case 'show-validation': showValidation(); break;
    case 'edit-connection-ports': { const cable = selectedCable(); if (cable) openConnection(globalAsset(cable.from), globalAsset(cable.to), cable); break; }
    case 'close-dialog': closeDialogs(); break;
    case 'close-inspector': selected = { kind: null, id: null }; inspectorOpen = false; setMode('select'); render(); break;
    case 'import-csv': $('#inventory-file').click(); break;
    case 'download-inventory-template': download('titan-inventory-template.csv', 'name,type,ip,management_url,vendor,model\r\n', 'text/csv;charset=utf-8'); break;
    case 'upload-plan': $('#plan-file').click(); break;
    case 'trace-outline': outlineDraft = []; setMode('outline', 'Click around the floor boundary, then choose Finish outline'); renderScene(); break;
    case 'undo-outline': outlineDraft.pop(); renderScene(); break;
    case 'finish-outline':
      if (outlineDraft.length < 3) { toast('Choose at least three points for the outline.'); break; }
      project.outline = outlineDraft.map(p => [...p]); outlineDraft = []; setMode('select'); save(); render(); toast('Floor outline updated.'); break;
    case 'clear-outline': project.outline = []; save(); render(); toast('Floor outline reset.'); break;
    case 'import-project': $('#project-file').click(); break;
    case 'cancel-mode': outlineDraft = []; inspectorOpen = !!selected.id; setMode('select'); render(); break;
    case 'add-asset': {
      const added = { id: uid(), name: 'New equipment', type: 'switch', zoneId: '', vendor: '', model: '', ip: '', managementUrl: '', placed: false, rackId: '', rackStart: null, rackHeight: null, rackUnits: null, ports: [] };
      project.assets.push(added); selected = { kind: 'asset', id: added.id }; inspectorOpen = true; closeDialogs(); save(); setMode('select'); render(); toast('Equipment added. Edit its details and place it on the plan.'); break;
    }
    case 'place-asset': if (asset) { inspectorOpen = false; renderInspector(); setMode('place', `Choose a position for ${asset.name}`); $('#canvas-card').scrollIntoView({ behavior: 'smooth', block: 'center' }); } break;
    case 'connect-asset':
      if (!asset?.placed) toast('Place this equipment on the plan first.');
      else { inspectorOpen = false; renderInspector(); setMode('connect', `Select equipment to connect to ${asset.name}`); $('#canvas-card').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      break;
    case 'delete-asset':
      if (asset && confirm(`Remove ${asset.name} and its connections?`)) { project.assets = project.assets.filter(a => a.id !== asset.id); project.cables = project.cables.filter(c => c.from !== asset.id && c.to !== asset.id); project.assets.forEach(a => { if (a.rackId === asset.id) Object.assign(a, { rackId: '', rackStart: null, rackHeight: null }); }); selected = { kind: null, id: null }; save(); setMode('select'); render(); toast('Equipment removed.'); }
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
    case 'reset-view': rotation = 0; zoom = defaultZoom; pan = { x: 0, y: 0 }; render(); break;
    case 'export-project': download(`${projectFilename()}.json`, JSON.stringify(serializeProject(currentProject), null, 2), 'application/json'); toast('Project exported.'); break;
    case 'export-svg': {
      const copy = $('#scene').cloneNode(true); copy.querySelectorAll('.route-editor, .route-hit').forEach(node => node.remove()); copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); copy.setAttribute('font-family', 'Inter, Arial, sans-serif');
      download(`${projectFilename()}-floor-plan.svg`, new XMLSerializer().serializeToString(copy), 'image/svg+xml'); toast('Diagram exported as SVG.'); break;
    }
    case 'rename-project': {
      const name = prompt('Project name', project.name)?.trim();
      if (name) { project.name = name.slice(0, 80); save(); render(); }
      break;
    }
    case 'new-project': {
      const name = prompt('Project name', 'Untitled project')?.trim(); if (!name) break;
      workspace.projects.push({ schemaVersion: 1, name: name.slice(0, 80), buildings: [{ id: uid(), name: 'Building 1', floors: [blankFloor()] }], cables: [] });
      workspace.projectIndex = workspace.projects.length - 1; workspace.buildingIndex = 0; workspace.floorIndex = 0; selectFloor(); resetSelection(); save(); render(); break;
    }
    case 'new-building': {
      const name = prompt('Building name', 'New building')?.trim(); if (!name) break;
      currentProject.buildings.push({ id: uid(), name: name.slice(0, 80), floors: [blankFloor()] });
      workspace.buildingIndex = currentProject.buildings.length - 1; workspace.floorIndex = 0; selectFloor(); resetSelection(); save(); render(); break;
    }
    case 'new-floor': {
      const name = prompt('Floor name', 'New floor')?.trim(); if (!name) break;
      building.floors.push({ ...blankFloor(name.slice(0, 80)), outline: (floor.outline || []).map(p => [...p]) }); workspace.floorIndex = building.floors.length - 1; selectFloor(); resetSelection(); save(); render(); break;
    }
    case 'rename-building': { const name = prompt('Building name', building.name)?.trim(); if (name) { building.name = name.slice(0, 80); save(); render(); } break; }
    case 'rename-floor': { const name = prompt('Floor name', floor.floorName)?.trim(); if (name) { floor.floorName = name.slice(0, 80); save(); render(); } break; }

  }
});

document.addEventListener('change', event => {
  const field = event.target, asset = selectedAsset();
  if (['project-select', 'building-select', 'floor-select'].includes(field.id)) {
    if (field.id === 'project-select') { workspace.projectIndex = Number(field.value); workspace.buildingIndex = 0; workspace.floorIndex = 0; }
    if (field.id === 'building-select') { workspace.buildingIndex = Number(field.value); workspace.floorIndex = 0; }
    if (field.id === 'floor-select') workspace.floorIndex = Number(field.value);
    selectFloor(); resetSelection(); save(); render(); return;
  }
  if (field.id === 'asset-floor' && asset) {
    const at = allFloors().find(({ floor: f }) => f.id === field.value);
    if (at && at.floor !== floor) { moveAssetToFloor(floor, at.floor, asset, currentProject.cables); workspace.buildingIndex = currentProject.buildings.indexOf(at.building); workspace.floorIndex = at.building.floors.indexOf(at.floor); selectFloor(); save(); render(); toast('Equipment moved. Place it on the new floor.'); }
    return;
  }
  if (field.id === 'cross-floor-connect' && field.value && asset) {
    const target = globalAsset(field.value);
    if (!target) { toast('Choose another device.'); render(); return; }
    openConnection(asset, target); return;
  }
  if (field.id === 'connection-color') {
    if (pendingPort && !field.dataset.cableId) pendingPort.color = field.value;
    else { const cable = project.cables.find(c => c.id === field.dataset.cableId); if (cable) { cable.color = field.value; save(); showRacks(rackView, field.dataset.deviceId, field.dataset.portName); render(); } }
    return;
  }
  if (field.id === 'connect-to' && field.value) { const [device, port] = JSON.parse(field.value); connectRackPort(device, port); return; }
  if (field.closest('#asset-form') && asset) {
    const key = field.name, value = field.value.trim();
    if (field.dataset.portField) {
      const port = asset.ports[Number(field.dataset.portIndex)], attribute = field.dataset.portField;
      if (!port || !['name', 'speed', 'media', 'poe'].includes(attribute)) return;
      if (attribute === 'poe' && !['unknown', 'source', 'powered', 'none'].includes(value)) return;
      if (attribute === 'name' && (!value || asset.ports.some(p => p !== port && p.name.toLowerCase() === value.toLowerCase()))) { toast('Interface names must be unique and non-empty.'); render(); return; }
      if (attribute === 'name') for (const cable of project.cables) {
        if (cable.from === asset.id && (cable.fromPortId === port.id || cable.fromPort?.toLowerCase() === port.name.toLowerCase())) { cable.fromPort = value; cable.fromPortId = port.id; }
        if (cable.to === asset.id && (cable.toPortId === port.id || cable.toPort?.toLowerCase() === port.name.toLowerCase())) { cable.toPort = value; cable.toPortId = port.id; }
      }
      port[attribute] = value || 'Unknown'; save(); render(); return;
    }
    if (key === 'portCount') { try { if (!value) throw new Error('Enter a port count.'); configurePorts(asset, Number(value), project.cables); save(); } catch (error) { toast(error.message); } render(); return; }
    if (key === 'poeBudget' || key === 'poeDemand') {
      const number = value === '' ? null : Number(value);
      if (number !== null && (!Number.isFinite(number) || number < 0)) { toast('Enter a non-negative number of watts.'); render(); return; }
      asset[key] = number; save(); render(); return;
    }
    if (['rackId', 'rackStart', 'rackHeight', 'rackUnits'].includes(key)) {
      try {
        const number = value === '' ? null : Number(value);
        if (key !== 'rackId' && number !== null && (!Number.isInteger(number) || number < 1 || number > 512)) throw new Error('Enter a whole number between 1 and 512.');
        if (key === 'rackUnits') {
          if (number !== null && project.assets.some(a => a.rackId === asset.id && a.rackStart && a.rackHeight && a.rackStart + a.rackHeight - 1 > number)) throw new Error('Existing rack positions do not fit the capacity.');
          asset.rackUnits = number;
        } else if (key === 'rackId') { assignRack(project.assets, asset, value, asset.rackStart, asset.rackHeight); rackDrafts.delete(asset); }
        else if (asset.rackId && (asset.rackStart == null || asset.rackHeight == null)) {
          const draft = rackDrafts.get(asset) || { rackStart: asset.rackStart, rackHeight: asset.rackHeight };
          draft[key] = number; rackDrafts.set(asset, draft);
          if (draft.rackStart == null || draft.rackHeight == null) { toast('Enter both starting U and height to set the position.'); render(); return; }
          assignRack(project.assets, asset, asset.rackId, draft.rackStart, draft.rackHeight); rackDrafts.delete(asset);
        } else if (asset.rackId) assignRack(project.assets, asset, asset.rackId, key === 'rackStart' ? number : asset.rackStart, key === 'rackHeight' ? number : asset.rackHeight);
        else asset[key] = number;
        save();
      } catch (error) { toast(error.message); }
      render(); return;
    }
    if (key === 'name' && !value) { toast('Equipment name cannot be empty.'); render(); return; }
    if (key === 'managementUrl' && value && !safeManagementUrl(value)) { toast('Use a complete http:// or https:// management URL.'); render(); return; }
    if (key === 'type' && !TYPES.includes(value)) return;
    if (key === 'type' && value !== asset.type && (value === 'cabinet' || asset.type === 'cabinet') && (asset.ports.length || asset.rackId || project.cables.some(c => c.from === asset.id || c.to === asset.id) || project.assets.some(a => a.rackId === asset.id))) { toast('Remove interfaces, connections and rack assignments before changing between a device and rack.'); render(); return; }
    asset[key] = key === 'managementUrl' ? safeManagementUrl(value) : value;
    save(); render();
  }

});

$('#inventory-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('Inventory CSV must be smaller than 2 MB.');
    const result = parseInventory(await file.text(), project.zones, false);
    result.assets.filter(a => ['switch', 'firewall', 'router'].includes(a.type)).forEach(a => { a.rackId = ''; });
    project.assets.push(...result.assets); render();
    if (await save()) toast(`Imported ${result.assets.length} equipment item${result.assets.length === 1 ? '' : 's'}.`);
    if (result.errors.length) alert(`Inventory notes:\n\n${result.errors.slice(0, 30).join('\n')}${result.errors.length > 30 ? `\n…and ${result.errors.length - 30} more.` : ''}`);
  } catch (error) { alert(error.message); }
  event.target.value = '';
});
$('#plan-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  const targetFloor = floor;
  try {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP floor plan.');
    if (file.size > 2_000_000) throw new Error('Floor plan must be smaller than 2 MB for browser storage.');
    const image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read the floor plan.')); reader.readAsDataURL(file); });
    targetFloor.planImage = image; targetFloor.demo = false; render(); if (await save()) toast('Floor plan uploaded.');
  } catch (error) { alert(error.message); }
  event.target.value = '';
});
$('#project-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 50_000_000) throw new Error('Project file must be smaller than 50 MB.');
    const imported = restoreHierarchy(JSON.parse(await file.text()));
    workspace.projects.push(imported); workspace.projectIndex = workspace.projects.length - 1; workspace.buildingIndex = 0; workspace.floorIndex = 0; selectFloor(); resetSelection(); render();
    if (await save()) toast('Project imported.');
  } catch (error) { alert(`Could not import project: ${error.message}`); }
  event.target.value = '';
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (drag) { cancelDrag(); pointers.clear(); return; }
  if (mode !== 'select') { outlineDraft = []; inspectorOpen = !!selected.id; setMode('select'); render(); }
  else if (!$('.inspector').hidden) { selected = { kind: null, id: null }; inspectorOpen = false; render(); }
});
render();
if (loadError) { unsaved = true; $('#save-status').textContent = 'Storage unavailable'; toast('Existing browser data could not be loaded. Saving is disabled to protect it.', 12000); }
else if (migrated) save().then(saved => {
  if (saved) try { if (localStorage.getItem(migrated[0]) === migrated[1]) localStorage.removeItem(migrated[0]); } catch { /* The IndexedDB copy is already committed. */ }
});
else if (upgrade) save();

window.addEventListener('resize', drawRackCables);

$('#rack-dialog').addEventListener('close', () => { pendingPort = null; });
