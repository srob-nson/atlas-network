const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('titan-workspace', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('workspace');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Browser storage is blocked by another tab.'));
});

export async function loadWorkspace() {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readonly');
    const request = transaction.objectStore('workspace').get('current');
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = transaction.onerror = () => reject(transaction.error || request.error);
  });
}

export async function storeWorkspace(workspace) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readwrite');
    transaction.objectStore('workspace').put(workspace, 'current');
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Storage failed.'));
  });
}
