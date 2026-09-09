import type { GateCommand, GateState, Observation } from './index';

export class GateError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}

/** Ephemeral Gate A coordinator. This is not the production durable queue. */
export class GateSession {
  state: GateState;
  private receipts = new Map<string, string>();
  private attempts = new Set<string>();
  private counted = new Set<string>();
  private pending: GateCommand | null = null;
  private lastSequence = -1;
  private commandAt = 0;
  private transitionGood = true;
  readonly history: Array<{ at: number; type: string; detail: unknown }> = [];

  constructor(id: string) {
    this.state = { v: 1, sessionId: id, revision: 0, status: 'idle', desired: null, current: null, observation: null, connected: false, pendingCommand: null, message: 'Attach the extension to begin.', transitions: 0, consecutiveTransitions: 0 };
  }

  record(type: string, detail: unknown) {
    this.history.push({ at: Date.now(), type, detail });
    if (this.history.length > 1000) this.history.shift();
  }

  connect() {
    this.state.connected = true;
    // A new socket never means a command can be replayed. Observe first.
    this.state.message = 'Connected. Waiting for a fresh player observation.';
    this.lastSequence = -1;
    this.state.observation = null;
    this.state.revision++;
    this.record('connected', {});
  }

  disconnect() {
    if (!this.state.connected) return;
    this.state.connected = false;
    this.state.message = 'Extension offline. Current local playback may continue; transport is disabled.';
    this.state.revision++;
    this.record('disconnected', {});
  }

  dispatch(command: GateCommand, now = Date.now()): boolean {
    const fingerprint = JSON.stringify(command);
    const receipt = this.receipts.get(command.commandId);
    if (receipt) {
      if (receipt !== fingerprint) throw new GateError('COMMAND_ID_REUSED', 409, 'This command ID was already used for a different operation.');
      return false;
    }
    if (!this.state.connected || !this.state.observation) throw new GateError('HOST_OFFLINE', 409, 'Wait for a fresh extension observation.');
    if (command.expectedRevision !== this.state.revision) throw new GateError('VERSION_CONFLICT', 409, 'The player state changed. Review it and try again.');
    if (this.pending) throw new GateError('COMMAND_PENDING', 409, 'Wait for the current command to resolve.');
    if (this.receipts.size >= 500) throw new GateError('SESSION_LIMIT', 429, 'Create a new test session.');
    if (command.type === 'load' && this.attempts.has(command.performance.attemptId)) throw new GateError('ATTEMPT_REUSED', 409, 'Use a new performance ID, including for retries.');
    if (command.type === 'resume' && (this.state.status !== 'paused' || !this.state.current)) throw new GateError('INVALID_STATE', 409, 'Only a confirmed paused performance can resume.');
    if (command.type === 'pause' && !['playing', 'loading'].includes(this.state.status)) throw new GateError('INVALID_STATE', 409, 'There is no performance to pause.');
    this.receipts.set(command.commandId, fingerprint);
    this.pending = command;
    this.commandAt = now;
    this.state.pendingCommand = command.commandId;
    if (command.type === 'load') {
      this.attempts.add(command.performance.attemptId);
      this.state.desired = command.performance;
      this.state.current = null;
      this.state.status = 'loading';
      this.transitionGood = this.state.observation.fullscreen;
      this.state.message = `Loading ${command.performance.videoId}. Waiting for confirmed content playback.`;
    }
    this.state.revision++;
    this.record('command', { commandId: command.commandId, type: command.type, ...(command.type === 'load' ? { attemptId: command.performance.attemptId, videoId: command.performance.videoId } : {}) });
    return true;
  }

  result(commandId: string, accepted: boolean, error?: string) {
    if (this.pending?.commandId !== commandId) return;
    this.record('accepted', { commandId, accepted, error });
    if (!accepted) {
      this.state.status = 'blocked';
      this.state.current = null;
      this.state.message = error || 'The player rejected the operation.';
      this.clearPending();
      this.state.revision++;
    } else if (this.pending.type === 'probe') {
      this.clearPending();
      this.state.revision++;
    }
  }

  observe(observation: Observation) {
    if (!this.state.connected || observation.sequence <= this.lastSequence) return;
    this.lastSequence = observation.sequence;
    const before = JSON.stringify([this.state.status, this.state.current, this.state.pendingCommand, this.state.message, this.state.transitions]);
    this.state.observation = observation;
    const desired = this.state.desired;
    const matching = desired && observation.attemptId === desired.attemptId && observation.videoId === desired.videoId;
    if (this.pending?.type === 'load') {
      this.transitionGood &&= observation.fullscreen && observation.fullscreenPreserved && observation.playerPreserved && observation.overlayMounted;
    }
    if (observation.playerState === 'unknown' && !this.pending) {
      this.state.status = 'blocked';
      this.state.current = null;
      this.state.message = 'Player state is unknown. Inspect YouTube, then explicitly retry or stop.';
    } else if (observation.adShowing && this.state.current) {
      this.state.current = null;
      this.state.status = 'loading';
      this.state.message = 'Waiting for content playback after YouTube advertising.';
    } else if (observation.error || observation.playerState === 'blocked') {
      this.state.status = 'blocked';
      this.state.current = null;
      this.state.message = observation.error || 'Playback is blocked.';
      this.clearPending();
    } else if (this.pending?.type === 'skip' && ['paused', 'ended', 'cued'].includes(observation.playerState)) {
      this.state.status = 'between_songs';
      this.state.current = null;
      this.state.desired = null;
      this.state.message = 'Intermission. Start the next singer when ready.';
      this.clearPending();
    } else if (matching && observation.loadEvidence && !observation.adShowing) {
      if (observation.playerState === 'playing') {
        // A timed-out/rejected/ended attempt must not revive on late observations.
        if (this.pending?.type === 'load' || ['playing', 'paused'].includes(this.state.status) || this.state.status === 'loading' && this.counted.has(desired.attemptId)) {
          this.state.status = 'playing';
          this.state.current = desired;
          this.state.message = observation.fullscreen ? 'Content playback confirmed.' : 'Playback confirmed. Restore fullscreen on the host computer.';
          if (this.pending?.type === 'load') {
            if (!this.counted.has(desired.attemptId)) {
              this.counted.add(desired.attemptId);
              this.state.transitions++;
              this.state.consecutiveTransitions = this.transitionGood ? this.state.consecutiveTransitions + 1 : 0;
              this.record('transition', { attemptId: desired.attemptId, videoId: desired.videoId, preserved: this.transitionGood });
            }
            this.clearPending();
          } else if (this.pending?.type === 'resume') this.clearPending();
        }
      } else if (observation.playerState === 'paused' && this.state.current) {
        this.state.status = 'paused';
        this.state.message = 'Paused.';
        if (this.pending?.type === 'pause') this.clearPending();
      } else if (observation.playerState === 'ended' && this.state.current) {
        this.state.status = 'between_songs';
        this.state.current = null;
        this.state.desired = null;
        this.state.message = 'Performance complete. Start the next singer when ready.';
        this.clearPending();
      }
    } else if (!this.pending && observation.playerState === 'playing' && !observation.adShowing && (!matching || !desired)) {
      this.state.status = 'out_of_sync';
      this.state.current = null;
      this.state.message = 'YouTube is playing outside the selected performance. Load a performance or stop for intermission.';
    }
    if (before !== JSON.stringify([this.state.status, this.state.current, this.state.pendingCommand, this.state.message, this.state.transitions])) {
      this.state.revision++;
      this.record('state', { status: this.state.status, attemptId: this.state.current?.attemptId ?? null, pendingCommand: this.state.pendingCommand });
    }
  }

  expirePending(now = Date.now()) {
    if (this.pending && now - this.commandAt > 20_000) {
      this.record('timeout', { commandId: this.pending.commandId });
      this.state.status = 'blocked';
      this.state.current = null;
      this.state.message = 'Playback could not be confirmed. Inspect YouTube, then explicitly retry or stop. The operation will not replay automatically.';
      this.clearPending();
      this.state.revision++;
    }
  }

  private clearPending() { this.pending = null; this.state.pendingCommand = null; }
}
