let opened;
export function database() {
  return opened ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('hymn-stats', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('records', { keyPath: 'id' }); req.result.createObjectStore('settings'); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function operation(store, mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode), request = action(tx.objectStore(store)); let result;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Local save was interrupted.'));
  });
}
export const local = {
  all: () => operation('records', 'readonly', s => s.getAll()),
  get: (id) => operation('records', 'readonly', s => s.get(id)),
  put: (record) => operation('records', 'readwrite', s => s.put(structuredClone(record))),
  setting: (key) => operation('settings', 'readonly', s => s.get(key)),
  setSetting: (key, value) => operation('settings', 'readwrite', s => s.put(value, key)),
};
export function download(value, filename, type = 'application/json') {
  const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type });
  const url = URL.createObjectURL(blob), link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
