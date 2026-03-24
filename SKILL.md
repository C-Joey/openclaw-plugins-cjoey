# Telegram Footer Plugin

> This ClawHub bundle packages a **native OpenClaw plugin**, not a prompt-only skill.
> Install it with `openclaw plugins install clawhub:telegram-footer-plugin`, not `openclaw skills install`.

## What it does

Appends a compact footer to **Telegram direct-message assistant replies**:

```text
──────────
🧠 provider/model 💭 Think: level 📊 used/limit
```

## Current validation boundary

### Verified
- OpenClaw `2026.3.22`
- Telegram direct-message text replies

### Not yet fully verified
- media captions
- all multi-block reply variants
- group/channel paths
- non-Telegram channels
- other OpenClaw versions

So the accurate claim is:
- **verified** on OpenClaw `2026.3.22` for Telegram DM text replies
- other cases may be compatible, but are **not yet validated**

## Install

```bash
openclaw plugins install clawhub:telegram-footer-plugin
```

Then enable it in config:

```json5
{
  plugins: {
    allow: ["telegram-footer-plugin"],
    entries: {
      "telegram-footer-plugin": {
        enabled: true,
        config: {
          directOnly: true
        }
      }
    }
  }
}
```

Restart the Gateway after config changes.

## Notes

- Native plugin / hook route
- Does **not** patch OpenClaw dist bundles
- Uses `before_message_write` + `message_sending`
- The current implementation reads session/transcript state to infer thinking/context details, so future OpenClaw internals may require follow-up compatibility updates
