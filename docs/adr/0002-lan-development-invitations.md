# ADR 0002: LAN-addressed development invitations

Date: 2026-09-09. Status: accepted. Implementation PR: none yet; local work.

Design: [MVP delivery](../design/mvp.md#reliability-and-delivery). Supersedes the initial prototype's localhost default, not ADR 0001's temporary-relay decision.

## Context

The demo must be usable from phones on the host's network. A QR pointing at localhost opens the phone's own loopback interface, not the host computer. The user explicitly requires LAN URLs for development and defers tunneling.

## Decision

Use one shared origin resolver for extension builds, relay startup, and live tests. Detect a private IPv4 on a non-loopback physical interface, ignoring common container/VPN interfaces. With multiple candidates choose a stable interface-name order; operators can select the correct network with `GATE_PUBLIC_ORIGIN`. If detection fails, require explicit configuration rather than silently using localhost.

Bind the development relay to `0.0.0.0` by default. Both controller and guest QR URLs use the selected origin. Visiting the loopback development address redirects to that origin. The extension manifest grants access only to the selected service origin and YouTube; rebuild/reload it when the LAN IP changes.

## Consequences

Phones must use the same LAN, with client isolation disabled and the relay port reachable. Local HTTP works for the prototype controller, including UUID generation without secure-context-only APIs. Production installation/offline PWA behavior requires HTTPS and remains outside this gate.

Cloudflare Tunnel is a deferred development convenience for reaching the relay through HTTPS. Durable Objects remain the planned shared-room coordinator; they are not themselves a tunnel. No tunnel provisioning or deployment is part of this change. See [Cloudflare Tunnel documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/).

## Validation

Cover LAN selection, ignored loopback/container/VPN addresses, explicit origin overrides, inconsistent settings, and missing interfaces. Verify that extension permissions, relay-generated QR destinations, and the phone page agree on the LAN origin.
