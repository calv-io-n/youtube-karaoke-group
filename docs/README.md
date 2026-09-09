# Documentation

Documentation lives beside the code in this repository so changes can be reviewed together.

| Area | Purpose | Start here |
| --- | --- | --- |
| `design` | Desired state: product requirements, interfaces, and acceptance criteria | [MVP specification](design/mvp.md) |
| `adr` | Numbered decisions that change or clarify the design; preserve the reasoning and consequences | [Decision log](adr/README.md) |
| `architecure` | What is actually implemented, with an architecture record for each implementation PR | [Current implementation](architecure/README.md) |
| `wiki` | Human-facing setup, operation, troubleshooting, and contribution guides | [Wiki](wiki/README.md) |

The spelling `architecure` is intentional and follows the requested directory name.

## Updating documentation

1. Change desired behavior in `design` before or alongside implementation.
2. If a change departs from the accepted design, add a numbered ADR linking the affected specification. Record status, context, decision, consequences, and verification. Supersede old ADRs rather than silently rewriting decisions.
3. Every implementation PR adds an architecture record describing only shipped code and actual validation. Link its real PR once one exists; local work is marked **unmerged**. Update the current implementation index in the same PR.
4. Update wiki instructions whenever an operator or contributor workflow changes. Distinguish tested instructions from pending validation.

Design documents are not evidence of implementation. Planned capabilities must never appear as built in architecture records.
