# Releasing Fast Browser

## 1. Verify the repo

```bash
npm install
npx tsc --noEmit
npm test
npm run build
npm audit
```

## 2. Build the extension

```bash
npm run package:extension
```

This creates `fast-browser-extension.zip` from the built `dist/` directory.

## 3. Smoke test in Chrome

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Load `dist/` as an unpacked extension
4. Open a normal `http` or `https` page
5. Open the Fast Browser side panel
6. Verify:
   - inspect works
   - site access messaging is clear
   - Ollama / provider setup works
   - a simple task such as clicking a search box succeeds

## 4. Prepare Chrome Web Store assets

Before publishing, have:

- extension icon set
- screenshots of the side panel on a real site
- short description
- detailed description
- privacy policy URL or hosted policy page
- support URL

## 5. Production permission tightening

Before a wider release:

- remove broad development access patterns
- prefer `activeTab` plus runtime-granted site access
- document clearly which pages are unsupported

## 6. Versioning

Update the version in:

- `package.json`
- `manifest.config.ts`

Tag the release after the packaged zip and store metadata are validated.
