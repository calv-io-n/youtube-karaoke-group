<script setup lang="ts">
import { tab, type Tab } from '../store';

const tabs: Array<{ id: Tab; label: string; path: string }> = [
  { id: 'home', label: 'Home', path: 'M9 18V6l10-2v11M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  { id: 'search', label: 'Search', path: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5' },
  { id: 'browse', label: 'Library', path: 'M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v6H4zM14 15h6v6h-6z' },
  { id: 'faves', label: 'Faves', path: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z' },
  { id: 'room', label: 'Room', path: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15 4.2a3.5 3.5 0 0 1 0 6.6' },
];
</script>

<template>
  <nav class="tabbar" aria-label="Sections">
    <button v-for="t in tabs" :key="t.id" :class="['tab', { on: tab === t.id }]" :aria-current="tab === t.id ? 'page' : undefined" @click="tab = t.id">
      <span class="icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="t.path"/></svg></span>
      <span class="tab-label">{{ t.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.tabbar { position: absolute; left: 0; right: 0; bottom: 0; padding: 10px 12px calc(14px + env(safe-area-inset-bottom)); background: rgba(255, 255, 255, .93); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border-top: 2px solid var(--line-soft); display: flex; justify-content: space-around; z-index: 35; }
.tab { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 8px; min-width: 60px; color: var(--dim); }
.tab.on { color: var(--pink); }
.icon { width: 44px; height: 30px; border-radius: 999px; display: flex; align-items: center; justify-content: center; transition: background .15s; }
.tab.on .icon { background: var(--pink-pale); }
.tab-label { font: 800 11px var(--body); }
</style>
