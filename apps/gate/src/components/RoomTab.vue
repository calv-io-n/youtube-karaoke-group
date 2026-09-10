<script setup lang="ts">
import { computed } from 'vue';
import type { QueueItem } from '@karaoke/contracts';
import { songInfo, thumb } from '../library';
import { doneItems, hostReady, isController, joinedName, members, moveBy, playingItem, queue, removeItem, reordering, roomCode, setJoining, showToast, startNext, waiting } from '../store';

const PALETTE = [{ bg: '#ffd0e3', fg: '#ff6fae' }, { bg: '#bfe3ff', fg: '#4fa9f2' }, { bg: '#ffe9a8', fg: '#c98a00' }, { bg: '#d6f5e3', fg: '#2f9c66' }];
const people = computed(() => {
  const list = isController ? ['Host', ...members.value] : [joinedName.value, ...members.value.filter(name => name !== joinedName.value)];
  return list.map((name, index) => ({ name, initial: name.trim()[0]?.toUpperCase() ?? '?', ...(index === 0 ? { bg: '#3b3556', fg: '#fff' } : PALETTE[(index - 1) % PALETTE.length]!) }));
});
const joiningOpen = computed(() => queue.value?.joiningOpen ?? true);
const queueCount = computed(() => (playingItem.value ? 1 : 0) + waiting.value.length);
const describe = (item: QueueItem) => songInfo(item.videoId);
const statusOf = (item: QueueItem) => item.status === 'playing' ? 'singing now' : item.status === 'queued' ? (item.requester !== item.singer ? `requested by ${item.requester}` : 'waiting') : item.status;

async function invite() {
  const url = `${location.origin}/r/${roomCode.value}`;
  const data = { title: 'Utaoke', text: `Join our karaoke room with code ${roomCode.value}`, url };
  try { if (navigator.share) { await navigator.share(data); return; } } catch { return; }
  try { await navigator.clipboard.writeText(url); showToast('Invite link copied ♪'); } catch { showToast(`Room code: ${roomCode.value}`); }
}
</script>

<template>
  <div class="between head">
    <div><div class="eyebrow">Room</div><div class="code">{{ roomCode || '····' }}</div></div>
    <button v-if="isController" class="joining" :style="{ background: joiningOpen ? 'var(--green-soft)' : 'var(--line-soft)', color: joiningOpen ? 'var(--green)' : 'var(--dim)' }" :aria-pressed="joiningOpen" @click="setJoining(!joiningOpen)">{{ joiningOpen ? 'Joining open' : 'Joining closed' }}</button>
    <span v-else class="joining" :style="{ background: joiningOpen ? 'var(--green-soft)' : 'var(--line-soft)', color: joiningOpen ? 'var(--green)' : 'var(--dim)' }">{{ joiningOpen ? 'Joining open' : 'Joining closed' }}</span>
  </div>
  <div class="shelf people">
    <div v-for="person in people" :key="person.name" class="person"><div class="avatar" :style="{ background: person.bg, color: person.fg }">{{ person.initial }}</div><div class="person-name ellipsis">{{ person.name }}</div></div>
    <button class="person invite" :disabled="!roomCode" @click="invite"><div class="avatar dashed">+</div><div class="person-name">Invite</div></button>
  </div>

  <div class="section-head"><div class="eyebrow">Queue · {{ queueCount }}</div><div class="muted small">{{ isController ? 'You start each singer' : 'Anyone can start the next singer' }}</div></div>
  <div class="stack">
    <div v-if="playingItem" class="card q-row row playing">
      <div class="pos pink">♪</div>
      <img class="q-thumb" :src="thumb(playingItem.videoId)" alt="" loading="lazy">
      <div class="meta"><div class="q-title ellipsis">{{ describe(playingItem).title }}</div><div class="q-sub ellipsis">{{ playingItem.singer }} · singing now</div></div>
    </div>
    <div v-for="(item, index) in waiting" :key="item.id" class="card q-row row">
      <div class="pos">{{ index + 1 }}</div>
      <img class="q-thumb" :src="thumb(item.videoId)" alt="" loading="lazy">
      <div class="meta"><div class="q-title ellipsis">{{ describe(item).title }}</div><div class="q-sub ellipsis">{{ item.singer }} · {{ statusOf(item) }}</div></div>
      <div class="actions">
        <button class="square" :aria-label="`Move ${item.singer} up`" :disabled="reordering || index === 0" @click="moveBy(item, -1)">↑</button>
        <button class="square" :aria-label="`Move ${item.singer} down`" :disabled="reordering || index === waiting.length - 1" @click="moveBy(item, 1)">↓</button>
        <button v-if="isController" class="square pink" :aria-label="`Remove ${item.singer}`" @click="removeItem(item)">×</button>
      </div>
    </div>
    <div v-if="!playingItem && !waiting.length" class="card q-row empty">The queue is empty. Add a song from Search or the Library.</div>
    <div v-for="item in doneItems" :key="item.id" class="card q-row row done">
      <div class="pos">✓</div>
      <img class="q-thumb" :src="thumb(item.videoId)" alt="" loading="lazy">
      <div class="meta"><div class="q-title ellipsis">{{ describe(item).title }}</div><div class="q-sub ellipsis">{{ item.singer }} · {{ item.status }}</div></div>
    </div>
  </div>
  <button class="btn pink block start" :disabled="!waiting.length || !hostReady" @click="startNext">Start next singer ♪</button>
</template>

<style scoped>
.head { margin-bottom: 14px; }
.code { font: 900 28px/1.1 var(--display); letter-spacing: .12em; }
.joining { border-radius: 999px; padding: 10px 14px; font: 800 12px var(--body); flex: none; }
.people { gap: 10px; margin-bottom: 20px; padding-bottom: 6px; }
.person { flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; width: 60px; }
.avatar { width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font: 900 18px var(--display); border: 3px solid #fff; box-shadow: 0 2px 0 var(--line); }
.avatar.dashed { border: 3px dashed #8ed0ff; box-shadow: none; color: var(--blue); font: 900 22px var(--body); background: transparent; }
.person-name { font: 800 11px var(--body); color: var(--muted); max-width: 60px; }
.invite .person-name { color: var(--blue); }
.invite:disabled { opacity: .5; }
.small { font-size: 12px; color: var(--faint); }
.q-row { padding: 10px 10px 10px 14px; border-radius: 20px; animation: pop .3s ease; }
.q-row.playing { background: var(--pink-tint); }
.q-row.done { opacity: .6; }
.q-row.empty { color: var(--dim); font: 700 13px var(--body); }
.pos { font: 900 14px var(--body); color: var(--faint); width: 18px; flex: none; text-align: center; }
.pos.pink { color: var(--pink); }
.q-thumb { width: 56px; height: 40px; border-radius: 10px; object-fit: cover; background: var(--pink-soft); flex: none; }
.meta { flex: 1; min-width: 0; }
.q-title { font: 800 14px/1.2 var(--body); }
.q-sub { font: 700 12px var(--body); color: var(--dim); }
.actions { display: flex; gap: 4px; flex: none; }
.start { margin-top: 16px; }
</style>
