export const TYPES = ['cabinet', 'switch', 'router', 'firewall', 'access_point', 'patch_panel'];

export function placeAsset(asset, zones, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Position must be finite.');
  x = Math.round(Math.max(0, Math.min(100, x)) * 100) / 100;
  y = Math.round(Math.max(0, Math.min(100, y)) * 100) / 100;
  const zone = zones.filter(z => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h).sort((a, b) => a.w * a.h - b.w * b.h)[0];
  return { ...asset, x, y, placed: true, zoneId: zone?.id || '' };
}

export function safeManagementUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function csvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { field += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field.trim()); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted field.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseInventory(text, zones) {
  const rows = csvRows(text);
  const headers = (rows.shift() || []).map(value => value.toLowerCase().replace(/[\s-]+/g, '_'));
  if (!headers.includes('name') || !headers.includes('type')) throw new Error('CSV needs name and type columns.');
  const assets = [], errors = [];
  rows.forEach((values, index) => {
    const row = Object.fromEntries(headers.map((header, i) => [header, values[i] || '']));
    let type = row.type.toLowerCase().replace(/[\s-]+/g, '_');
    if (type === 'rack') type = 'cabinet';
    if (type === 'ap') type = 'access_point';
    if (!row.name || !TYPES.includes(type)) {
      errors.push(`Row ${index + 2}: ${!row.name ? 'name is required' : `unsupported type “${row.type}”`}.`);
      return;
    }
    const zone = zones.find(z => z.name.toLowerCase() === (row.zone || '').toLowerCase());
    const link = row.management_url || row.url || '';
    if (row.zone && !zone) errors.push(`Row ${index + 2}: zone “${row.zone}” was not found; assign it after import.`);
    if (link && !safeManagementUrl(link)) errors.push(`Row ${index + 2}: invalid management URL was omitted.`);
    assets.push({ id: crypto.randomUUID(), name: row.name, type, zoneId: zone?.id || '', ip: row.ip || '', managementUrl: safeManagementUrl(link), model: row.model || '', placed: false });
  });
  return { assets, errors };
}

export function autoPlace(assets, zones) {
  const result = assets.map(asset => ({ ...asset }));
  for (const zone of zones) {
    const pending = result.filter(asset => asset.zoneId === zone.id && !asset.placed);
    const occupied = result.filter(asset => asset.zoneId === zone.id && asset.placed);
    if (!pending.length || zone.w <= 0 || zone.h <= 0) continue;
    const count = pending.length + occupied.length;
    const columns = Math.max(1, Math.ceil(Math.sqrt(count * zone.w / zone.h)));
    const rows = Math.ceil((count + occupied.length + 1) / columns);
    const minDistance = Math.min(zone.w / (columns + 1), zone.h / (rows + 1)) * 0.4;
    let slot = 0;
    for (const asset of pending) {
      while (slot < columns * rows) {
        const x = zone.x + zone.w * ((slot % columns) + 1) / (columns + 1);
        const y = zone.y + zone.h * (Math.floor(slot / columns) + 1) / (rows + 1);
        slot++;
        if (occupied.some(other => Math.hypot(other.x - x, other.y - y) < minDistance)) continue;
        Object.assign(asset, { x, y, placed: true });
        occupied.push(asset);
        break;
      }
    }
  }
  return result;
}

export function restoreProject(input) {
  const invalid = () => { throw new Error('Invalid project file.'); };
  if (!input || typeof input.name !== 'string' || !Array.isArray(input.zones) || !Array.isArray(input.assets) || !Array.isArray(input.cables)) invalid();
  const ids = new Set();
  const zones = input.zones.map(zone => {
    if (!zone || typeof zone.id !== 'string' || !zone.id || ids.has(zone.id) || typeof zone.name !== 'string' || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(zone[key])) || zone.x < 0 || zone.y < 0 || zone.w <= 0 || zone.h <= 0 || zone.x + zone.w > 100 || zone.y + zone.h > 100) invalid();
    ids.add(zone.id);
    return { id: zone.id, name: zone.name, x: zone.x, y: zone.y, w: zone.w, h: zone.h };
  });
  ids.clear();
  const assets = input.assets.map(asset => {
    if (!asset || typeof asset.id !== 'string' || !asset.id || ids.has(asset.id) || typeof asset.name !== 'string' || !TYPES.includes(asset.type) || (asset.placed && (!Number.isFinite(asset.x) || !Number.isFinite(asset.y) || asset.x < 0 || asset.y < 0 || asset.x > 100 || asset.y > 100))) invalid();
    ids.add(asset.id);
    return { id: asset.id, name: asset.name, type: asset.type, zoneId: zones.some(zone => zone.id === asset.zoneId) ? asset.zoneId : '', ip: String(asset.ip || ''), model: String(asset.model || ''), managementUrl: safeManagementUrl(asset.managementUrl), placed: !!asset.placed, x: asset.placed ? asset.x : null, y: asset.placed ? asset.y : null };
  });
  const cables = input.cables.map(cable => {
    if (!cable || typeof cable.id !== 'string' || !ids.has(cable.from) || !ids.has(cable.to) || cable.from === cable.to) invalid();
    return { id: cable.id, from: cable.from, to: cable.to };
  });
  const planImage = typeof input.planImage === 'string' && /^data:image\/(png|jpeg|webp);base64,/i.test(input.planImage) ? input.planImage : '';
  return { name: input.name, floorName: typeof input.floorName === 'string' ? input.floorName : 'Ground floor', planImage, demo: !!input.demo && !planImage, zones, assets, cables };
}
