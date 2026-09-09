import { describe, expect, it } from 'vitest';
import { ADAPTER_VERSION, GateCommand, newId, normalizeVideo, type Observation } from '@karaoke/contracts';
import { GateSession } from '@karaoke/contracts/gate';

const observation = (overrides: Partial<Observation> = {}): Observation => ({ adapterVersion: ADAPTER_VERSION, sequence: 0, attemptId: null, videoId: 'jNQXAC9IVRw', playerState: 'paused', currentTime: 0, duration: 20, loadEvidence: false, fullscreen: true, fullscreenPreserved: true, playerPreserved: true, overlayMounted: true, adShowing: false, capabilities: { load: true, pause: true, resume: true, identity: true }, error: null, ...overrides });
function setup() { const s = new GateSession(newId()); s.connect(); s.observe(observation()); return s; }
function load(s: GateSession) { return GateCommand.parse({ v: 1, type: 'load', commandId: newId(), expectedRevision: s.state.revision, performance: { attemptId: newId(), videoId: 'jNQXAC9IVRw', singer: 'Singer', requester: 'Requester' } }); }
function playing(command: ReturnType<typeof load>, sequence = 1) { if (command.type !== 'load') throw new Error(); return observation({ sequence, attemptId: command.performance.attemptId, playerState: 'playing', loadEvidence: true }); }

describe('YouTube URL parsing', () => {
  it.each(['https://www.youtube.com/watch?v=jNQXAC9IVRw&list=foo&t=20', 'https://youtu.be/jNQXAC9IVRw?si=tracking', 'https://m.youtube.com/shorts/jNQXAC9IVRw', 'jNQXAC9IVRw'])('normalizes %s', input => expect(normalizeVideo(input)).toBe('jNQXAC9IVRw'));
  it.each(['https://youtube.com.evil.test/watch?v=jNQXAC9IVRw', 'https://www.youtube.com@evil.test/watch?v=jNQXAC9IVRw', 'https://www.youtube.com:444/watch?v=jNQXAC9IVRw', 'file:///etc/passwd', 'https://youtu.be/jNQXAC9IVRw/other', 'https://www.youtube.com/playlist?list=foo'])('rejects %s', input => expect(() => normalizeVideo(input)).toThrow());
});
describe('Gate A state coordination', () => {
  it('does not announce singing on acceptance, wrong identity, an ad, or missing restart evidence', () => {
    const s = setup(); const c = load(s); s.dispatch(c); s.result(c.commandId, true);
    expect(s.state.current).toBeNull();
    s.observe({ ...playing(c), loadEvidence: false }); expect(s.state.current).toBeNull();
    s.observe({ ...playing(c, 2), videoId: 'aqz-KE-bpKQ' }); expect(s.state.current).toBeNull();
    s.observe({ ...playing(c, 3), adShowing: true }); expect(s.state.current).toBeNull();
    s.observe(playing(c, 4)); expect(s.state.current?.singer).toBe('Singer'); expect(s.state.transitions).toBe(1);
  });
  it('deduplicates delivery, rejects altered IDs, stale revisions and concurrent starts', () => {
    const s = setup(); const c = load(s); expect(s.dispatch(c)).toBe(true); expect(s.dispatch(c)).toBe(false);
    expect(() => s.dispatch({ ...c, expectedRevision: c.expectedRevision + 1 })).toThrow('already used');
    expect(() => s.dispatch({ ...load(s), expectedRevision: 0 })).toThrow('state changed');
    expect(() => s.dispatch(load(s))).toThrow('current command');
  });
  it('requires separate restart evidence for consecutive performances of the same video', () => {
    const s = setup(); const a = load(s); s.dispatch(a); s.observe(playing(a));
    const b = load(s); s.dispatch(b); s.observe(playing(a, 2)); expect(s.state.current).toBeNull();
    s.observe({ ...playing(b, 3), loadEvidence: false }); expect(s.state.current).toBeNull();
    s.observe(playing(b, 4)); expect(s.state.transitions).toBe(2); expect(s.state.consecutiveTransitions).toBe(2);
  });
  it('never counts a transition that lost fullscreen during loading', () => {
    const s = setup(); const c = load(s); s.dispatch(c);
    s.observe({ ...playing(c), fullscreen: false, loadEvidence: false }); s.observe(playing(c, 2));
    expect(s.state.transitions).toBe(1); expect(s.state.consecutiveTransitions).toBe(0);
  });
  it('waits for confirmed stop and natural completion without selecting another song', () => {
    const s = setup(); const c = load(s); s.dispatch(c); s.observe(playing(c));
    s.dispatch({ v: 1, type: 'skip', commandId: newId(), expectedRevision: s.state.revision });
    expect(s.state.current).not.toBeNull();
    s.observe({ ...playing(c, 2), playerState: 'paused' }); expect(s.state.status).toBe('between_songs'); expect(s.state.desired).toBeNull();
    const d = load(s); s.dispatch(d); s.observe(playing(d, 3)); s.observe({ ...playing(d, 4), playerState: 'ended' }); expect(s.state.status).toBe('between_songs');
  });
  it('reconciles ambiguous dispatch without replay and rejects offline commands', () => {
    const s = setup(); const c = load(s); s.dispatch(c); s.disconnect();
    expect(s.dispatch(c)).toBe(false); expect(() => s.dispatch(load(s))).toThrow('fresh extension');
    s.connect(); expect(() => s.dispatch(load(s))).toThrow('fresh extension'); s.observe(playing(c));
    expect(s.state.status).toBe('playing'); expect(s.state.transitions).toBe(1);
  });
  it('does not revive timed-out or failed attempts on late playback', () => {
    const s = setup(); const c = load(s); s.dispatch(c, 0); s.expirePending(20_001);
    s.observe(playing(c)); expect(s.state.status).toBe('blocked'); expect(s.state.current).toBeNull(); expect(s.state.transitions).toBe(0);
  });
  it('ignores stale observations and identifies unexpected native playback', () => {
    const s = setup(); const c = load(s); s.dispatch(c); s.observe(playing(c, 3));
    s.observe({ ...playing(c, 2), playerState: 'ended' }); expect(s.state.status).toBe('playing');
    s.observe({ ...playing(c, 4), videoId: 'aqz-KE-bpKQ' }); expect(s.state.status).toBe('out_of_sync'); expect(s.state.current).toBeNull();
  });
  it('clears singer attribution on unknown state and requires an explicit new attempt', () => {
    const s = setup(); const c = load(s); s.dispatch(c); s.observe(playing(c));
    s.observe({ ...playing(c, 2), playerState: 'unknown' }); expect(s.state.status).toBe('blocked'); expect(s.state.current).toBeNull();
    s.observe(playing(c, 3)); expect(s.state.current).toBeNull();
  });
  it('suspends singer attribution during advertising without counting a second transition', () => {
    const s = setup(); const c = load(s); s.dispatch(c); s.observe(playing(c));
    s.observe({ ...playing(c, 2), adShowing: true }); expect(s.state.current).toBeNull();
    s.observe(playing(c, 3)); expect(s.state.current?.singer).toBe('Singer'); expect(s.state.transitions).toBe(1);
  });
});
