import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { GateCommand, HostMessage, Id, Name, QueueAction, QueueItem, QueueSubmission, type QueueSnapshot, newId } from '@karaoke/contracts';
import { GateError, GateSession } from '@karaoke/contracts/gate';
import { publicQueue } from '@karaoke/contracts/room';

type Role = 'extension' | 'controller' | 'viewer' | 'guest';
type Session = { model: GateSession; hashes: Record<'extension' | 'controller' | 'viewer', Buffer>; recoveryHash: Buffer; controllerUrl: string; viewerUrl: string; joinUrl: string; roomCode: string; guests: Map<string, string>; sockets: Set<WebSocket>; extension?: WebSocket; lastHeartbeat: number; expires: number; tickets: Map<string, { role: Role; expires: number }>; queue: QueueItem[]; queueRevision: number; joiningOpen: boolean; activeQueueItem: string | null };
const digest = (value: string) => createHash('sha256').update(value).digest();
const secret = () => randomBytes(32).toString('base64url');
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const RoomCode = /^[A-HJKMNP-Z]{4}$/;
const GUEST_ACTIONS = new Set(['reorder', 'start-next', 'pause', 'resume', 'skip']);
const roomCode = () => Array.from(randomBytes(4), byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');

type StoredSession = { id: string; roomCode: string; hashes: Record<'extension' | 'controller' | 'viewer', string>; recoveryHash: string; controllerUrl: string; viewerUrl: string; joinUrl: string; guests: Array<[string, string]>; expires: number; queue: QueueItem[]; queueRevision: number; joiningOpen: boolean; activeQueueItem: string | null; revision: number };
export function createRelay(publicOrigin: string, log: (message: string) => void = () => undefined, options: { storePath?: string } = {}) {
  const sessions = new Map<string, Session>();
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const snapshotStore = (): StoredSession[] => [...sessions].map(([id, s]) => ({ id, roomCode: s.roomCode, hashes: { extension: s.hashes.extension.toString('hex'), controller: s.hashes.controller.toString('hex'), viewer: s.hashes.viewer.toString('hex') }, recoveryHash: s.recoveryHash.toString('hex'), controllerUrl: s.controllerUrl, viewerUrl: s.viewerUrl, joinUrl: s.joinUrl, guests: [...s.guests], expires: s.expires, queue: s.queue, queueRevision: s.queueRevision, joiningOpen: s.joiningOpen, activeQueueItem: s.activeQueueItem, revision: s.model.state.revision }));
  const writeStore = () => { clearTimeout(saveTimer); saveTimer = undefined; if (!options.storePath) return; try { writeFileSync(options.storePath, JSON.stringify(snapshotStore())); } catch (error) { log(`Could not save sessions: ${String(error)}`); } };
  const persist = () => { if (!options.storePath || saveTimer) return; saveTimer = setTimeout(writeStore, 300); saveTimer.unref?.(); };
  if (options.storePath && existsSync(options.storePath)) {
    try {
      const stored = JSON.parse(readFileSync(options.storePath, 'utf8')) as StoredSession[];
      for (const entry of stored) {
        if (entry.expires < Date.now()) continue;
        const model = new GateSession(entry.id); model.state.revision = entry.revision;
        sessions.set(entry.id, { model, hashes: { extension: Buffer.from(entry.hashes.extension, 'hex'), controller: Buffer.from(entry.hashes.controller, 'hex'), viewer: Buffer.from(entry.hashes.viewer, 'hex') }, recoveryHash: Buffer.from(entry.recoveryHash, 'hex'), controllerUrl: entry.controllerUrl, viewerUrl: entry.viewerUrl, joinUrl: entry.joinUrl, roomCode: entry.roomCode, guests: new Map(entry.guests), sockets: new Set(), lastHeartbeat: 0, expires: entry.expires, tickets: new Map(), queue: entry.queue, queueRevision: entry.queueRevision, joiningOpen: entry.joiningOpen, activeQueueItem: entry.activeQueueItem });
      }
      if (sessions.size) log(`Restored ${sessions.size} room(s): ${[...sessions.values()].map(s => s.roomCode).join(', ')}. Hosts and phones reconnect automatically.`);
    } catch (error) { log(`Could not restore sessions: ${String(error)}`); }
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16_384 });
  const findByCode = (code: string) => { for (const [id, s] of sessions) if (s.roomCode === code && s.expires >= Date.now()) return { id, s }; return undefined; };
  const allocateCode = () => { for (let attempt = 0; attempt < 50; attempt++) { const code = roomCode(); if (![...sessions.values()].some(s => s.roomCode === code)) return code; } throw new GateError('CAPACITY', 429, 'No room code is available.'); };
  const queueSnapshot = (s: Session): QueueSnapshot => publicQueue(s.queue, s.queueRevision, s.joiningOpen);
  const syncQueue = (s: Session) => {
    const attempt = s.model.state.current?.attemptId ?? s.model.state.desired?.attemptId;
    if (attempt) { const item = s.queue.find(entry => entry.attemptId === attempt); if (item) { if (s.model.state.status === 'playing') item.status = 'playing'; s.activeQueueItem = item.id; } }
    if (s.activeQueueItem && s.model.state.status === 'between_songs') { const item = s.queue.find(entry => entry.id === s.activeQueueItem); if (item?.status === 'playing') item.status = 'completed'; s.activeQueueItem = null; s.queueRevision++; }
  };
  const roomSnapshot = (s: Session) => { syncQueue(s); return { queue: queueSnapshot(s), playback: s.model.state, roomCode: s.roomCode }; };
  const broadcasts = (s: Session) => { syncQueue(s); persist(); const body = JSON.stringify({ type: 'state', state: { ...s.model.state, queue: queueSnapshot(s) } }); for (const socket of s.sockets) if (socket.readyState === WebSocket.OPEN) { if (socket.bufferedAmount > 256_000) socket.close(1008, 'Slow connection'); else socket.send(body); } };
  const originAllowed = (origin?: string) => origin === publicOrigin || (!!origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin));
  function roleFor(s: Session, req: IncomingMessage): Role {
    const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]; if (!token) throw new GateError('UNAUTHORIZED', 401, 'A session credential is required.'); const hash = digest(token);
    for (const role of ['extension', 'controller', 'viewer'] as const) if (timingSafeEqual(hash, s.hashes[role])) return role;
    for (const guestHash of s.guests.keys()) if (timingSafeEqual(hash, Buffer.from(guestHash, 'hex'))) return 'guest';
    throw new GateError('UNAUTHORIZED', 401, 'Invalid session credential.');
  }
  async function body(req: IncomingMessage) { let text = ''; for await (const chunk of req) { text += String(chunk); if (Buffer.byteLength(text) > 16_384) throw new GateError('TOO_LARGE', 413, 'Request too large.'); } try { return JSON.parse(text); } catch { throw new GateError('BAD_JSON', 400, 'Expected JSON.'); } }
  function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', publicOrigin); if (!url.pathname.startsWith('/api/gate/')) return false;
    try {
      if (req.headers.origin && !originAllowed(req.headers.origin)) throw new GateError('ORIGIN_DENIED', 403, 'Unexpected origin.');
      if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin'); }
      if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.writeHead(204); res.end(); return true; }
      const room = /^\/api\/gate\/rooms\/([^/]+)$/.exec(url.pathname);
      if (room && req.method === 'GET') {
        const code = decodeURIComponent(room[1]!).toUpperCase(); const found = RoomCode.test(code) ? findByCode(code) : undefined;
        if (!found) throw new GateError('ROOM_NOT_FOUND', 404, 'No open room has that code.');
        json(res, 200, { sessionId: found.id, joinUrl: found.s.joinUrl }); return true;
      }
      if (url.pathname === '/api/gate/sessions' && req.method === 'POST') {
        if (sessions.size >= 20) throw new GateError('CAPACITY', 429, 'Too many sessions.'); const id = randomUUID(); const code = allocateCode(); const tokens = { extension: secret(), controller: secret(), viewer: secret(), recovery: secret() };
        const controllerUrl = `${publicOrigin}/control/${id}#${tokens.controller}`; const viewerUrl = `${publicOrigin}/join/${id}#${tokens.viewer}`; const joinUrl = `${publicOrigin}/join/${id}`;
        sessions.set(id, { model: new GateSession(id), hashes: { extension: digest(tokens.extension), controller: digest(tokens.controller), viewer: digest(tokens.viewer) }, recoveryHash: digest(tokens.recovery), controllerUrl, viewerUrl, joinUrl, roomCode: code, guests: new Map(), sockets: new Set(), lastHeartbeat: 0, expires: Date.now() + 8 * 60 * 60_000, tickets: new Map(), queue: [], queueRevision: 0, joiningOpen: true, activeQueueItem: null });
        log(`Room ${code} opened for session ${id}. Guests join at ${joinUrl} or with the code.`); json(res, 201, { sessionId: id, roomCode: code, extensionToken: tokens.extension, recoveryCode: tokens.recovery, controllerUrl, viewerUrl, joinUrl }); return true;
      }
      const match = /^\/api\/gate\/sessions\/([^/]+)(?:\/(commands|ticket|report|close|join|queue|recover))?$/.exec(url.pathname); if (!match || !Id.safeParse(match[1]).success) throw new GateError('NOT_FOUND', 404, 'Unknown endpoint.');
      const s = sessions.get(match[1]!); if (!s || s.expires < Date.now()) throw new GateError('EXPIRED', 410, 'This session expired.');
      if (match[2] === 'recover' && req.method === 'POST') { const supplied = String((await body(req)).recoveryCode ?? ''); if (!supplied || !timingSafeEqual(digest(supplied), s.recoveryHash)) throw new GateError('RECOVERY_FAILED', 403, 'The recovery code is invalid.'); const extensionToken = secret(); s.hashes.extension = digest(extensionToken); for (const ws of s.sockets) ws.close(4001, 'Playback binding replaced'); s.tickets.clear(); json(res, 200, { extensionToken, sessionId: match[1], roomCode: s.roomCode, controllerUrl: s.controllerUrl, viewerUrl: s.viewerUrl, joinUrl: s.joinUrl, expiresAt: s.expires }); return true; }
      const role = match[2] === 'join' && req.method === 'POST' ? 'viewer' : roleFor(s, req);
      if (match[2] === 'join' && req.method === 'POST') {
        if (!s.joiningOpen) throw new GateError('JOINING_CLOSED', 409, 'Joining is closed.'); if (s.guests.size >= 30) throw new GateError('PARTICIPANT_LIMIT', 429, 'This room has reached its 30 participant limit.'); const parsed = Name.safeParse((await body(req)).displayName); if (!parsed.success) throw new GateError('INVALID_NAME', 400, 'Choose a display name from 1 to 60 characters.'); const token = secret(); s.guests.set(digest(token).toString('hex'), parsed.data); json(res, 201, { guestToken: token, guestUrl: `${publicOrigin}/join/${match[1]}#${token}`, displayName: parsed.data });
      } else if (match[2] === 'queue' && req.method === 'GET') json(res, 200, roomSnapshot(s));
      else if (match[2] === 'queue' && req.method === 'POST') {
        const raw = await body(req); const isAction = !!raw && typeof raw === 'object' && 'action' in raw;
        if (role === 'guest' && !isAction) {
          if (!s.joiningOpen) throw new GateError('JOINING_CLOSED', 409, 'Joining is closed.'); const parsed = QueueSubmission.safeParse(raw); if (!parsed.success) throw new GateError('INVALID_SUBMISSION', 400, 'Submit a valid YouTube video and singer name.'); if (s.queue.filter(item => ['pending', 'queued', 'playing'].includes(item.status)).length >= 200) throw new GateError('QUEUE_LIMIT', 429, 'The room request limit has been reached.'); const requester = s.guests.get(digest(req.headers.authorization!.slice(7)).toString('hex')) ?? 'Guest'; const item: QueueItem = { id: newId(), videoId: parsed.data.videoId, singer: parsed.data.singer, requester, status: 'queued', position: s.queue.length, attemptId: null, createdAt: new Date().toISOString() }; s.queue.push(item); s.queueRevision++; broadcasts(s); json(res, 201, { item, ...roomSnapshot(s) });
        } else {
          const parsed = QueueAction.safeParse(raw); if (!parsed.success) throw new GateError('INVALID_ACTION', 400, 'Invalid queue action.'); const action = parsed.data;
          if (role !== 'controller' && !(role === 'guest' && GUEST_ACTIONS.has(action.action))) throw new GateError('FORBIDDEN', 403, 'Only the host can moderate this queue.');
          if (action.action === 'approve' || action.action === 'reject' || action.action === 'remove') { const item = s.queue.find(entry => entry.id === action.itemId); if (!item) throw new GateError('NOT_FOUND', 404, 'Queue item not found.'); item.status = action.action === 'approve' ? 'queued' : action.action === 'reject' ? 'rejected' : 'cancelled'; s.queueRevision++; }
          else if (action.action === 'cancel') { const item = s.queue.find(entry => entry.id === action.itemId && entry.status === 'pending'); if (!item) throw new GateError('NOT_FOUND', 404, 'Waiting request not found.'); item.status = 'cancelled'; s.queueRevision++; }
          else if (action.action === 'reorder') { if (action.expectedQueueRevision !== s.queueRevision) throw new GateError('VERSION_CONFLICT', 409, 'Queue changed. Refresh and retry.'); const waiting = s.queue.filter(item => item.status === 'queued'); const ids = new Set(waiting.map(item => item.id)); if (action.itemIds.length !== waiting.length || action.itemIds.some(id => !ids.has(id)) || new Set(action.itemIds).size !== waiting.length) throw new GateError('INVALID_ORDER', 400, 'Reorder must include every waiting item once.'); action.itemIds.forEach((id, position) => { s.queue.find(item => item.id === id)!.position = position; }); s.queue.sort((a, b) => a.position - b.position); s.queueRevision++; }
          else if (action.action === 'set-joining') { s.joiningOpen = action.open; s.queueRevision++; }
          else if (action.action === 'start-next') { syncQueue(s); const next = s.queue.find(item => item.status === 'queued'); if (!next) throw new GateError('EMPTY_QUEUE', 409, 'No approved singer is waiting.'); const interrupted = s.queue.filter(item => item.status === 'playing'); const command = GateCommand.parse({ v: 1, commandId: newId(), expectedRevision: s.model.state.revision, type: 'load', performance: { attemptId: newId(), videoId: next.videoId, singer: next.singer, requester: next.requester } }); if (command.type !== 'load') throw new GateError('INTERNAL', 500, 'Invalid generated playback command.'); s.model.dispatch(command); for (const item of interrupted) item.status = 'skipped'; next.status = 'playing'; next.attemptId = command.performance.attemptId; s.activeQueueItem = next.id; s.queueRevision++; s.extension?.send(JSON.stringify({ type: 'command', command })); }
          else { syncQueue(s); if (!s.activeQueueItem) throw new GateError('NO_PERFORMANCE', 409, 'There is no current performance.'); const command = GateCommand.parse({ v: 1, commandId: newId(), expectedRevision: s.model.state.revision, type: action.action }); s.model.dispatch(command); s.extension?.send(JSON.stringify({ type: 'command', command })); }
          syncQueue(s); broadcasts(s); json(res, 202, roomSnapshot(s));
        }
      } else if (!match[2] && req.method === 'GET') json(res, 200, s.model.state);
      else if (match[2] === 'ticket' && req.method === 'POST') { for (const [key, ticket] of s.tickets) if (ticket.expires < Date.now()) s.tickets.delete(key); const token = secret(); s.tickets.set(digest(token).toString('hex'), { role, expires: Date.now() + 30_000 }); json(res, 200, { ticket: token }); }
      else if (match[2] === 'commands' && req.method === 'POST') { if (role !== 'controller') throw new GateError('FORBIDDEN', 403, 'Use queue actions for host commands.'); const parsed = GateCommand.safeParse(await body(req)); if (!parsed.success) throw new GateError('INVALID_COMMAND', 400, 'Invalid command.'); const dispatched = s.model.dispatch(parsed.data); if (dispatched) s.extension?.send(JSON.stringify({ type: 'command', command: parsed.data })); broadcasts(s); json(res, 202, { accepted: true, duplicate: !dispatched, commandId: parsed.data.commandId, state: s.model.state }); }
      else if (match[2] === 'report' && req.method === 'GET' && role !== 'viewer') json(res, 200, { generatedAt: new Date().toISOString(), gate: 'A', acceptance: 'NOT_AUTOMATICALLY_CERTIFIED', state: { status: s.model.state.status, transitions: s.model.state.transitions, consecutiveTransitions: s.model.state.consecutiveTransitions, observation: s.model.state.observation }, queue: queueSnapshot(s), history: s.model.history });
      else if (match[2] === 'close' && req.method === 'POST' && role === 'extension') { for (const ws of s.sockets) ws.close(1000, 'Session closed'); sessions.delete(match[1]!); log(`Room ${s.roomCode} closed.`); json(res, 200, { closed: true }); }
      else throw new GateError('FORBIDDEN', 403, 'This operation is unavailable to this credential.');
    } catch (error) { if (req.method === 'POST') persist(); const e = error instanceof GateError ? error : new GateError('INTERNAL', 500, 'The relay could not process the request.'); const id = url.pathname.split('/')[4]; const s = id ? sessions.get(id) : undefined; let state; if (s) try { roleFor(s, req); state = s.model.state; } catch { /* no disclosure */ } json(res, e.status, { code: e.code, message: e.message, ...(state ? { state } : {}) }); }
    if (req.method === 'POST') persist();
    return true;
  }
  const interval = setInterval(() => { for (const [id, s] of sessions) { if (s.expires < Date.now()) { for (const ws of s.sockets) ws.close(1000, 'Session expired'); sessions.delete(id); persist(); continue; } if (s.extension && Date.now() - s.lastHeartbeat > 60_000) s.extension.close(1001, 'Heartbeat expired'); const rev = s.model.state.revision; s.model.expirePending(); syncQueue(s); if (rev !== s.model.state.revision) broadcasts(s); } }, 1000); interval.unref();
  function upgrade(req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) { const url = new URL(req.url ?? '/', publicOrigin); const match = /^\/api\/gate\/sessions\/([^/]+)\/stream$/.exec(url.pathname); const s = match ? sessions.get(match[1]!) : undefined; if (!s || s.expires < Date.now() || !originAllowed(req.headers.origin)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; } wss.handleUpgrade(req, socket, head, ws => { let role: Role | undefined; const authTimeout = setTimeout(() => ws.close(1008, 'Authenticate first'), 5000); let windowAt = Date.now(); let frames = 0; ws.on('message', raw => { try { if (Date.now() - windowAt > 1000) { frames = 0; windowAt = Date.now(); } if (++frames > 20) { ws.close(1008, 'Rate limit'); return; } const message = JSON.parse(raw.toString()); if (!role) { if (message.type !== 'authenticate' || typeof message.ticket !== 'string') throw new Error('Authentication required'); const key = digest(message.ticket).toString('hex'); const ticket = s.tickets.get(key); s.tickets.delete(key); if (!ticket || ticket.expires < Date.now()) throw new Error('Expired ticket'); if (s.sockets.size >= 32 || ticket.role === 'extension' && s.extension) throw new Error('Connection limit'); role = ticket.role; clearTimeout(authTimeout); s.sockets.add(ws); if (role === 'extension') { s.extension = ws; s.lastHeartbeat = Date.now(); s.model.connect(); } broadcasts(s); return; } if (role !== 'extension' || s.extension !== ws) throw new Error('Observation authority required'); const parsed = HostMessage.parse(message); s.lastHeartbeat = Date.now(); if (parsed.type === 'heartbeat') ws.send(JSON.stringify({ type: 'heartbeat' })); else if (parsed.type === 'observation') { s.model.observe(parsed.observation); syncQueue(s); broadcasts(s); } else if (parsed.type === 'result') { s.model.result(parsed.commandId, parsed.accepted, parsed.error); syncQueue(s); broadcasts(s); } else ws.close(1000, 'Detached'); } catch { ws.close(1008, 'Invalid or unauthorized message'); } }); ws.on('error', () => ws.close()); ws.on('close', () => { clearTimeout(authTimeout); s.sockets.delete(ws); if (s.extension === ws) { s.extension = undefined; s.model.disconnect(); broadcasts(s); } }); }); }
  return { handle, upgrade, close: () => { clearInterval(interval); writeStore(); for (const client of wss.clients) client.terminate(); wss.close(); }, sessions };
}
