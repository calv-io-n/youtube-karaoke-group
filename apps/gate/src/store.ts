import { computed, ref } from 'vue';
import { GateState, ServerMessage, QueueSnapshot, QueueSubmission, normalizeVideo, newId, type GateCommand, type QueueItem } from '@karaoke/contracts';
import { songInfo } from './library';

export type Tab = 'home' | 'search' | 'browse' | 'faves' | 'room';

const routeMatch = /^\/(control|join)\/([a-f0-9-]+)$/.exec(location.pathname);
const codeMatch = /^\/r\/([a-z]{4})$/i.exec(location.pathname);

export const isController = routeMatch?.[1] === 'control';
export const sessionId = ref(routeMatch?.[2] ?? '');
/** Room code typed into a `/r/CODE` link; the join screen resolves it on mount. */
export const prefilledCode = codeMatch?.[1]?.toUpperCase() ?? '';

const tokenKey = (id: string) => `karaoke-gate:${id}:${isController ? 'controller' : 'viewer'}`;
const nameKey = (id: string) => `karaoke-gate:${id}:name`;
let token = location.hash.slice(1) || (sessionId.value ? localStorage.getItem(tokenKey(sessionId.value)) ?? '' : '');
if (token && sessionId.value) localStorage.setItem(tokenKey(sessionId.value), token);
if (location.hash) history.replaceState(null, '', location.pathname);

export const state = ref<GateState>();
export const queue = ref<QueueSnapshot>();
export const members = ref<string[]>([]);
export const roomCode = ref('');
export const connected = ref(false);
export const ended = ref(false);
export const error = ref('');
export const submitting = ref(false);
export const uncertain = ref<GateCommand>();
export const reordering = ref(false);
export const joinedName = ref(isController ? 'Host' : sessionId.value ? localStorage.getItem(nameKey(sessionId.value)) ?? '' : '');
export const tab = ref<Tab>('home');
export const toast = ref('');
export const hasToken = ref(!!token);
/** Guests count as joined once they hold a guest credential and a display name. */
export const joined = computed(() => hasToken.value && (isController || !!joinedName.value));

let socket: WebSocket | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let queueTimer: ReturnType<typeof setInterval> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;
let retryCount = 0;
const base = () => `/api/gate/sessions/${sessionId.value}`;

export function showToast(message: string) {
  clearTimeout(toastTimer); toast.value = message;
  toastTimer = setTimeout(() => { toast.value = ''; }, 2000);
}

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(base() + path, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, cache: 'no-store' });
  const data = await response.json();
  if (data.state) { const parsed = GateState.safeParse(data.state); if (parsed.success) acceptState(parsed.data); }
  if (!response.ok) throw Object.assign(new Error(data.message || 'Request failed.'), { definitive: true, status: response.status });
  return data;
}
function acceptState(next: GateState) { if (!state.value || next.revision >= state.value.revision) state.value = next; }
function acceptRoom(data: { queue?: unknown; roomCode?: unknown; members?: unknown }) {
  const parsed = QueueSnapshot.safeParse(data.queue);
  if (parsed.success && (!queue.value || parsed.data.revision >= queue.value.revision)) queue.value = parsed.data;
  if (typeof data.roomCode === 'string') roomCode.value = data.roomCode;
  if (Array.isArray(data.members)) members.value = data.members.filter((name): name is string => typeof name === 'string');
}
export async function loadQueue() {
  if (!token || !sessionId.value || stopped) return;
  try { const response = await fetch(base() + '/queue', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }); if (response.ok) acceptRoom(await response.json()); } catch { /* reconnect loop will retry */ }
}

/** Looks up a four-letter room code and returns its session id. */
export async function resolveRoom(code: string): Promise<string> {
  const response = await fetch(`/api/gate/rooms/${encodeURIComponent(code.trim().toUpperCase())}`, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'No open room has that code.');
  return data.sessionId as string;
}
/** Joins a room as a guest, stores the credential, and connects. */
export async function joinRoom(id: string, displayName: string) {
  const response = await fetch(`/api/gate/sessions/${id}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Could not join this room.');
  sessionId.value = id; token = data.guestToken; hasToken.value = true; joinedName.value = data.displayName; error.value = ''; ended.value = false; stopped = false; retryCount = 0;
  localStorage.setItem(tokenKey(id), token); localStorage.setItem(nameKey(id), data.displayName);
  history.replaceState(null, '', `/join/${id}`);
  await connect(); startPolling(); await loadQueue();
}
/** Forgets this device's credential so the join screen shows again. */
export function leaveRoom() {
  if (sessionId.value) { localStorage.removeItem(tokenKey(sessionId.value)); localStorage.removeItem(nameKey(sessionId.value)); }
  location.replace(isController ? '/' : sessionId.value ? `/join/${sessionId.value}` : '/');
}

async function connect() {
  if (stopped || !sessionId.value || !token) return;
  try {
    acceptState(GateState.parse(await api('')));
    const { ticket } = await api('/ticket', { method: 'POST' });
    if (stopped) return;
    const url = new URL(base() + '/stream', location.origin); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url); socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'authenticate', ticket }));
    ws.onmessage = event => {
      try {
        const parsed = ServerMessage.parse(JSON.parse(event.data));
        if (parsed.type === 'state') { acceptState(parsed.state); acceptRoom(parsed.state); connected.value = true; retryCount = 0; }
      } catch { ws.close(1008, 'Invalid state'); }
    };
    ws.onclose = event => {
      connected.value = false;
      if (event.code === 1000) { stopped = true; ended.value = true; error.value = 'This room is closed. Ask the host to open a new one.'; return; }
      schedule();
    };
    ws.onerror = () => { connected.value = false; };
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Cannot connect.';
    const status = (e as { status?: number }).status;
    if (status && [401, 403, 410].includes(status)) { stopped = true; ended.value = true; }
    else schedule();
  }
}
function schedule() {
  if (stopped) return;
  clearTimeout(retry);
  retry = setTimeout(() => void connect(), Math.min(5000, 500 * 2 ** Math.min(retryCount++, 3)) + Math.random() * 300);
}
function wake() { if (stopped || connected.value || (socket && socket.readyState <= WebSocket.OPEN)) return; clearTimeout(retry); retryCount = 0; void connect(); }
function onVisible() { if (document.visibilityState === 'visible') { wake(); void loadQueue(); } }
function startPolling() { clearInterval(queueTimer); queueTimer = setInterval(() => { if (document.visibilityState === 'visible') void loadQueue(); }, 2500); }

export function start() {
  document.addEventListener('visibilitychange', onVisible); window.addEventListener('online', wake);
  if (joined.value) { void connect(); startPolling(); void loadQueue(); }
}
export function stop() {
  stopped = true; clearTimeout(retry); clearInterval(queueTimer); socket?.close();
  document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', wake);
}

/** Controller-only playback commands (Gate A verification path). */
export async function submit(command: GateCommand) {
  if (!connected.value) { error.value = 'Offline. This command has not been submitted.'; return; }
  submitting.value = true; error.value = '';
  try { await api('/commands', { method: 'POST', body: JSON.stringify(command) }); uncertain.value = undefined; }
  catch (e) {
    error.value = e instanceof Error ? e.message : 'Command failed.';
    if (!(e as { definitive?: boolean }).definitive) { uncertain.value = command; error.value = 'The response was lost. Check the original command before sending another.'; }
    else uncertain.value = undefined;
  } finally { submitting.value = false; }
}
export async function loadPerformance(link: string, singer: string, requester: string) {
  if (!transportReady.value || !state.value) return;
  try {
    const videoId = normalizeVideo(link);
    if (!singer.trim() || !requester.trim()) throw new Error('Enter singer and requester names.');
    await submit({ v: 1, commandId: newId(), expectedRevision: state.value.revision, type: 'load', performance: { attemptId: newId(), videoId, singer: singer.trim(), requester: requester.trim() } });
  } catch (e) { error.value = e instanceof Error ? e.message : 'Invalid request.'; }
}
export async function probe() { if (transportReady.value && state.value) await submit({ v: 1, commandId: newId(), expectedRevision: state.value.revision, type: 'probe' }); }
export async function downloadReport() {
  try {
    const report = await api('/report');
    const blob = new Blob([JSON.stringify({ ...report, controllerBrowser: navigator.userAgent }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'utaoke-gate-a-report.json'; a.click(); URL.revokeObjectURL(url);
  } catch (e) { error.value = e instanceof Error ? e.message : 'Report unavailable.'; }
}

/** Queue actions shared by guests and the host; a stale reorder refreshes the queue. */
export async function queueAction(action: unknown): Promise<boolean> {
  try {
    const response = await fetch(base() + '/queue', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(action), cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.message || 'Queue action failed.'), { status: response.status });
    acceptRoom(data); error.value = ''; return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Queue action failed.';
    if ((e as { status?: number }).status === 409) await loadQueue();
    return false;
  }
}
/** Adds a song to the room queue for `singer` (defaults to this device's name). */
export async function addSong(videoId: string, singer = joinedName.value): Promise<boolean> {
  try {
    const parsed = QueueSubmission.parse({ videoId, singer });
    const response = await fetch(base() + '/queue', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(parsed), cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Request failed.');
    acceptRoom(data); error.value = ''; return true;
  } catch (e) { error.value = e instanceof Error ? e.message : 'Request failed.'; return false; }
}

export const waiting = computed(() => queue.value?.items.filter(item => item.status === 'queued') ?? []);
export const playingItem = computed(() => queue.value?.items.find(item => item.status === 'playing'));
export const doneItems = computed(() => queue.value?.items.filter(item => ['completed', 'skipped', 'failed'].includes(item.status)) ?? []);
export const hostReady = computed(() => connected.value && !!state.value?.connected && !!state.value?.observation && !state.value?.pendingCommand);
export const transportReady = computed(() => hostReady.value && !submitting.value && !uncertain.value);
export const status = computed(() => state.value?.status ?? 'idle');
export const statusLabel = computed(() => ({ idle: 'Waiting for the host', loading: 'Loading on TV…', playing: 'Playing on TV', paused: 'Paused', between_songs: 'Between singers', blocked: 'Blocked on TV', out_of_sync: 'Out of sync' })[status.value]);
export const statusColor = computed(() => ({ idle: '#8e88a8', loading: '#4fa9f2', playing: '#2f9c66', paused: '#c98a00', between_songs: '#4fa9f2', blocked: '#e0475f', out_of_sync: '#c98a00' })[status.value]);
export const connectionLabel = computed(() => ended.value ? 'Room closed' : !connected.value ? 'Reconnecting…' : state.value?.connected ? 'Connected' : 'Host offline');
export const connectionColor = computed(() => connected.value && state.value?.connected && !ended.value ? '#5ad38a' : '#ffb347');
export const needsFullscreen = computed(() => !!state.value?.connected && !!state.value.observation && !state.value.observation.fullscreen);

export const nowPlaying = computed(() => {
  const current = state.value?.current;
  if (!current) return { videoId: '', singer: status.value === 'loading' ? 'Getting ready…' : 'Between singers', requester: '', title: 'Nobody is singing yet', artist: 'Pick a song and start the next singer', initial: '♪' };
  const info = songInfo(current.videoId);
  return { videoId: current.videoId, singer: current.singer, requester: current.requester, title: info.title, artist: info.artist, initial: current.singer.trim()[0]?.toUpperCase() ?? '♪' };
});
export const progress = computed(() => {
  const observation = state.value?.observation;
  if (!observation || !state.value?.current || !observation.duration) return { elapsed: 0, duration: 0, pct: 0 };
  return { elapsed: observation.currentTime, duration: observation.duration, pct: Math.max(0, Math.min(100, (100 * observation.currentTime) / observation.duration)) };
});

export const positionOf = (itemId: string) => waiting.value.findIndex(item => item.id === itemId) + 1;
export async function moveBy(item: QueueItem, delta: number) {
  if (!queue.value || reordering.value) return;
  const order = waiting.value.map(entry => entry.id);
  const from = order.indexOf(item.id); const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return;
  order.splice(to, 0, ...order.splice(from, 1));
  reordering.value = true;
  try { await queueAction({ action: 'reorder', itemIds: order, expectedQueueRevision: queue.value.revision }); } finally { reordering.value = false; }
}
export async function startNext() {
  if (!waiting.value.length) { showToast('Queue is empty — add a song!'); return; }
  if (await queueAction({ action: 'start-next' })) { showToast('Starting the next singer ♪'); tab.value = 'home'; }
}
/** Transport: the host talks to the playback command endpoint (works even for performances started outside the queue); guests use queue actions. */
async function transport(type: 'pause' | 'resume' | 'skip'): Promise<boolean> {
  if (!isController) return queueAction({ action: type });
  if (!transportReady.value || !state.value) return false;
  await submit({ v: 1, commandId: newId(), expectedRevision: state.value.revision, type });
  return !error.value;
}
export const pause = () => transport('pause');
export const resume = () => transport('resume');
export const stopSong = async () => { if (await transport('skip')) showToast('Stopped — intermission time'); };
export const removeItem = (item: QueueItem) => queueAction({ action: 'remove', itemId: item.id });
export const setJoining = (open: boolean) => queueAction({ action: 'set-joining', open });
