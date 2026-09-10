<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { GateState, ServerMessage, QueueSnapshot, QueueSubmission, normalizeVideo, newId, type GateCommand } from '@karaoke/contracts';

const match = /^\/(control|join)\/([a-f0-9-]+)$/.exec(location.pathname);
const roomMatch = /^\/r\/([a-z]{4})$/i.exec(location.pathname);
const isController = match?.[1] === 'control';
const sessionId = match?.[2] ?? '';
const key = `karaoke-gate:${sessionId}:${isController ? 'controller' : 'viewer'}`;
let token = location.hash.slice(1) || localStorage.getItem(key) || '';
if (token) localStorage.setItem(key, token);
history.replaceState(null, '', location.pathname);
const state = ref<GateState>();
const queue = ref<QueueSnapshot>();
const connected = ref(false);
const ended = ref(false);
const error = ref('');
const submitting = ref(false);
const singer = ref('Alex');
const requester = ref('Alex');
const videoLink = ref('');
const uncertain = ref<GateCommand>();
const joinName = ref('');
const guestSinger = ref('');
const guestVideo = ref('');
const joinedName = ref(localStorage.getItem(`karaoke-gate:${sessionId}:name`) ?? '');
const roomCode = ref('');
const resolving = ref(false);
const currentRoomCode = ref('');
const reordering = ref(false);
let socket: WebSocket | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let stopped = false;
let retryCount = 0;
const base = `/api/gate/sessions/${sessionId}`;
const transportReady = computed(() => connected.value && state.value?.connected && state.value?.observation && !state.value.pendingCommand && !submitting.value && !uncertain.value);
const label = computed(() => state.value?.status.replaceAll('_', ' ') ?? 'connecting');
const connectionLabel = computed(() => ended.value ? 'Session ended' : !connected.value ? 'Reconnecting…' : state.value?.connected ? 'Connected' : 'Host offline');

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(base + path, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, cache: 'no-store' });
  const data = await response.json();
  if (data.state) { const parsed = GateState.safeParse(data.state); if (parsed.success) acceptState(parsed.data); }
  if (!response.ok) throw Object.assign(new Error(data.message || 'Request failed.'), { definitive: true, status: response.status });
  return data;
}
async function loadQueue() {
  if (!token || !sessionId) return;
  try { const response = await fetch(base + '/queue', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }); const data = await response.json(); acceptQueue(data); } catch { /* reconnect loop will retry */ }
}
function acceptState(next: GateState) { if (!state.value || next.revision >= state.value.revision) state.value = next; }
function acceptQueue(data: { queue?: unknown; roomCode?: unknown }) {
  const parsed = QueueSnapshot.safeParse(data.queue);
  if (parsed.success && (!queue.value || parsed.data.revision >= queue.value.revision)) queue.value = parsed.data;
  if (typeof data.roomCode === 'string') currentRoomCode.value = data.roomCode;
}
async function resolveRoom(code: string, replace = false) {
  resolving.value = true; error.value = '';
  try {
    const response = await fetch(`/api/gate/rooms/${encodeURIComponent(code.trim().toUpperCase())}`, { cache: 'no-store' });
    const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Room not found.');
    location[replace ? 'replace' : 'assign'](`/join/${data.sessionId}`);
  } catch (e) { error.value = e instanceof Error ? e.message : 'Room not found.'; resolving.value = false; }
}
async function connect() {
  if (stopped || !match || !token) return;
  try {
    acceptState(GateState.parse(await api('')));
    const { ticket } = await api('/ticket', { method: 'POST' });
    if (stopped) return;
    const url = new URL(base + '/stream', location.origin); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url); socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'authenticate', ticket }));
    ws.onmessage = event => {
      try {
        const parsed = ServerMessage.parse(JSON.parse(event.data));
        if (parsed.type === 'state') { acceptState(parsed.state); acceptQueue(parsed.state); connected.value = true; retryCount = 0; }
      } catch { ws.close(1008, 'Invalid state'); }
    };
    ws.onclose = event => {
      connected.value = false;
      if (event.code === 1000) { stopped = true; ended.value = true; error.value = 'This temporary session is closed or expired. Create another from the extension.'; return; }
      schedule();
    };
    ws.onerror = () => { connected.value = false; };
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Cannot connect.';
    if ((e as { status?: number }).status && [401, 403, 410].includes((e as { status: number }).status)) { stopped = true; ended.value = true; }
    else schedule();
  }
}
function schedule() {
  if (stopped) return;
  clearTimeout(retry);
  retry = setTimeout(() => void connect(), Math.min(5000, 500 * 2 ** Math.min(retryCount++, 3)) + Math.random() * 300);
}
async function submit(command: GateCommand) {
  if (!connected.value) { error.value = 'Offline. This command has not been submitted.'; return; }
  submitting.value = true; error.value = '';
  try { await api('/commands', { method: 'POST', body: JSON.stringify(command) }); uncertain.value = undefined; }
  catch (e) {
    error.value = e instanceof Error ? e.message : 'Command failed.';
    if (!(e as { definitive?: boolean }).definitive) { uncertain.value = command; error.value = 'The response was lost. Check the original command before sending another.'; }
    else uncertain.value = undefined;
  } finally { submitting.value = false; }
}
async function load() {
  if (!transportReady.value || !state.value) return;
  try {
    const videoId = normalizeVideo(videoLink.value);
    if (!singer.value.trim() || !requester.value.trim()) throw new Error('Enter singer and requester names.');
    await submit({ v: 1, commandId: newId(), expectedRevision: state.value.revision, type: 'load', performance: { attemptId: newId(), videoId, singer: singer.value.trim(), requester: requester.value.trim() } });
  } catch (e) { error.value = e instanceof Error ? e.message : 'Invalid request.'; }
}
async function control(type: 'pause' | 'resume' | 'skip' | 'probe') {
  if (!transportReady.value || !state.value) return;
  await submit({ v: 1, commandId: newId(), expectedRevision: state.value.revision, type });
}
async function download() {
  try {
    const report = await api('/report');
    const blob = new Blob([JSON.stringify({ ...report, controllerBrowser: navigator.userAgent }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'karaoke-gate-a-report.json'; a.click(); URL.revokeObjectURL(url);
  } catch (e) { error.value = e instanceof Error ? e.message : 'Report unavailable.'; }
}
function wake() { if (stopped || connected.value || (socket && socket.readyState <= WebSocket.OPEN)) return; clearTimeout(retry); retryCount = 0; void connect(); }
function onVisible() { if (document.visibilityState === 'visible') { wake(); void loadQueue(); } }
onMounted(() => { if (roomMatch) void resolveRoom(roomMatch[1]!, true); else void connect(); document.addEventListener('visibilitychange', onVisible); window.addEventListener('online', wake); });
onUnmounted(() => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', wake); });
let queueTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { void loadQueue(); queueTimer = setInterval(() => void loadQueue(), 2000); });
onUnmounted(() => { stopped = true; clearTimeout(retry); clearInterval(queueTimer); socket?.close(); });

async function joinRoom() {
  error.value = '';
  try {
    const response = await fetch(base + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: joinName.value }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Could not join.');
    token = data.guestToken; joinedName.value = data.displayName; localStorage.setItem(`karaoke-gate:${sessionId}:viewer`, token); localStorage.setItem(`karaoke-gate:${sessionId}:name`, data.displayName); history.replaceState(null, '', `/join/${sessionId}`); await connect(); await loadQueue();
  } catch (e) { error.value = e instanceof Error ? e.message : 'Could not join.'; }
}
async function submitGuest() {
  try { const videoId = normalizeVideo(guestVideo.value); const parsed = QueueSubmission.parse({ videoId, singer: guestSinger.value }); const response = await fetch(base + '/queue', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) }); const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Request failed.'); acceptQueue(data); guestVideo.value = ''; guestSinger.value = ''; error.value = ''; } catch (e) { error.value = e instanceof Error ? e.message : 'Request failed.'; }
}
async function queueAction(action: unknown) {
  try { const response = await fetch(base + '/queue', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(action) }); const data = await response.json(); if (!response.ok) throw Object.assign(new Error(data.message || 'Queue action failed.'), { status: response.status }); acceptQueue(data); error.value = ''; }
  catch (e) { error.value = e instanceof Error ? e.message : 'Queue action failed.'; if ((e as { status?: number }).status === 409) await loadQueue(); }
}
const waiting = computed(() => queue.value?.items.filter(item => item.status === 'queued') ?? []);
const positionOf = (itemId: string) => waiting.value.findIndex(item => item.id === itemId) + 1;
const ordinal = (n: number) => { const tens = n % 100; return `${n}${tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`; };
const hostReady = computed(() => connected.value && !!state.value?.connected && !!state.value?.observation && !state.value?.pendingCommand);
async function moveTo(itemId: string, position: number) {
  if (!queue.value || reordering.value) return;
  const order = waiting.value.map(item => item.id);
  const from = order.indexOf(itemId); const to = position - 1;
  if (from < 0 || to < 0 || to >= order.length || from === to) return;
  order.splice(to, 0, ...order.splice(from, 1));
  reordering.value = true;
  try { await queueAction({ action: 'reorder', itemIds: order, expectedQueueRevision: queue.value.revision }); } finally { reordering.value = false; }
}
function onPosition(itemId: string, event: Event) { void moveTo(itemId, Number((event.target as HTMLSelectElement).value)); }
</script>

<template>
  <main>
    <header><a href="/" class="wordmark">Karaoke<span> / together</span></a><span class="tag">LAN prototype</span></header>
    <template v-if="!match">
      <section class="intro"><p class="eyebrow">START ON THE BIG SCREEN</p><h1>Make room<br>for your voice.</h1><p>Open a YouTube video on your computer and choose <strong>Start playback test</strong> in the extension. Scan its private QR to control playback.</p><p class="muted">Guests: scan the QR on the shared screen, or type the four-letter room code shown there.</p></section>
      <form class="request" @submit.prevent="resolveRoom(roomCode)"><h2>Join with a room code</h2><label for="room-code">Room code</label><input id="room-code" v-model="roomCode" maxlength="4" minlength="4" pattern="[A-Za-z]{4}" autocapitalize="characters" autocomplete="off" spellcheck="false" required placeholder="ABCD"><button class="primary" type="submit" :disabled="resolving">{{ resolving ? 'Finding room…' : 'Join room' }} <span aria-hidden="true">↗</span></button></form>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </template>
    <template v-else>
      <section class="intro"><p class="eyebrow">{{ isController ? 'YOUR PRIVATE CONTROLLER' : 'THE SHARED SCREEN' }}<span v-if="currentRoomCode" class="tag room-code">Room {{ currentRoomCode }}</span></p><h1>{{ isController ? 'Pass the mic.' : 'Sing together.' }}</h1><p>{{ isController ? 'Approve requests, choose the next singer, and keep the room on the big screen.' : 'Join the room, request a song, and follow the current performance.' }}</p></section>
      <section class="performance" aria-live="polite">
        <div class="row"><span class="eyebrow">{{ label }}</span><span :class="['connection', { online: connected && state?.connected }]">{{ connectionLabel }}</span></div>
        <h2>{{ state?.current?.singer || (state?.status === 'loading' ? 'Getting ready…' : 'Between singers') }}</h2>
        <p v-if="state?.current && state.current.requester !== state.current.singer">Requested by {{ state.current.requester }}</p>
        <p class="muted">{{ state?.message || 'Connecting to the host…' }}</p>
        <p v-if="state?.connected && state.observation && !state.observation.fullscreen" class="notice">Enter YouTube fullscreen on the host computer.</p>
      </section>
      <template v-if="!isController && !token">
        <form class="request" @submit.prevent="joinRoom"><h2>Join this room</h2><label for="join-name">Your display name</label><input id="join-name" v-model="joinName" maxlength="60" required placeholder="How should the room identify you?"><button class="primary" type="submit">Join room <span aria-hidden="true">↗</span></button></form>
      </template>
      <template v-else-if="!isController">
        <form class="request" @submit.prevent="submitGuest"><h2>Request a song</h2><p class="muted">You are joining as {{ joinedName || 'guest' }}. Songs join the queue automatically. Anyone in the room can set the order and start the next singer.</p><label for="guest-video">YouTube link</label><input id="guest-video" v-model="guestVideo" required maxlength="2048" placeholder="Paste a YouTube watch or share link"><label for="guest-singer">Singer</label><input id="guest-singer" v-model="guestSinger" required maxlength="60" placeholder="Who will sing?"><button class="primary" type="submit">Submit request <span aria-hidden="true">↗</span></button></form>
        <section class="request"><h2>Room queue</h2><p v-if="!queue?.items.length" class="muted">No requests yet.</p><ul class="queue-list"><li v-for="item in queue?.items" :key="item.id"><div><strong>{{ item.singer }}</strong><span>{{ item.requester }} · {{ item.status }}</span></div><div v-if="item.status === 'queued'" class="queue-actions"><label class="position"><span>Position</span><select :value="positionOf(item.id)" :disabled="reordering" :aria-label="`Position for ${item.singer}`" @change="onPosition(item.id, $event)"><option v-for="n in waiting.length" :key="n" :value="n">{{ ordinal(n) }}</option></select></label></div></li></ul>
        <button class="primary" :disabled="!waiting.length || !hostReady" @click="queueAction({ action: 'start-next' })">Start next singer <span aria-hidden="true">↗</span></button>
        <div class="transport"><button :disabled="!hostReady || state?.status !== 'playing'" @click="queueAction({ action: 'pause' })">Pause</button><button :disabled="!hostReady || state?.status !== 'paused'" @click="queueAction({ action: 'resume' })">Resume</button><button :disabled="!hostReady || !state?.current" @click="queueAction({ action: 'skip' })">Stop / intermission</button></div></section>
      </template>
      <template v-else>
        <section class="request"><div class="row"><h2>Room queue</h2><button @click="queueAction({ action: 'set-joining', open: !queue?.joiningOpen })">{{ queue?.joiningOpen ? 'Close joining' : 'Open joining' }}</button></div><p v-if="!queue?.items.length" class="muted">Guests can scan the public overlay QR to request songs.</p><ul class="queue-list"><li v-for="item in queue?.items" :key="item.id"><div><strong>{{ item.singer }}</strong><span>{{ item.requester }} · {{ item.status }}</span></div><div class="queue-actions"><button v-if="item.status === 'pending'" @click="queueAction({ action: 'approve', itemId: item.id })">Approve</button><button v-if="item.status === 'pending'" @click="queueAction({ action: 'reject', itemId: item.id })">Reject</button><template v-if="item.status === 'queued'"><label class="position"><span>Position</span><select :value="positionOf(item.id)" :disabled="reordering" :aria-label="`Position for ${item.singer}`" @change="onPosition(item.id, $event)"><option v-for="n in waiting.length" :key="n" :value="n">{{ ordinal(n) }}</option></select></label><button @click="queueAction({ action: 'remove', itemId: item.id })">Remove</button></template></div></li></ul><button class="primary" :disabled="!waiting.length || !transportReady" @click="queueAction({ action: 'start-next' })">Start next singer <span aria-hidden="true">↗</span></button></section>
      </template>
      <template v-if="isController">
        <form class="request" @submit.prevent="load"><h2>Next performance</h2><label for="video">YouTube link</label><input id="video" v-model="videoLink" placeholder="Paste a YouTube watch or share link" required maxlength="2048" autocomplete="off"><div class="names"><div><label for="singer">Singer</label><input id="singer" v-model="singer" required maxlength="60"></div><div><label for="requester">Requested by</label><input id="requester" v-model="requester" required maxlength="60"></div></div><button class="primary" :disabled="!transportReady" type="submit">{{ state?.status === 'blocked' ? 'Retry as a new performance' : 'Start performance' }} <span aria-hidden="true">↗</span></button></form>
        <div class="transport"><button :disabled="!transportReady || state?.status !== 'playing'" @click="control('pause')">Pause</button><button :disabled="!transportReady || state?.status !== 'paused'" @click="control('resume')">Resume</button><button :disabled="!transportReady" @click="control('skip')">Stop / intermission</button></div>
        <div v-if="uncertain" class="notice"><p>The original command may have reached the host.</p><button :disabled="!connected || submitting" @click="submit(uncertain)">Check original command</button></div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <details class="diagnostics"><summary>Playback verification</summary><dl><dt>Confirmed transitions</dt><dd>{{ state?.transitions ?? 0 }}</dd><dt>Consecutive fullscreen transitions</dt><dd>{{ state?.consecutiveTransitions ?? 0 }} / 20</dd><dt>Observed video</dt><dd>{{ state?.observation?.videoId ?? 'Unknown' }}</dd><dt>New playback evidence</dt><dd>{{ state?.observation?.loadEvidence ? 'Observed' : 'Not yet observed' }}</dd><dt>Player preserved</dt><dd>{{ state?.observation?.playerPreserved ? 'Yes' : 'No' }}</dd><dt>Overlay mounted</dt><dd>{{ state?.observation?.overlayMounted ? 'Yes' : 'No' }}</dd></dl><p>Twenty transitions alone do not certify Gate A. Complete the failure and recovery scenarios in the test guide.</p><button :disabled="!connected" @click="download">Export diagnostic report</button><button :disabled="!transportReady" @click="control('probe')">Probe player</button></details>
      </template>
      <p v-else-if="error" class="error" role="alert">{{ error }}</p>
    </template>
    <footer>One screen. One song at a time.<span>Gate A · temporary session</span></footer>
  </main>
</template>
