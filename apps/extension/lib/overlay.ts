import QRCode from 'qrcode';
import type { GateState } from '@karaoke/contracts';

export function createOverlay(viewerUrl: string, roomCode?: string) {
  const host = document.createElement('div');
  host.id = 'karaoke-gate-overlay';
  host.style.cssText = 'position:absolute;inset:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = ':host{all:initial;pointer-events:none}.label,.join{position:absolute;top:28px;color:#fff;background:rgba(15,18,22,.78);border-radius:10px;font-family:Arial,sans-serif;padding:14px 18px;max-width:45%;box-sizing:border-box}.label{left:28px}.join{right:28px;text-align:center;font-size:16px}.singer{display:block;font-size:28px;line-height:1.2;overflow-wrap:anywhere}.detail,.upcoming,.status{display:block;font-size:14px;margin-top:7px;line-height:1.4}.upcoming{color:#f0d8a1}.status{color:#cce5e2}canvas{display:block;width:112px;height:112px;margin-bottom:8px}.caption{font-size:13px;color:#d2dad8}.code{font-size:24px;font-weight:700;letter-spacing:.18em;color:#fff;margin:2px 0 4px}';
  const label = document.createElement('div'); label.className = 'label';
  const singer = document.createElement('strong'); singer.className = 'singer'; singer.textContent = 'Karaoke playback test';
  const detail = document.createElement('span'); detail.className = 'detail';
  const upcoming = document.createElement('span'); upcoming.className = 'upcoming';
  const status = document.createElement('span'); status.className = 'status';
  label.append(singer, detail, upcoming, status);
  const join = document.createElement('div'); join.className = 'join';
  const canvas = document.createElement('canvas');
  const title = document.createElement('div'); title.textContent = 'Scan to join';
  const caption = document.createElement('div'); caption.className = roomCode ? 'code' : 'caption'; caption.textContent = roomCode ? roomCode : 'Playback test · view only';
  const hint = document.createElement('div'); hint.className = 'caption'; hint.textContent = roomCode ? 'Room code · enter it on the site' : '';
  const address = document.createElement('div'); address.className = 'caption'; address.textContent = new URL(viewerUrl).host;
  join.append(canvas, title, caption, hint, address);
  root.append(style, label, join);
  void QRCode.toCanvas(canvas, viewerUrl, { width: 224, margin: 2, errorCorrectionLevel: 'M' });
  let mounted = false;
  function mount() {
    const fullscreen = document.fullscreenElement;
    const container = fullscreen ?? document.getElementById('movie_player');
    const player = document.getElementById('movie_player');
    const safe = container instanceof HTMLElement && container.tagName !== 'VIDEO' && !!player && (container === player || container.contains(player));
    if (!safe) { host.remove(); mounted = false; return; }
    if (host.parentElement !== container) container.append(host);
    mounted = host.isConnected && (!fullscreen || fullscreen.contains(host));
  }
  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('fullscreenchange', mount);
  mount();
  return {
    update(state: GateState) {
      singer.textContent = state.current ? state.current.singer : state.status === 'loading' ? 'Loading performance…' : 'Between singers';
      detail.textContent = state.current && state.current.requester !== state.current.singer ? `Requested by ${state.current.requester}` : '';
      upcoming.textContent = state.queue?.items.filter(item => item.status === 'queued').slice(0, 2).map(item => `Next: ${item.singer}`).join(' · ') ?? '';
      status.textContent = !state.connected ? 'Host disconnected · playback may continue' : state.message;
      mount();
    },
    mounted: () => mounted && host.isConnected,
    destroy() { observer.disconnect(); document.removeEventListener('fullscreenchange', mount); host.remove(); },
  };
}
