<script setup lang="ts">
import { computed, ref } from 'vue';
import { fmt, thumb } from '../library';
import { hostReady, isController, nowPlaying, pause, progress, resume, startNext, status, statusColor, statusLabel, stopSong, waiting } from '../store';

const SHEET_H = 460; const HANDLE_H = 70;
/** 0 = tucked away, 1 = fully open. The host starts with the controls showing. */
const sheetP = ref(isController ? 1 : 0);
const dragging = ref(false);
let dragStartY = 0; let dragStartP = 0; let moved = false;
const open = computed(() => sheetP.value > 0.5);
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const sheetStyle = computed(() => ({ transform: `translateY(${-(SHEET_H - HANDLE_H) * (1 - sheetP.value)}px)`, transition: dragging.value ? 'none' : 'transform .38s cubic-bezier(.3,1.3,.5,1)' }));
const bodyOpacity = computed(() => 0.35 + 0.65 * sheetP.value);

function down(e: PointerEvent) { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); dragging.value = true; dragStartY = e.clientY; dragStartP = sheetP.value; moved = false; }
function move(e: PointerEvent) { if (!dragging.value) return; const dy = e.clientY - dragStartY; sheetP.value = clamp(dragStartP + dy / (SHEET_H - HANDLE_H)); if (Math.abs(dy) > 6) moved = true; }
function up() { if (!dragging.value) return; dragging.value = false; if (moved) sheetP.value = sheetP.value > 0.4 ? 1 : 0; }
function tap() { if (moved) return; sheetP.value = open.value ? 0 : 1; }

const playing = computed(() => status.value === 'playing');
const canToggle = computed(() => hostReady.value && (status.value === 'playing' || status.value === 'paused'));
const handleLabel = computed(() => open.value ? 'Hide controls' : !nowPlaying.value.videoId ? 'Pull down for controls' : playing.value ? `${nowPlaying.value.singer} · ${nowPlaying.value.title}` : `${statusLabel.value} — pull for controls`);
</script>

<template>
  <div class="sheet" :style="sheetStyle">
    <div class="body" :style="{ opacity: bodyOpacity }" :inert="!open || undefined">
      <div class="eyebrow sheet-eyebrow">Karaoke controls</div>
      <div class="row np">
        <img v-if="nowPlaying.videoId" class="np-thumb" :src="thumb(nowPlaying.videoId)" alt=""><img v-else class="np-thumb mascot" src="/mascot/head.png" alt="">
        <div class="np-meta"><div class="np-title ellipsis">{{ nowPlaying.videoId ? nowPlaying.title : 'Between singers' }}</div><div class="np-sub ellipsis">{{ nowPlaying.videoId ? `${nowPlaying.singer} · ${nowPlaying.artist}` : waiting.length ? `${waiting.length} waiting in the queue` : 'The queue is empty' }}</div><div class="status" :style="{ color: statusColor }"><span class="dot" :style="{ background: statusColor }"></span>{{ statusLabel }}</div></div>
      </div>
      <div class="bar" role="progressbar" :aria-valuenow="Math.round(progress.pct)" aria-valuemin="0" aria-valuemax="100"><div class="fill" :style="{ transform: `scaleX(${progress.pct / 100})` }"></div></div>
      <div class="times"><span>{{ fmt(progress.elapsed) }}</span><span>{{ fmt(progress.duration) }}</span></div>
      <div class="controls">
        <button class="side" aria-label="Next singer" title="Start the next singer" :disabled="!hostReady || !waiting.length" @click="startNext"><svg width="26" height="26" viewBox="0 0 24 24" fill="#3b3556"><path d="M5 5l9 7-9 7zM16 5h3v14h-3z"/></svg></button>
        <button class="main" :aria-label="playing ? 'Pause' : 'Resume'" :disabled="!canToggle" @click="playing ? pause() : resume()"><svg width="34" height="34" viewBox="0 0 24 24" fill="#fff"><path v-if="playing" d="M6 5h4v14H6zM14 5h4v14h-4z"/><path v-else d="M7 4l13 8-13 8z"/></svg></button>
        <button class="side" aria-label="Stop / intermission" title="Stop and go to intermission" :disabled="!hostReady || !nowPlaying.videoId" @click="stopSong"><svg width="24" height="24" viewBox="0 0 24 24" fill="#3b3556"><rect x="5" y="5" width="14" height="14" rx="3"/></svg></button>
      </div>
      <div class="hint">{{ open ? (hostReady ? 'Push up to tuck the controls away' : 'Waiting for the host screen…') : '' }}</div>
    </div>
    <div class="handle" role="button" tabindex="0" :aria-expanded="open" aria-label="Karaoke controls" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @click="tap" @keydown.enter.prevent="tap" @keydown.space.prevent="tap">
      <span class="glyph" :style="{ background: open ? 'var(--blue)' : 'var(--pink)' }">{{ open ? '▴' : '▾' }}</span>
      <span class="handle-label ellipsis">{{ handleLabel }}</span>
      <span class="grip"></span>
    </div>
  </div>
</template>

<style scoped>
.sheet { position: absolute; left: 0; right: 0; top: 0; height: 460px; z-index: 30; pointer-events: none; }
.body { position: absolute; inset: 0; background: linear-gradient(180deg, var(--blue-light) 0%, var(--pink-soft) 100%); border-radius: 0 0 40px 40px; box-shadow: 0 10px 30px rgba(79, 169, 242, .25); pointer-events: auto; padding: calc(env(safe-area-inset-top) + 56px) 24px 0; display: flex; flex-direction: column; }
.sheet-eyebrow { color: #4c6f8f; }
.np { margin-top: 14px; gap: 14px; }
.np-thumb { width: 104px; height: 70px; border-radius: 16px; object-fit: cover; background: #fff; box-shadow: 0 4px 0 rgba(255, 255, 255, .7); flex: none; }
.np-thumb.mascot { object-fit: contain; padding: 4px; }
.np-meta { flex: 1; min-width: 0; }
.np-title { font: 900 18px/1.2 var(--display); }
.np-sub { font: 700 13px var(--body); color: var(--muted); margin-top: 2px; }
.status { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; padding: 5px 10px; border-radius: 999px; background: rgba(255, 255, 255, .7); font: 800 11px var(--body); }
.status .dot { width: 7px; height: 7px; }
.bar { margin-top: 22px; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, .7); overflow: hidden; }
.fill { height: 100%; border-radius: 4px; background: var(--pink); transform-origin: left center; transition: transform .5s linear; }
.times { display: flex; justify-content: space-between; font: 800 11px var(--body); color: var(--muted); margin-top: 6px; font-variant-numeric: tabular-nums; }
.controls { display: flex; align-items: center; justify-content: center; gap: 18px; margin-top: 22px; }
.side, .main { border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: transform .08s, box-shadow .08s, opacity .2s; }
.side { width: 60px; height: 60px; background: #fff; box-shadow: 0 5px 0 #d9cde0; }
.side:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 2px 0 #d9cde0; }
.main { width: 84px; height: 84px; background: var(--pink); box-shadow: 0 7px 0 var(--pink-dark); color: #fff; }
.main:active:not(:disabled) { transform: translateY(4px); box-shadow: 0 3px 0 var(--pink-dark); }
.side:disabled, .main:disabled { opacity: .45; }
.hint { text-align: center; font: 700 12px var(--body); color: var(--muted); margin-top: 10px; min-height: 16px; }
.handle { position: absolute; left: 50%; top: 460px; transform: translateX(-50%); margin-top: -16px; pointer-events: auto; cursor: grab; touch-action: none; user-select: none; display: flex; align-items: center; gap: 10px; padding: 10px 18px 10px 14px; border-radius: 999px; background: #fff; box-shadow: 0 4px 0 var(--line), 0 10px 24px rgba(59, 53, 86, .12); max-width: calc(100% - 40px); }
.handle:active { cursor: grabbing; }
.glyph { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; color: #fff; font-size: 12px; flex: none; }
.handle-label { font: 800 13px var(--body); color: var(--ink); }
.grip { width: 36px; height: 5px; border-radius: 3px; background: var(--line); flex: none; }
</style>
