import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Fast Browser',
  version: '0.2.0',
  description: 'Open-source browser automation with natural language and DOM-native extraction.',
  permissions: ['activeTab', 'sidePanel', 'storage', 'tabs', 'scripting'],
  host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  side_panel: {
    default_path: 'sidepanel.html',
  },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'none';",
  },
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  action: {
    default_title: 'Fast Browser',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },
});
