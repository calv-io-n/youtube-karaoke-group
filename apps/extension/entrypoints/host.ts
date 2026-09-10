import { browser } from 'wxt/browser';
import { GateCommand, GateState, HostMessage } from '@karaoke/contracts';
import { createOverlay } from '../lib/overlay';

export default defineUnlistedScript(() => {
  const globals = globalThis as typeof globalThis & { __karaokeHostCleanup?: () => void };
  globals.__karaokeHostCleanup?.();
  let overlay: ReturnType<typeof createOverlay> | undefined;
  let active = false;
  let destroyed = false;
  const port = browser.runtime.connect({ name: 'karaoke-host-v1' });
  function sendPage(payload: unknown) { window.postMessage({ channel: 'karaoke-gate-v1', direction: 'to-player', payload }, location.origin); }
  function receive(event: MessageEvent) {
    if (!active || event.source !== window || event.origin !== location.origin || event.data?.channel !== 'karaoke-gate-v1' || event.data?.direction !== 'from-player') return;
    const parsed = HostMessage.safeParse(event.data.payload);
    if (!parsed.success || !['observation', 'result'].includes(parsed.data.type)) return;
    if (parsed.data.type === 'observation') parsed.data.observation.overlayMounted = overlay?.mounted() ?? false;
    try { port.postMessage(parsed.data); } catch { cleanup(); }
  }
  port.onMessage.addListener(message => {
    if (message.type === 'attach' && typeof message.viewerUrl === 'string') {
      const url = new URL(message.viewerUrl);
      if (url.origin !== __SERVICE_ORIGIN__) return;
      overlay?.destroy(); overlay = createOverlay(url.href, typeof message.roomCode === 'string' ? message.roomCode : undefined); active = true;
      port.postMessage({ type: 'ready' });
    } else if (message.type === 'state') {
      const parsed = GateState.safeParse(message.state);
      if (parsed.success) overlay?.update(parsed.data);
    } else if (message.type === 'command' && active) {
      const parsed = GateCommand.safeParse(message.command);
      if (parsed.success) sendPage({ type: 'command', command: parsed.data });
    } else if (message.type === 'detach') cleanup();
  });
  function cleanup() {
    if (destroyed) return;
    destroyed = true;
    active = false;
    overlay?.destroy(); overlay = undefined;
    window.removeEventListener('message', receive);
    sendPage({ type: 'destroy' });
    port.disconnect();
    delete globals.__karaokeHostCleanup;
  }
  globals.__karaokeHostCleanup = cleanup;
  window.addEventListener('message', receive);
  port.onDisconnect.addListener(cleanup);
});
