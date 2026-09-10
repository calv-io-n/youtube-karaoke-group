<script setup lang="ts">
import { computed, ref } from 'vue';
import { LIB, embed, songInfo, thumb } from '../library';
import SongCard from './SongCard.vue';
import { connected, connectionColor, connectionLabel, downloadReport, error, isController, joinedName, loadPerformance, members, needsFullscreen, nowPlaying, probe, roomCode, state, status, submit, submitting, tab, transportReady, uncertain, waiting } from '../store';

const upNext = computed(() => waiting.value.slice(0, 2).map((item, index) => ({ ...item, pos: index + 1, info: songInfo(item.videoId) })));
const quickPicks = computed(() => LIB.filter(song => song.tag === 'Anime' || song.tag === 'J-Pop').slice(0, 5));
const memberCount = computed(() => members.value.length + (isController ? 1 : 0));
const statusText = computed(() => status.value.replaceAll('_', ' '));

// Controller-only Gate A tooling: start any YouTube link as a performance, and inspect verification evidence.
const videoLink = ref('');
const singer = ref('Alex');
const requester = ref('Alex');
async function start() { await loadPerformance(videoLink.value, singer.value, requester.value); }
</script>

<template>
  <div class="between head">
    <div><div class="eyebrow">Room · {{ roomCode || '····' }}</div><h1 class="title">Hi, {{ joinedName }} ♪</h1></div>
    <div class="pill here" :title="connectionLabel"><span class="dot" :style="{ background: connectionColor }"></span>{{ connected ? `${memberCount} here` : connectionLabel }}</div>
  </div>
  <p v-if="needsFullscreen" class="notice">Enter fullscreen on the host computer so the room can see the words.</p>
  <div class="eyebrow label">On the big screen</div>
  <div class="screen">
    <iframe v-if="nowPlaying.videoId" :key="nowPlaying.videoId" :src="embed(nowPlaying.videoId)" title="Now playing preview" allow="encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>
    <div v-else class="screen-empty"><img class="mascot sway" src="/mascot/sing.png" width="110" height="110" alt=""><div><div class="empty-title">The stage is open</div><div class="empty-sub">{{ waiting.length ? `${waiting.length} waiting · start the next singer` : 'Add a song to get things going' }}</div></div></div>
  </div>
  <section class="performance row" aria-live="polite">
    <div class="avatar">{{ nowPlaying.initial }}</div>
    <div class="np"><span class="eyebrow">{{ statusText }}</span><h2 class="np-singer ellipsis">{{ nowPlaying.singer }}</h2><div class="np-sub ellipsis">{{ nowPlaying.videoId ? `${nowPlaying.title} · ${nowPlaying.artist}` : nowPlaying.artist }}</div><div v-if="nowPlaying.requester && nowPlaying.requester !== nowPlaying.singer" class="np-sub">Requested by {{ nowPlaying.requester }}</div></div>
    <div :class="['eq', { live: status === 'playing' }]" aria-hidden="true"><span></span><span></span><span></span></div>
  </section>
  <p v-if="state?.message && (status === 'blocked' || status === 'out_of_sync' || !state.connected)" class="muted status-msg">{{ state.message }}</p>

  <div class="section-head"><div class="eyebrow">Up next</div><button class="link" @click="tab = 'room'">See queue →</button></div>
  <div class="stack next">
    <div v-for="item in upNext" :key="item.id" class="card next-row row">
      <div class="pos">{{ item.pos }}</div>
      <img class="next-thumb" :src="thumb(item.videoId)" alt="" loading="lazy">
      <div class="meta"><div class="next-title ellipsis">{{ item.info.title }}</div><div class="next-sub">{{ item.singer }}</div></div>
    </div>
    <div v-if="!upNext.length" class="card next-row empty">Nobody is waiting. Add a song and it lands here.</div>
  </div>

  <div class="eyebrow label">Quick picks for you</div>
  <div class="shelf"><SongCard v-for="song in quickPicks" :key="song.id" :song="song" variant="mini" /></div>

  <template v-if="isController">
    <form class="card host-form" @submit.prevent="start">
      <div class="eyebrow">Host tools</div>
      <h3 class="form-title">Start a performance</h3>
      <p class="muted">Play any YouTube link right now, outside the queue.</p>
      <label class="label" for="video">YouTube link</label>
      <input id="video" v-model="videoLink" class="field" placeholder="Paste a YouTube watch or share link" required maxlength="2048" autocomplete="off">
      <div class="names">
        <div><label class="label" for="singer">Singer</label><input id="singer" v-model="singer" class="field" required maxlength="60"></div>
        <div><label class="label" for="requester">Requested by</label><input id="requester" v-model="requester" class="field" required maxlength="60"></div>
      </div>
      <button class="btn blue block form-go" :disabled="!transportReady" type="submit">{{ status === 'blocked' ? 'Retry as a new performance' : 'Start performance' }}</button>
    </form>
    <div v-if="uncertain" class="notice uncertain"><p>The original command may have reached the host.</p><button class="ghost" :disabled="!connected || submitting" @click="submit(uncertain)">Check original command</button></div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <details class="verify">
      <summary>Playback verification</summary>
      <dl><dt>Confirmed transitions</dt><dd>{{ state?.transitions ?? 0 }}</dd><dt>Consecutive fullscreen transitions</dt><dd>{{ state?.consecutiveTransitions ?? 0 }} / 20</dd><dt>Observed video</dt><dd>{{ state?.observation?.videoId ?? 'Unknown' }}</dd><dt>New playback evidence</dt><dd>{{ state?.observation?.loadEvidence ? 'Observed' : 'Not yet observed' }}</dd><dt>Player preserved</dt><dd>{{ state?.observation?.playerPreserved ? 'Yes' : 'No' }}</dd><dt>Overlay mounted</dt><dd>{{ state?.observation?.overlayMounted ? 'Yes' : 'No' }}</dd></dl>
      <p>Twenty transitions alone do not certify Gate A. Complete the failure and recovery scenarios in the test guide.</p>
      <div class="actions"><button :disabled="!connected" @click="downloadReport">Export diagnostic report</button><button :disabled="!transportReady" @click="probe">Probe player</button></div>
    </details>
  </template>
  <p v-else-if="error" class="error" role="alert">{{ error }}</p>
</template>

<style scoped>
.head { margin-bottom: 16px; align-items: flex-start; }
.here { color: var(--blue); flex: none; white-space: nowrap; }
.label { margin: 0 0 8px; }
.screen { border-radius: 24px; overflow: hidden; background: #000; aspect-ratio: 16 / 9; box-shadow: 0 8px 0 var(--blue-soft); }
.screen iframe { width: 100%; height: 100%; border: 0; display: block; }
.screen-empty { height: 100%; display: flex; align-items: center; gap: 14px; padding: 12px 18px; background: linear-gradient(135deg, var(--blue-light), var(--pink-soft)); color: var(--ink); }
.screen-empty img { width: 96px; height: 96px; object-fit: contain; flex: none; }
.empty-title { font: 900 18px/1.2 var(--display); }
.empty-sub { font: 700 13px var(--body); color: var(--muted); margin-top: 4px; }
.performance { margin: 14px 0 22px; }
.avatar { width: 46px; height: 46px; border-radius: 16px; background: var(--pink-soft); display: flex; align-items: center; justify-content: center; font: 900 18px var(--display); color: var(--pink); flex: none; }
.np { flex: 1; min-width: 0; }
.np .eyebrow { display: block; font-size: 10px; }
.np-singer { font: 900 17px/1.2 var(--display); margin: 2px 0 0; overflow-wrap: anywhere; }
.np-sub { font: 700 12px var(--body); color: var(--dim); }
.status-msg { margin: -12px 0 18px; }
.next { margin-bottom: 22px; }
.next-row { padding: 10px 12px; border-radius: 20px; }
.next-row.empty { color: var(--dim); font: 700 13px var(--body); }
.pos { width: 26px; height: 26px; border-radius: 50%; background: var(--blue-pale); color: var(--blue); display: flex; align-items: center; justify-content: center; font: 900 12px var(--body); flex: none; }
.next-thumb { width: 56px; height: 40px; border-radius: 10px; object-fit: cover; background: var(--pink-soft); }
.meta { flex: 1; min-width: 0; }
.next-title { font: 800 14px/1.2 var(--body); }
.next-sub { font: 700 12px var(--body); color: var(--dim); }
.host-form { margin-top: 26px; padding: 16px; }
.form-title { font: 900 20px/1.2 var(--display); margin: 4px 0 2px; }
.names { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-go { margin-top: 16px; }
.uncertain { margin-top: 14px; }
.uncertain p { margin: 0 0 8px; }
</style>
