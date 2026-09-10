import QRCode from 'qrcode';
import { browser } from 'wxt/browser';
import type { GateState } from '@karaoke/contracts';

const FONT = "'Nunito', 'Zen Maru Gothic', ui-rounded, 'Hiragino Maru Gothic ProN', 'Segoe UI', system-ui, sans-serif";
const STYLE = [
  ':host{all:initial;pointer-events:none}',
  `.label,.join{position:absolute;top:28px;box-sizing:border-box;font-family:${FONT};color:#3b3556;background:rgba(255,255,255,.94);border-radius:24px;box-shadow:0 6px 0 #ffb3d1,0 12px 30px rgba(59,53,86,.18)}`,
  '.label{left:28px;max-width:46%;display:flex;align-items:center;gap:16px;padding:16px 22px 16px 16px}',
  '.mascot{width:76px;height:76px;flex:none;object-fit:contain;filter:drop-shadow(0 3px 0 rgba(255,179,209,.6))}',
  '.text{min-width:0}',
  '.singer{display:block;font-size:30px;line-height:1.15;font-weight:900;color:#ff6fae;overflow-wrap:anywhere;letter-spacing:-.3px}',
  '.detail,.upcoming,.status{display:block;font-size:14px;line-height:1.4;margin-top:5px;font-weight:700}',
  '.detail{color:#6d6788}.detail:empty,.upcoming:empty,.status:empty{display:none}',
  '.upcoming{color:#4fa9f2;font-weight:800}',
  '.status{color:#8e88a8;font-size:12px}',
  '.join{right:28px;text-align:center;padding:14px 16px 16px;box-shadow:0 6px 0 #cfe8ff,0 12px 30px rgba(59,53,86,.18)}',
  '.qr{display:inline-block;padding:6px;border:3px solid #ffb3d1;border-radius:18px;background:#fff}',
  'canvas{display:block;width:112px;height:112px;border-radius:8px}',
  '.title{font-size:15px;font-weight:900;margin-top:8px}',
  '.code{display:inline-block;margin:6px 0 4px;padding:6px 16px;border-radius:999px;background:#ff6fae;color:#fff;font-size:24px;font-weight:900;letter-spacing:.18em;text-indent:.18em;box-shadow:0 3px 0 #e04f92}',
  '.caption{font-size:12px;font-weight:700;color:#8e88a8;line-height:1.35}.caption:empty{display:none}',
].join('');

export function createOverlay(viewerUrl: string, roomCode?: string) {
  const host = document.createElement('div');
  host.id = 'karaoke-gate-overlay';
  host.style.cssText = 'position:absolute;inset:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  const label = document.createElement('div'); label.className = 'label';
  const mascot = document.createElement('img'); mascot.className = 'mascot'; mascot.alt = ''; mascot.src = browser.runtime.getURL('/mascot/sing.png');
  const text = document.createElement('div'); text.className = 'text';
  const singer = document.createElement('strong'); singer.className = 'singer'; singer.textContent = 'Utaoke';
  const detail = document.createElement('span'); detail.className = 'detail';
  const upcoming = document.createElement('span'); upcoming.className = 'upcoming';
  const status = document.createElement('span'); status.className = 'status';
  text.append(singer, detail, upcoming, status);
  label.append(mascot, text);
  const join = document.createElement('div'); join.className = 'join';
  const qr = document.createElement('div'); qr.className = 'qr';
  const canvas = document.createElement('canvas'); qr.append(canvas);
  const title = document.createElement('div'); title.className = 'title'; title.textContent = 'Scan to join';
  const caption = document.createElement('div'); caption.className = roomCode ? 'code' : 'caption'; caption.textContent = roomCode ? roomCode : 'Playback test · view only';
  const hint = document.createElement('div'); hint.className = 'caption'; hint.textContent = roomCode ? 'or type this room code' : '';
  const address = document.createElement('div'); address.className = 'caption'; address.textContent = new URL(viewerUrl).host;
  join.append(qr, title, caption, hint, address);
  root.append(style, label, join);
  void QRCode.toCanvas(canvas, viewerUrl, { width: 224, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#3b3556', light: '#ffffff' } });
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
