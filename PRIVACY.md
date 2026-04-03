# Privacy Policy

Fast Browser is a local-first Chrome extension for browser automation.

## What the extension accesses

Fast Browser reads the currently active web page in order to:

- extract visible text and interactive elements
- send a compact page snapshot to the configured model provider
- execute the approved browser action on the active page

It does not scrape every tab in the background. It only operates on the tab the user is actively running it against.

## What data is stored

Fast Browser stores the following locally in Chrome extension storage:

- provider selection
- model name
- endpoint URL
- non-secret UI preferences

API keys are stored in `chrome.storage.session`, not in persistent local storage.

## What data is sent off-device

If you configure a remote provider such as Anthropic or an OpenAI-compatible API, Fast Browser sends:

- your task prompt
- the compact page snapshot generated from the active tab
- recent action history for the current run

If you use Ollama locally, those requests can stay on your machine.

## What Fast Browser does not do

Fast Browser does not include analytics, ad trackers, or third-party telemetry.

Fast Browser does not intentionally collect passwords, credit card numbers, or other clearly sensitive field values. Sensitive inputs are flagged and blocked from automated typing by the current action layer.

## Retention

Run state is transient. The extension does not include a hosted account system or a cloud run history in this alpha release.

## Contact

If you have privacy questions, open an issue in the GitHub repository or contact the maintainer through the public project channels.
