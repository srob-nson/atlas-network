export const $ = selector => document.querySelector(selector);
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const typeName = type => ({ cabinet: 'Cabinet', switch: 'Switch', router: 'Router', firewall: 'Firewall', access_point: 'Access point', patch_panel: 'Patch panel', plc: 'PLC', rtu: 'RTU', hmi: 'HMI', engineering_workstation: 'Engineering workstation', server: 'Server', workstation: 'Workstation', ip_camera: 'IP camera', nvr: 'Network video recorder', access_controller: 'Access controller', sensor: 'Sensor', meter: 'Meter', drive: 'Drive', ied: 'IED', gateway: 'Gateway', printer: 'Printer', other: 'Other IP device' })[type] || type;
export const typeIcon = type => type === 'access_point' ? 'nodes' : type === 'cabinet' ? 'layers' : 'box';

export function setupQuestion(closeDialogs) {
  let resolveQuestion = null, kind = '';
  $('#question-form').addEventListener('submit', event => {
    event.preventDefault();
    const value = $('#question-input').value.trim();
    if (kind === 'text' && (!value || value.length > 80)) { $('#question-error').textContent = 'Enter a name of up to 80 characters.'; $('#question-input').focus(); return; }
    const resolve = resolveQuestion; resolveQuestion = null; $('#question-dialog').close(); resolve?.(kind === 'text' ? value : true);
  });
  $('#question-cancel').addEventListener('click', () => $('#question-dialog').close());
  $('#question-dialog').addEventListener('close', () => { const resolve = resolveQuestion; resolveQuestion = null; resolve?.(null); });
  return function question(title, message = '', initial = '', nextKind = 'text') {
    closeDialogs(); kind = nextKind;
    $('#question-title').textContent = title; $('#question-message').textContent = message;
    $('#question-label').textContent = title; $('#question-field').hidden = kind !== 'text';
    $('#question-input').value = initial; $('#question-input').required = kind === 'text';
    $('#question-error').textContent = ''; $('#question-cancel').hidden = kind === 'notice';
    $('#question-submit').textContent = kind === 'text' ? 'Save' : kind === 'confirm' ? 'Remove' : 'OK';
    $('#question-dialog').showModal();
    if (kind === 'text') { $('#question-input').focus(); $('#question-input').select(); }
    return new Promise(resolve => { resolveQuestion = resolve; });
  };
}
