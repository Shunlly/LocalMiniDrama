const dns = require('dns').promises;
const net = require('net');

const MAX_WEB_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_WEB_SOURCE_TEXT_CHARS = 200000;
const WEB_SOURCE_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;

function badRequest(message) {
  const err = new Error(message);
  err.code = 'BAD_REQUEST';
  return err;
}

function ipv4ToNumber(ip) {
  const parts = String(ip || '').split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function ipv4InRange(ip, start, maskBits) {
  const value = ipv4ToNumber(ip);
  const base = ipv4ToNumber(start);
  if (value == null || base == null) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (value & mask) === (base & mask);
}

function isPrivateIPv4(ip) {
  return [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4],
  ].some(([start, bits]) => ipv4InRange(ip, start, bits));
}

function isPrivateIPv6(ip) {
  const v = String(ip || '').toLowerCase();
  if (!v || v === '::' || v === '::1' || v === '0:0:0:0:0:0:0:1') return true;
  if (v.startsWith('fc') || v.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(v)) return true;
  const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIPv4(mapped[1]) : false;
}

function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIPv4(address);
  if (version === 6) return isPrivateIPv6(address);
  return true;
}

function parseHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch (_) {
    throw badRequest('请输入有效的网页 URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw badRequest('网页素材只支持 http/https URL');
  }
  if (!parsed.hostname || /\.local$/i.test(parsed.hostname) || /(^|\.)localhost$/i.test(parsed.hostname)) {
    throw badRequest('不允许导入 localhost 或本地域名');
  }
  if (net.isIP(parsed.hostname) && isPrivateAddress(parsed.hostname)) {
    throw badRequest('不允许导入内网、回环或链路本地地址');
  }
  parsed.hash = '';
  return parsed;
}

async function assertPublicHttpUrl(rawUrl, resolver = dns.lookup) {
  const parsed = parseHttpUrl(rawUrl);
  if (!net.isIP(parsed.hostname)) {
    const addresses = await resolver(parsed.hostname, { all: true, verbatim: false });
    const list = Array.isArray(addresses) ? addresses : [addresses];
    if (!list.length) throw badRequest('网页 URL 无法解析');
    if (list.some((item) => !item?.address || isPrivateAddress(item.address))) {
      throw badRequest('不允许导入解析到内网、回环或链路本地地址的 URL');
    }
  }
  return parsed;
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : '';
      } catch (_) {
        return '';
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = Number.parseInt(n, 16);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : '';
      } catch (_) {
        return '';
      }
    });
}

function stripHtmlToText(html) {
  const withoutNoise = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '\n')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '\n')
    .replace(/<(header|nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, '\n');

  const mainCandidates = [];
  for (const tag of ['article', 'main']) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    for (const match of withoutNoise.matchAll(re)) {
      if (match[1]) mainCandidates.push(match[1]);
    }
  }
  const content = mainCandidates.length
    ? mainCandidates.sort((a, b) => b.length - a.length)[0]
    : withoutNoise.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || withoutNoise;

  return decodeHtmlEntities(content)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 2)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractHtmlTitle(html) {
  const h1 = String(html || '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = h1 || String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  return stripHtmlToText(title).replace(/\n+/g, ' ').trim();
}

function extractTextFromWebPayload(raw, contentType = '') {
  const type = String(contentType || '').toLowerCase();
  const body = String(raw || '').replace(/^\uFEFF/, '');
  const looksHtml = type.includes('html') || /<html[\s>]/i.test(body) || /<body[\s>]/i.test(body);
  const text = looksHtml
    ? stripHtmlToText(body)
    : body.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  const title = looksHtml ? extractHtmlTitle(body) : '';
  if (!text || text.length < 20) throw badRequest('网页正文过短，未能抽取出可导入的文本素材');
  return {
    title,
    text: text.length > MAX_WEB_SOURCE_TEXT_CHARS ? text.slice(0, MAX_WEB_SOURCE_TEXT_CHARS).trim() : text,
    truncated: text.length > MAX_WEB_SOURCE_TEXT_CHARS,
    text_length: text.length,
  };
}

async function readResponseTextLimited(res, limitBytes = MAX_WEB_SOURCE_BYTES) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > limitBytes) throw badRequest('网页内容超过导入大小限制');
    return text;
  }

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limitBytes) {
      try { await reader.cancel(); } catch (_) {}
      throw badRequest('网页内容超过导入大小限制');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchWithTimeout(url, fetchImpl, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_SOURCE_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWebSource(rawUrl, opts = {}) {
  const fetchImpl = opts.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available in this Node runtime');
  const resolver = opts.resolver || dns.lookup;
  let parsed = await assertPublicHttpUrl(rawUrl, resolver);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const res = await fetchWithTimeout(parsed.toString(), fetchImpl, {
      redirect: 'manual',
      headers: {
        Accept: 'text/html,text/plain,application/json;q=0.8,*/*;q=0.2',
        'User-Agent': 'LocalMiniDrama-SourceIntake/1.0',
      },
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw badRequest('网页重定向缺少目标地址');
      parsed = await assertPublicHttpUrl(new URL(location, parsed).toString(), resolver);
      continue;
    }
    if (!res.ok) throw badRequest(`网页请求失败：HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    if (contentType && !/(text\/|html|json|xml|csv|markdown)/i.test(contentType)) {
      throw badRequest('网页素材目前只支持文本或 HTML 内容');
    }
    const raw = await readResponseTextLimited(res, opts.maxBytes || MAX_WEB_SOURCE_BYTES);
    const extracted = extractTextFromWebPayload(raw, contentType);
    return {
      url: parsed.toString(),
      content_type: contentType,
      ...extracted,
    };
  }

  throw badRequest('网页重定向次数过多');
}

module.exports = {
  MAX_WEB_SOURCE_BYTES,
  assertPublicHttpUrl,
  extractTextFromWebPayload,
  fetchWebSource,
  isPrivateAddress,
  stripHtmlToText,
};
