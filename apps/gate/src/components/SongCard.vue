<script setup lang="ts">
import { computed, ref } from 'vue';
import { embed, thumb, type Song } from '../library';
import { favorites, toggleFavorite } from '../favorites';
import { addSong, showToast } from '../store';

/** Only one inline preview plays at a time across every card. */
const previewId = ref('');

const props = withDefaults(defineProps<{ song: Song; variant?: 'row' | 'tile' | 'mini' }>(), { variant: 'row' });
const fav = computed(() => favorites.has(props.song.id));
const previewing = computed(() => previewId.value === props.song.id);
const adding = ref(false);

function onFav() { const saved = toggleFavorite(props.song.id); if (saved) showToast('Saved to favorites ♥'); }
function onPreview() { previewId.value = previewing.value ? '' : props.song.id; }
async function onAdd() {
  adding.value = true;
  try { if (await addSong(props.song.id)) showToast(`Added "${props.song.title}" to the queue ♪`); }
  finally { adding.value = false; }
}
</script>

<template>
  <div v-if="variant === 'row'" class="card song-row">
    <div class="row">
      <button class="thumb thumb-row" :aria-label="`Preview ${song.title}`" :aria-pressed="previewing" @click="onPreview"><img :src="thumb(song.id)" alt="" loading="lazy"><span class="play">▶</span></button>
      <div class="meta"><div class="song-title ellipsis">{{ song.title }}</div><div class="song-sub ellipsis">{{ song.artist }} · {{ song.tag }}</div></div>
      <button :class="['heart', { on: fav }]" :aria-label="fav ? `Remove ${song.title} from favorites` : `Save ${song.title} to favorites`" :aria-pressed="fav" @click="onFav">{{ fav ? '♥' : '♡' }}</button>
      <button class="plus" :aria-label="`Add ${song.title} to the queue`" :disabled="adding" @click="onAdd">+</button>
    </div>
    <div v-if="previewing" class="embed preview"><iframe :src="embed(song.id, true)" :title="`Preview of ${song.title}`" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
  </div>
  <div v-else :class="['card', 'song-tile', variant]">
    <button class="thumb thumb-tile" :aria-label="`Preview ${song.title}`" :aria-pressed="previewing" @click="onPreview">
      <img :src="thumb(song.id)" alt="" loading="lazy">
      <span v-if="variant === 'mini'" class="play center">▶</span>
      <span v-else :class="['heart-badge', { on: fav }]" role="button" :aria-label="fav ? 'Remove from favorites' : 'Save to favorites'" @click.stop="onFav">{{ fav ? '♥' : '♡' }}</span>
    </button>
    <div class="tile-title ellipsis">{{ song.title }}</div>
    <div class="between tile-foot"><span class="song-sub ellipsis">{{ song.artist }}</span><button :class="['plus', 'sm', { blue: variant === 'tile' }]" :aria-label="`Add ${song.title} to the queue`" :disabled="adding" @click="onAdd">+</button></div>
    <div v-if="previewing" class="embed preview"><iframe :src="embed(song.id, true)" :title="`Preview of ${song.title}`" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
  </div>
</template>

<style scoped>
.song-row { padding: 10px; }
.thumb-row { width: 96px; height: 64px; }
.meta { flex: 1; min-width: 0; }
.song-title { font: 900 15px/1.25 var(--display); }
.song-sub { font: 700 12px var(--body); color: var(--dim); margin-top: 2px; }
.preview { margin-top: 10px; }
.song-tile { flex: none; width: 168px; padding: 8px; }
.song-tile.mini { width: 150px; }
.thumb-tile { width: 100%; aspect-ratio: 16 / 9; border-radius: 16px; display: block; }
.heart-badge { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border-radius: 50%; background: rgba(255, 255, 255, .92); display: flex; align-items: center; justify-content: center; font-size: 14px; line-height: 1; color: #d3cfe0; }
.heart-badge.on { color: var(--pink); }
.tile-title { font: 900 13px/1.25 var(--display); margin: 8px 2px 0; }
.mini .tile-title { font: 800 13px/1.2 var(--body); }
.tile-foot { margin: 2px 2px 0; gap: 6px; }
.tile-foot .song-sub { margin: 0; font-size: 11px; }
</style>
