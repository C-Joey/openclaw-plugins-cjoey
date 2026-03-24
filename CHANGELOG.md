# Changelog

## 0.1.0-alpha.2

- Re-published from the dedicated public source repository `C-Joey/openclaw-plugins-cjoey`
- Corrected ClawHub provenance metadata to point at the intended public plugin source repo

## 0.1.0-alpha.1

- First public alpha release
- Implemented Telegram footer injection as a native OpenClaw hook-only plugin
- Uses `before_message_write` + `message_sending` instead of patching dist bundles
- Verified on OpenClaw `2026.3.22` for Telegram direct-message text replies
- Documents explicit validation boundary and known unverified scenarios
