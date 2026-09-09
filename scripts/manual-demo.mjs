import { chromium } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Keep this browser open for a person to run the karaoke demo.
const extension = resolve('apps/extension/.output/chrome-mv3');
const profile = await mkdtemp(join(tmpdir(), 'karaoke-manual-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  executablePath: process.env.GATE_CHROMIUM || undefined,
  viewport: null,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--remote-debugging-port=9223'],
});
const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
const extensionId = new URL(worker.url()).host;
const youtube = await context.newPage();
await youtube.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw', { waitUntil: 'domcontentloaded', timeout: 60000 });
await youtube.locator('#movie_player').waitFor({ timeout: 30000 });
const popup = await context.newPage();
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
const session = await popup.evaluate(async () => {
  const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
  const result = await chrome.runtime.sendMessage({ type: 'attach', tabId: tabs[0].id });
  if (!result.ok) throw new Error(result.error);
  const joinUrl = new URL(`/join/${result.sessionId}`, result.controllerUrl).href;
  return { controllerUrl: result.controllerUrl, joinUrl };
});
const controller = await context.newPage();
await controller.goto(session.controllerUrl);
await controller.getByRole('button', { name: 'Start next singer' }).waitFor();
console.log(JSON.stringify({ ...session, browserDebugPort: 9223 }));
await youtube.bringToFront();
console.log('Manual demo ready. Enter fullscreen on YouTube and submit songs through the guest link. Leave this process running.');
await new Promise(resolve => context.on('close', resolve));
