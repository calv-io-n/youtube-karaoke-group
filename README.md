# YouTube Group Karaoke

Host Chrome extension + phone controller + application-owned karaoke queue.

**Status:** Gate A prototype implemented. Automated real-YouTube transition and playback scenarios pass on Linux; physical-phone acceptance is pending. The full MVP remains gated by the [acceptance checklist](docs/wiki/gate-a-checklist.md).

```sh
npm install
npm run dev:info
npm run build
npm run dev:gate
```

Load `apps/extension/.output/chrome-mv3` as an unpacked Chrome extension, open a YouTube watch page, and start the test from its popup. Both QR codes use the host's detected LAN IP; phones must share its network. Cloudflare Tunnel is deferred.

See the [documentation map](docs/README.md), [desired-state specification](docs/design/mvp.md), [implemented architecture](docs/architecure/README.md), and [development guide](docs/wiki/development.md).
