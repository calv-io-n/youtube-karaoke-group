import { reactive } from 'vue';

export type Tag = 'Anime' | 'J-Pop' | 'City pop' | 'K-Pop' | 'Party' | 'Classics' | 'Ballads';
export type Song = { id: string; title: string; artist: string; tag: Tag; dur: number; source: string };

/**
 * Preloaded karaoke versions (instrumental + on-screen lyrics). Every entry was checked against
 * YouTube oEmbed so the in-app preview embed works; `source` names the uploading channel.
 * Playback happens in the host's real YouTube tab, so guests never need to open these directly.
 */
export const LIB: Song[] = [
  { id: 'Zy91HqT3jIE', title: 'Idol', artist: 'YOASOBI', tag: 'Anime', dur: 230, source: 'EdKara' },
  { id: 'fNMBtyP8zjI', title: 'Gurenge', artist: 'LiSA', tag: 'Anime', dur: 245, source: 'EdKara' },
  { id: 'kfREg0i6eOM', title: "A Cruel Angel's Thesis", artist: 'Yoko Takahashi', tag: 'Anime', dur: 255, source: 'EdKara' },
  { id: 'KjBoyGsD5-Y', title: 'Blue Bird', artist: 'Ikimonogakari', tag: 'Anime', dur: 230, source: 'EdKara' },
  { id: '66o8rQJK5hI', title: 'Pretender', artist: 'Official HIGE DANdism', tag: 'J-Pop', dur: 329, source: 'KARAOKE UtaCchaO' },
  { id: 'vN0mac_Sf7Y', title: 'Lemon', artist: 'Kenshi Yonezu', tag: 'J-Pop', dur: 265, source: 'EdKara' },
  { id: 'qF1bDi6_vlA', title: 'Plastic Love', artist: 'Mariya Takeuchi', tag: 'City pop', dur: 300, source: 'KARAOKE UtaCchaO' },
  { id: 'xvgXkfJ1IoQ', title: 'Stay With Me (Mayonaka no Door)', artist: 'Miki Matsubara', tag: 'City pop', dur: 327, source: 'EdKara' },
  { id: 'Khnksie1d4s', title: 'Dynamite', artist: 'BTS', tag: 'K-Pop', dur: 200, source: 'Tiyangie Lab' },
  { id: '1WsSY1I17gw', title: 'Butter', artist: 'BTS', tag: 'K-Pop', dur: 192, source: 'BANGTANTV' },
  { id: 'qWst8V-P9qw', title: 'Uptown Funk', artist: 'Mark Ronson ft. Bruno Mars', tag: 'Party', dur: 285, source: 'Party Tyme Karaoke' },
  { id: 'Mbt6nFx4irU', title: 'Shape of You', artist: 'Ed Sheeran', tag: 'Party', dur: 246, source: 'Zoom Karaoke' },
  { id: 'NvZyU7ij_bs', title: 'Mr. Brightside', artist: 'The Killers', tag: 'Party', dur: 225, source: 'Zoom Karaoke' },
  { id: 'o21EmahSfSc', title: 'Bohemian Rhapsody', artist: 'Queen', tag: 'Classics', dur: 364, source: 'EdKara' },
  { id: '5yebPm09eM0', title: "Don't Stop Me Now", artist: 'Queen', tag: 'Classics', dur: 229, source: 'Zoom Karaoke' },
  { id: '9iQH7g_zKl8', title: 'Never Gonna Give You Up', artist: 'Rick Astley', tag: 'Classics', dur: 228, source: 'Zoom Karaoke' },
  { id: 'LsOFR-oYB6w', title: 'Sweet Caroline', artist: 'Neil Diamond', tag: 'Classics', dur: 227, source: 'Stingray Karaoke' },
  { id: 'SRn4Fh47kok', title: 'Rolling in the Deep', artist: 'Adele', tag: 'Ballads', dur: 241, source: 'Stingray Karaoke' },
  { id: 'ziLic4haqaw', title: 'Someone Like You', artist: 'Adele', tag: 'Ballads', dur: 286, source: 'EdKara' },
  { id: '9Z8oIQZvEP0', title: 'Let It Go', artist: 'Idina Menzel (Frozen)', tag: 'Ballads', dur: 224, source: 'karaoke SESH' },
];

export const TAGS: Array<'All' | Tag> = ['All', 'Anime', 'J-Pop', 'City pop', 'K-Pop', 'Party', 'Classics', 'Ballads'];

export const SHELVES: Array<{ title: string; tags: Tag[]; dot: string }> = [
  { title: 'Anime openings', tags: ['Anime'], dot: '#ff6fae' },
  { title: 'J-Pop & city pop', tags: ['J-Pop', 'City pop'], dot: '#4fa9f2' },
  { title: 'Party classics', tags: ['Party', 'Classics', 'K-Pop', 'Ballads'], dot: '#ffb347' },
];

export const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const embed = (id: string, autoplay = false) => `https://www.youtube.com/embed/${id}?${autoplay ? 'autoplay=1&' : ''}mute=1&playsinline=1&rel=0`;
export const fmt = (seconds: number) => { const s = Math.max(0, Math.round(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const bySongId = (id: string) => LIB.find(song => song.id === id);

export function search(query: string, tag: 'All' | Tag): Song[] {
  const q = query.trim().toLowerCase();
  if (q) return LIB.filter(song => `${song.title} ${song.artist} ${song.tag}`.toLowerCase().includes(q));
  return LIB.filter(song => tag === 'All' || song.tag === tag);
}

/** Titles for songs guests pasted themselves, resolved through YouTube oEmbed (no API key, CORS-enabled). */
export type SongInfo = { title: string; artist: string; known: boolean };
const resolved = reactive(new Map<string, SongInfo>());
const inflight = new Set<string>();

export function songInfo(videoId: string): SongInfo {
  const known = bySongId(videoId);
  if (known) return { title: known.title, artist: known.artist, known: true };
  const hit = resolved.get(videoId);
  if (hit) return hit;
  void resolveTitle(videoId);
  return { title: 'YouTube video', artist: videoId, known: false };
}

async function resolveTitle(videoId: string) {
  if (inflight.has(videoId) || resolved.has(videoId)) return;
  inflight.add(videoId);
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, { referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json() as { title?: unknown; author_name?: unknown };
    resolved.set(videoId, { title: typeof data.title === 'string' ? data.title : 'YouTube video', artist: typeof data.author_name === 'string' ? data.author_name : '', known: false });
  } catch {
    resolved.set(videoId, { title: 'YouTube video', artist: videoId, known: false });
  } finally { inflight.delete(videoId); }
}
