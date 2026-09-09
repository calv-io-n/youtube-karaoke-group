# YouTube Group Karaoke — desired state

Version: 0.1. Status: accepted implementation target, subject to Gate A. This document describes the destination, not the current build.

## Product

One desktop Chrome tab runs regular YouTube using the host's own account. Only the host installs an extension. Guests open a phone web app from a guest-only QR, choose a public display name, submit a YouTube URL and singer, and follow the queue. A separately paired host phone manages the evening. An HDMI-connected television is supported.

The application owns the queue; YouTube owns playback. No Google login, cookies, or Premium credentials enter this application. A room credential grants no YouTube privileges.

Target 30 participants and 200 requests per room. Guest songs are automatically approved into the queue by default. Waiting-item changes must never interrupt playback. The next singer starts only on host action; skip returns to intermission.

Out of scope: accounts, search, voting, automatic singer rotation, multiple playback screens, casting/native TV apps, recording, microphone processing, scoring, pitch shifting, and synchronizing YouTube's own queue.

## Architecture

TypeScript throughout; Vue 3 + Vite PWA; WXT Chrome Manifest V3 extension; Cloudflare Worker API and Static Assets; one SQLite-backed Durable Object per room; authenticated WebSockets; shared versioned runtime schemas. Do not introduce PostgreSQL, Redis, Kubernetes, or a desktop companion.

The extension service worker owns credentials, server connection, tab/document binding, routing, and recovery. An isolated content script owns the overlay. A small packaged MAIN-world bridge provides capability probing, video loading, pause/resume, and observations. It cannot execute arbitrary code or proxy arbitrary network requests. Page messages are untrusted even if their origin/channel matches.

Permissions: storage, scripting, alarms, and host access limited to YouTube and the service origin. Bind to one explicit tab/document, never whichever tab happens to be active. Remove UI/listeners on detach or closure. Bundle all executable code; remote adapter patches are forbidden.

## Fullscreen and playback gate

Mount a display-only Shadow DOM overlay below `document.fullscreenElement`, following fullscreen changes. Never replace/move YouTube's video or fullscreen container. Unsupported containers produce an honest unsupported state. Default: singer/requester top-left, public QR top-right, next two approved singers below the singer. Hide requester when identical. Expose corner, margin, opacity, font size, QR size, and temporary hiding controls.

Full-page navigation is not an accepted transition mechanism. Fullscreen loss preserves room state, notifies the host phone, and requires a local fullscreen action.

Gate A precedes the complete backend/UI: enter fullscreen once, remotely switch real YouTube videos 20 consecutive times, preserve fullscreen and overlay, and correctly identify each new performance, including the same video twice consecutively. Test pause/resume, natural completion, unavailable content, native playback changes, and unknown states. Record OS, Chrome, extension/adapter versions, and evidence. A fixture or iframe cannot pass this gate.

Linux is the first required platform. Stop and report evidence if Gate A cannot pass; do not continue remaining milestones or substitute manual loading. Windows is required before claiming Windows compatibility.

## State and consistency

Entities: Room, Participant, QueueItem, QueueOrder, PlaybackAttempt, CommandReceipt, HostOutbox. A video ID is never a queue-item or attempt ID. Separate requester from singer; derive requester from the authenticated session.

Queue states: pending, queued, reserved, playing, completed, failed, skipped, rejected, cancelled. Playback states: idle, loading, playing, paused, between_songs, blocked, out_of_sync. Retry creates a new attempt for the same failed item. Remove cancels it; skip terminates it.

Reorder submits all and only approved waiting IDs plus expectedQueueRevision. Validate membership, uniqueness, and revision atomically; stale updates return 409 VERSION_CONFLICT with authorized current state. Reserved/current items are excluded. Reorder never invokes playback.

Start next atomically reserves an item, creates an attempt, and persists an outgoing operation. Only observations confirming expected video and content playback for that attempt may announce its singer. Same-video loads require restart evidence. Natural completion and confirmed skip enter intermission. Unexpected native playback enters out_of_sync; explicitly retry the intended performance or stop and return to intermission.

Commands have unique IDs and applicable queue/playback revisions. Persist receipts; identical retries return the original result, and altered payloads with the same ID conflict. Browser playback is not exactly-once: after ambiguous acknowledgement inspect before retrying. Never blindly reload or select another singer.

## Interfaces

HTTPS endpoints:

```text
POST /api/rooms
POST /api/rooms/:id/join
POST /api/rooms/:id/host-pairing
POST /api/rooms/:id/host-pairing/redeem
GET  /api/rooms/:id
POST /api/rooms/:id/commands
POST /api/rooms/:id/ws-ticket
GET  /api/rooms/:id/stream
POST /api/rooms/:id/binding-requests
POST /api/rooms/:id/binding-requests/:requestId/approve
POST /api/rooms/:id/binding-requests/:requestId/redeem
POST /api/rooms/:id/owner-recovery
POST /api/videos/resolve
```

Versioned schemas: RoomSnapshot, Command, CommandResult, PlaybackIntent, PlaybackObservation. Include monotonic room version, applicable revisions, command/attempt IDs, binding epoch, and ordered observation sequence. Reject incompatible protocols.

Event families: room.snapshot, command.result, host.command, playback.observed, host.status, room.closed. Broadcast role-filtered full snapshots after durable changes; progress uses lightweight observations. Ignore old versions; fetch a snapshot on reconnect. Pending requests are visible only to their requester and hosts.

Normalize supported YouTube URLs without arbitrary fetches. Optional server-side YouTube Data API videos.list resolves titles/durations. Keep unresolved submissions reviewable with video IDs; metadata is no playback guarantee. Discard tracking, playlist, and timestamp parameters.

## Access, recovery, and retention

Owner extension UI creates/administers rooms and pairs controllers. Host phones control queue, transport, moderation, overlay, and replacement playback-binding approval. Playback credentials only receive playback commands and report observations. Guests read approved queue, submit, and cancel their own waiting requests.

Room-scoped secrets have expiry/revocation and hashed server storage. PWA sessions use Secure HttpOnly cookies with origin/CSRF checks; extension APIs use scoped bearer credentials in chrome.storage.session. Guest QR never grants host permissions. Host pairing is single-use and shown only in extension UI. Render names/titles as text. Validate messages, frame sizes, rate limits, and every action's server-side permission.

Browser restart clears extension credentials. A paired host phone approves a short-lived replacement binding request that also requires the requesting extension's private redemption secret. Increment the binding epoch and reject old bindings. A separately saved high-entropy owner recovery code restores administration, rotates itself, and revokes privileged sessions/bindings. Without either recovery path, create a new room.

Joining can be closed, invitations rotated, participants revoked, requests moderated. Default expiry is eight hours, configurable to 24. Delete participant names, invitations, and history within 24 hours of closure/expiry; enforce closure immediately.

## Reliability and delivery

Extension heartbeat: 20 seconds; host unavailable after 60 seconds. Reconnect with bounded exponential backoff/jitter. Authenticate, obtain fresh state, inspect local playback, reconcile pending operations, then enable transport. Continue current local playback offline, never cached-queue advancement. Guard natural completion against native continuation. Navigation invalidates binding.

PWA caches shell only, not authenticated responses or media. Offline submissions remain visibly unsent and require explicit resubmission. An ambiguous submitted command retains its ID for reconciliation.

Milestones: A real fullscreen gate; B durable rooms/pairing/queue; C complete karaoke loop; D reliability/permissions; E private pilot packaging. First release is deployed HTTPS PWA plus unpacked Chrome extension, not store publication. Public/commercial distribution needs separate platform-terms review.

Development demos use the host LAN IP for both private controller and public guest QR codes, with the relay reachable from phones on the same network. Share origin selection between extension build and server startup. Do not default QR codes to localhost. Cloudflare Tunnel for development HTTPS access is a deferred stretch goal; Durable Objects are room coordination, not tunneling.

Acceptance: real guest scan → submission → automatic queuing/reorder → confirmed singer attribution → manual next; duplicate/concurrent commands and restarts preserve queue without duplicate advancement. Exercise Linux Chrome, Android Chrome/iOS Safari controllers, and Windows before Windows support. Targets on healthy networks: <500 ms p95 queue propagation, <1 second command acceptance excluding media load, two hours without unbounded growth.

Logs contain latency, connection loss, adapter failures, and reconciliation outcomes, not credentials, names, invitation URLs, or song history. Each release supplies migration/configuration files, installation/recovery instructions, and compatibility evidence.
