# ADR 0001: Ephemeral relay for Gate A

Date: 2026-09-09. Status: accepted for the prototype only. Implementation PR: none yet; local work.

Design: [Fullscreen gate](../design/mvp.md#fullscreen-and-playback-gate), [Architecture](../design/mvp.md#architecture).

## Context

The accepted plan requires phone-originated commands against real YouTube before investing in durable rooms. Gate A needs a command transport but does not need the full room service.

## Decision

Use a local Node HTTP/WebSocket relay with expiring in-memory test sessions and separate controller, display, and extension credentials. The phone fixture is a Vue page. This prototype uses bearer authentication rather than the future PWA cookie sessions. Its endpoints are namespaced under `/api/gate` to prevent confusion with the intended `/api/rooms` contract.

## Consequences

This is a deliberate temporary deviation from the Worker/Durable Object deployment and PWA authentication architecture. Restarting the relay loses test sessions. It is not production room persistence, host pairing, or restart recovery. Keep it on a trusted test network; do not publish it as the MVP backend. After Gate A passes, build the specified Cloudflare service with durable receipts/outbox and cookie-based phone sessions.

## Validation

Test role separation, expiry, stale commands, no blind replay, and real extension routing. Gate A still requires 20 real transitions and the fault scenarios; local fixture tests do not remove that requirement.
