<script setup lang="ts">
import { computed } from 'vue';
import { LIB } from '../library';
import { favorites } from '../favorites';
import SongCard from './SongCard.vue';
import { tab } from '../store';

const faves = computed(() => LIB.filter(song => favorites.has(song.id)));
</script>

<template>
  <h1 class="title">Favorites</h1>
  <p class="subtitle">{{ faves.length ? `${faves.length} saved · tap + to queue one` : 'Your go-to songs, ready to queue.' }}</p>
  <div v-if="!faves.length" class="empty">
    <img class="mascot bob" src="/mascot/sad.png" width="150" height="150" alt="The red panda mascot holding an empty basket">
    <div class="empty-title">Nothing here yet</div>
    <div class="empty-sub">Tap the ♡ on any song to save it for next time.</div>
    <button class="btn blue small" @click="tab = 'browse'">Browse library</button>
  </div>
  <div class="stack faves"><SongCard v-for="song in faves" :key="song.id" :song="song" /></div>
</template>

<style scoped>
.empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 30px 20px; }
.empty img { width: 150px; height: 150px; object-fit: contain; }
.empty-title { font: 900 18px var(--display); margin-top: 18px; }
.empty-sub { font: 700 13px var(--body); color: var(--dim); margin: 4px 0 18px; }
.faves { gap: 10px; }
</style>
