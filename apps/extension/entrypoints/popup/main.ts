import { browser } from 'wxt/browser';
import QRCode from 'qrcode';
import './style.css';

const attach = document.querySelector<HTMLButtonElement>('#attach')!;
const detach = document.querySelector<HTMLButtonElement>('#detach')!;
const status = document.querySelector<HTMLElement>('#status')!;
const pairing = document.querySelector<HTMLElement>('#pairing')!;
const controller = document.querySelector<HTMLAnchorElement>('#controller')!;
const recovery = document.querySelector<HTMLElement>('#recovery')!;
const room = document.querySelector<HTMLElement>('#room')!;
const restoreSession = document.querySelector<HTMLInputElement>('#session')!;
const restoreCode = document.querySelector<HTMLInputElement>('#code')!;
const recover = document.querySelector<HTMLButtonElement>('#recover')!;
async function show(url: string, roomCode?: string) {
  pairing.hidden = false; detach.hidden = false;
  room.hidden = !roomCode; room.textContent = roomCode ? `Room code for guests: ${roomCode}` : '';
  controller.href = url;
  controller.textContent = `Open controller · ${new URL(url).host}`;
  await QRCode.toCanvas(document.querySelector<HTMLCanvasElement>('#qr')!, url, { width: 224, margin: 2 });
}
function showRecovery(code?: string) {
  if (!code) return;
  recovery.hidden = false;
  recovery.textContent = `Save this recovery code: ${code}`;
}
attach.addEventListener('click', async () => {
  attach.disabled = true; status.textContent = 'Attaching to this YouTube tab…';
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab.');
    const result = await browser.runtime.sendMessage({ type: 'attach', tabId: tab.id });
    if (!result?.ok) throw new Error(result?.error || 'Attachment failed.');
    await show(result.controllerUrl, result.roomCode);
    showRecovery(result.recoveryCode);
    status.textContent = 'Attached. Enter YouTube fullscreen locally, then use the controller.';
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'Attachment failed.'; }
  finally { attach.disabled = false; }
});
recover.addEventListener('click', async () => {
  recover.disabled = true; status.textContent = 'Restoring playback access…';
  try {
    const result = await browser.runtime.sendMessage({ type: 'recover', sessionId: restoreSession.value.trim(), recoveryCode: restoreCode.value });
    if (!result?.ok) throw new Error(result?.error || 'Recovery failed.');
    await show(result.controllerUrl, result.roomCode);
    status.textContent = 'Playback access restored. Re-enter fullscreen locally if YouTube left it.';
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'Recovery failed.'; }
  finally { recover.disabled = false; }
});
detach.addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'detach' });
  pairing.hidden = true; detach.hidden = true; status.textContent = 'Session closed.';
});
void browser.runtime.sendMessage({ type: 'status' }).then(async result => {
  if (result?.binding) await show(result.binding.controllerUrl, result.binding.roomCode);
  status.textContent = result?.error || result?.state?.message || '';
}).catch(() => { status.textContent = 'Extension unavailable. Reload it and try again.'; });
