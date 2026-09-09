# Gate A: real playback acceptance

Record the date, OS, browser version, extension version, adapter version, host account mode (without credentials), phone browser, and network origin. Keep screenshots/diagnostic exports free of private controller links.

| Scenario | Required observation |
| --- | --- |
| Join by phone | Private controller and public view-only QR both open the host's LAN origin on an actual phone |
| Enter fullscreen | Local fullscreen action places QR and singer UI inside the fullscreen container |
| 20 transitions | All 20 remote loads preserve the existing fullscreen element, player, and overlay |
| Consecutive duplicate video | Distinct attempts restart from the beginning and attribute the correct singer/requester |
| Pause/resume | Actual paused/playing observations follow the requested control |
| Natural completion | A real ended event clears the current singer and waits for host action |
| Skip | Current playback stops and enters intermission without loading the next performance |
| Unavailable content | No singer is announced as performing; failure remains visible and explicit retry is possible |
| Native playback change | A different native video enters out-of-sync without acquiring a waiting singer's identity |
| Unknown player state | No success is inferred; attribution clears or a pending attempt times out conservatively |
| Fullscreen loss | The controller asks for local recovery and preserves state |
| Reconnection | No blind replay after acknowledgement loss; observe before allowing another command |
| Other tabs | Unbound YouTube tabs remain untouched |

`npm run gate:live` automates real-site checks using a fresh Chromium profile and a browser controller. The diagnostic report describes which scenarios actually completed; it cannot certify physical-phone or host-account compatibility by itself. Controlled browser fixtures verify boundary behavior separately and must be labeled as fixtures.

After failure, inspect the player and export the diagnostic report. Do not substitute a full-page navigation or iframe demo. Milestones B–E remain gated until the required interaction is proven.
