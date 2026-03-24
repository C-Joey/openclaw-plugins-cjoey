# Telegram Footer Plugin

一个 **OpenClaw 原生 hook-only plugin**，用于在 **Telegram 私聊回复**末尾追加紧凑页脚，例如：

```text
──────────
🧠 provider/model 💭 Think: level 📊 used/limit
```

## 当前定位

这是一个 **alpha 版可用插件**，不是旧 `telegram-footer-patch` skill 的换壳。

- **路线**：原生 plugin + hook
- **不做的事**：不 patch OpenClaw dist bundle
- **主要 hook**：
  - `before_message_write`
  - `message_sending`

## 已验证范围

### 当前实测版本
- **OpenClaw**: `2026.3.22`

### 当前实测场景
- **渠道**：Telegram
- **会话类型**：私聊（direct chat）
- **回复类型**：普通文本 assistant reply
- **结果**：真实私聊链路已验证，脚注可以成功自动追加

## 未验证 / 明确边界

以下场景**尚未完成系统验收**：

- Telegram 媒体 caption
- 多段/复杂 block 回复的所有变体
- 群聊、频道、转发等非私聊路径
- 其他渠道（Discord / Slack / Signal 等）
- 更老或更新版本 OpenClaw

因此当前版本只能表述为：

- **已实测支持**：OpenClaw `2026.3.22` 下的 Telegram 私聊文本回复
- **其余场景**：可能兼容，但**未验证**，不能直接宣称已支持

## 实现方式

插件分两步工作：

1. 在 `before_message_write` 中读取即将写入 transcript 的 assistant message，预计算 footer
2. 在 `message_sending` 中拦截 Telegram 出站文本并追加 footer

当前 footer 内容主要来自：

- assistant message 中的 `provider / model / usage`
- session 尾部状态中的 `thinkingLevel` 与 context-limit 相关字段（若可读）

## 设计限制

`message_sending` 事件本身**不直接提供完整的 model / thinking / context 字段**，因此当前实现不是“纯 message_sending 单点取数”，而是：

- transcript 预取
- 发送时文本匹配
- 短时缓存补全

另外，当前版本会读取 OpenClaw session 文件来补齐 thinking / context 信息，因此对 **当前 OpenClaw 内部 transcript / session 布局**存在一定耦合。后续若上游内部结构变化，可能需要跟进适配。

## 配置项

```json5
{
  plugins: {
    entries: {
      "telegram-footer-plugin": {
        enabled: true,
        config: {
          directOnly: true,
          contextLimit: 400000,
          cacheTtlMs: 300000,
          debug: false
        }
      }
    }
  }
}
```

支持字段：

- `enabled`: 是否启用
- `channels`: 目标渠道列表，默认 `['telegram']`
- `directOnly`: 是否仅处理 Telegram 私聊，默认 `true`
- `separator`: 页脚分隔线
- `contextLimit`: 手动覆盖上下文上限
- `thinkingFallback`: 推断不到 thinking 时的兜底文案
- `cacheTtlMs`: 短时缓存 TTL
- `debug`: 是否输出调试日志

## 安装与启用（发布后）

发布到 ClawHub 后，可按 OpenClaw 标准插件流程安装，例如：

```bash
openclaw plugins install clawhub:telegram-footer-plugin
```

然后在配置中显式启用：

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

配置落地后需要重启 Gateway。

## 与旧 skill 的区别

旧的 `telegram-footer-patch` 是 **skill + dist patch** 路线；
本项目是 **plugin + hook** 路线。

如果你的目标是：

- 不改 dist
- 通过 OpenClaw 原生插件机制注入 Telegram 页脚

那么应该使用这个 plugin，而不是旧 patch skill。
