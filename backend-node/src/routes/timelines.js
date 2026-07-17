const response = require('../response');
const timelineService = require('../services/timelineService');

function badRequestOrInternal(res, err) {
  if (err && err.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
  return response.internalError(res, err.message || 'Timeline operation failed');
}

module.exports = function timelineRoutes(db, log) {
  return {
    getDramaTimeline(req, res) {
      try {
        const timeline = timelineService.getDramaTimeline(db, req.params.id);
        if (!timeline) return response.notFound(res, 'Drama timeline not found');
        response.success(res, timeline);
      } catch (err) {
        log.error('timeline drama get', { error: err.message, drama_id: req.params.id });
        badRequestOrInternal(res, err);
      }
    },

    getEpisodeTimeline(req, res) {
      try {
        const timeline = timelineService.getEpisodeTimeline(db, req.params.episode_id);
        if (!timeline) return response.notFound(res, 'Episode timeline not found');
        response.success(res, timeline);
      } catch (err) {
        log.error('timeline episode get', { error: err.message, episode_id: req.params.episode_id });
        badRequestOrInternal(res, err);
      }
    },

    exportEpisodeSrt(req, res) {
      try {
        const srt = timelineService.exportEpisodeSrt(db, req.params.episode_id);
        if (!srt) return response.notFound(res, 'Episode timeline not found');
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
        if (!manifest) return response.notFound(res, 'Drama timeline not found');
        response.success(res, manifest);
      } catch (err) {
        log.error('timeline manifest export', { error: err.message, drama_id: req.params.id });
        badRequestOrInternal(res, err);
      }
    },
  };
};
