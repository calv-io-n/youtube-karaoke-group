<script setup lang="ts">
import { computed, ref } from 'vue';
import { normalizeVideo } from '@karaoke/contracts';
import { TAGS, search, songInfo, type Tag } from '../library';
import SongCard from './SongCard.vue';
import { addSong, joinedName, showToast } from '../store';

const query = ref('');
const tag = ref<'All' | Tag>('All');
const results = computed(() => search(query.value, tag.value));
const resultsLabel = computed(() => { const q = query.value.trim(); return q ? `${results.value.length} result${results.value.length === 1 ? '' : 's'} for “${q}”` : tag.value === 'All' ? 'All songs' : tag.value; });

const pasting = ref(false);
const link = ref('');
const singer = ref(joinedName.value);
const pasteError = ref('');
const pasteBusy = ref(false);
const pastedId = computed(() => { try { return normalizeVideo(link.value); } catch { return ''; } });
const pastedInfo = computed(() => pastedId.value ? songInfo(pastedId.value) : undefined);
async function openPaste() {
  pasting.value = true; pasteError.value = ''; singer.value = singer.value || joinedName.value;
  try { const text = await navigator.clipboard?.readText(); if (text && /youtu/.test(text)) link.value = text.trim(); } catch { /* clipboard permission denied: user pastes manually */ }
}
async function submitPaste() {
  pasteError.value = '';
  if (!pastedId.value) { pasteError.value = 'Use a YouTube watch or share link.'; return; }
  pasteBusy.value = true;
  try { if (await addSong(pastedId.value, singer.value.trim())) { showToast('Added to the queue ♪'); link.value = ''; pasting.value = false; } }
  finally { pasteBusy.value = false; }
}
</script>

<template>
  <h1 class="title find">Find a song</h1>
  <div class="search">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4fa9f2" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input v-model="query" type="search" placeholder="Song, artist, anime…" aria-label="Search the library" autocomplete="off" enterkeyhint="search">
    <button class="paste" :aria-pressed="pasting" @click="pasting ? (pasting = false) : openPaste()">{{ pasting ? 'Close' : 'Paste link' }}</button>
  </div>
  <form v-if="pasting" class="card paste-card" @submit.prevent="submitPaste">
    <div class="eyebrow">Any YouTube link</div>
    <p class="muted">Paste a watch or share link and we normalize it. Karaoke versions with on-screen lyrics work best.</p>
    <label class="label" for="paste-link">YouTube link</label>
    <input id="paste-link" v-model="link" class="field" placeholder="https://youtu.be/…" inputmode="url" autocomplete="off" required>
    <div v-if="pastedInfo" class="row found"><span class="found-dot"></span><span class="ellipsis"><b>{{ pastedInfo.title }}</b> <span v-if="pastedInfo.artist" class="muted">· {{ pastedInfo.artist }}</span></span></div>
    <label class="label" for="paste-singer">Who sings it</label>
    <input id="paste-singer" v-model="singer" class="field" maxlength="60" required>
    <p v-if="pasteError" class="error" role="alert">{{ pasteError }}</p>
    <button type="submit" class="btn pink block paste-go" :disabled="pasteBusy || !link">Add to queue ♪</button>
  </form>
  <div class="shelf tags"><button v-for="t in TAGS" :key="t" :class="['chip', { on: tag === t && !query }]" @click="tag = t; query = ''">{{ t }}</button></div>
  <div class="eyebrow results-label">{{ resultsLabel }}</div>
  <div class="stack results">
    <SongCard v-for="song in results" :key="song.id" :song="song" />
    <div v-if="!results.length" class="card none">Nothing in the library matches. Try <b>Paste link</b> to add any YouTube video.</div>
  </div>
</template>

<style scoped>
.find { margin-bottom: 14px; }
.search { display: flex; align-items: center; gap: 10px; padding: 4px 6px 4px 18px; border-radius: 999px; background: #fff; border: 3px solid var(--blue-soft); transition: border-color .15s; }
.search:focus-within { border-color: var(--blue); }
.search input { flex: 1; min-width: 0; border: 0; outline: none; background: none; font: 800 16px var(--body); color: var(--ink); padding: 10px 0; -webkit-appearance: none; }
.search input::placeholder { color: var(--faint); }
.paste { border-radius: 999px; background: var(--blue-pale); color: var(--blue); font: 800 12px var(--body); padding: 10px 12px; white-space: nowrap; }
.paste-card { margin-top: 12px; padding: 14px 16px; }
.paste-card .muted { margin: 4px 0 0; }
.found { margin-top: 10px; font: 700 13px var(--body); min-width: 0; }
.found-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green-dot); flex: none; }
.paste-go { margin-top: 14px; }
.tags { margin: 14px -20px 18px; padding: 4px 20px 6px; gap: 8px; }
.results-label { margin: 0 0 10px; }
.results { gap: 10px; }
.none { padding: 18px; color: var(--muted); font: 700 13px var(--body); }
</style>
