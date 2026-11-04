// The browser tests use an isolated preview profile and seed IndexedDB directly.
export function browserEvaluate(send) {
  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const read = () => run(`new Promise((resolve, reject) => { const request = indexedDB.open('titan-workspace'); request.onerror = reject; request.onsuccess = () => { const db = request.result, tx = db.transaction('workspace'); const get = tx.objectStore('workspace').get('current'); tx.oncomplete = () => { db.close(); resolve(get.result ?? null); }; tx.onerror = reject; }; })`);
  const write = value => run(`new Promise((resolve, reject) => { const request = indexedDB.open('titan-workspace'); request.onerror = reject; request.onsuccess = () => { const db = request.result, tx = db.transaction('workspace', 'readwrite'), store = tx.objectStore('workspace'); ${value === null ? 'store.delete("current")' : `store.put(${JSON.stringify(value)}, 'current')`}; tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject; }; })`);
  return async expression => {
    if (/localStorage\.(?:setItem|removeItem|clear)\(/.test(expression)) {
      const reload = expression.includes('location.reload()');
      const result = await run(expression.replace(/location\.reload\(\);?/g, ''));
      const raw = await run(`localStorage.getItem('titan-workspace-v2')`);
      await write(raw === null ? null : JSON.parse(raw));
      if (reload) await send('Page.reload', { ignoreCache: true });
      return result;
    }
    if (/localStorage\.getItem\(['"]titan-workspace-v2['"]\)/.test(expression)) {
      await new Promise(resolve => setTimeout(resolve, 50));
      await run(`new Promise((resolve, reject) => { const deadline = Date.now() + 5000; const check = () => { if (document.querySelector('#save-status')?.textContent !== 'Saving…') resolve(); else if (Date.now() > deadline) reject(new Error('Save timed out')); else setTimeout(check, 10); }; check(); })`);
      const value = await read();
      expression = expression.replace(/localStorage\.getItem\(['"]titan-workspace-v2['"]\)/g, JSON.stringify(value === null ? null : JSON.stringify(value)));
    }
    return run(expression);
  };
}
