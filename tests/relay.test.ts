import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createRelay } from '../apps/gate/server/relay';
import { ADAPTER_VERSION, newId } from '@karaoke/contracts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function setup() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const relay = createRelay(origin);
  server.on('request', (req, res) => void relay.handle(req, res));
  server.on('upgrade', relay.upgrade);
  cleanups.push(async () => { relay.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const created = await fetch(`${origin}/api/gate/sessions`, { method: 'POST' }).then(r => r.json());
  const base = `${origin}/api/gate/sessions/${created.sessionId}`;
  const token = (role: string) => role === 'extension' ? created.extensionToken : new URL(role === 'controller' ? created.controllerUrl : created.viewerUrl).hash.slice(1);
  const request = (path: string, role: string, method = 'GET', data?: unknown) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token(role)}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  async function connect(role: string) {
    const { ticket } = await request('/ticket', role, 'POST').then(r => r.json());
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/stream', { origin });
    await once(ws, 'open');
    const state = once(ws, 'message');
    ws.send(JSON.stringify({ type: 'authenticate', ticket }));
    await state;
    return ws;
  }
  return { origin, relay, created, base, request, connect };
}

describe('temporary relay boundaries', () => {
  it('isolates controller, extension, and public QR authority', async () => {
    const { request, base } = await setup();
    expect((await fetch(base)).status).toBe(401);
    expect((await request('', 'viewer')).status).toBe(200);
    expect((await request('/commands', 'viewer', 'POST', {})).status).toBe(403);
    expect((await request('/commands', 'extension', 'POST', {})).status).toBe(403);
    expect((await request('/report', 'viewer')).status).toBe(403);
    expect((await request('/close', 'controller', 'POST')).status).toBe(403);
  });
  it('routes a controller command only to the extension and never duplicates dispatch', async () => {
    const { request, connect } = await setup();
    const host = await connect('extension');
    host.send(JSON.stringify({ type: 'observation', observation: { adapterVersion: ADAPTER_VERSION, sequence: 0, attemptId: null, videoId: 'jNQXAC9IVRw', playerState: 'paused', currentTime: 0, duration: 20, loadEvidence: false, fullscreen: true, fullscreenPreserved: true, playerPreserved: true, overlayMounted: true, adShowing: false, capabilities: { load: true, pause: true, resume: true, identity: true }, error: null } }));
    await once(host, 'message');
    const state = await request('', 'controller').then(r => r.json());
    const command = { v: 1, commandId: newId(), expectedRevision: state.revision, type: 'load', performance: { attemptId: newId(), videoId: 'jNQXAC9IVRw', singer: 'Test', requester: 'Another' } };
    const routed: unknown[] = [];
    host.on('message', raw => { const msg = JSON.parse(raw.toString()); if (msg.type === 'command') routed.push(msg); });
    expect((await request('/commands', 'controller', 'POST', command)).status).toBe(202);
    expect((await request('/commands', 'controller', 'POST', command).then(r => r.json())).duplicate).toBe(true);
    expect(routed).toHaveLength(1);
    const report = await request('/report', 'controller').then(r => r.text());
    expect(report).not.toContain('Another'); expect(report).not.toContain('controllerUrl');
  });
  it('rejects forged observations from a viewer socket', async () => {
    const { connect } = await setup(); const viewer = await connect('viewer');
    const close = once(viewer, 'close'); viewer.send(JSON.stringify({ type: 'heartbeat' }));
    expect((await close)[0]).toBe(1008);
  });
  it('enforces expiry and closes a session without leaving read access', async () => {
    const { request, relay, created } = await setup();
    relay.sessions.get(created.sessionId)!.expires = Date.now() - 1;
    expect((await request('', 'controller')).status).toBe(410);
  });
  it('blocks a cross-origin session creation request', async () => {
    const { origin } = await setup();
    const response = await fetch(`${origin}/api/gate/sessions`, { method: 'POST', headers: { Origin: 'https://evil.test' } });
    expect(response.status).toBe(403);
  });
  it('attributes guest requests to a joined participant and automatically queues songs for host-controlled start', async () => {
    const { request, created, base, connect } = await setup();
    const guestJoin = await fetch(base + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: 'Jamie' }) }).then(r => r.json());
    const guestRequest = (path: string, method = 'GET', data?: unknown) => fetch(base + path, { method, headers: { Authorization: `Bearer ${guestJoin.guestToken}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const submitted = await guestRequest('/queue', 'POST', { videoId: 'jNQXAC9IVRw', singer: 'Riley' }).then(r => r.json());
    expect(submitted.item.requester).toBe('Jamie'); expect(submitted.item.status).toBe('queued');
    const host = await connect('extension');
    host.send(JSON.stringify({ type: 'observation', observation: { adapterVersion: ADAPTER_VERSION, sequence: 0, attemptId: null, videoId: 'jNQXAC9IVRw', playerState: 'paused', currentTime: 0, duration: 20, loadEvidence: false, fullscreen: true, fullscreenPreserved: true, playerPreserved: true, overlayMounted: true, adShowing: false, capabilities: { load: true, pause: true, resume: true, identity: true }, error: null } }));
    await new Promise(resolve => setTimeout(resolve, 10));
    const controllerQueue = (path: string, data: unknown) => request(path, 'controller', 'POST', data);
    expect((await guestRequest('/queue', 'POST', { action: 'start-next' })).status).not.toBe(202);
    const started = await controllerQueue('/queue', { action: 'start-next' }).then(r => r.json());
    expect(started.queue.items.find((item: any) => item.id === submitted.item.id).status).toBe('playing');
  });
  it('caps room guests at 30', async () => {
    const { base } = await setup();
    const joins = await Promise.all(Array.from({ length: 31 }, (_, index) => fetch(base + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: `Guest ${index}` }) })));
    expect(joins.filter(response => response.status === 201)).toHaveLength(30);
    expect(joins.filter(response => response.status === 429)).toHaveLength(1);
  });
  it('rotates extension access with the one-time recovery code', async () => {
    const { created, base, request } = await setup();
    const recovered = await fetch(base + '/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recoveryCode: created.recoveryCode }) }).then(r => r.json());
    expect(recovered.extensionToken).toBeTruthy(); expect(recovered.controllerUrl).toBe(created.controllerUrl);
    expect((await fetch(base, { headers: { Authorization: `Bearer ${created.extensionToken}` } })).status).toBe(401);
    expect((await fetch(base, { headers: { Authorization: `Bearer ${recovered.extensionToken}` } })).status).toBe(200);
    expect((await fetch(base + '/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recoveryCode: 'wrong' }) })).status).toBe(403);
  });
});
