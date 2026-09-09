import { chromium } from '@playwright/test';

// Compatibility helper for an already-running relay from before auto-approval.
// Uses the bound room's host credential; never controls unrelated rooms.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
let startRequested = process.argv.includes('--start');
let reported = '';
while (browser.isConnected()) {
  try {
    const worker = ctx.serviceWorkers().find(w => w.url().startsWith('chrome-extension:'));
    if (!worker) throw new Error('Waiting for karaoke extension');
    const binding = await worker.evaluate(async () => (await chrome.storage.session.get('binding')).binding);
    if (!binding) throw new Error('Waiting for a room');
    const url = new URL(binding.controllerUrl);
    const endpoint = `${url.origin}/api/gate/sessions/${binding.sessionId}/queue`;
    const headers = { Authorization: `Bearer ${url.hash.slice(1)}`, 'Content-Type': 'application/json' };
    const response = await fetch(endpoint, { headers });
    if (!response.ok) throw new Error(`Room returned ${response.status}`);
    const snapshot = await response.json();
    for (const item of snapshot.queue.items.filter(item => item.status === 'pending')) {
      const approved = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ action: 'approve', itemId: item.id }) });
      if (!approved.ok) throw new Error(`Approval returned ${approved.status}`);
      console.log('Approved waiting song');
    }
    if (startRequested && snapshot.playback.connected && snapshot.playback.observation && snapshot.queue.items.some(item => item.status === 'queued')) {
      const started = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ action: 'start-next' }) });
      const result = await started.json();
      if (started.ok) { startRequested = false; console.log('Requested next singer'); }
      else if (reported !== result.message) { reported = result.message; console.log(reported); }
    }
    const status = `Room ${binding.sessionId}: ${snapshot.playback.status}; connected=${snapshot.playback.connected}; pending=${snapshot.queue.items.filter(x => x.status === 'pending').length}`;
    if (status !== reported) { reported = status; console.log(status); }
  } catch (error) {
    if (reported !== error.message) { reported = error.message; console.log(reported); }
  }
  await new Promise(resolve => setTimeout(resolve, 500));
}
