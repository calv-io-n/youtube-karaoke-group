import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { resolveDevOrigin } from './dev-origin.mjs';

const origin = resolveDevOrigin();
const videos = (process.env.GATE_VIDEOS || 'jNQXAC9IVRw,aqz-KE-bpKQ').split(',');
if (videos.some(id => !/^[A-Za-z0-9_-]{11}$/.test(id))) throw new Error('GATE_VIDEOS must be comma-separated video IDs.');
const extension = resolve('apps/extension/.output/chrome-mv3');
const profile = await mkdtemp(join(tmpdir(), 'karaoke-gate-'));
const report = { startedAt: new Date().toISOString(), platform: process.platform, adapterVersion: 'youtube-native-v0.1.0', browser: '', status: 'INCOMPLETE', transitions: [], failure: null, scenarios: {}, limitations: ['Uses an automated controller browser, not a physical phone.', 'A separate real-device and failure-scenario checklist is required.'] };
await mkdir('artifacts', { recursive: true });
let context;
let youtube;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    executablePath: process.env.GATE_CHROMIUM || undefined,
    viewport: null,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--disable-dev-shm-usage'],
  });
  report.browser = context.browser()?.version() ?? '';
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 20_000 });
  const extensionId = new URL(worker.url()).host;
  youtube = await context.newPage();
  await youtube.goto(`https://www.youtube.com/watch?v=${videos[0]}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const reject = youtube.getByRole('button', { name: /Reject all/i }).first();
  if (await reject.isVisible()) await reject.click();
  await youtube.locator('#movie_player').waitFor({ timeout: 30_000 });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const session = await popup.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
    return chrome.runtime.sendMessage({ type: 'attach', tabId: tabs[0].id });
  });
  if (!session.ok) throw new Error(session.error);
  // Open controller before checking playback so failures still exercise end-to-end routing.
  const controller = await context.newPage();
  await controller.goto(session.controllerUrl);
  await controller.getByRole('button', { name: 'Start performance' }).waitFor({ timeout: 15_000 });
  await youtube.bringToFront();
  const play = youtube.locator('.ytp-large-play-button');
  if (await play.isVisible()) await play.click({ timeout: 1500 }).catch(() => undefined);
  // Let YouTube finish its normal ad flow. This fixture does not suppress ads.
  for (let second = 0; second < 90; second++) {
    const contentPlaying = await youtube.evaluate(() => {
      const p = document.getElementById('movie_player'); const v = p?.querySelector('video');
      return v && !v.paused && v.currentTime > 0.5 && v.readyState >= 2 && !p.classList.contains('ad-showing') && !p.classList.contains('ad-interrupting');
    });
    if (contentPlaying) break;
    const skipAd = youtube.locator('.ytp-skip-ad-button, .ytp-ad-skip-button-modern').first();
    if (await skipAd.isVisible()) await skipAd.click({ timeout: 1000 }).catch(() => undefined);
    if (second % 20 === 0) console.log('Waiting for normal YouTube content playback…');
    await youtube.waitForTimeout(1000);
  }
  await youtube.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && !v.paused && v.currentTime > 0.5 && v.readyState >= 2;
  }, undefined, { timeout: 10_000 });
  if (!await youtube.evaluate(() => !!document.fullscreenElement)) await youtube.locator('.ytp-fullscreen-button').click();
  await youtube.waitForFunction(() => document.fullscreenElement?.contains(document.getElementById('karaoke-gate-overlay')));
  async function readState() {
    return controller.evaluate(async id => {
      const token = sessionStorage.getItem(`karaoke-gate:${id}:controller`);
      return fetch(`/api/gate/sessions/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
    }, session.sessionId);
  }
  for (let i = 0; i < 20; i++) {
    const videoId = videos[Math.floor(i / 2) % videos.length]; // Same video twice as separate attempts.
    await controller.getByLabel('YouTube link').fill(`https://youtu.be/${videoId}`);
    await controller.getByLabel('Singer', { exact: true }).fill(`Test singer ${i + 1}`);
    await controller.getByLabel('Requested by').fill('Test requester');
    await controller.getByRole('button', { name: 'Start performance' }).click();
    await expect.poll(async () => {
      const state = await readState();
      return state.transitions === i + 1 && state.status === 'playing' && state.observation?.playerPreserved;
    }, { timeout: 25_000, message: `Confirm performance ${i + 1} and preservation of the original player` }).toBe(true);
    const observed = await youtube.evaluate(() => ({ fullscreen: !!document.fullscreenElement, overlay: !!document.fullscreenElement?.contains(document.getElementById('karaoke-gate-overlay')), videoId: document.getElementById('movie_player')?.getVideoData?.().video_id }));
    report.transitions.push({ index: i + 1, expectedVideoId: videoId, ...observed });
    if (!observed.fullscreen || !observed.overlay || observed.videoId !== videoId) throw new Error(`Transition ${i + 1} lost fullscreen, overlay, or video identity.`);
    console.log(`Transition ${i + 1}/20 preserved fullscreen and overlay.`);
    await youtube.waitForFunction(() => document.querySelector('video')?.currentTime > 1);
  }
  async function waitState(status, timeout = 25_000) {
    await expect.poll(async () => {
      const state = await readState();
      return { status: state.status, pending: state.pendingCommand };
    }, { timeout, message: `Wait for observed ${status}` }).toEqual({ status, pending: null });
  }
  async function loadVideo(videoId, singer) {
    await controller.getByLabel('YouTube link').fill(`https://youtu.be/${videoId}`);
    await controller.getByLabel('Singer', { exact: true }).fill(singer);
    await controller.getByRole('button', { name: /Start performance|Retry as a new performance/ }).click();
    await waitState('playing');
    await controller.getByRole('heading', { name: singer, exact: true }).waitFor();
  }
  await controller.getByRole('button', { name: 'Pause', exact: true }).click();
  await waitState('paused');
  await controller.getByRole('button', { name: 'Resume', exact: true }).click();
  await waitState('playing');
  report.scenarios.pauseResume = 'passed';
  console.log('Pause/resume confirmed.');
  await controller.getByRole('button', { name: 'Stop / intermission', exact: true }).click();
  await waitState('between_songs');
  report.scenarios.skipToIntermission = 'passed';
  await loadVideo(videos[0], 'Completion test');
  await youtube.evaluate(() => { const v = document.querySelector('video'); if (v && Number.isFinite(v.duration)) v.currentTime = Math.max(0, v.duration - 2); });
  await waitState('between_songs', 15_000);
  report.scenarios.naturalCompletion = 'passed (seeked near end, then observed actual ended event)';
  console.log('Natural completion confirmed.');
  await loadVideo(videos[0], 'Native change test');
  // Simulate a host changing the native player independently of our command channel.
  await youtube.evaluate(id => document.getElementById('movie_player').loadVideoById({ videoId: id, startSeconds: 0 }), videos[1] ?? videos[0]);
  await waitState('out_of_sync');
  report.scenarios.unexpectedNativePlayback = 'passed';
  await controller.getByRole('button', { name: 'Stop / intermission', exact: true }).click();
  await waitState('between_songs');
  await controller.getByLabel('YouTube link').fill('https://youtu.be/00000000000');
  await controller.getByRole('button', { name: 'Start performance' }).click();
  await waitState('blocked', 30_000);
  report.scenarios.unavailableVideo = 'passed';
  console.log('Unavailable video is blocked without announcing a singer.');
  report.status = 'AUTOMATED_SCENARIOS_PASSED';
  report.scenarios.transitions = 'passed';
  report.relay = await controller.evaluate(async id => {
    const token = sessionStorage.getItem(`karaoke-gate:${id}:controller`);
    return fetch(`/api/gate/sessions/${id}/report`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
  }, session.sessionId);
} catch (error) {
  report.status = 'BLOCKED';
  report.failure = error instanceof Error ? error.message.split('\n').slice(0, 4).join('\n') : String(error);
  if (youtube) {
    report.player = await youtube.evaluate(() => ({ url: location.origin + location.pathname, fullscreen: !!document.fullscreenElement, overlay: !!document.getElementById('karaoke-gate-overlay'), error: document.querySelector('.ytp-error-content-wrap')?.textContent?.slice(0, 400), video: (() => { const v = document.querySelector('video'); return v ? { paused: v.paused, readyState: v.readyState, currentTime: v.currentTime, errorCode: v.error?.code } : null; })(), capabilities: (() => { const p = document.getElementById('movie_player'); return { load: typeof p?.loadVideoById, identity: typeof p?.getVideoData }; })() })).catch(() => ({}));
    await youtube.screenshot({ path: 'artifacts/gate-a-live.png' }).catch(() => undefined);
  }
  console.error(`Gate A blocked: ${report.failure}`);
  process.exitCode = 1;
} finally {
  await writeFile('artifacts/gate-a-live.json', JSON.stringify(report, null, 2));
  await context?.close();
  console.log('Evidence: artifacts/gate-a-live.json');
}
