import { ADAPTER_VERSION, type GateCommand, type Observation } from '@karaoke/contracts';

type NativePlayer = HTMLElement & {
  loadVideoById?: (input: { videoId: string; startSeconds: number }) => void;
  pauseVideo?: () => void;
  playVideo?: () => void;
  getVideoData?: () => { video_id?: string };
  getPlayerState?: () => number;
};

/** Unofficial native-site integration. All YouTube selectors and page methods live here. */
export function createYouTubeAdapter(doc: Document = document) {
  let sequence = 0;
  let attemptId: string | null = null;
  let expectedId: string | null = null;
  let generationEvent = false;
  let restartSeen = false;
  let progressed = false;
  let loadEvidence = false;
  let previousTime = 0;
  let beforeLoadTime = 0;
  let beforeLoadVideo = '';
  let awaitingStart = false;
  let initialPlayer: NativePlayer | null = null;
  let initialVideo: HTMLVideoElement | null = null;
  let initialFullscreen: Element | null = null;
  let preservedFullscreen = true;
  let naturalEnd = false;
  let intermission = false;
  let lastError: string | null = null;
  let observedVideo: HTMLVideoElement | null = null;
  const player = () => doc.querySelector<NativePlayer>('#movie_player');
  const video = () => player()?.querySelector<HTMLVideoElement>('video.html5-main-video') ?? null;
  const onGeneration = () => { if (awaitingStart) generationEvent = true; };
  const onEnded = () => { if (attemptId) { naturalEnd = true; intermission = true; player()?.pauseVideo?.(); } };
  const onFullscreen = () => { if (initialFullscreen && doc.fullscreenElement !== initialFullscreen) preservedFullscreen = false; };
  doc.addEventListener('fullscreenchange', onFullscreen);

  function listen() {
    const next = video();
    if (next === observedVideo) return;
    observedVideo?.removeEventListener('loadstart', onGeneration);
    observedVideo?.removeEventListener('emptied', onGeneration);
    observedVideo?.removeEventListener('ended', onEnded);
    observedVideo = next;
    next?.addEventListener('loadstart', onGeneration);
    next?.addEventListener('emptied', onGeneration);
    next?.addEventListener('ended', onEnded);
  }
  listen();

  function observe(): Observation {
    listen();
    const p = player();
    const v = video();
    let id: string | null = null;
    let nativeState = -99;
    try {
      const raw = p?.getVideoData?.().video_id;
      id = raw && /^[A-Za-z0-9_-]{11}$/.test(raw) ? raw : null;
      nativeState = p?.getPlayerState?.() ?? -99;
    } catch { lastError = 'Native player observation failed.'; }
    const currentTime = Number.isFinite(v?.currentTime) ? Math.max(0, v!.currentTime) : 0;
    const duration = Number.isFinite(v?.duration) ? Math.max(0, v!.duration) : 0;
    const adShowing = !!p?.classList.contains('ad-showing') || !!p?.classList.contains('ad-interrupting');
    const errorVisible = !!p?.querySelector('.ytp-error[aria-hidden="false"], .ytp-error-content-wrap:not([hidden])')?.getClientRects().length;
    if (awaitingStart && id === expectedId && v && !adShowing) {
      if (currentTime < 2 && (generationEvent || (beforeLoadVideo === id && beforeLoadTime > 0.5 && currentTime + 0.3 < beforeLoadTime) || beforeLoadVideo !== id)) restartSeen = true;
      if (restartSeen && currentTime > previousTime + 0.02 && !v.paused && v.readyState >= 2 && nativeState === 1) progressed = true;
      loadEvidence = restartSeen && progressed;
      if (loadEvidence) awaitingStart = false;
    }
    previousTime = currentTime;
    if (attemptId && !awaitingStart && (nativeState === 0 || v?.ended)) { naturalEnd = true; intermission = true; }
    if (intermission && v && !v.paused) p?.pauseVideo?.();
    let state: Observation['playerState'] = 'unknown';
    if (nativeState === 1 && v && !v.paused && v.readyState >= 2) state = 'playing';
    else if (nativeState === 2 || v?.paused && nativeState === 1) state = 'paused';
    else if (nativeState === 3 || nativeState === -1) state = 'loading';
    else if (nativeState === 5) state = 'cued';
    if (nativeState === 0 || naturalEnd) state = 'ended';
    if (errorVisible || v?.error) state = 'blocked';
    if (!p || !v) state = 'unknown';
    return {
      adapterVersion: ADAPTER_VERSION,
      sequence: sequence++, attemptId, videoId: id, playerState: state,
      currentTime, duration, loadEvidence,
      fullscreen: !!doc.fullscreenElement,
      fullscreenPreserved: !!initialFullscreen && preservedFullscreen && doc.fullscreenElement === initialFullscreen,
      playerPreserved: (!initialPlayer || p === initialPlayer) && (!initialVideo || v === initialVideo),
      overlayMounted: false, // The isolated script supplies the actual overlay observation.
      adShowing,
      capabilities: { load: typeof p?.loadVideoById === 'function', pause: typeof p?.pauseVideo === 'function', resume: typeof p?.playVideo === 'function', identity: typeof p?.getVideoData === 'function' },
      error: errorVisible || v?.error ? 'YouTube reports unavailable or unplayable content. Inspect the player.' : lastError,
    };
  }

  function dispatch(command: GateCommand) {
    const p = player();
    if (!p) throw new Error('The YouTube watch player is unavailable.');
    lastError = null;
    if (command.type === 'load') {
      if (!p.loadVideoById || !p.getVideoData || !p.playVideo) throw new Error('This YouTube player does not expose the required native capabilities.');
      listen();
      initialPlayer = p;
      initialVideo = video();
      initialFullscreen = doc.fullscreenElement;
      preservedFullscreen = true;
      beforeLoadTime = initialVideo?.currentTime ?? 0;
      beforeLoadVideo = p.getVideoData().video_id ?? '';
      previousTime = 0;
      attemptId = command.performance.attemptId;
      expectedId = command.performance.videoId;
      generationEvent = false; restartSeen = false; progressed = false; loadEvidence = false;
      naturalEnd = false; intermission = false; awaitingStart = true;
      p.loadVideoById({ videoId: expectedId, startSeconds: 0 });
      p.playVideo();
    } else if (command.type === 'pause' || command.type === 'skip') {
      if (!p.pauseVideo) throw new Error('Pause is unsupported.');
      if (command.type === 'skip') { intermission = true; naturalEnd = false; awaitingStart = false; }
      p.pauseVideo();
    } else if (command.type === 'resume') {
      if (!p.playVideo || intermission) throw new Error('Resume is unavailable during intermission.');
      p.playVideo();
    }
  }
  function destroy() {
    doc.removeEventListener('fullscreenchange', onFullscreen);
    observedVideo?.removeEventListener('loadstart', onGeneration);
    observedVideo?.removeEventListener('emptied', onGeneration);
    observedVideo?.removeEventListener('ended', onEnded);
  }
  return { observe, dispatch, destroy };
}
