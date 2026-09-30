'use strict';

/*
 * Spiegel der Daten in IndexedDB. localStorage ist im Service Worker nicht verfügbar,
 * IndexedDB schon – so kann er beim Eintreffen einer Erinnerung den Baum berechnen.
 */
const Mirror = (() => {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open('gewohnheiten', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  return {
    put: (key, value) => run('readwrite', (s) => s.put(value, key)),
    get: (key) => run('readonly', (s) => s.get(key)),
  };
})();
