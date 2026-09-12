/**
 * 剧本查询结果装配：把数据库行转成接口对象，并清洗不应透传的图片数据。
 */

function sanitizeImageUrl(url) {
  if (!url) return null;
  if (String(url).startsWith('data:')) return null;
  return url;
}

function parseJsonColumn(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function parseStoryboardCharacters(charactersStr) {
  if (!charactersStr || typeof charactersStr !== 'string') return [];
  try {
    const parsed = JSON.parse(charactersStr);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c) => (typeof c === 'object' && c != null && c.id != null ? Number(c.id) : Number(c)))
      .filter((n) => Number.isFinite(n));
  } catch (_) {
    return [];
  }
}

function rowToDrama(r) {
  let metadata = r.metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch (e) {
      metadata = {};
    }
  }
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    genre: r.genre,
    style: r.style || 'realistic',
    total_episodes: r.total_episodes ?? 1,
    total_duration: r.total_duration ?? 0,
    status: r.status || 'draft',
    thumbnail: r.thumbnail,
    tags: r.tags,
    metadata: metadata || {},
    created_at: r.created_at,
    updated_at: r.updated_at,
    removed_at: r.deleted_at || null,
    is_removed: Boolean(r.deleted_at),
    recycle_state: r.trash_state || null,
  };
}

function rowToEpisode(r) {
  return {
    id: r.id,
    drama_id: r.drama_id,
    episode_number: r.episode_number,
    title: r.title,
    script_content: r.script_content,
    description: r.description,
    duration: r.duration ?? 0,
    status: r.status || 'draft',
    video_url: r.video_url,
    thumbnail: r.thumbnail,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToStoryboard(r) {
  return {
    id: r.id,
    episode_id: r.episode_id,
    scene_id: r.scene_id,
    storyboard_number: r.storyboard_number,
    title: r.title,
    description: r.description,
    location: r.location,
    time: r.time,
    duration: r.duration ?? 0,
    dialogue: r.dialogue,
    narration: r.narration ?? null,
    action: r.action,
    result: r.result ?? null,
    atmosphere: r.atmosphere,
    image_prompt: r.image_prompt,
    polished_prompt: r.polished_prompt ?? null,
    continuity_snapshot: r.continuity_snapshot ?? null,
    video_prompt: r.video_prompt,
    shot_type: r.shot_type ?? null,
    angle: r.angle ?? null,
    angle_h: r.angle_h ?? null,
    angle_v: r.angle_v ?? null,
    angle_s: r.angle_s ?? null,
    movement: r.movement ?? null,
    lighting_style: r.lighting_style ?? null,
    depth_of_field: r.depth_of_field ?? null,
    segment_index: r.segment_index ?? 0,
    segment_title: r.segment_title ?? null,
    creation_mode: r.creation_mode === 'universal' ? 'universal' : 'classic',
    universal_segment_text: r.universal_segment_text ?? null,
    layout_description: r.layout_description ?? null,
    first_frame_image_id: r.first_frame_image_id ?? null,
    last_frame_image_id: r.last_frame_image_id ?? null,
    last_frame_image_url: sanitizeImageUrl(r.last_frame_image_url),
    last_frame_local_path: r.last_frame_local_path ?? null,
    characters: parseStoryboardCharacters(r.characters),
    composed_image: r.composed_image,
    image_url: sanitizeImageUrl(r.image_url),
    local_path: r.local_path ?? null,
    main_panel_idx: r.main_panel_idx != null ? Number(r.main_panel_idx) : null,
    video_url: r.video_url,
    video_local_path: r.video_local_path ?? null,
    reference_images: parseJsonColumn(r.reference_images) || [],
    video_reference_image_id: r.video_reference_image_id ?? null,
    audio_local_path: r.audio_local_path ?? null,
    narration_audio_local_path: r.narration_audio_local_path ?? null,
    status: r.status || 'pending',
    error_msg: r.error_msg,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToCharacter(r) {
  return {
    id: r.id,
    drama_id: r.drama_id,
    name: r.name,
    role: r.role,
    description: r.description,
    appearance: r.appearance,
    personality: r.personality,
    voice_style: r.voice_style,
    image_url: sanitizeImageUrl(r.image_url),
    local_path: r.local_path,
    extra_images: r.extra_images || null,
    ref_image: r.ref_image || null,
    reference_images: r.reference_images,
    seed_value: r.seed_value,
    sort_order: r.sort_order ?? 0,
    error_msg: r.error_msg,
    polished_prompt: r.polished_prompt || null,
    negative_prompt: r.negative_prompt || null,
    four_view_image_url: r.four_view_image_url || null,
    seedance2_asset: parseJsonColumn(r.seedance2_asset),
    seedance2_voice_asset: parseJsonColumn(r.seedance2_voice_asset),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToScene(r) {
  return {
    id: r.id,
    drama_id: r.drama_id,
    location: r.location,
    time: r.time,
    prompt: r.prompt,
    polished_prompt: r.polished_prompt || null,
    negative_prompt: r.negative_prompt || null,
    storyboard_count: r.storyboard_count ?? 1,
    image_url: sanitizeImageUrl(r.image_url),
    local_path: r.local_path,
    extra_images: r.extra_images || null,
    ref_image: r.ref_image || null,
    status: r.status || 'pending',
    error_msg: r.error_msg,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToProp(r) {
  return {
    id: r.id,
    drama_id: r.drama_id,
    name: r.name,
    type: r.type,
    description: r.description,
    prompt: r.prompt,
    image_url: sanitizeImageUrl(r.image_url),
    local_path: r.local_path,
    extra_images: r.extra_images || null,
    ref_image: r.ref_image || null,
    negative_prompt: r.negative_prompt || null,
    error_msg: r.error_msg,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

module.exports = {
  sanitizeImageUrl,
  parseJsonColumn,
  parseStoryboardCharacters,
  rowToDrama,
  rowToEpisode,
  rowToStoryboard,
  rowToCharacter,
  rowToScene,
  rowToProp,
};
