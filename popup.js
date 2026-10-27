const $ = (id) => document.getElementById(id);
const say = (t) => { $('msg').textContent = t; };

chrome.storage.sync.get({ enabled: true, sensitivity: 50 }).then((s) => {
  $('enabled').checked = s.enabled;
  $('sens').value = s.sensitivity;
  $('sensVal').textContent = s.sensitivity;
});
$('enabled').addEventListener('change', () => chrome.storage.sync.set({ enabled: $('enabled').checked }));
$('sens').addEventListener('input', () => {
  $('sensVal').textContent = $('sens').value;
  chrome.storage.sync.set({ sensitivity: Number($('sens').value) });
});

async function send(cmd, okText) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { cmd });
    say(okText);
    if (cmd === 'capture-plate') setTimeout(() => window.close(), 600);
  } catch (e) {
    say('Open a Google Meet tab first, then reload it once.');
  }
}
$('plate').addEventListener('click', () => send('capture-plate', 'Step out of frame. A 5 second countdown is on the call page.'));
$('test').addEventListener('click', () => send('test-snap', 'Snap sent to the call.'));
$('clear').addEventListener('click', () => send('clear-plate', 'Saved room removed.'));
