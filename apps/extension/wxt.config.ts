import { defineConfig } from 'wxt';
import { resolveDevOrigin } from '../../scripts/dev-origin.mjs';

const service = new URL(resolveDevOrigin());
export default defineConfig({
  manifest: {
    name: 'YouTube Group Karaoke — Gate A',
    description: 'Fullscreen playback validation prototype. Attach explicitly to one YouTube tab.',
    minimum_chrome_version: '116',
    permissions: ['storage', 'scripting', 'alarms'],
    host_permissions: ['https://www.youtube.com/*', `${service.origin}/*`],
  },
  vite: () => ({ define: { __SERVICE_ORIGIN__: JSON.stringify(service.origin) } }),
});
