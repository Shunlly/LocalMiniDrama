'use strict';

// 从 uploadValidation 拆出的网络/URL 校验：IPv4/IPv6、CIDR、元数据主机与公网 HTTP(S) 检查。

const dns = require('dns');
const net = require('net');

class UnsafeMediaReferenceError extends Error {
  constructor(
    message = '媒体引用必须是安全的本地存储资源或公网 HTTP(S) URL',
    reason = 'UNSAFE_PATH'
  ) {
    super(message);
    this.name = 'UnsafeMediaReferenceError';
    this.code = 'UNSAFE_MEDIA_REFERENCE';
    this.reason = reason;
  }
}

function ipv4Number(address) {
  const parts = String(address).split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value < 0 || value > 255) return null;
    result = (result * 256) + value;
  }
  return result >>> 0;
}

function ipv4InCidr(address, base, prefix) {
  const value = ipv4Number(address);
  const network = ipv4Number(base);
  if (value == null || network == null) return false;
  const shift = 32 - prefix;
  return shift === 32 ? true : (value >>> shift) === (network >>> shift);
}

function parseIpv6(address) {
  let input = String(address || '').toLowerCase();
  if (!input || input.includes('%')) return null;
  if (input.includes('.')) {
    const splitAt = input.lastIndexOf(':');
    if (splitAt < 0) return null;
    const ipv4 = ipv4Number(input.slice(splitAt + 1));
    if (ipv4 == null) return null;
    input = `${input.slice(0, splitAt)}:${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  if ((input.match(/::/g) || []).length > 1) return null;
  const halves = input.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const parts = [...left, ...Array(missing).fill('0'), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  let value = 0n;
  for (const part of parts) value = (value << 16n) | BigInt(parseInt(part, 16));
  return value;
}

function ipv6InCidr(value, base, prefix) {
  const baseValue = parseIpv6(base);
  if (value == null || baseValue == null) return false;
  const shift = 128n - BigInt(prefix);
  return (value >> shift) === (baseValue >> shift);
}

function isGloballyRoutableIp(address) {
  const family = net.isIP(String(address || ''));
  if (family === 4) {
    return ![
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
      ['224.0.0.0', 4], ['240.0.0.0', 4],
    ].some(([base, prefix]) => ipv4InCidr(address, base, prefix));
  }
  if (family !== 6) return false;
  const value = parseIpv6(address);
  if (value == null) return false;
  if (ipv6InCidr(value, '::ffff:0:0', 96)) {
    const mapped = Number(value & 0xffffffffn);
    return isGloballyRoutableIp([
      (mapped >>> 24) & 255,
      (mapped >>> 16) & 255,
      (mapped >>> 8) & 255,
      mapped & 255,
    ].join('.'));
  }
  return ![
    ['::', 128], ['::1', 128], ['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
    ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
    ['3fff::', 20], ['5f00::', 16], ['fc00::', 7], ['fec0::', 10],
    ['fe80::', 10], ['ff00::', 8],
  ].some(([base, prefix]) => ipv6InCidr(value, base, prefix));
}

function isMetadataIp(address) {
  const family = net.isIP(String(address || ''));
  if (family === 4) {
    return address === '169.254.169.254' ||
      address === '169.254.170.2' ||
      address === '100.100.100.200' ||
      address === '168.63.129.16';
  }
  if (family !== 6) return false;
  const value = parseIpv6(address);
  return value != null && value === parseIpv6('fd00:ec2::254');
}

function isAllowedPrivateProviderIp(address) {
  const family = net.isIP(String(address || ''));
  if (family === 4) {
    return [
      ['10.0.0.0', 8], ['127.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16],
    ].some(([base, prefix]) => ipv4InCidr(address, base, prefix));
  }
  if (family !== 6) return false;
  const value = parseIpv6(address);
  return value != null && (
    ipv6InCidr(value, '::1', 128) ||
    ipv6InCidr(value, 'fc00::', 7)
  );
}

function normalizedHostname(hostname) {
  return String(hostname || '').trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

function isBlockedHostname(hostname) {
  const host = normalizedHostname(hostname);
  return !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    host.endsWith('.internal') || host.endsWith('.home.arpa') || host === 'metadata' ||
    host === 'instance-data' || host === 'metadata.google.internal';
}

function isMetadataHostname(hostname) {
  const host = normalizedHostname(hostname);
  return host === 'metadata' || host === 'instance-data' ||
    host === 'metadata.google.internal' || host === 'metadata.azure.internal' ||
    host.endsWith('.metadata.google.internal');
}

function parseHttpUrlSyntax(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 4096 || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new UnsafeMediaReferenceError('媒体 URL 为空、过长或包含控制字符');
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch (_) {
    throw new UnsafeMediaReferenceError('媒体 URL 无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new UnsafeMediaReferenceError('媒体 URL 必须是不含凭据的 HTTP(S) 地址');
  }
  return parsed;
}

function trustedOriginMatch(parsed, trustedOrigins) {
  if (!Array.isArray(trustedOrigins) || trustedOrigins.length === 0) return false;
  return trustedOrigins.some((value) => {
    try {
      const trusted = parseHttpUrlSyntax(value);
      return trusted.origin === parsed.origin;
    } catch (_) {
      return false;
    }
  });
}

function isExplicitLocalProviderHostname(hostname) {
  const host = normalizedHostname(hostname);
  if (!host) return false;
  if (net.isIP(host)) return isAllowedPrivateProviderIp(host);
  return !host.includes('.') || host === 'localhost' || host.endsWith('.localhost') ||
    host.endsWith('.local') || host.endsWith('.internal') ||
    host.endsWith('.home.arpa') || host.endsWith('.docker.internal');
}

function assertPublicHttpUrlSyntax(value) {
  const parsed = parseHttpUrlSyntax(value);
  const host = normalizedHostname(parsed.hostname);
  if (isBlockedHostname(host)) throw new UnsafeMediaReferenceError('媒体 URL 主机不是公网地址');
  if (net.isIP(host) && !isGloballyRoutableIp(host)) {
    throw new UnsafeMediaReferenceError('媒体 URL 解析到非公网地址');
  }
  return parsed;
}

async function validatePublicHttpUrl(value, options = {}) {
  const basic = parseHttpUrlSyntax(value);
  const basicHost = normalizedHostname(basic.hostname);
  if (isMetadataHostname(basicHost)) {
    throw new UnsafeMediaReferenceError('媒体 URL 指向元数据服务，已被拒绝');
  }
  const trustedOrigin = trustedOriginMatch(basic, options.trustedOrigins);
  const explicitPrivateOrigin = trustedOriginMatch(basic, options.allowPrivateOrigins);
  const privateAddressAllowed = explicitPrivateOrigin || (
    trustedOrigin && isExplicitLocalProviderHostname(basicHost)
  );
  const parsed = trustedOrigin ? basic : assertPublicHttpUrlSyntax(value);
  const host = normalizedHostname(parsed.hostname);
  let records;
  if (net.isIP(host)) {
    records = [{ address: host, family: net.isIP(host) }];
  } else {
    const lookup = options.lookup || dns.promises.lookup;
    try {
      records = await lookup(host, { all: true, verbatim: true });
    } catch (error) {
      throw new UnsafeMediaReferenceError('媒体地址无法解析，请检查链接是否正确');
    }
  }
  if (!Array.isArray(records)) records = records ? [records] : [];
  const invalidDnsAnswer = records.some((record) => !net.isIP(String(record?.address || '')));
  const metadataAnswer = records.some((record) => isMetadataIp(record?.address));
  const unsafeAnswer = records.some((record) => {
    if (isGloballyRoutableIp(record?.address)) return false;
    return !privateAddressAllowed || !isAllowedPrivateProviderIp(record?.address);
  });
  if (records.length === 0 || invalidDnsAnswer || metadataAnswer || unsafeAnswer) {
    throw new UnsafeMediaReferenceError('媒体 URL 解析到非公网地址');
  }
  return {
    url: parsed.toString(),
    parsed,
    trustedOrigin,
    privateAddressAllowed,
    addresses: records.map((record) => ({ address: record.address, family: Number(record.family) || net.isIP(record.address) })),
  };
}

function createPinnedDnsLookup(selected) {
  const address = String(selected?.address || '');
  const family = Number(selected?.family) || net.isIP(address);
  if (!family) throw new UnsafeMediaReferenceError('固定的 DNS 地址无效');
  return (_hostname, lookupOptions, callback) => {
    if (typeof lookupOptions === 'function') {
      callback = lookupOptions;
      lookupOptions = {};
    }
    if (lookupOptions?.all === true) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

module.exports = {
  UnsafeMediaReferenceError,
  assertPublicHttpUrlSyntax,
  createPinnedDnsLookup,
  ipv4InCidr,
  isGloballyRoutableIp,
  normalizedHostname,
  parseHttpUrlSyntax,
  validatePublicHttpUrl,
};
