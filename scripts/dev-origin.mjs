import { networkInterfaces } from 'node:os';

export function selectLanAddress(interfaces) {
  const privateIp = address => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
  const candidates = Object.entries(interfaces).flatMap(([name, values]) => {
    if (/^(lo|docker|br-|veth|virbr|tun|tap|wg|tailscale|utun|vmnet|vbox)/i.test(name)) return [];
    return (values ?? []).filter(value => value.family === 'IPv4' && !value.internal && privateIp(value.address)).map(value => ({ name, address: value.address }));
  });
  candidates.sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
  if (!candidates.length) throw new Error('No private LAN IPv4 address found. Connect to Wi-Fi/Ethernet or set GATE_PUBLIC_ORIGIN to the host LAN URL. Localhost is not used for QR invitations.');
  return candidates[0].address;
}

export function resolveDevOrigin(env = process.env, interfaces) {
  if (env.GATE_PUBLIC_ORIGIN && env.KARAOKE_SERVICE_ORIGIN && env.GATE_PUBLIC_ORIGIN !== env.KARAOKE_SERVICE_ORIGIN) throw new Error('GATE_PUBLIC_ORIGIN and KARAOKE_SERVICE_ORIGIN must match.');
  const override = env.GATE_PUBLIC_ORIGIN || env.KARAOKE_SERVICE_ORIGIN;
  if (override) {
    const url = new URL(override);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Set the service origin to an HTTP(S) origin without a path, query, or credentials.');
    return url.origin;
  }
  let available = interfaces;
  if (!available) {
    try { available = networkInterfaces(); }
    catch { throw new Error('Cannot inspect LAN interfaces in this environment. Set GATE_PUBLIC_ORIGIN=http://<host-LAN-IP>:8787 for both build and relay.'); }
  }
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  return `http://${selectLanAddress(available)}:${port}`;
}
