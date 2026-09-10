import { browser } from 'wxt/browser';
import { HostMessage, ServerMessage, type GateState } from '@karaoke/contracts';

type Binding = { sessionId: string; extensionToken: string; controllerUrl: string; viewerUrl: string; joinUrl?: string; roomCode?: string; tabId: number; documentId: string };

export default defineBackground(() => {
  let binding: Binding | undefined;
  let host: ReturnType<typeof browser.runtime.connect> | undefined;
  let socket: WebSocket | undefined;
  let state: GateState | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let attempts = 0;
  let busy = false;
  let connecting = false;
  let lastError = '';
  const hydrated = browser.storage.session.get('binding').then(data => { binding = data.binding as Binding | undefined; });

  async function api(path: string, options: RequestInit = {}) {
    const response = await fetch(`${__SERVICE_ORIGIN__}/api/gate/${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(binding ? { Authorization: `Bearer ${binding.extensionToken}` } : {}), ...options.headers },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || `Service error ${response.status}`);
    return body;
  }
  function stopSocket() {
    clearTimeout(retryTimer); clearInterval(heartbeat);
    retryTimer = undefined; heartbeat = undefined;
    const previous = socket; socket = undefined;
    previous?.close();
  }
  function hostSend(message: unknown) { try { host?.postMessage(message); } catch { lastError = 'Host document disconnected. Reattach from the extension.'; } }
  async function connect() {
    if (!binding || !host || connecting || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    connecting = true;
    const current = binding;
    try {
      const { ticket } = await api(`sessions/${current.sessionId}/ticket`, { method: 'POST' });
      if (binding !== current || !host) return;
      const url = new URL(`/api/gate/sessions/${current.sessionId}/stream`, __SERVICE_ORIGIN__);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(url.href); socket = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'authenticate', ticket }));
        clearInterval(heartbeat);
        heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat' })); }, 20_000);
      };
      ws.onmessage = event => {
        let raw; try { raw = JSON.parse(event.data); } catch { ws.close(1008, 'Invalid service message'); return; }
        const parsed = ServerMessage.safeParse(raw);
        if (!parsed.success || binding !== current || socket !== ws) return;
        if (parsed.data.type === 'state') { state = parsed.data.state; attempts = 0; lastError = ''; hostSend(parsed.data); }
        else if (parsed.data.type === 'command') hostSend(parsed.data);
      };
      ws.onclose = () => {
        if (socket !== ws) return;
        socket = undefined; clearInterval(heartbeat);
        if (state) { state = { ...state, connected: false }; hostSend({ type: 'state', state }); }
        scheduleReconnect();
      };
      ws.onerror = () => { lastError = 'Cannot connect to the test relay.'; };
    } catch (error) { lastError = error instanceof Error ? error.message : 'Connection failed.'; scheduleReconnect(); }
    finally { connecting = false; }
  }
  function scheduleReconnect() {
    if (!binding || !host || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = undefined; void connect(); }, Math.min(5000, 500 * 2 ** Math.min(attempts++, 3)) + Math.random() * 300);
  }
  async function detach(closeSession: boolean) {
    hostSend({ type: 'detach' }); host = undefined;
    stopSocket();
    if (binding && closeSession) await api(`sessions/${binding.sessionId}/close`, { method: 'POST' }).catch(() => undefined);
    binding = undefined; state = undefined;
    await browser.storage.session.remove('binding');
    await browser.alarms.clear('karaoke-recover');
  }
  async function attach(tabId: number) {
    if (busy) throw new Error('Attachment already in progress.');
    busy = true;
    try {
      const tab = await browser.tabs.get(tabId);
      const url = new URL(tab.url ?? 'about:blank');
      if (url.origin !== 'https://www.youtube.com' || url.pathname !== '/watch') throw new Error('Open a regular YouTube watch page first.');
      await detach(true);
      const [probe] = await browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: () => location.href });
      if (!probe?.documentId) throw new Error('Cannot identify this YouTube document.');
      const session = await api('sessions', { method: 'POST' });
      binding = { ...session, tabId, documentId: probe.documentId };
      await browser.storage.session.set({ binding });
      await browser.scripting.executeScript({ target: { tabId, documentIds: [binding!.documentId] }, files: ['/host.js'], world: 'ISOLATED' });
      await browser.alarms.create('karaoke-recover', { periodInMinutes: 1 });
      lastError = '';
      return { controllerUrl: binding!.controllerUrl, viewerUrl: binding!.viewerUrl, sessionId: binding!.sessionId, roomCode: binding!.roomCode, recoveryCode: session.recoveryCode };
    } catch (error) { await detach(true); throw error; }
    finally { busy = false; }
  }
  async function recover(sessionId: string, recoveryCode: string) {
    if (!sessionId || !recoveryCode) throw new Error('Enter the room ID and recovery code.');
    const response = await fetch(`${__SERVICE_ORIGIN__}/api/gate/sessions/${sessionId}/recover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recoveryCode }) });
    const restored = await response.json(); if (!response.ok) throw new Error(restored.message || 'Recovery failed.');
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw new Error('Open the bound YouTube watch page before restoring.');
    const url = new URL(tab.url ?? 'about:blank'); if (url.origin !== 'https://www.youtube.com' || url.pathname !== '/watch') throw new Error('Open a regular YouTube watch page before restoring.');
    await detach(false);
    const [probe] = await browser.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: () => location.href }); if (!probe?.documentId) throw new Error('Cannot identify this YouTube document.');
    const restoredBinding: Binding = { ...restored, tabId: tab.id, documentId: probe.documentId };
    binding = restoredBinding;
    await browser.storage.session.set({ binding: restoredBinding });
    await browser.scripting.executeScript({ target: { tabId: tab.id, documentIds: [restoredBinding.documentId] }, files: ['/host.js'], world: 'ISOLATED' });
    await browser.alarms.create('karaoke-recover', { periodInMinutes: 1 });
    return { controllerUrl: restoredBinding.controllerUrl, sessionId: restoredBinding.sessionId, roomCode: restoredBinding.roomCode };
  }
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== 'karaoke-host-v1') { port.disconnect(); return; }
    void hydrated.then(() => {
      if (!binding || port.sender?.tab?.id !== binding.tabId || port.sender.documentId !== binding.documentId || port.sender.frameId !== 0) { port.disconnect(); return; }
      host?.disconnect(); host = port;
      const current = binding;
      port.onMessage.addListener(raw => {
        if (host !== port || binding !== current) return;
        if (raw?.type === 'ready') {
          void browser.scripting.executeScript({ target: { tabId: current.tabId, documentIds: [current.documentId] }, files: ['/bridge.js'], world: 'MAIN' }).then(connect).catch(error => { lastError = String(error); });
          return;
        }
        const parsed = HostMessage.safeParse(raw);
        if (!parsed.success) return;
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(parsed.data));
      });
      port.onDisconnect.addListener(() => {
        if (host !== port) return;
        host = undefined; stopSocket();
        lastError = 'The bound document disconnected. Reattach on a YouTube watch page.';
      });
      port.postMessage({ type: 'attach', viewerUrl: current.joinUrl ?? current.viewerUrl, roomCode: current.roomCode });
    });
  });
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL('/popup.html')) return;
    void hydrated.then(async () => {
      try {
        if (message?.type === 'attach' && Number.isInteger(message.tabId)) respond({ ok: true, ...await attach(message.tabId) });
        else if (message?.type === 'recover') respond({ ok: true, ...await recover(String(message.sessionId ?? ''), String(message.recoveryCode ?? '')) });
        else if (message?.type === 'detach') { await detach(true); respond({ ok: true }); }
        else if (message?.type === 'status') respond({ ok: true, binding: binding ? { tabId: binding.tabId, sessionId: binding.sessionId, controllerUrl: binding.controllerUrl, roomCode: binding.roomCode } : null, state, error: lastError });
        else respond({ ok: false, error: 'Unsupported extension action.' });
      } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : 'Extension action failed.' }); }
    });
    return true;
  });
  browser.tabs.onRemoved.addListener(tabId => { if (binding?.tabId === tabId) void detach(true); });
  let recovering = false;
  async function recoverWorker() {
    await hydrated;
    if (!binding || host || busy || recovering) return;
    recovering = true;
    const current = binding;
    try {
      const [probe] = await browser.scripting.executeScript({ target: { tabId: current.tabId, frameIds: [0] }, func: () => ({ origin: location.origin, pathname: location.pathname }) });
      const page = probe?.result as { origin: string; pathname: string } | undefined;
      if (!probe?.documentId || page?.origin !== 'https://www.youtube.com' || page.pathname !== '/watch') { lastError = 'Open the bound tab on a YouTube watch page to restore the overlay.'; return; }
      if (binding !== current) return;
      if (probe.documentId !== current.documentId) { binding = { ...current, documentId: probe.documentId }; await browser.storage.session.set({ binding }); }
      await browser.scripting.executeScript({ target: { tabId: current.tabId, documentIds: [binding.documentId] }, files: ['/host.js'], world: 'ISOLATED' });
      lastError = '';
    } catch { lastError = 'The bound tab is gone. Reattach explicitly.'; }
    finally { recovering = false; }
  }
  browser.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'karaoke-recover') void recoverWorker(); });
  browser.tabs.onUpdated.addListener((tabId, info) => { if (binding?.tabId === tabId && info.status === 'complete' && !host) setTimeout(() => void recoverWorker(), 1500); });
  void recoverWorker();
});
