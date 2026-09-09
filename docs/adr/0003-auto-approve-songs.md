# ADR 0003: Automatically approve song requests

Status: Accepted. Requested during the personal LAN demo.

New guest submissions enter `queued` immediately, preserving authenticated requester attribution and submission limits. The host still chooses when to start the next singer and may reorder or remove waiting songs. This changes the original design's default manual approval requirement.

The LAN relay broadcasts the updated queue immediately. Existing live sessions running the earlier relay use a temporary host-controller approval loop until the relay can restart without disrupting the test.
