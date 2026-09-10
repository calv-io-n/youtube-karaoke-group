<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { joinRoom, prefilledCode, resolveRoom, sessionId } from '../store';

const code = ref(prefilledCode);
const name = ref('');
const busy = ref(false);
const err = ref('');
const scanning = ref(false);
const scanStatus = ref('Looking for a code…');
const video = ref<HTMLVideoElement>();
/** Session found by scanning or by the `/join/:id` link, so the code field can be skipped. */
const knownSession = ref(sessionId.value);
let stream: MediaStream | undefined;
let scanTimer: ReturnType<typeof setInterval> | undefined;

const cleanCode = computed(() => code.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4));
const cannotJoin = computed(() => busy.value || !name.value.trim() || (!knownSession.value && cleanCode.value.length < 4));

async function join() {
  if (cannotJoin.value) return;
  busy.value = true; err.value = '';
  try {
    const id = knownSession.value || await resolveRoom(cleanCode.value);
    await joinRoom(id, name.value.trim());
  } catch (e) { err.value = e instanceof Error ? e.message : 'Could not join this room.'; }
  finally { busy.value = false; }
}

type Detector = { detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>> };
function acceptScan(value: string) {
  let url: URL | undefined; try { url = new URL(value, location.origin); } catch { return false; }
  if (url.origin !== location.origin) return false;
  const join = /^\/join\/([a-f0-9-]+)$/.exec(url.pathname); const room = /^\/r\/([a-z]{4})$/i.exec(url.pathname);
  if (join) { knownSession.value = join[1]!; code.value = ''; }
  else if (room) { knownSession.value = ''; code.value = room[1]!.toUpperCase(); }
  else return false;
  scanStatus.value = 'Found the room ♪'; setTimeout(cancelScan, 500); return true;
}
async function startScan() {
  scanning.value = true; scanStatus.value = 'Looking for a code…';
  const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  if (!Ctor || !navigator.mediaDevices?.getUserMedia || !window.isSecureContext) { scanStatus.value = 'This browser cannot scan in-app. Point your camera app at the TV instead.'; return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    if (!video.value) throw new Error('no video');
    video.value.srcObject = stream; await video.value.play();
    const detector = new Ctor({ formats: ['qr_code'] });
    scanTimer = setInterval(async () => {
      if (!video.value || video.value.readyState < 2) return;
      try { for (const hit of await detector.detect(video.value)) if (acceptScan(hit.rawValue)) { clearInterval(scanTimer); return; } }
      catch { /* keep scanning */ }
    }, 350);
  } catch { scanStatus.value = 'Camera unavailable. Type the code from the TV instead.'; }
}
function cancelScan() {
  clearInterval(scanTimer); scanTimer = undefined;
  stream?.getTracks().forEach(track => track.stop()); stream = undefined;
  scanning.value = false;
}
onMounted(() => { if (knownSession.value) document.getElementById('singer-name')?.focus(); });
onBeforeUnmount(cancelScan);
</script>

<template>
  <div class="join">
    <div class="blob blue"></div><div class="blob pink"></div>
    <div class="brand">
      <div class="mark" aria-hidden="true">♪</div>
      <div><div class="wordmark">Utaoke</div><div class="tagline">GROUP KARAOKE</div></div>
    </div>
    <img class="mascot hero" src="/mascot/wave.gif" width="200" height="200" alt="Utaoke's red panda mascot waving with a microphone">
    <h1 class="headline">{{ knownSession ? 'You found the room ♪' : 'Join the room ♪' }}</h1>
    <p class="lede">{{ knownSession ? 'Pick a singer name and come on in.' : 'Scan the code on the big screen, or type it in.' }}</p>
    <form class="form" @submit.prevent="join">
      <button v-if="!knownSession" type="button" class="scan" @click="startScan">
        <span class="scan-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16"/></svg></span>
        <span><span class="scan-title">Scan room QR</span><span class="scan-sub">Point at the TV</span></span>
      </button>
      <div v-if="!knownSession" class="divider"><span></span>OR ENTER CODE<span></span></div>
      <input v-if="!knownSession" id="room-code" v-model="code" class="field code" placeholder="ABCD" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" inputmode="text" aria-label="Room code" :disabled="busy">
      <input id="singer-name" v-model="name" class="field name" placeholder="Your singer name" maxlength="60" autocomplete="nickname" aria-label="Your singer name" :disabled="busy" required>
      <p v-if="err" class="error" role="alert">{{ err }}</p>
      <div class="spacer"></div>
      <button type="submit" class="btn pink block go" :disabled="cannotJoin">{{ busy ? 'Joining…' : "Let's sing!" }}</button>
    </form>
    <div v-if="scanning" class="scanner">
      <div class="scan-head">Find the QR on the TV</div>
      <div class="scan-hint">{{ stream ? 'Hold steady' : ' ' }}</div>
      <div class="viewfinder">
        <video ref="video" muted playsinline></video>
        <i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>
        <div class="line"></div>
      </div>
      <div class="scan-status" role="status">{{ scanStatus }}</div>
      <button type="button" class="cancel" @click="cancelScan">Cancel</button>
    </div>
  </div>
</template>

<style scoped>
.join { position: relative; min-height: 100%; display: flex; flex-direction: column; padding: calc(env(safe-area-inset-top) + 28px) 24px calc(env(safe-area-inset-bottom) + 28px); overflow: hidden; }
.blob { position: absolute; border-radius: 50%; opacity: .7; pointer-events: none; }
.blob.blue { width: 220px; height: 220px; background: var(--blue-light); top: -60px; right: -70px; }
.blob.pink { width: 160px; height: 160px; background: var(--pink-soft); bottom: 120px; left: -60px; }
.brand { position: relative; display: flex; align-items: center; gap: 10px; }
.mark { width: 44px; height: 44px; border-radius: 16px; background: var(--pink); color: #fff; display: flex; align-items: center; justify-content: center; font: 900 24px var(--display); box-shadow: 0 6px 0 var(--pink-dark); }
.wordmark { font: 900 22px/1 var(--display); letter-spacing: -.5px; }
.tagline { font: 700 11px/1.4 var(--body); color: var(--dim); letter-spacing: .12em; }
.hero { position: relative; margin: 18px auto 0; width: 200px; height: 200px; object-fit: contain; }
.headline { position: relative; margin: 14px 0 6px; font: 900 34px/1.1 var(--display); letter-spacing: -1px; }
.lede { position: relative; margin: 0 0 20px; font: 600 15px/1.45 var(--body); color: var(--muted); }
.form { position: relative; display: flex; flex-direction: column; flex: 1; }
.scan { display: flex; align-items: center; gap: 14px; width: 100%; padding: 16px 18px; border-radius: 24px; background: var(--blue); color: #fff; box-shadow: 0 6px 0 var(--blue-dark); text-align: left; transition: transform .08s, box-shadow .08s; }
.scan:active { transform: translateY(4px); box-shadow: 0 2px 0 var(--blue-dark); }
.scan-icon { width: 44px; height: 44px; border-radius: 14px; background: rgba(255, 255, 255, .25); display: flex; align-items: center; justify-content: center; flex: none; }
.scan-title { display: block; font: 900 18px/1.2 var(--display); }
.scan-sub { display: block; font: 700 12px/1.4 var(--body); opacity: .85; }
.divider { display: flex; align-items: center; gap: 12px; margin: 22px 0 14px; font: 800 11px var(--body); color: var(--faint); letter-spacing: .14em; }
.divider span { flex: 1; height: 2px; background: var(--line); border-radius: 2px; }
.name { margin-top: 10px; }
.spacer { flex: 1; min-height: 18px; }
.go { margin-top: 12px; padding: 18px; font-size: 18px; }
.scanner { position: absolute; inset: 0; background: #1a1730; display: flex; flex-direction: column; align-items: center; padding: calc(env(safe-area-inset-top) + 60px) 24px 50px; color: #fff; z-index: 5; }
.scan-head { font: 900 20px var(--display); }
.scan-hint { font: 700 13px var(--body); color: #b7b1d6; margin-top: 4px; min-height: 18px; }
.viewfinder { position: relative; width: 260px; height: 260px; margin: 40px 0 auto; border-radius: 18px; overflow: hidden; }
.viewfinder video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.c { position: absolute; width: 44px; height: 44px; border: 0 solid var(--pink); }
.c.tl { left: 0; top: 0; border-left-width: 6px; border-top-width: 6px; border-radius: 18px 0 0 0; }
.c.tr { right: 0; top: 0; border-right-width: 6px; border-top-width: 6px; border-radius: 0 18px 0 0; border-color: #8ed0ff; }
.c.bl { left: 0; bottom: 0; border-left-width: 6px; border-bottom-width: 6px; border-radius: 0 0 0 18px; border-color: #8ed0ff; }
.c.br { right: 0; bottom: 0; border-right-width: 6px; border-bottom-width: 6px; border-radius: 0 0 18px 0; }
.line { position: absolute; left: 14px; right: 14px; height: 3px; background: linear-gradient(90deg, transparent, #ff9ac8, transparent); animation: scanline 1.6s ease-in-out infinite alternate; border-radius: 3px; }
.scan-status { font: 800 14px var(--body); color: var(--pink-light); text-align: center; margin-top: 20px; }
.cancel { margin-top: 18px; padding: 12px 26px; border-radius: 999px; background: rgba(255, 255, 255, .14); color: #fff; font: 800 14px var(--body); }
</style>
