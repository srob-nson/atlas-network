const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function rackUI(getProject, save, refresh, canAssignRack) {
  const dialog = document.createElement('dialog');
  dialog.className = 'inventory-dialog';
  document.body.append(dialog);
  let cabinetId;
  const options = (items, value, empty) => `<option value="">${empty}</option>` + items.map(i => `<option value="${esc(i.id)}" ${i.id === value ? 'selected' : ''}>${esc(i.name || i.label)}</option>`).join('');
  function draw() {
    const project = getProject(), cabinet = project.assets.find(a => a.id === cabinetId);
    if (!cabinet) { dialog.close(); return; }
    const occupants = project.assets.filter(a => a.cabinetId === cabinet.id);
    dialog.innerHTML = `<div class="dialog-header"><div><h2>${esc(cabinet.name)} front</h2><p>Rack units, bottom to top</p></div><button type="button" data-rack-close aria-label="Close rack">×</button></div>
      <label class="field">Cabinet capacity (U)<input data-capacity type="number" min="1" max="1000" value="${cabinet.capacity ?? 42}"></label>
      <div class="inventory-list">${Array.from({length: cabinet.capacity ?? 42}, (_, i) => (cabinet.capacity ?? 42) - i).map(u => { const a = occupants.find(a => u >= a.rackUnit && u < a.rackUnit + (a.rackHeight ?? 1)); return `<div class="inventory-row"><strong>U${u}</strong><span>${a ? `${esc(a.name)}${a.ports?.length ? ` · ${a.ports.map(p => esc(p.label)).join(', ')}` : ''}` : '—'}</span></div>`; }).join('')}</div>
      <h3>Assign equipment</h3><form data-assign><label class="field">Equipment<select name="asset" required>${options(project.assets.filter(a => a.type !== 'cabinet'), '', 'Select equipment')}</select></label><label class="field">Starting unit<input name="unit" type="number" min="1" required value="1"></label><label class="field">Height (U)<input name="height" type="number" min="1" required value="1"></label><button class="button primary">Assign</button></form>
      ${occupants.map(a => `<div class="inventory-row"><strong>${esc(a.name)} · U${a.rackUnit}–${a.rackUnit + (a.rackHeight ?? 1) - 1}</strong><button data-unassign="${esc(a.id)}">Unassign</button></div>`).join('')}`;
  }
  function update() { save(); refresh(); draw(); }
  dialog.addEventListener('click', e => {
    if (e.target.closest('[data-rack-close]')) dialog.close();
    const unassign = e.target.closest('[data-unassign]');
    if (unassign) { const asset = getProject().assets.find(a => a.id === unassign.dataset.unassign); asset.cabinetId = ''; asset.rackUnit = null; update(); }
  });
  dialog.addEventListener('change', e => {
    if (!e.target.matches('[data-capacity]')) return;
    const cabinet = getProject().assets.find(a => a.id === cabinetId), capacity = Number(e.target.value);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000 || getProject().assets.some(a => a.cabinetId === cabinetId && a.rackUnit + (a.rackHeight ?? 1) - 1 > capacity)) { alert('Capacity must contain all assigned equipment.'); draw(); return; }
    cabinet.capacity = capacity; update();
  });
  dialog.addEventListener('submit', e => {
    if (!e.target.matches('[data-assign]')) return;
    e.preventDefault(); const data = new FormData(e.target), asset = getProject().assets.find(a => a.id === data.get('asset')), unit = Number(data.get('unit')), height = Number(data.get('height'));
    if (!asset || !canAssignRack(getProject().assets, asset.id, cabinetId, unit, height)) { alert('Choose available rack units within the cabinet.'); return; }
    Object.assign(asset, {cabinetId, rackUnit: unit, rackHeight: height}); update();
  });
  return id => { cabinetId = id; draw(); dialog.showModal(); };
}

export function portUI(getProject, save, refresh) {
  const dialog = document.createElement('dialog'); dialog.className = 'inventory-dialog'; document.body.append(dialog);
  let assetId;
  function draw() {
    const asset = getProject().assets.find(a => a.id === assetId);
    dialog.innerHTML = `<div class="dialog-header"><h2>${esc(asset.name)} ports</h2><button type="button" data-close aria-label="Close ports">×</button></div><form data-add-port><label class="field">Port label<input name="label" required maxlength="80"></label><button class="button primary">Add port</button></form>${(asset.ports || []).map(p => `<div class="inventory-row"><label class="field">Port label<input data-port-label="${esc(p.id)}" value="${esc(p.label)}" required maxlength="80"></label><button data-remove-port="${esc(p.id)}">Remove</button></div>`).join('')}`;
  }
  dialog.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) dialog.close();
    const button = e.target.closest('[data-remove-port]'); if (!button) return;
    const project = getProject(), id = button.dataset.removePort, asset = project.assets.find(a => a.id === assetId);
    const used = project.cables.filter(c => (c.from === assetId && c.fromPort === id) || (c.to === assetId && c.toPort === id));
    if (used.length && !confirm('This port is used by a cable. Clear its cable endpoint?')) return;
    used.forEach(c => { if (c.from === assetId && c.fromPort === id) c.fromPort = ''; if (c.to === assetId && c.toPort === id) c.toPort = ''; });
    asset.ports = asset.ports.filter(p => p.id !== id); save(); refresh(); draw();
  });
  dialog.addEventListener('change', e => {
    if (!e.target.matches('[data-port-label]')) return;
    const label = e.target.value.trim(); if (!label) { alert('Port label cannot be empty.'); draw(); return; }
    getProject().assets.find(a => a.id === assetId).ports.find(p => p.id === e.target.dataset.portLabel).label = label; save(); refresh(); draw();
  });
  dialog.addEventListener('submit', e => {
    e.preventDefault(); const label = new FormData(e.target).get('label').trim(); if (!label) return;
    const asset = getProject().assets.find(a => a.id === assetId); (asset.ports ||= []).push({id: crypto.randomUUID(), label}); save(); refresh(); draw();
  });
  return id => { assetId = id; draw(); dialog.showModal(); };
}
