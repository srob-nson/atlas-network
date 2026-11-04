import { round, rotatePoint, projectPoint } from './geometry.js';
import { cableRoute, serializeProject } from './model.js?v=17';
import { routeStatus } from './physical.js?v=1';
import { escapeHtml as esc, typeName } from './ui.js';

export function drawScene({ scene, floor, project, currentProject, selected, view, rotation, zoom, pan, mode, outlineDraft, pathwayDraft, pointIndex, selectedCable, assetById, crossFloor, globalAsset, locationName, physicalAnchors }) {
  const rotated = (x, y) => rotatePoint(x, y, rotation);
  const point = (x, y, z = 0) => projectPoint(x, y, z, rotation, view);
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
    const width = 900 / zoom, height = 500 / zoom;
    scene.setAttribute('viewBox', `${500-width/2 + pan.x} ${285-height/2 + pan.y} ${width} ${height}`);
    const outline = project.outline?.length ? project.outline : [[0,0],[100,0],[100,100],[0,100]];
    const p00 = point(0,0), p10 = point(100,0), p01 = point(0,100);
    const matrix = `${round((p10[0]-p00[0])/100)} ${round((p10[1]-p00[1])/100)} ${round((p01[0]-p00[0])/100)} ${round((p01[1]-p00[1])/100)} ${round(p00[0])} ${round(p00[1])}`;
    let out = `<defs><filter id="floorShadow" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur stdDeviation="12"/></filter><filter id="tagShadow" x="-30%" y="-50%" width="160%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#355b42" flood-opacity=".12"/></filter><clipPath id="floorClip">${poly(outline, '#fff')}</clipPath></defs>`;
    if (view === '3d') {
      const shadow = outline.map(([x,y]) => { const [a,b] = point(x,y); return `${round(a+8)},${round(b+20)}`; }).join(' ');
      out += `<polygon points="${shadow}" fill="#829c86" opacity=".14" filter="url(#floorShadow)"/>`;
      const ground = outline.map(([x,y]) => point(x,y));
      for (let i = 0; i < ground.length; i++) {
        const a = ground[i], b = ground[(i + 1) % ground.length];
        if (b[0] > a[0]) out += `<polygon points="${a.map(round).join(',')} ${b.map(round).join(',')} ${round(b[0])},${round(b[1]+13)} ${round(a[0])},${round(a[1]+13)}" fill="#c8d7c8"/>`;
      }
    }
    out += poly(outline, '#f1f5ed', 'stroke="#b9cbbb" stroke-width="1.5" data-floor="true"');
    if (project.planImage) out += `<g ${mode === 'outline' ? '' : 'clip-path="url(#floorClip)"'} pointer-events="none"><image href="${esc(project.planImage)}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet" transform="matrix(${matrix})" opacity=".8"/></g>`;
    if (mode === 'outline' && outlineDraft.length) {
      out += `<polyline points="${points(outlineDraft)}" fill="none" stroke="#277754" stroke-width="3" stroke-dasharray="7 4" pointer-events="none"/>`;
      for (const [x,y] of outlineDraft) { const [px,py] = point(x,y); out += `<circle cx="${round(px)}" cy="${round(py)}" r="5" fill="#277754" stroke="white" stroke-width="2" pointer-events="none"/>`; }
    }
    out += demoFurniture() + demoWalls();
    const selectedRoute = selectedCable()?.route;
    const selectedData = selectedCable() ? serializeProject(currentProject) : null;
    const physicalState = selectedData ? routeStatus(selectedData, selectedData.connections.find(c => c.id === selectedCable().id)) : 'conceptual';
    for (const path of currentProject.pathways.filter(item => item.floorId === floor.id)) {
      const active = selectedRoute?.pathwayIds?.includes(path.id), color = active && physicalState === 'reviewed' ? '#248568' : '#547a9b';
      out += `<polyline data-pathway="${esc(path.id)}" points="${points(path.points.map(p => [p.x, p.y]))}" fill="none" stroke="${color}" stroke-width="${active ? 4 : 2}" stroke-dasharray="${active && physicalState === 'reviewed' ? '' : '7 4'}" pointer-events="none"><title>${esc(path.name)} · ${active && physicalState === 'reviewed' ? 'manually reviewed route' : 'pathway, not verified'}</title></polyline>`;
    }
    for (const riser of currentProject.risers) for (const end of [riser.from, riser.to]) if (end.floorId === floor.id) {
      const [x, y] = point(end.x, end.y);
      out += `<g data-riser="${esc(riser.id)}" pointer-events="none"><circle cx="${round(x)}" cy="${round(y)}" r="6" fill="#fff" stroke="#547a9b" stroke-width="2"/><title>${esc(riser.name)} · riser endpoint</title></g>`;
    }
    if (mode === 'pathway') {
      if (pathwayDraft.length) out += `<polyline points="${points(pathwayDraft.map(p => [p.x, p.y]))}" fill="none" stroke="#365f85" stroke-width="3" stroke-dasharray="6 4" pointer-events="none"/>`;
      for (const anchor of physicalAnchors()) { const [x, y] = point(anchor.x, anchor.y); out += `<circle cx="${round(x)}" cy="${round(y)}" r="4" fill="#fff" stroke="#365f85" stroke-width="1.5" pointer-events="none"/>`; }
    }
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
      out += `<polyline data-cable="${esc(cable.id)}" tabindex="0" role="button" aria-label="Conceptual connection ${esc(a.name)} to ${esc(b.name)}" points="${path}" fill="none" stroke="${cable === editing ? '#b3742f' : esc(cable.color || '#d9a667')}" stroke-width="${cable === editing ? 3 : 2.1}" stroke-dasharray="5 4" stroke-linejoin="round" stroke-linecap="round"/>`;
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

  renderScene();
}
