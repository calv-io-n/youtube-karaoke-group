import { resolveDevOrigin } from './dev-origin.mjs';
const origin = resolveDevOrigin();
console.log(`Development origin: ${origin}\nBoth controller and guest QR codes use this origin.\nBuild the extension and start the relay on this machine.\nFor multiple adapters, set GATE_PUBLIC_ORIGIN explicitly for both commands.`);
