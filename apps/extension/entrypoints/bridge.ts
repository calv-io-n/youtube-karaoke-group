import { GateCommand } from '@karaoke/contracts';
import { createYouTubeAdapter } from '../lib/youtube-adapter';

export default defineUnlistedScript(() => {
  const globals = window as Window & { __karaokeBridgeCleanup?: () => void };
  globals.__karaokeBridgeCleanup?.();
  const adapter = createYouTubeAdapter();
  const channel = 'karaoke-gate-v1';
  function send(payload: unknown) { window.postMessage({ channel, direction: 'from-player', payload }, location.origin); }
  function receive(event: MessageEvent) {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel || event.data?.direction !== 'to-player') return;
    const message = event.data.payload;
    if (message?.type === 'destroy') { cleanup(); return; }
    const command = GateCommand.safeParse(message?.command);
    if (message?.type !== 'command' || !command.success) return;
    try {
      adapter.dispatch(command.data);
      send({ type: 'result', commandId: command.data.commandId, accepted: true });
    } catch (error) {
      send({ type: 'result', commandId: command.data.commandId, accepted: false, error: error instanceof Error ? error.message.slice(0, 240) : 'Player operation failed.' });
    }
  }
  const timer = setInterval(() => {
    try { send({ type: 'observation', observation: adapter.observe() }); } catch { /* Unknown page changes must not execute anything else. */ }
  }, 250);
  function cleanup() { clearInterval(timer); window.removeEventListener('message', receive); adapter.destroy(); delete globals.__karaokeBridgeCleanup; }
  globals.__karaokeBridgeCleanup = cleanup;
  window.addEventListener('message', receive);
});
