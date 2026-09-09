import { DurableObject } from 'cloudflare:workers';

type Env = { ROOMS: any; ASSETS?: any; YOUTUBE_DATA_API_KEY?: string };
type Role = 'owner' | 'host' | 'guest';
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const token = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const id = () => crypto.randomUUID();
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(x => x.toString(16).padStart(2, '0')).join('');

export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/rooms' && request.method === 'POST') {
    const roomId = id(); const owner = token(); const host = token(); const guest = token();
    const room = env.ROOMS.get(env.ROOMS.idFromName(roomId));
    await room.create({ roomId, credentials: { owner: await hash(owner), host: await hash(host), guest: await hash(guest) } });
    return json({ roomId, ownerToken: owner, hostToken: host, guestToken: guest });
  }
  const match = /^\/api\/rooms\/([^/]+)(?:\/(join|queue|stream|close))?$/.exec(url.pathname);
  if (!match) return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: 'NOT_FOUND' }, 404);
  const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]!));
  const auth = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (match[2] === 'join' && request.method === 'POST') return room.join(await request.json());
  if (!auth) return json({ error: 'UNAUTHORIZED' }, 401);
  const role = await room.role(await hash(auth));
  if (!role) return json({ error: 'FORBIDDEN' }, 403);
  if (match[2] === 'stream') return room.stream(role);
  if (match[2] === 'close') return room.close(role);
  if (match[2] === 'queue' && request.method === 'GET') return room.snapshot(role);
  if (match[2] === 'queue' && request.method === 'POST') return room.command(role, await request.json(), auth);
  return room.snapshot(role);
} };

export class Room extends DurableObject<Env> {
  state: any;
  constructor(ctx: any, env: Env) { super(ctx, env); ctx.blockConcurrencyWhile(async () => { this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (key TEXT PRIMARY KEY, value TEXT NOT NULL)'); this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS queue (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, singer TEXT NOT NULL, requester TEXT NOT NULL, status TEXT NOT NULL, position INTEGER NOT NULL, attempt_id TEXT, created_at TEXT NOT NULL)'); this.state = await this.ctx.storage.get('state') ?? null; }); }
  async create(input: any) { this.state = { ...input, queueRevision: 0, joiningOpen: true, closed: false, version: 1 }; await this.ctx.storage.put('state', this.state); }
  async role(secretHash: string) { const state = await this.ctx.storage.get<any>('state'); if (!state || state.closed) return null; if (secretHash === state.credentials.owner) return 'owner'; if (secretHash === state.credentials.host) return 'host'; if (secretHash === state.credentials.guest) return 'guest'; const guest = await this.ctx.storage.get<string>(`guest:${secretHash}`); return guest ? 'guest' : null; }
  async join(input: any) { const name = String(input?.displayName ?? '').trim(); if (name.length < 1 || name.length > 60) return json({ error: 'INVALID_NAME' }, 400); const guest = token(); await this.ctx.storage.put(`guest:${await hash(guest)}`, name); return json({ guestToken: guest, displayName: name }); }
  async snapshot(role: Role) { const state = await this.ctx.storage.get<any>('state'); const rows = this.ctx.storage.sql.exec('SELECT id, video_id as videoId, singer, requester, status, position, attempt_id as attemptId, created_at as createdAt FROM queue ORDER BY position').toArray(); return json({ roomId: state.roomId, queue: { revision: state.queueRevision, joiningOpen: state.joiningOpen, items: role === 'guest' ? rows.map((x: any) => ({ ...x, requester: x.requester })) : rows }, version: state.version }); }
  async command(role: Role, command: any, auth = '') {
    if (role === 'guest' && command?.action !== 'submit') return json({ error: 'FORBIDDEN' }, 403);
    const state = await this.ctx.storage.get<any>('state');
    if (command?.action === 'submit') { const name = await this.ctx.storage.get<string>(`guest:${await hash(auth)}`); if (!name) return json({ error: 'FORBIDDEN' }, 403); if (!/^[A-Za-z0-9_-]{11}$/.test(command.videoId) || typeof command.singer !== 'string' || command.singer.trim().length > 60) return json({ error: 'INVALID_SUBMISSION' }, 400); const position = this.ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) as count FROM queue').one().count; this.ctx.storage.sql.exec('INSERT INTO queue (id, video_id, singer, requester, status, position, attempt_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id(), command.videoId, command.singer.trim(), name, 'pending', position, null, new Date().toISOString()); state.queueRevision++; state.version++; await this.ctx.storage.put('state', state); return this.snapshot(role); }
    if (role !== 'owner' && role !== 'host') return json({ error: 'FORBIDDEN' }, 403);
    if (command?.action === 'set-joining') state.joiningOpen = Boolean(command.open);
    else if (command?.action === 'approve' || command?.action === 'reject' || command?.action === 'remove') this.ctx.storage.sql.exec('UPDATE queue SET status = ? WHERE id = ?', command.action === 'approve' ? 'queued' : command.action === 'reject' ? 'rejected' : 'cancelled', command.itemId);
    else if (command?.action === 'reorder') { if (command.expectedQueueRevision !== state.queueRevision) return json({ error: 'VERSION_CONFLICT' }, 409); command.itemIds.forEach((itemId: string, position: number) => this.ctx.storage.sql.exec('UPDATE queue SET position = ? WHERE id = ?', position, itemId)); }
    else if (command?.action === 'remove') this.ctx.storage.sql.exec('UPDATE queue SET status = ? WHERE id = ?', 'cancelled', command.itemId);
    else return json({ error: 'UNSUPPORTED_ACTION' }, 400);
    state.queueRevision++; state.version++; await this.ctx.storage.put('state', state); return this.snapshot(role);
  }
  async stream(role: Role) { const pair = new WebSocketPair(); this.ctx.acceptWebSocket(pair[1]); pair[1].serializeAttachment({ role }); pair[1].send(JSON.stringify(await (await this.snapshot(role)).json())); return new Response(null, { status: 101, webSocket: pair[0] }); }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) { if (typeof message !== 'string') return; const input = JSON.parse(message); if (input?.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; } if (input?.type === 'snapshot') { const attachment = ws.deserializeAttachment() as { role: Role }; ws.send(JSON.stringify(await (await this.snapshot(attachment.role)).json())); } }
  async close(role: Role) { if (role !== 'owner') return json({ error: 'FORBIDDEN' }, 403); const state = await this.ctx.storage.get<any>('state'); state.closed = true; await this.ctx.storage.put('state', state); return json({ closed: true }); }
}
