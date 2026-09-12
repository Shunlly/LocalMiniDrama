/**
 * 素材查询结果装配：把数据库行转成接口对象，并编解码网络来源元数据。
 * 路由仍通过 assetService 调用，本模块不改变公开 API。
 */

const networkMediaService = require('./networkMediaService');

function parseOpenverseSourceMetadata(parsed) {
  if (parsed.source_provider !== 'Openverse') return null;
  if (!networkMediaService.isOpenverseId(parsed.openverse_id)) return null;
  if (typeof parsed.source_url !== 'string' || typeof parsed.license !== 'string') return null;
  const source = new URL(parsed.source_url);
  if (source.protocol !== 'https:' || source.origin !== 'https://openverse.org' || source.username || source.password) {
    return null;
  }
  return parsed;
}

function parseNetworkSourceMetadata(value) {
  if (typeof value !== 'string' || !value.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.kind === 'openverse') return parseOpenverseSourceMetadata(parsed);
    if (
      parsed?.kind !== 'wikimedia_commons'
      || parsed.source_provider !== 'Wikimedia Commons'
      || typeof parsed.source_url !== 'string'
      || typeof parsed.commons_title !== 'string'
    ) return null;
    const source = new URL(parsed.source_url);
    if (source.protocol !== 'https:' || source.origin !== 'https://commons.wikimedia.org') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function encodeNetworkSourceMetadata(item) {
  if (item?.kind === 'openverse' || item?.source === 'openverse') {
    return JSON.stringify({
      kind: 'openverse',
      source_provider: 'Openverse',
      source_url: item.source_url,
      author: item.author,
      license: item.license,
      license_url: item.license_url || '',
      landing_page: item.landing_page || '',
      openverse_id: item.openverse_id,
      source_site: item.source_site || '',
      indexed_on: item.indexed_on || '',
      resolved_download_url: item.resolved_download_url || '',
      content_sha256: item.content_sha256 || '',
    });
  }
  return JSON.stringify({
    kind: 'wikimedia_commons',
    source_provider: 'Wikimedia Commons',
    source_url: item.source_url,
    author: item.author,
    license: item.license,
    license_url: item.license_url || '',
    commons_title: item.commons_title,
    commons_page_id: item.commons_page_id || null,
    commons_revision_timestamp: item.commons_revision_timestamp || '',
    commons_sha1: item.commons_sha1 || '',
    resolved_download_url: item.resolved_download_url || '',
    content_sha256: item.content_sha256 || '',
  });
}

function isUnchangedNetworkSource(previous, next) {
  if ((previous.kind || 'wikimedia_commons') === 'wikimedia_commons') {
    return previous.commons_revision_timestamp === next.commons_revision_timestamp
      && previous.commons_sha1 === next.commons_sha1
      && previous.content_sha256 === next.content_sha256;
  }
  if (previous.kind === 'openverse') {
    return String(previous.openverse_id || '').toLowerCase() === String(next.openverse_id || '').toLowerCase()
      && previous.content_sha256 === next.content_sha256;
  }
  return previous.content_sha256 === next.content_sha256 && previous.source_url === next.source_url;
}

function rowToItem(r) {
  const sourceMetadata = parseNetworkSourceMetadata(r.category);
  return {
    id: r.id,
    drama_id: r.drama_id,
    name: r.name,
    type: r.type,
    category: sourceMetadata ? 'network' : r.category,
    url: r.url,
    local_path: r.local_path,
    file_size: r.file_size,
    mime_type: r.mime_type,
    width: r.width,
    height: r.height,
    duration: r.duration,
    image_gen_id: r.image_gen_id,
    video_gen_id: r.video_gen_id,
    source_drama_title: r.source_drama_title || null,
    ...(sourceMetadata ? {
      source_provider: sourceMetadata.source_provider,
      source_url: sourceMetadata.source_url,
      author: sourceMetadata.author,
      license: sourceMetadata.license,
      license_url: sourceMetadata.license_url,
      source_metadata: sourceMetadata,
    } : {}),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

module.exports = {
  rowToItem,
  parseNetworkSourceMetadata,
  encodeNetworkSourceMetadata,
  isUnchangedNetworkSource,
};
