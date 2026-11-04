import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, typeName } from '../dist/ui.js';

test('equipment labels are readable and user text is escaped', () => {
  assert.equal(typeName('ip_camera'), 'IP camera');
  assert.equal(typeName('future_type'), 'future_type');
  assert.equal(escapeHtml(`<img src="x" onerror='bad'>&`), '&lt;img src=&quot;x&quot; onerror=&#39;bad&#39;&gt;&amp;');
});
