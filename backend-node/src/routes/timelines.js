const response = require('../response');
const timelineService = require('../services/timelineService');

function toUserMessage(err, fallback) {
  const message = String(err && err.message || '').trim();
  if (message && /[\u4e00-\u9fff]/.test(message)) return message;
  return fallback;
}

function badRequestOrInternal(res, err) {
  if (err && err.code === 'BAD_REQUEST') {
    return response.badRequest(res, toUserMessage(err, '请求参数无效，请检查项目或分集 ID 后重试'));
  }
  return response.internalError(res, toUserMessage(err, '时间线操作失败，请稍后重试'));
}

module.exports = function timelineRoutes(db, log) {
  return {
    getDramaTimeline(req, res) {
      try {
        const timeline = timelineService.getDramaTimeline(db, req.params.id);
        if (!timeline) return response.notFound(res, '未找到该项目的时间线，请确认项目存在且已生成时间线');
        response.success(res, timeline);
      } catch (err) {
        log.error('timeline drama get', { error: err.message, drama_id: req.params.id });
        badRequestOrInternal(res, err);
      }
    },

    getEpisodeTimeline(req, res) {
      try {
        const timeline = timelineService.getEpisodeTimeline(db, req.params.episode_id);
        if (!timeline) return response.notFound(res, '未找到该分集的时间线，请确认分集存在且已生成时间线');
        response.success(res, timeline);
      } catch (err) {
        log.error('timeline episode get', { error: err.message, episode_id: req.params.episode_id });
        badRequestOrInternal(res, err);
      }
    },

    exportEpisodeSrt(req, res) {
      try {
        const srt = timelineService.exportEpisodeSrt(db, req.params.episode_id);
        if (!srt) return response.notFound(res, '未找到该分集的时间线，请确认分集存在且已生成时间线');
        res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="episode-${srt.episode.episode_number || srt.episode.id}.srt"`);
        res.status(200).send(srt.content);
      } catch (err) {
        log.error('timeline srt export', { error: err.message, episode_id: req.params.episode_id });
        badRequestOrInternal(res, err);
      }
    },

    exportDramaManifest(req, res) {
      try {
        const manifest = timelineService.exportDramaManifest(db, req.params.id);
        if (!manifest) return response.notFound(res, '未找到该项目的时间线，请确认项目存在且已生成时间线');
        response.success(res, manifest);
      } catch (err) {
        log.error('timeline manifest export', { error: err.message, drama_id: req.params.id });
        badRequestOrInternal(res, err);
      }
    },
  };
};
