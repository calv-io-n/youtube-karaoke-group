import { describe, expect, it } from 'vitest';
import { resolveDevOrigin } from '../scripts/dev-origin.mjs';
import type { NetworkInterfaceInfo } from 'node:os';
const address = (ip: string, internal = false): NetworkInterfaceInfo => ({ address: ip, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${ip}/24` });
describe('LAN development origin', () => {
  it('uses a private LAN address instead of loopback, Docker, or VPN adapters', () => {
    expect(resolveDevOrigin({}, { lo: [address('127.0.0.1', true)], docker0: [address('172.17.0.1')], 'br-test': [address('172.18.0.1')], tailscale0: [address('100.90.0.1')], wlp0s20f3: [address('192.168.1.84')] })).toBe('http://192.168.1.84:8787');
  });
  it('shares explicit origins across relay and extension and supports a later HTTPS origin', () => {
    expect(resolveDevOrigin({ GATE_PUBLIC_ORIGIN: 'https://demo.example.com' }, {})).toBe('https://demo.example.com');
    expect(resolveDevOrigin({ KARAOKE_SERVICE_ORIGIN: 'http://192.168.2.3:9000' }, {})).toBe('http://192.168.2.3:9000');
    expect(() => resolveDevOrigin({ GATE_PUBLIC_ORIGIN: 'http://192.168.1.1', KARAOKE_SERVICE_ORIGIN: 'http://192.168.1.2' }, {})).toThrow('must match');
  });
  it('fails explicitly instead of producing a localhost QR when no LAN exists', () => {
    expect(() => resolveDevOrigin({}, { lo: [address('127.0.0.1', true)] })).toThrow('No private LAN');
  });
});
