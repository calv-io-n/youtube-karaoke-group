import type { GateState, QueueItem, QueueSnapshot } from './index';

export type RoomReply = { queue: QueueSnapshot; playback: GateState; roomCode?: string };

export function publicQueue(items: QueueItem[], revision: number, joiningOpen: boolean): QueueSnapshot {
  return { revision, joiningOpen, items: items.filter(item => item.status !== 'rejected' && item.status !== 'cancelled').map((item, position) => ({ ...item, position })) };
}
