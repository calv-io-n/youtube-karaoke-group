import { reactive } from 'vue';

const KEY = 'utaoke:favorites';

function load(): string[] {
  try { const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []; }
  catch { return []; }
}

export const favorites = reactive(new Set<string>(load()));

export function isFavorite(videoId: string) { return favorites.has(videoId); }

/** Toggles a favourite and returns true when the song was just saved. */
export function toggleFavorite(videoId: string): boolean {
  const saved = !favorites.has(videoId);
  if (saved) favorites.add(videoId); else favorites.delete(videoId);
  try { localStorage.setItem(KEY, JSON.stringify([...favorites])); } catch { /* private mode: keep in memory only */ }
  return saved;
}
