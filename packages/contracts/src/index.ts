import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;
export const ADAPTER_VERSION = 'youtube-native-v0.1.0';
export const VideoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
export const Name = z.string().trim().min(1).max(60);
export const Id = z.string().uuid();
export const QueueStatus = z.enum(['pending', 'queued', 'playing', 'completed', 'failed', 'skipped', 'rejected', 'cancelled']);
export const QueueItem = z.object({
  id: Id,
  videoId: VideoId,
  singer: Name,
  requester: Name,
  status: QueueStatus,
  position: z.number().int().nonnegative(),
  attemptId: Id.nullable(),
  createdAt: z.string(),
});
export type QueueItem = z.infer<typeof QueueItem>;
export const QueueSnapshot = z.object({
  revision: z.number().int().nonnegative(),
  joiningOpen: z.boolean(),
  items: z.array(QueueItem),
});
export type QueueSnapshot = z.infer<typeof QueueSnapshot>;
export const QueueSubmission = z.object({ videoId: VideoId, singer: Name });
export const QueueAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), itemId: Id }),
  z.object({ action: z.literal('reject'), itemId: Id }),
  z.object({ action: z.literal('remove'), itemId: Id }),
  z.object({ action: z.literal('cancel'), itemId: Id }),
  z.object({ action: z.literal('reorder'), itemIds: z.array(Id).max(200), expectedQueueRevision: z.number().int().nonnegative() }),
  z.object({ action: z.literal('start-next') }),
  z.object({ action: z.enum(['pause', 'resume', 'skip']) }),
  z.object({ action: z.literal('set-joining'), open: z.boolean() }),
]);
export type QueueAction = z.infer<typeof QueueAction>;

// getRandomValues also works on trusted-LAN HTTP during the local prototype.
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeVideo(input: string): string {
  if (VideoId.safeParse(input.trim()).success) return input.trim();
  const url = new URL(input.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('Use a YouTube watch or share link.');
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be' && /^\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)) id = url.pathname.split('/')[1] ?? null;
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (/^\/(shorts|live)\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)) id = url.pathname.split('/')[2] ?? null;
  }
  if (!VideoId.safeParse(id).success) throw new Error('Use a YouTube watch or share link.');
  return id!;
}

export const Performance = z.object({
  attemptId: Id,
  videoId: VideoId,
  singer: Name,
  requester: Name,
});
export type Performance = z.infer<typeof Performance>;

export const GateCommand = z.discriminatedUnion('type', [
  z.object({ v: z.literal(1), commandId: Id, expectedRevision: z.number().int().nonnegative(), type: z.literal('load'), performance: Performance }),
  z.object({ v: z.literal(1), commandId: Id, expectedRevision: z.number().int().nonnegative(), type: z.enum(['pause', 'resume', 'skip', 'probe']) }),
]);
export type GateCommand = z.infer<typeof GateCommand>;

export const Observation = z.object({
  adapterVersion: z.literal(ADAPTER_VERSION),
  sequence: z.number().int().nonnegative(),
  attemptId: Id.nullable(),
  videoId: VideoId.nullable(),
  playerState: z.enum(['unknown', 'loading', 'playing', 'paused', 'ended', 'blocked', 'cued']),
  currentTime: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(),
  loadEvidence: z.boolean(),
  fullscreen: z.boolean(),
  fullscreenPreserved: z.boolean(),
  playerPreserved: z.boolean(),
  overlayMounted: z.boolean(),
  adShowing: z.boolean(),
  capabilities: z.object({ load: z.boolean(), pause: z.boolean(), resume: z.boolean(), identity: z.boolean() }),
  error: z.string().max(240).nullable(),
});
export type Observation = z.infer<typeof Observation>;

export const GateState = z.object({
  v: z.literal(1),
  sessionId: Id,
  revision: z.number().int().nonnegative(),
  status: z.enum(['idle', 'loading', 'playing', 'paused', 'between_songs', 'blocked', 'out_of_sync']),
  desired: Performance.nullable(),
  current: Performance.nullable(),
  observation: Observation.nullable(),
  connected: z.boolean(),
  pendingCommand: Id.nullable(),
  message: z.string(),
  transitions: z.number().int().nonnegative(),
  consecutiveTransitions: z.number().int().nonnegative(),
  queue: QueueSnapshot.optional(),
});
export type GateState = z.infer<typeof GateState>;

export const HostMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('observation'), observation: Observation }),
  z.object({ type: z.literal('result'), commandId: Id, accepted: z.boolean(), error: z.string().max(240).optional() }),
  z.object({ type: z.literal('heartbeat') }),
  z.object({ type: z.literal('detached') }),
]);
export const ServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), state: GateState }),
  z.object({ type: z.literal('command'), command: GateCommand }),
  z.object({ type: z.literal('heartbeat') }),
]);
