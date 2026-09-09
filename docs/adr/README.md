# Architecture decision records

Record accepted changes to the [desired state](../design/mvp.md) here. Implementation details that follow the specification belong in architecture records instead.

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-gate-a-temporary-relay.md) | Accepted, prototype only | Use an ephemeral local relay during Gate A; preserve Cloudflare as the MVP target |
| [0002](0002-lan-development-invitations.md) | Accepted | Use LAN IPs for development QR codes; defer Cloudflare Tunnel |

New records use the next four-digit number and a descriptive filename. Include date, status (proposed/accepted/superseded), design references, context, decision, consequences, validation, and implementation PR link when one exists. Never invent a PR number or describe an unmerged decision as shipped.
