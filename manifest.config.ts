import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Fast Browser',
  version: '0.1.0',
  description: 'Open-source browser automation with natural language and DOM-native extraction.',
  permissions: ['activeTab', 'sidePanel', 'storage', 'tabs', 'scripting'],
  host_permissions: ['<all_urls>'],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/content-script.ts'],
      run_at: 'document_idle',
    },
  ],
  side_panel: {
    default_path: 'sidepanel.html',
  },
  action: {
    default_title: 'Fast Browser',
  },
});

