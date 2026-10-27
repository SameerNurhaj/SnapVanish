// Isolated-world bridge: chrome.storage / popup  <->  page-world inject.js
const post = (type, payload = {}) =>
  window.postMessage({ __snapvanish: true, dir: 'in', type, ...payload }, '*');

async function sendAll() {
  try {
    const s = await chrome.storage.sync.get({ enabled: true, sensitivity: 50 });
    post('settings', { settings: s });
    const l = await chrome.storage.local.get({ plate: null });
    if (l.plate) post('plate', { dataUrl: l.plate });
  } catch (e) { /* extension was reloaded */ }
}
sendAll();

window.addEventListener('message', (e) => {
  const m = e.data;
  if (e.source !== window || !m || m.__snapvanish !== true || m.dir !== 'out') return;
  if (m.type === 'hello') sendAll();
  if (m.type === 'save-plate') chrome.storage.local.set({ plate: m.dataUrl });
});

chrome.storage.onChanged.addListener((_c, area) => { if (area === 'sync') sendAll(); });

chrome.runtime.onMessage.addListener((m) => {
  if (m.cmd === 'capture-plate') post('capture-plate');
  if (m.cmd === 'test-snap') post('test-snap');
  if (m.cmd === 'clear-plate') { chrome.storage.local.remove('plate'); post('clear-plate'); }
});
