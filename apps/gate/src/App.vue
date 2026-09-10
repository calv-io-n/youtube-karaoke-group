<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import JoinScreen from './components/JoinScreen.vue';
import HomeTab from './components/HomeTab.vue';
import ControlSheet from './components/ControlSheet.vue';
import SearchTab from './components/SearchTab.vue';
import LibraryTab from './components/LibraryTab.vue';
import FavesTab from './components/FavesTab.vue';
import RoomTab from './components/RoomTab.vue';
import TabBar from './components/TabBar.vue';
import { ended, error, joined, leaveRoom, start, stop, tab, toast } from './store';

onMounted(start);
onUnmounted(stop);
watch(tab, () => { document.querySelector('.content')?.scrollTo({ top: 0 }); });
</script>

<template>
  <div class="shell">
    <template v-if="ended">
      <div class="ended">
        <img class="mascot bob" src="/mascot/sad.png" width="150" height="150" alt="">
        <h1 class="title">This room is closed</h1>
        <p class="muted">{{ error || 'The host ended the session or it expired.' }}</p>
        <button class="btn pink small" @click="leaveRoom">Join another room</button>
      </div>
    </template>
    <JoinScreen v-else-if="!joined" />
    <template v-else>
      <main :class="['content', { 'with-sheet': tab === 'home' }]">
        <HomeTab v-if="tab === 'home'" />
        <SearchTab v-else-if="tab === 'search'" />
        <LibraryTab v-else-if="tab === 'browse'" />
        <FavesTab v-else-if="tab === 'faves'" />
        <RoomTab v-else />
        <p v-if="error && tab !== 'home'" class="error" role="alert">{{ error }}</p>
      </main>
      <ControlSheet v-if="tab === 'home'" />
      <div v-if="toast" class="toast" role="status">{{ toast }}</div>
      <TabBar />
    </template>
  </div>
</template>

<style scoped>
.ended { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px 28px; gap: 8px; }
.ended img { width: 150px; height: 150px; object-fit: contain; }
.ended .title { margin-top: 12px; }
.ended .btn { margin-top: 14px; }
</style>
