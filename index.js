const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_SEPARATOR = '──────────';
const DEFAULT_CHANNELS = ['telegram'];
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const SESSION_TAIL_BYTES = 128 * 1024;
const footerCache = new Map();
const sessionInfoCache = new Map();

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function toPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/^\s*\[\[\s*reply_to:[^\]]+\]\]\s*/i, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function parseJsonMaybe(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function textPhase(block) {
  return parseJsonMaybe(block && block.textSignature)?.phase || '';
}

function pushUnique(list, value) {
  if (!value || list.includes(value)) return;
  list.push(value);
}

function extractOutgoingTextCandidates(message) {
  const blocks = Array.isArray(message && message.content) ? message.content : [];
  const textBlocks = blocks.filter(
    (block) => block && block.type === 'text' && typeof block.text === 'string' && normalizeText(block.text),
  );

  if (textBlocks.length === 0) return [];

  const finalAnswerBlocks = textBlocks.filter((block) => textPhase(block) === 'final_answer');
  const preferredBlocks = finalAnswerBlocks.length > 0 ? finalAnswerBlocks : textBlocks;
  const candidates = [];

  for (const block of preferredBlocks) {
    pushUnique(candidates, normalizeText(block.text));
  }

  if (finalAnswerBlocks.length === 0 && textBlocks.length > 1) {
    pushUnique(candidates, normalizeText(textBlocks.map((block) => block.text).join('\n')));
  }

  return candidates;
}

function formatTokens(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '?';
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1).replace(/\.0$/, '')}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1).replace(/\.0$/, '')}k`;
  }
  return String(Math.round(value));
}

function buildTokenUsage(used, limit) {
  const usedLabel = formatTokens(used);
  const limitLabel = formatTokens(limit);
  return limitLabel === '?' ? usedLabel : `${usedLabel}/${limitLabel}`;
}

function resolveTotalTokens(message) {
  const usage = asObject(message && message.usage);
  const total = toPositiveNumber(usage.totalTokens);
  if (total) return total;

  const parts = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].map((value) =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0,
  );
  const sum = parts.reduce((acc, value) => acc + value, 0);
  return sum > 0 ? sum : null;
}

function resolveSessionFile(sessionKey, agentId) {
  if (typeof sessionKey !== 'string' || !sessionKey) return null;
  const effectiveAgentId = typeof agentId === 'string' && agentId ? agentId : 'main';
  return path.join(os.homedir(), '.openclaw', 'agents', effectiveAgentId, 'sessions', `${sessionKey}.jsonl`);
}

function readTailText(filePath, maxBytes = SESSION_TAIL_BYTES) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const length = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, size - length);
  } finally {
    fs.closeSync(fd);
  }
  return {
    stat,
    text: buffer.toString('utf8'),
  };
}

function findNumericDeep(value, keys) {
  if (!value || typeof value !== 'object') return null;

  for (const key of keys) {
    const candidate = toPositiveNumber(value[key]);
    if (candidate) return candidate;
  }

  for (const nested of Object.values(value)) {
    const candidate = findNumericDeep(nested, keys);
    if (candidate) return candidate;
  }

  return null;
}

function scanSessionInfo(filePath) {
  try {
    const { stat, text } = readTailText(filePath);
    const lines = text.split(/\n+/).filter(Boolean).reverse();
    let thinkingLevel = null;
    let contextLimit = null;

    for (const line of lines) {
      const entry = parseJsonMaybe(line);
      if (!entry || typeof entry !== 'object') continue;

      if (!thinkingLevel && typeof entry.thinkingLevel === 'string' && entry.thinkingLevel) {
        thinkingLevel = entry.thinkingLevel;
      }

      if (!thinkingLevel && entry.type === 'custom') {
        const customThinking = entry?.data?.thinkingLevel;
        if (typeof customThinking === 'string' && customThinking) {
          thinkingLevel = customThinking;
        }
      }

      if (!contextLimit) {
        contextLimit = findNumericDeep(entry, [
          'contextTokens',
          'contextWindow',
          'contextLimit',
          'maxInputTokens',
          'inputTokenLimit',
          'promptTokenLimit',
        ]);
      }

      if (thinkingLevel && contextLimit) break;
    }

    return {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      info: { thinkingLevel, contextLimit },
    };
  } catch {
    return null;
  }
}

function getSessionInfo(sessionKey, agentId) {
  const filePath = resolveSessionFile(sessionKey, agentId);
  if (!filePath || !fs.existsSync(filePath)) return {};

  const cached = sessionInfoCache.get(filePath);
  try {
    const stat = fs.statSync(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.info;
    }
  } catch {
    return (cached && cached.info) || {};
  }

  const scanned = scanSessionInfo(filePath);
  if (!scanned) return (cached && cached.info) || {};
  sessionInfoCache.set(filePath, scanned);
  return scanned.info;
}

function pruneFooterCache(ttlMs) {
  const cutoff = Date.now() - ttlMs;
  for (const [key, entries] of footerCache) {
    const fresh = entries.filter((entry) => entry.at >= cutoff);
    if (fresh.length === 0) footerCache.delete(key);
    else footerCache.set(key, fresh);
  }
}

function rememberFooter(texts, footer, ttlMs) {
  if (!footer) return;
  pruneFooterCache(ttlMs);
  const now = Date.now();

  for (const text of texts) {
    const key = normalizeText(text);
    if (!key) continue;
    const entries = footerCache.get(key) || [];
    entries.push({ footer, at: now });
    footerCache.set(key, entries.slice(-5));
  }
}

function lookupFooter(text, ttlMs) {
  const key = normalizeText(text);
  if (!key) return null;
  pruneFooterCache(ttlMs);
  const entries = footerCache.get(key);
  if (!entries || entries.length === 0) return null;
  return entries[entries.length - 1]?.footer || null;
}

function resolveThinkingLevel(message, sessionInfo, pluginCfg) {
  if (typeof sessionInfo?.thinkingLevel === 'string' && sessionInfo.thinkingLevel) {
    return sessionInfo.thinkingLevel;
  }
  if (typeof message?.thinkingLevel === 'string' && message.thinkingLevel) {
    return message.thinkingLevel;
  }
  const hasThinkingBlock = Array.isArray(message?.content)
    && message.content.some((block) => block?.type === 'thinking');
  if (hasThinkingBlock) return 'on';
  return typeof pluginCfg.thinkingFallback === 'string' && pluginCfg.thinkingFallback
    ? pluginCfg.thinkingFallback
    : 'default';
}

function buildFooter(message, ctx, pluginCfg) {
  const sessionInfo = getSessionInfo(ctx?.sessionKey, ctx?.agentId);
  const provider = typeof message?.provider === 'string' && message.provider ? message.provider : '';
  const model = typeof message?.model === 'string' && message.model ? message.model : '';
  const modelLabel = provider && model ? `${provider}/${model}` : model || provider || 'unknown';
  const thinking = resolveThinkingLevel(message, sessionInfo, pluginCfg);
  const used = resolveTotalTokens(message);
  const limit = toPositiveNumber(pluginCfg.contextLimit) || sessionInfo.contextLimit || null;
  const statusFooter = [
    `🧠 ${modelLabel}`,
    `💭 Think: ${thinking}`,
    `📊 ${buildTokenUsage(used, limit)}`,
  ].join(' ');
  const separator = typeof pluginCfg.separator === 'string' && pluginCfg.separator
    ? pluginCfg.separator
    : DEFAULT_SEPARATOR;
  return `${separator}\n${statusFooter}`;
}

function hasExistingFooter(text, separator) {
  if (typeof text !== 'string' || !text) return false;
  return text.includes(`${separator}\n🧠 `) || (text.includes('\n🧠 ') && text.includes('💭 Think:'));
}

function isLikelyDirectTelegramChat(to) {
  const raw = String(to ?? '').trim();
  const id = raw.includes(':') ? raw.split(':').pop() : raw;
  return id ? !id.startsWith('-') : true;
}

const plugin = {
  id: 'telegram-footer-plugin',
  name: 'Telegram Footer Plugin',
  description: 'Append a compact Telegram reply footer at send time without patching dist bundles.',
  register(api) {
    const pluginCfg = asObject(api.pluginConfig);
    const channels = Array.isArray(pluginCfg.channels) && pluginCfg.channels.length > 0
      ? pluginCfg.channels.filter((value) => typeof value === 'string' && value)
      : DEFAULT_CHANNELS;
    const channelSet = new Set(channels);
    const directOnly = pluginCfg.directOnly !== false;
    const ttlMs = Number.isInteger(pluginCfg.cacheTtlMs) && pluginCfg.cacheTtlMs >= 1000
      ? pluginCfg.cacheTtlMs
      : DEFAULT_CACHE_TTL_MS;
    const separator = typeof pluginCfg.separator === 'string' && pluginCfg.separator
      ? pluginCfg.separator
      : DEFAULT_SEPARATOR;
    const debug = pluginCfg.debug === true;

    api.on('before_message_write', (event, ctx) => {
      if (pluginCfg.enabled === false) return;
      const message = event?.message;
      if (!message || message.role !== 'assistant') return;

      const candidates = extractOutgoingTextCandidates(message);
      if (candidates.length === 0) return;

      const footer = buildFooter(message, ctx, pluginCfg);
      rememberFooter(candidates, footer, ttlMs);

      if (debug) {
        api.logger.info?.(`telegram-footer-plugin: cached footer for ${candidates.length} candidate text(s)`);
      }
    });

    api.on('message_sending', (event, ctx) => {
      if (pluginCfg.enabled === false) return;
      if (!channelSet.has(ctx.channelId)) return;
      if (directOnly && ctx.channelId === 'telegram' && !isLikelyDirectTelegramChat(event.to)) return;
      if (typeof event?.content !== 'string' || !event.content.trim()) return;
      if (hasExistingFooter(event.content, separator)) return;

      const footer = lookupFooter(event.content, ttlMs);
      if (!footer) {
        if (debug) {
          api.logger.info?.('telegram-footer-plugin: no cached footer match for outbound message');
        }
        return;
      }

      const separatorText = event.content.endsWith('\n') ? '' : '\n\n';
      return {
        content: `${event.content}${separatorText}${footer}`,
      };
    });
  },
};

module.exports = plugin;
module.exports.default = plugin;
