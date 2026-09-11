'use strict';

// 从 providerSdkProduction 拆出的时间线计划：校验轨道/分镜并生成合成计划与滤镜计划。
// 保持原语义，不是新增真实厂商接入。

const crypto = require('crypto');
const timelineService = require('./timelineService');
const videoMergeService = require('./videoMergeService');
const { isMockValue } = require('./providerSdkProtocol');
const {
  timelineTrackTypeLabel,
  productionCompositeError,
} = require('./providerSdkErrors');

function toJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

function hashJson(value) {
  return crypto.createHash('sha256').update(toJson(value), 'utf8').digest('hex');
}

function sortedTimelineItems(track) {
  return [...(track?.items || [])].sort((left, right) => (
    Number(left.start_sec) - Number(right.start_sec) ||
    Number(left.end_sec) - Number(right.end_sec) ||
    Number(left.id) - Number(right.id)
  ));
}

function hasPositiveTimelineDuration(item) {
  return Number.isFinite(Number(item?.start_sec)) &&
    Number.isFinite(Number(item?.end_sec)) &&
    Number(item.end_sec) > Number(item.start_sec);
}

function hasRealTimelineSource(item) {
  const value = String(item?.source_path || '').trim();
  return !!value && !isMockValue(value);
}

function normalizedTimelineTrack(track) {
  return {
    id: Number(track.id),
    type: track.type,
    name: track.name || '',
    sort_order: Number(track.sort_order) || 0,
    status: track.status || 'pending',
    metadata: track.metadata || {},
    items: sortedTimelineItems(track).map((item) => ({
      id: Number(item.id),
      storyboard_id: item.storyboard_id == null ? null : Number(item.storyboard_id),
      start_sec: Number(item.start_sec),
      end_sec: Number(item.end_sec),
      source_path: String(item.source_path || ''),
      metadata: item.metadata || {},
    })),
  };
}

function buildProductionTimelineCompositePlan(db, episodeId) {
  const timeline = timelineService.getEpisodeTimeline(db, episodeId);
  if (!timeline) throw productionCompositeError(`第 ${episodeId} 集还没有时间线，请先生成时间线后再合成`);
  const requiredTypes = ['video', 'subtitle', 'voice', 'dialogue', 'effect', 'bgm', 'transition'];
  const byType = new Map();
  for (const type of requiredTypes) {
    const matching = timeline.tracks.filter((track) => track.type === type);
    if (matching.length !== 1) {
      throw productionCompositeError(`第 ${episodeId} 集必须恰好有一条${timelineTrackTypeLabel(type)}时间线轨道`);
    }
    byType.set(type, matching[0]);
  }

  const videoItems = sortedTimelineItems(byType.get('video'));
  if (videoItems.length === 0) {
    throw productionCompositeError(`第 ${episodeId} 集的视频时间线为空，请先为分镜添加视频`);
  }
  const seenStoryboardIds = new Set();
  const scenes = videoItems.map((item, order) => {
    const storyboardId = Number(item.storyboard_id);
    if (!Number.isInteger(storyboardId) || storyboardId <= 0 || !item.storyboard) {
      throw productionCompositeError(`第 ${episodeId} 集视频片段 ${item.id} 没有有效分镜，请检查时间线`);
    }
    if (seenStoryboardIds.has(storyboardId)) {
      throw productionCompositeError(`第 ${episodeId} 集视频时间线重复引用了分镜 ${storyboardId}`);
    }
    if (!hasPositiveTimelineDuration(item) || !hasRealTimelineSource(item)) {
      throw productionCompositeError(`第 ${episodeId} 集视频片段 ${item.id} 尚未就绪，请确认已有本地视频且时长有效`);
    }
    seenStoryboardIds.add(storyboardId);
    const startSec = Number(item.start_sec);
    const endSec = Number(item.end_sec);
    return {
      order,
      timeline_item_id: Number(item.id),
      storyboard_id: storyboardId,
      start_sec: startSec,
      end_sec: endSec,
      duration: Number((endSec - startSec).toFixed(6)),
      source_path: String(item.source_path),
      video_url: String(item.source_path),
    };
  });

  const subtitleItems = sortedTimelineItems(byType.get('subtitle'));
  if (subtitleItems.length === 0 || subtitleItems.some((item) => (
    !hasPositiveTimelineDuration(item) || !String(item.source_path || '').trim()
  ))) {
    throw productionCompositeError(`第 ${episodeId} 集字幕时间线不完整，请为每个分镜补齐字幕`);
  }
  const voiceItems = sortedTimelineItems(byType.get('voice'));
  const dialogueItems = sortedTimelineItems(byType.get('dialogue'));
  if ([...voiceItems, ...dialogueItems].some((item) => (
    !hasPositiveTimelineDuration(item) || !hasRealTimelineSource(item)
  ))) {
    throw productionCompositeError(`第 ${episodeId} 集旁白或对白时间线的媒体无效，请重新生成配音并确认已保存到本地`);
  }
  if (voiceItems.length + dialogueItems.length === 0) {
    throw productionCompositeError(`第 ${episodeId} 集需要旁白或对白时间线媒体，请先生成配音`);
  }

  for (const type of ['effect', 'bgm', 'transition']) {
    const track = byType.get(type);
    const metadata = track.metadata || {};
    const items = sortedTimelineItems(track);
    if (items.length === 0 && !(
      track.status === 'unused' && metadata.optional === true && metadata.usage === 'unused'
    )) {
      throw productionCompositeError(`第 ${episodeId} 集的可选${timelineTrackTypeLabel(type)}轨道需明确标记为未使用，或补充该轨道内容`);
    }
  }

  const timelinePlan = {
    schema: 'localminidrama.production_timeline_composite.v1',
    episode_id: Number(episodeId),
    video_track_id: Number(byType.get('video').id),
    tracks: timeline.tracks
      .filter((track) => requiredTypes.includes(track.type))
      .map(normalizedTimelineTrack),
  };
  const timelinePlanHash = hashJson(timelinePlan);
  const filterPlan = videoMergeService.buildStrictSceneFilterPlan(scenes);
  return {
    scenes,
    timeline_plan: timelinePlan,
    timeline_plan_hash: timelinePlanHash,
    filter_plan: filterPlan,
  };
}

module.exports = {
  buildProductionTimelineCompositePlan,
};
