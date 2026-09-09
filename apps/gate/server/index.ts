import { createServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { createRelay } from './relay';
import { resolveDevOrigin } from '../../../scripts/dev-origin.mjs';

const port = Number(process.env.PORT ?? 8787);
const publicOrigin = resolveDevOrigin();
const relay = createRelay(publicOrigin);
const vite = await createViteServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true, hmr: false, host: '0.0.0.0' }, appType: 'spa' });
const server = createServer(async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  if (req.headers.host !== new URL(publicOrigin).host && ['localhost', '127.0.0.1', '[::1]'].some(host => req.headers.host === `${host}:${port}`)) {
    res.writeHead(307, { Location: new URL(req.url ?? '/', publicOrigin).href }); res.end(); return;
  }
  if (req.headers.host !== new URL(publicOrigin).host) { res.writeHead(403); res.end('Unexpected host. Use the LAN URL printed by the development server.'); return; }
  if (!await relay.handle(req, res)) vite.middlewares(req, res);
});
server.on('upgrade', relay.upgrade);
server.listen(port, process.env.GATE_BIND ?? '0.0.0.0', () => console.log(`Gate A relay and controller: ${publicOrigin}\nController and guest QR codes use this LAN origin. Development sessions expire after eight hours.`));
async function stop() { relay.close(); server.close(); await vite.close(); }
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
