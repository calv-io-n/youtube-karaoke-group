# Development and Gate A

This guide runs the LAN MVP prototype. Sessions and queues are temporary in this development relay; the Durable Object deployment target is separate and not deployed here.

Prerequisites: Node 22 or newer, npm, desktop Chrome, and network access to YouTube. This repository uses npm workspaces and a shared lockfile.

## Start a LAN demo

1. Connect the host computer and phones to the same network.
2. Run `npm install`, then `npm run dev:info`. The latter prints the detected LAN origin (for example, `http://192.168.1.84:8787`). Container, loopback, and common VPN adapters are excluded.
3. Run `npm run build` on that computer. The extension embeds the same origin in its service connection and host permissions.
4. Run `npm run dev:gate` and leave it running. It listens on all interfaces; the printed LAN URL is the address phones should use. Opening localhost redirects to the LAN URL.
5. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `apps/extension/.output/chrome-mv3` inside this repository.
6. Open a regular YouTube watch page in Chrome. Turn off YouTube autoplay and avoid native playlists for this test.
7. Open the extension popup and choose **Start playback test**. Scan the popup's **private controller QR** on the host phone. This link controls playback; keep it off the shared screen.
8. Enter YouTube fullscreen on the computer. The overlay's QR is a separate **guest join link**. Its caption displays the LAN host and port.
9. Guests scan the overlay QR, choose a display name, paste a YouTube link, and name a singer. The host controller sees the request, approves it, and chooses **Start next singer**. The singer appears on the screen only after matching playback is confirmed.
10. The controller can close joining, reject/remove requests, pause/resume, stop to intermission, and inspect the current queue. Close the session from the extension popup when finished. Stopping the relay discards all sessions.

The private controller link is an expiring prototype credential. The extension popup also shows a recovery code once per session; use it after an extension/browser restart to rotate the extension token and rebind the active YouTube tab. The LAN relay still has in-memory room state, so a relay restart requires a fresh session.

## Select a different network or port

When multiple physical adapters exist, selection is deterministic by interface name. Override it explicitly to choose the phone-facing network:

```sh
export GATE_PUBLIC_ORIGIN=http://192.168.1.84:8787
npm run build
npm run dev:gate
```

Replace the example address with this host's LAN address. Use the same environment for build and relay. If using a different port, also set `PORT`. `KARAOKE_SERVICE_ORIGIN` is an alternative origin variable; setting both to different values is rejected.

When DHCP changes the LAN IP, rebuild/reload the extension and create a new session. If interface inspection is restricted, set the origin explicitly; the tool deliberately does not fall back to localhost for QR codes.

## Verify changes

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

The browser fixture starts the relay if necessary. Install its browser once with `npx playwright install chromium`, or set `GATE_CHROMIUM` to an existing Chromium executable. Headless fixture tests are not proof of YouTube compatibility.

Run `npm run gate:live` for the real-site diagnostic script. It opens an isolated visible Chromium profile with the built extension, uses the controller page to send requests, and writes ignored local JSON/screenshot artifacts in `artifacts`. It does not use the host's existing Google profile. `GATE_VIDEOS` optionally supplies comma-separated test video IDs. A normal host-profile and physical-phone check remains necessary for the pilot.

See the [Gate A checklist](gate-a-checklist.md) for what a complete gate result must include.

## Troubleshooting

- **Phone cannot open the LAN URL:** verify Wi-Fi, host firewall access to TCP 8787, and that guest/client isolation is disabled. A phone using mobile data cannot reach this private address.
- **QR contains an old address:** rebuild and reload the extension, restart the relay with the same origin, then create a new test session.
- **No private LAN address found:** connect Wi-Fi/Ethernet or provide the explicit origin for the correct interface.
- **Transport disabled:** wait for the extension's fresh player observation. On a changed/reloaded YouTube document, reattach from the popup. Do not repeatedly click start after an uncertain response; use **Check original command**.
- **YouTube requests sign-in or refuses playback:** establish normal playback locally first. The extension does not supply account access or bypass restrictions.
- **Fullscreen lost:** restore it on the host computer. Phone commands cannot provide the browser's required local activation.
- **Relay restart:** create a fresh prototype session because the development relay is in-memory. **Extension/browser reload:** use the room ID and one-time recovery code from the popup, then rebind the active YouTube watch tab.

The phone app includes a web manifest and shell cache. Service-worker registration intentionally requires HTTPS; the trusted-LAN HTTP demo remains network-only. Authenticated API responses, room credentials, and YouTube media are never cached. Cloudflare Tunnel is deferred, as recorded in [ADR 0002](../adr/0002-lan-development-invitations.md).

## Durable Object deployment target

`apps/room-worker` contains the production-shaped Worker and one Durable Object per room. It uses SQL-backed queue rows, room-scoped credentials, WebSocket room streams, and the room command contract. Install Wrangler separately (`npm install -g wrangler` or use your organization’s pinned toolchain), configure Cloudflare credentials, build the PWA assets, then run `npm run deploy -w @karaoke/room-worker`. This has not been deployed from this repository yet; the LAN relay remains the verified development path.

Do not infer successful real playback from a passing build or fixture test.
