# Automatic approval of guest songs

The LAN relay creates guest requests in `queued` state and broadcasts the updated queue to connected clients. The guest form explains automatic queuing and host-controlled start. The integration test starts a submitted song without an approval command and checks that guests cannot start playback.

The current live demo keeps its in-memory room intact through a temporary approval loop in its open desktop controller tab. Keep that tab open during this session. Future relay starts use server-side automatic approval. The deferred Cloudflare scaffold has not been changed in this implementation.

Decision: [ADR 0003](../../adr/0003-auto-approve-songs.md).
