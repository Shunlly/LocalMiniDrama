"use strict";

const VIDEO_PROTOCOLS_SUPPORT_SD2_ASSET_SCHEME = new Set([
  'volcengine_omni',
  'volcengine',
  'dashscope',
  'kling_omni',
  'kling',
]);

function parseJsonColumn(value) {
  if (value == null || value === '') return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (_) {
    return null;
  }
}

function normalizeMaterialHubAssetUrl(assetUrlOrId) {
  const text = String(assetUrlOrId || '').trim();
  if (!text) return null;
  if (text.startsWith('asset://')) return text;
  if (text.startsWith('asset-')) return `asset://${text}`;
  return `asset://${text.replace(/^\/+/, '')}`;
}

function normalizeStorageRelativePath(value) {
  let text = String(value || '').trim().replace(/^[/\\]+/, '').split('?')[0];
  text = text.replace(/\\/g, '/').replace(/\/+$/, '');
  return text;
}

function storageRelativeFromPublicUrl(urlStr) {
  const text = String(urlStr || '').trim();
  if (!/^https?:\/\//i.test(text)) return '';
  try {
    const parsed = new URL(text);
    let pathname = parsed.pathname || '';
    const marker = '/static/';
    const index = pathname.toLowerCase().indexOf(marker);
    if (index >= 0) pathname = pathname.slice(index + marker.length);
    else pathname = pathname.replace(/^\/+/, '');
    return normalizeStorageRelativePath(decodeURIComponent(pathname));
  } catch (_) {
    return '';
  }
}

function buildSd2ActiveAssetUrlLookup(db, dramaId) {
  const urlToAsset = new Map();
  const relPathToAsset = new Map();
  if (!db || !dramaId) return { urlToAsset, relPathToAsset };
  let rows = [];
  try {
    rows = db.prepare(
      'SELECT image_url, local_path, seedance2_asset FROM characters WHERE drama_id = ? AND deleted_at IS NULL'
    ).all(Number(dramaId));
  } catch (_) {
    return { urlToAsset, relPathToAsset };
  }
  for (const row of rows) {
    const asset = parseJsonColumn(row.seedance2_asset);
    if (!asset || String(asset.status || '').toLowerCase() !== 'active') continue;
    const uri = normalizeMaterialHubAssetUrl(asset.hub_asset_id || asset.asset_url);
    if (!uri) continue;
    const certifiedImage = String(asset.certified_image_url || '').trim();
    const certifiedPath = normalizeStorageRelativePath(asset.certified_local_path || '');
    if (certifiedImage) {
      urlToAsset.set(certifiedImage, uri);
      urlToAsset.set(certifiedImage.split('?')[0], uri);
    }
    if (certifiedPath) relPathToAsset.set(certifiedPath, uri);
    const imageUrl = String(row.image_url || '').trim();
    if (imageUrl) {
      urlToAsset.set(imageUrl, uri);
      urlToAsset.set(imageUrl.split('?')[0], uri);
    }
    const localPath = normalizeStorageRelativePath(row.local_path || '');
    if (localPath) relPathToAsset.set(localPath, uri);
  }
  return { urlToAsset, relPathToAsset };
}

function rewriteOneImageUrlForSd2(original, lookup) {
  const text = String(original || '').trim();
  if (!text || text.startsWith('asset://') || text.startsWith('data:')) {
    return { next: text, changed: false };
  }
  for (const candidate of [text, text.split('?')[0]]) {
    if (lookup.urlToAsset.has(candidate)) {
      return { next: lookup.urlToAsset.get(candidate), changed: true };
    }
  }
  const relative = storageRelativeFromPublicUrl(text);
  if (relative && lookup.relPathToAsset.has(relative)) {
    return { next: lookup.relPathToAsset.get(relative), changed: true };
  }
  return { next: text, changed: false };
}

function collectActiveCharacterVoiceRefs(db, dramaId) {
  const map = new Map();
  if (!db || !dramaId) return map;
  try {
    const rows = db.prepare(
      'SELECT id, seedance2_voice_asset FROM characters WHERE drama_id = ? AND deleted_at IS NULL'
    ).all(Number(dramaId));
    for (const row of rows) {
      const asset = parseJsonColumn(row.seedance2_voice_asset);
      if (!asset || String(asset.status || '').toLowerCase() !== 'active') continue;
      const url = String(asset.url || '').trim();
      if (url) map.set(Number(row.id), url);
    }
  } catch (_) {}
  return map;
}

function applySeedance2CertifiedAssetUrlsToVideoOpts(db, log, opts) {
  const next = { ...opts };
  const lookup = buildSd2ActiveAssetUrlLookup(db, opts.drama_id);
  if (lookup.urlToAsset.size === 0 && lookup.relPathToAsset.size === 0) return next;
  const changes = [];
  const patch = (field, value) => {
    const rewritten = rewriteOneImageUrlForSd2(value, lookup);
    if (rewritten.changed) changes.push(field);
    return rewritten.next;
  };
  if (opts.image_url != null) next.image_url = patch('image_url', opts.image_url);
  if (opts.first_frame_url != null) next.first_frame_url = patch('first_frame_url', opts.first_frame_url);
  if (opts.last_frame_url != null) next.last_frame_url = patch('last_frame_url', opts.last_frame_url);
  if (Array.isArray(opts.reference_urls)) {
    next.reference_urls = opts.reference_urls.map((url, index) => patch(`reference_urls[${index}]`, url));
  }
  if (changes.length && log?.info) {
    log.info('[视频][SD2] 已将认证图片替换为 asset 引用', {
      video_gen_id: opts.video_gen_id,
      drama_id: opts.drama_id,
      changed_fields: changes,
    });
  }
  return next;
}

module.exports = {
  VIDEO_PROTOCOLS_SUPPORT_SD2_ASSET_SCHEME,
  normalizeMaterialHubAssetUrl,
  applySeedance2CertifiedAssetUrlsToVideoOpts,
  collectActiveCharacterVoiceRefs,
  rewriteOneImageUrlForSd2,
};
