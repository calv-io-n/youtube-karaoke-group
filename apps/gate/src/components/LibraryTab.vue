<script setup lang="ts">
import { LIB, SHELVES } from '../library';
import SongCard from './SongCard.vue';

const shelves = SHELVES.map(shelf => ({ ...shelf, songs: LIB.filter(song => shelf.tags.includes(song.tag)) }));
</script>

<template>
  <h1 class="title">Library</h1>
  <p class="subtitle">Karaoke links everyone in the room can pick.</p>
  <section v-for="shelf in shelves" :key="shelf.title" class="shelf-block">
    <div class="row shelf-head"><span class="dot" :style="{ background: shelf.dot, width: '10px', height: '10px' }"></span><h2 class="shelf-title">{{ shelf.title }}</h2><span class="count">{{ shelf.songs.length }} songs</span></div>
    <div class="shelf"><SongCard v-for="song in shelf.songs" :key="song.id" :song="song" variant="tile" /></div>
  </section>
</template>

<style scoped>
.shelf-block { margin-bottom: 18px; }
.shelf-head { gap: 10px; margin-bottom: 8px; }
.shelf-title { font: 900 17px var(--display); margin: 0; }
.count { font: 800 12px var(--body); color: var(--faint); }
</style>
