import { defineConfig } from 'wxt';
import { resolveDevOrigin } from '../../scripts/dev-origin.mjs';

const service = new URL(resolveDevOrigin());
export default defineConfig({
  manifest: {
    name: 'Utaoke — YouTube Group Karaoke',
    description: 'Host a group karaoke room from one YouTube tab. Attach explicitly to one video tab; guests join from their phones.',
    minimum_chrome_version: '116',
    permissions: ['storage', 'scripting', 'alarms'],
    host_permissions: ['https://www.youtube.com/*', `${service.origin}/*`],
    // The fullscreen overlay shows the mascot next to the current singer; nothing else is exposed to the page.
    web_accessible_resources: [{ resources: ['mascot/*.png'], matches: ['https://www.youtube.com/*'] }],
  },
  vite: () => ({ define: { __SERVICE_ORIGIN__: JSON.stringify(service.origin) } }),
});
