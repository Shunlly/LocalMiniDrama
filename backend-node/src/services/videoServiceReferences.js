/**
 * 视频参考图与模型配置装配：本地 /static 路径归一化、宫格参考图与提交参考列表。
 * 路由仍通过 videoService 调用，本模块不改变公开 API。
 * Windows 下 /static/ 必须先剥前缀再解析，不能把该路径当成绝对盘符路径。
 */

const aiConfigService = require('./aiConfigService');
const uploadService = require('./uploadService');
const { videoBadRequest: badRequest } = require('./videoServiceQuery');

function createVideoReferenceHelpers(messages) {
  function parseConfigSettings(config) {
    const value = config?.settings;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function configuredVideoModel(config, preferredModel) {
    return aiConfigService.resolveConfiguredModel(config, preferredModel, '');
  }

  function videoConfigSupportsGridReference(config, preferredModel) {
    if (!config) return false;
    const settings = parseConfigSettings(config);
    if (settings.supports_grid_reference === true) return true;
    if (settings.supports_grid_reference === false) return false;

    const model = configuredVideoModel(config, preferredModel).toLowerCase();
    const protocol = videoClient.resolveVideoProtocol(config, model);
    if (protocol === 'kling_omni' || protocol === 'agnes') return true;
    if (protocol === 'volcengine_omni') {
      return model.includes('seedance') && (/2[-_]0/.test(model) || /seedance[-_]?2|seedance2/.test(model));
    }
    return String(config.provider || '').trim().toLowerCase() === 'agnes' || /agnes-video/.test(model);
  }

  function normalizedLocalReferencePath(value) {
    const text = String(value || '').trim().replace(/\\/g, '/');
    if (!text) return '';
    let pathname = text;
    try {
      const parsed = new URL(text, 'http://localminidrama.invalid');
      pathname = decodeURIComponent(parsed.pathname || '');
    } catch (_) {}
    pathname = pathname.replace(/\\/g, '/').replace(/^\/+/, '');
    if (pathname.toLowerCase().startsWith('static/')) pathname = pathname.slice('static/'.length);
    if (!pathname || pathname.split('/').some((part) => part === '..' || part === '.')) return '';
    return pathname;
  }

  function referenceIdentity(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const localPath = normalizedLocalReferencePath(text);
    const looksLocal = !/^[a-z][a-z0-9+.-]*:/i.test(text) || /\/static\//i.test(text);
    if (looksLocal && localPath) return `local:${localPath}`;
    try {
      const parsed = new URL(text);
      if (!['http:', 'https:'].includes(parsed.protocol)) return `raw:${text}`;
      parsed.hash = '';
      return `url:${parsed.toString()}`;
    } catch (_) {
      return `raw:${text}`;
    }
  }

  function normalizeSubmittedMediaReference(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (text.startsWith('/static/')) {
      return `/static/${uploadService.normalizeStorageRelativeReference(text.slice('/static/'.length))}`;
    }
    if (/^https?:\/\//i.test(text)) {
      let parsed;
      try { parsed = new URL(text); } catch (_) { throw badRequest(messages.invalidUrl); }
      const host = String(parsed.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
      if ((host === 'localhost' || host === '127.0.0.1' || host === '::1') && parsed.pathname.startsWith('/static/')) {
        return `/static/${uploadService.normalizeStorageRelativeReference(parsed.pathname.slice('/static/'.length))}`;
      }
      try { return uploadService.assertPublicHttpUrlSyntax(text).toString(); }
      catch (_) { throw badRequest(messages.publicHttp); }
    }
    try { return `/static/${uploadService.normalizeStorageRelativeReference(text)}`; }
    catch (_) { throw badRequest(messages.localPath); }
  }

  function loadVideoReferenceImage(db, storyboardId, dramaId, value) {
    if (value == null || value === '') return null;
    const imageId = Number(value);
    if (!Number.isInteger(imageId) || imageId <= 0) throw badRequest(messages.gridIdInvalid);
    if (!Number.isInteger(storyboardId) || storyboardId <= 0) {
      throw badRequest(messages.gridNeedsStoryboard);
    }
    const row = db.prepare(
      `SELECT ig.id, ig.storyboard_id, ig.image_url, ig.local_path, e.drama_id
         FROM image_generations ig
         JOIN storyboards s ON s.id = ig.storyboard_id AND s.deleted_at IS NULL
         JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
         JOIN dramas d ON d.id = e.drama_id AND d.deleted_at IS NULL
        WHERE ig.id = ? AND ig.storyboard_id = ? AND ig.status = 'completed'
          AND ig.deleted_at IS NULL AND ig.frame_type IN ('quad_grid', 'nine_grid')`
    ).get(imageId, storyboardId);
    if (!row || (dramaId > 0 && Number(row.drama_id) !== dramaId)) {
      throw badRequest(messages.gridNotInStoryboard);
    }
    const canonical = row.local_path
      ? `/static/${String(row.local_path).replace(/^\/+/, '').replace(/\\/g, '/')}`
      : String(row.image_url || '').trim();
    if (!canonical) throw badRequest(messages.gridMissingUrl);
    return { ...row, canonical, identity: referenceIdentity(canonical) };
  }

  function normalizeReferenceUrls(value) {
    if (value == null || value === '') return [];
    if (!Array.isArray(value)) throw badRequest(messages.refsMustBeArray);
    const urls = [];
    const seen = new Set();
    for (const item of value) {
      const url = normalizeSubmittedMediaReference(item);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      if (urls.length >= 10) break;
    }
    return urls;
  }

  return {
    parseConfigSettings,
    configuredVideoModel,
    videoConfigSupportsGridReference,
    normalizedLocalReferencePath,
    referenceIdentity,
    normalizeSubmittedMediaReference,
    loadVideoReferenceImage,
    normalizeReferenceUrls,
  };
}

module.exports = {
  createVideoReferenceHelpers,
};
