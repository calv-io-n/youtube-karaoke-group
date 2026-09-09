import { test, expect, chromium } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Controlled native-player fixture. This verifies wiring, never real YouTube compatibility.
const fixture = `<!doctype html><html><head><title>Gate A test fixture</title></head><body style="margin:0"><div id="movie_player" style="position:relative;width:100vw;height:100vh;background:#1d2933;color:white"><video class="html5-main-video"></video><button id="fullscreen">Enter fullscreen</button><h1>Native player fixture — not real YouTube</h1></div><script>
const p=document.getElementById('movie_player'),v=p.querySelector('video');
let id='jNQXAC9IVRw',time=3,state=2;
Object.defineProperties(v,{currentTime:{get:()=>time,set:n=>time=n},duration:{get:()=>30},readyState:{get:()=>4},paused:{get:()=>state!==1},ended:{get:()=>state===0}});
p.getVideoData=()=>({video_id:id});p.getPlayerState=()=>state;
p.pauseVideo=()=>state=2;p.playVideo=()=>state=1;
p.loadVideoById=({videoId})=>{id=videoId;time=0;state=3;v.dispatchEvent(new Event('emptied'));v.dispatchEvent(new Event('loadstart'));setTimeout(()=>state=1,20);};
setInterval(()=>{if(state===1)time+=.1},100);
document.getElementById('fullscreen').onclick=()=>p.requestFullscreen();
window.fixtureEnd=()=>{state=0;v.dispatchEvent(new Event('ended'))};
window.fixtureNativeChange=()=>{id='aqz-KE-bpKQ';state=1};
window.fixtureUnknown=()=>{p.getPlayerState=()=>99;};
</script></body></html>`;

test('built extension routes one document, renders confirmed singer, preserves fullscreen, and detaches', async ({ baseURL }) => {
  const extension = resolve('apps/extension/.output/chrome-mv3');
  const profile = await mkdtemp(join(tmpdir(), 'karaoke-fixture-'));
  const context = await chromium.launchPersistentContext(profile, { headless: true, executablePath: process.env.GATE_CHROMIUM || undefined, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'] });
  const phoneBrowser = await chromium.launch({ headless: true, executablePath: process.env.GATE_CHROMIUM || undefined });
  try {
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const youtube = await context.newPage(); await youtube.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw');
    const other = await context.newPage(); await other.goto('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const attached = await popup.evaluate(async () => {
      const c = (globalThis as any).chrome;
      const tabs = await c.tabs.query({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' });
      return c.runtime.sendMessage({ type: 'attach', tabId: tabs[0].id });
    });
    expect(attached.ok).toBe(true);
    expect(new URL(attached.controllerUrl).origin).toBe(baseURL);
    expect(new URL(attached.viewerUrl).origin).toBe(baseURL);
    const phone = await phoneBrowser.newContext();
    const controller = await phone.newPage();
    await controller.setViewportSize({ width: 390, height: 844 });
    const pageErrors: string[] = []; controller.on('pageerror', e => pageErrors.push(e.message));
    await controller.goto(attached.controllerUrl);
    await youtube.bringToFront();
    await youtube.getByRole('button', { name: 'Enter fullscreen' }).click();
    await youtube.waitForFunction(() => !!document.fullscreenElement);
    await controller.getByLabel('YouTube link').fill('https://youtu.be/jNQXAC9IVRw');
    await controller.getByLabel('Singer', { exact: true }).fill('Avery <script>');
    await controller.getByLabel('Requested by').fill('Robin');
    await controller.getByRole('button', { name: 'Start performance' }).click();
    await expect(controller.locator('.performance h2')).toHaveText('Avery <script>');
    await expect(youtube.locator('#karaoke-gate-overlay .singer')).toHaveText('Avery <script>');
    await expect(youtube.locator('#karaoke-gate-overlay .detail')).toHaveText('Requested by Robin');
    expect(await youtube.evaluate(() => document.fullscreenElement?.contains(document.getElementById('karaoke-gate-overlay')))).toBe(true);
    expect(await other.locator('#karaoke-gate-overlay').count()).toBe(0);
    await controller.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(controller.getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
    await controller.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(controller.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    await controller.getByLabel('Singer', { exact: true }).fill('Second singer');
    await controller.getByRole('button', { name: 'Start performance' }).click();
    await expect(controller.locator('.performance h2')).toHaveText('Second singer');
    await youtube.evaluate(() => (window as any).fixtureEnd());
    await expect(controller.locator('.performance h2')).toHaveText('Between singers');
    await expect(controller.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled();
    await controller.getByRole('button', { name: 'Start performance' }).click();
    await expect(controller.locator('.performance h2')).toHaveText('Second singer');
    await youtube.evaluate(() => (window as any).fixtureUnknown());
    await expect(controller.locator('.performance .eyebrow')).toHaveText('blocked');
    await expect(youtube.locator('#karaoke-gate-overlay .singer')).toHaveText('Between singers');
    const viewer = await phone.newPage(); await viewer.goto(attached.viewerUrl);
    expect(await viewer.getByRole('button', { name: 'Start performance' }).count()).toBe(0);
    expect(await controller.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
    await controller.screenshot({ path: 'artifacts/controller-mobile.png', fullPage: true });
    await popup.evaluate(() => (globalThis as any).chrome.runtime.sendMessage({ type: 'detach' }));
    await expect(youtube.locator('#karaoke-gate-overlay')).toHaveCount(0);
  } finally { await phoneBrowser.close(); await context.close(); }
});
