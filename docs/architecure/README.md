# Implemented architecture

This area records actual code, limitations, and verification per implementation PR. It does not describe planned capabilities as built.

| Record | PR / merge status | Contents |
| --- | --- | --- |
| [Gate A prototype](changes/gate-a-prototype.md) | No PR yet; unmerged local work | Monorepo, contracts, fullscreen adapter and temporary test harness |

The local LAN room/queue path and playback prototype are implemented. A Cloudflare Worker + Durable Object deployment target now exists in `apps/room-worker`, but it has not been deployed or run against a configured Cloudflare account. Automated Gate A playback scenarios passed on real YouTube; physical-phone acceptance remains pending. Consult the record for verification results and limitations.

For each implementation PR, add `changes/<descriptive-slug>.md` with its real PR URL, merge status/date, implemented behavior, component/data flow, interfaces/storage changes, validation evidence, limitations, and links to relevant design/ADRs. Keep records immutable after merge except factual corrections; later PRs get their own records. Update this index in the same PR.
