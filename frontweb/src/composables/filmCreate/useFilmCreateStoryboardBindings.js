export function useFilmCreateStoryboardBindings(deps = {}) {
  const {
    storyboards,
    characters,
    props,
    scenes,
    storyboardsAPI,
    sbCharacterIds,
    sbPropIds,
    sbSceneId,
    saveProjectSettings,
  } = deps

  const EMPTY_ARR = []
  /** 当前分镜已选角色 id 列表（供 el-select 绑定） */
  function getSbCharacterIds(sbId) {
    const arr = sbCharacterIds.value[sbId]
    return Array.isArray(arr) && arr.length > 0 ? arr : EMPTY_ARR
  }

  /** 运镜值的简短中文标签（用于分镜控制栏显示） */
  function getMovementLabel(m) {
    if (!m) return ''
    const map = {
      static: '固定',
      push: '推镜',
      pull: '拉镜',
      pan: '横摇',
      tilt: '纵摇',
      tracking: '跟镜',
      crane_up: '升镜',
      crane_dn: '降镜',
      orbit: '环绕',
      handheld: '手持',
      zoom: '变焦',
      roll: '旋转',
      whip_pan: '甩镜',
      spiral: '螺旋',
      hitchcock_zoom: '希区柯克',
      bullet_time: '子弹时间',
      dutch_angle_move: '荷兰角',
      dolly_track: '推轨',
      slowmo_orbit: '升格环绕',
      'slow push in': '缓慢推镜',
      'static hold': '固定镜头'
    }
    return map[m] || m
  }

  function setSbCharacterIds(sbId, v) {
    const next = Array.isArray(v) ? v : []
    sbCharacterIds.value = { ...sbCharacterIds.value, [sbId]: next }
    onStoryboardCharacterChange(sbId)
  }

  /** 当前分镜尚未勾选的角色（供缩略图旁「+」下拉添加） */
  function charactersAvailableToAddToSb(sbId) {
    const all = characters.value ?? []
    const cur = new Set((getSbCharacterIds(sbId) || []).map((x) => Number(x)))
    return all.filter((c) => c && !cur.has(Number(c.id)))
  }

  function onSbAddCharacterCommand(sbId, charId) {
    const id = Number(charId)
    if (!Number.isFinite(id)) return
    const cur = [...(getSbCharacterIds(sbId) || [])]
    if (cur.some((x) => Number(x) === id)) return
    cur.push(id)
    setSbCharacterIds(sbId, cur)
  }

  /** 当前分镜已选物品 id 列表 */
  function getSbPropIds(sbId) {
    const arr = sbPropIds.value[sbId]
    return Array.isArray(arr) && arr.length > 0 ? arr : EMPTY_ARR
  }

  function setSbPropIds(sbId, v) {
    sbPropIds.value = { ...sbPropIds.value, [sbId]: Array.isArray(v) ? v : [] }
    onStoryboardPropChange(sbId)
  }

  function onStoryboardPropChange(sbId) {
    const ids = sbPropIds.value[sbId] || []
    storyboardsAPI.update(sbId, { prop_ids: ids }).catch(() => {})
  }

  /** 当前分镜选中的场景对象（用于下方缩略图） */
  function getSbSelectedScene(sbId) {
    const sceneId = sbSceneId.value[sbId]
    if (sceneId == null) return null
    const list = scenes.value ?? []
    return list.find((s) => Number(s.id) === Number(sceneId)) || null
  }

  /** 当前分镜选中的角色对象列表（用于下方缩略图） */
  function getSbSelectedCharacters(sbId) {
    const ids = getSbCharacterIds(sbId)
    if (!ids.length) return []
    const list = characters.value ?? []
    return ids.map((id) => list.find((c) => Number(c.id) === Number(id))).filter(Boolean)
  }

  /** 当前分镜选中的物品对象列表（用于下方缩略图） */
  function getSbSelectedProps(sbId) {
    const ids = getSbPropIds(sbId)
    if (!ids.length) return []
    const list = props.value ?? []
    return ids.map((id) => list.find((p) => Number(p.id) === Number(id))).filter(Boolean)
  }

  async function onStoryboardCharacterChange(sbId) {
    const ids = sbCharacterIds.value[sbId] || []
    try {
      await storyboardsAPI.update(sbId, { character_ids: ids })
      // 首/尾帧提示词保留（含用户手动保存版）；图生时后端会按当前勾选做 sanitize
    } catch (e) {
      console.warn('[分镜] 保存角色失败', e)
    }
  }

  function onLastFrameLayoutLockChange() {
    saveProjectSettings()
  }

  function onStoryboardSceneChange(sbId) {
    const sceneId = sbSceneId.value[sbId] ?? null
    storyboardsAPI.update(sbId, { scene_id: sceneId }).catch(() => {})
  }

  /** 同镜号多行时只保留 id 最大的一条（与后端 dedupe 一致，避免「影响的分镜」重复 #N） */
  function dedupeStoryboardsForAssetLink(list) {
    const byNum = new Map()
    const extras = []
    for (const sb of list || []) {
      const n = Number(sb?.storyboard_number)
      if (Number.isFinite(n) && n > 0) {
        const prev = byNum.get(n)
        if (!prev || Number(sb.id) > Number(prev.id)) byNum.set(n, sb)
      } else {
        extras.push(sb)
      }
    }
    return [...byNum.values(), ...extras].sort(
      (a, b) => (Number(a.storyboard_number) || 0) - (Number(b.storyboard_number) || 0)
    )
  }

  /** 返回包含指定角色的所有分镜（已排序） */
  function getCharAffectedStoryboards(charId) {
    const matched = (storyboards.value || []).filter((sb) => {
      if (!sb.characters) return false
      const chars = Array.isArray(sb.characters) ? sb.characters : []
      return chars.some((c) => Number(typeof c === 'object' && c != null ? c.id : c) === Number(charId))
    })
    return dedupeStoryboardsForAssetLink(matched)
  }

  /** 返回指定场景关联的所有分镜 */
  function getSceneAffectedStoryboards(sceneId) {
    const matched = (storyboards.value || []).filter(
      (sb) => sb.scene_id != null && Number(sb.scene_id) === Number(sceneId)
    )
    return dedupeStoryboardsForAssetLink(matched)
  }

  /** 返回包含指定道具的所有分镜（已排序） */
  function getPropAffectedStoryboards(propId) {
    const matched = (storyboards.value || []).filter((sb) => {
      if (!sb.prop_ids) return false
      const pids = Array.isArray(sb.prop_ids) ? sb.prop_ids : []
      return pids.some((pid) => Number(pid) === Number(propId))
    })
    return dedupeStoryboardsForAssetLink(matched)
  }

  /** 点击分镜 chip → 滚动到对应分镜行 */
  function scrollToStoryboard(sbId) {
    const el = document.getElementById('sb-' + sbId)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return {
    getSbCharacterIds,
    getMovementLabel,
    setSbCharacterIds,
    charactersAvailableToAddToSb,
    onSbAddCharacterCommand,
    getSbPropIds,
    setSbPropIds,
    onStoryboardPropChange,
    getSbSelectedScene,
    getSbSelectedCharacters,
    getSbSelectedProps,
    onStoryboardCharacterChange,
    onLastFrameLayoutLockChange,
    onStoryboardSceneChange,
    dedupeStoryboardsForAssetLink,
    getCharAffectedStoryboards,
    getSceneAffectedStoryboards,
    getPropAffectedStoryboards,
    scrollToStoryboard,
  }
}
