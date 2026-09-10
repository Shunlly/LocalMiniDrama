<template>
<div class="sb-panel sb-script">
  <div class="sb-script-row sb-script-selects">
    <el-select
      :model-value="getSbCharacterIds(sb.id)"
      :aria-label="`分镜${sb.storyboard_number || i + 1}角色`"
      placeholder="选择角色"
      multiple
      collapse-tags
      collapse-tags-tooltip
      size="small"
      class="sb-select"
      @update:model-value="(v) => setSbCharacterIds(sb.id, v)"
    >
      <el-option
        v-for="c in (characters || [])"
        :key="String(c.id)"
        :label="c.name || '未命名'"
        :value="c.id"
      />
      <template v-if="!(characters || []).length" #empty>
        <span class="sb-select-empty">请先在「角色」面板添加角色</span>
      </template>
    </el-select>
    <el-select
      v-model="sbSceneId[sb.id]"
      :aria-label="`分镜${sb.storyboard_number || i + 1}场景`"
      placeholder="选择场景"
      clearable
      size="small"
      class="sb-select"
      @change="() => onStoryboardSceneChange(sb.id)"
    >
      <el-option
        v-for="s in (scenes || [])"
        :key="s.id"
        :label="s.location"
        :value="s.id"
      />
      <template v-if="!(scenes || []).length" #empty>
        <span class="sb-select-empty">请先在「场景」面板添加场景</span>
      </template>
    </el-select>
    <el-select
      :model-value="getSbPropIds(sb.id)"
      :aria-label="`分镜${sb.storyboard_number || i + 1}道具`"
      placeholder="选择道具"
      multiple
      collapse-tags
      collapse-tags-tooltip
      size="small"
      class="sb-select"
      @update:model-value="(v) => setSbPropIds(sb.id, v)"
    >
      <el-option
        v-for="p in (propItems || [])"
        :key="String(p.id)"
        :label="p.name || '未命名'"
        :value="p.id"
      />
      <template v-if="!(propItems || []).length" #empty>
        <span class="sb-select-empty">请先在「道具」面板添加道具</span>
      </template>
    </el-select>
  </div>
  <!-- 当前选中：场景 / 角色 / 道具缩略图 -->
  <div v-if="getSbSelectedScene(sb.id) || getSbSelectedCharacters(sb.id).length || getSbSelectedProps(sb.id).length || (characters || []).length" class="sb-selected-thumbs">
    <div v-if="getSbSelectedScene(sb.id)" class="sb-thumb-row">
      <span class="sb-thumb-label">场景</span>
      <div class="sb-thumb-list">
        <button
          type="button"
          v-for="s in [getSbSelectedScene(sb.id)]"
          :key="s.id"
          class="sb-thumb-item sb-thumb-scene"
          :class="{ 'sb-thumb-clickable': hasAssetImage(s) }"
          :title="s.location"
          :disabled="!hasAssetImage(s)"
          :aria-label="`预览${s.location || '场景'}图片`"
          @click="hasAssetImage(s) && openImagePreview(assetImageUrl(s))"
        >
          <img v-if="hasAssetImage(s)" :src="assetImageUrl(s)" alt="" />
          <span v-else class="sb-thumb-placeholder">{{ (s.location || '')[0] }}</span>
        </button>
      </div>
    </div>
    <div v-if="(characters || []).length" class="sb-thumb-row">
      <span class="sb-thumb-label">角色</span>
      <div class="sb-thumb-list">
        <button
          type="button"
          v-for="c in getSbSelectedCharacters(sb.id)"
          :key="c.id"
          class="sb-thumb-item sb-thumb-avatar"
          :class="{ 'sb-thumb-clickable': hasAssetImage(c) }"
          :title="c.name"
          :disabled="!hasAssetImage(c)"
          :aria-label="`预览${c.name || '角色'}图片`"
          @click="hasAssetImage(c) && openImagePreview(assetImageUrl(c))"
        >
          <img v-if="hasAssetImage(c)" :src="assetImageUrl(c)" alt="" />
          <span v-else class="sb-thumb-placeholder">{{ (c.name || '')[0] }}</span>
        </button>
        <el-dropdown trigger="click" @command="(cmd) => onSbAddCharacterCommand(sb.id, cmd)">
          <button
            type="button"
            class="sb-thumb-item sb-thumb-avatar sb-thumb-add-char"
            title="添加角色"
            :aria-label="`为分镜${sb.storyboard_number || i + 1}添加角色`"
            @click.stop
          >
            <el-icon><Plus /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu class="sb-char-add-dropdown">
              <el-dropdown-item
                v-for="c in charactersAvailableToAddToSb(sb.id)"
                :key="c.id"
                :command="c.id"
              >
                {{ c.name || '未命名' }}
              </el-dropdown-item>
              <el-dropdown-item v-if="!charactersAvailableToAddToSb(sb.id).length" disabled>
                已全部添加或无角色
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>
    <div v-if="getSbSelectedProps(sb.id).length" class="sb-thumb-row">
      <span class="sb-thumb-label">道具</span>
      <div class="sb-thumb-list">
        <button
          type="button"
          v-for="p in getSbSelectedProps(sb.id)"
          :key="p.id"
          class="sb-thumb-item sb-thumb-prop"
          :class="{ 'sb-thumb-clickable': hasAssetImage(p) }"
          :title="p.name"
          :disabled="!hasAssetImage(p)"
          :aria-label="`预览${p.name || '道具'}图片`"
          @click="hasAssetImage(p) && openImagePreview(assetImageUrl(p))"
        >
          <img v-if="hasAssetImage(p)" :src="assetImageUrl(p)" alt="" />
          <span v-else class="sb-thumb-placeholder">{{ (p.name || '')[0] }}</span>
        </button>
      </div>
    </div>
  </div>
  <!-- 首尾帧模式下隐藏“图片提示词”入口，统一收敛到首/尾帧槽位的“查看提示词” -->
  <div v-if="!storyboardUseFirstLastFrame" class="sb-prompt-label">
    <span class="sb-dot"></span>
    <span>图片提示词</span>
  </div>
  <div v-if="!storyboardUseFirstLastFrame" class="sb-prompt-row">
    <span class="sb-prompt-text">{{ sb.image_prompt || '暂无图片提示词' }}</span>
    <el-button size="small" link type="primary" @click="onOpenSbPromptDialog(sb)">编辑</el-button>
  </div>
  <template v-if="storyboardIncludeNarration || (sbNarration[sb.id] || '').trim() || (sb.narration || '').trim()">
    <div class="sb-prompt-label">
      <span class="sb-dot"></span>
      <span>解说旁白</span>
    </div>
    <el-input
      v-model="sbNarration[sb.id]"
      type="textarea"
      :rows="2"
      :aria-label="`分镜${sb.storyboard_number || i + 1}解说旁白`"
      placeholder="本镜解说文案（画外音 / 纪录片式旁白，可生成配音或导出字幕）"
      class="sb-narration-input"
      @blur="() => onSaveSbNarrationField(sb)"
    />
    <div v-if="(sbNarration[sb.id] || sb.narration || '').toString().trim()" class="sb-narration-actions">
      <ActionGate :reason="ttsGenerationDisabledReason(sb.id, 'narration')" label="解说配音">
        <el-button
          size="small"
          :loading="ttsSbNarrationIds.has(sb.id)"
          :disabled="Boolean(ttsGenerationDisabledReason(sb.id, 'narration'))"
          :title="ttsSbNarrationIds.has(sb.id) ? '正在生成解说配音，请稍候' : (ttsGenerationDisabledReason(sb.id, 'narration') || undefined)"
          @click="onTtsSbNarration(sb)"
        >
          解说配音
        </el-button>
      </ActionGate>
      <el-tooltip v-if="sbNarrationAudioRelPath(sb)" content="播放解说旁白配音" placement="top">
        <el-button size="small" :aria-label="`播放分镜${sb.storyboard_number || i + 1}解说旁白配音`" @click="playSbNarrationTts(sb)">
          <el-icon><VideoPlay /></el-icon>
        </el-button>
      </el-tooltip>
    </div>
  </template>
</div>
</template>

<script setup>
import { Plus, VideoPlay } from '@element-plus/icons-vue'
import ActionGate from '@/components/filmCreate/ActionGate.vue'

defineOptions({ inheritAttrs: false })

defineProps({
  sb: { type: Object, required: true },
  i: { type: Number, required: true },
  characters: { type: Array, default: () => [] },
  scenes: { type: Array, default: () => [] },
  propItems: { type: Array, default: () => [] },
  sbSceneId: { type: Object, default: () => ({}) },
  sbNarration: { type: Object, default: () => ({}) },
  storyboardUseFirstLastFrame: { type: Boolean, default: false },
  storyboardIncludeNarration: { type: Boolean, default: false },
  ttsSbNarrationIds: { type: [Set, Object], default: () => new Set() },
  assetImageUrl: { type: Function, required: true },
  charactersAvailableToAddToSb: { type: Function, required: true },
  getSbCharacterIds: { type: Function, required: true },
  getSbPropIds: { type: Function, required: true },
  getSbSelectedCharacters: { type: Function, required: true },
  getSbSelectedProps: { type: Function, required: true },
  getSbSelectedScene: { type: Function, required: true },
  hasAssetImage: { type: Function, required: true },
  onOpenSbPromptDialog: { type: Function, required: true },
  onSaveSbNarrationField: { type: Function, required: true },
  onSbAddCharacterCommand: { type: Function, required: true },
  onStoryboardSceneChange: { type: Function, required: true },
  onTtsSbNarration: { type: Function, required: true },
  openImagePreview: { type: Function, required: true },
  playSbNarrationTts: { type: Function, required: true },
  sbNarrationAudioRelPath: { type: Function, required: true },
  setSbCharacterIds: { type: Function, required: true },
  setSbPropIds: { type: Function, required: true },
  ttsGenerationDisabledReason: { type: Function, required: true },
})
</script>

<style scoped src="./FilmCreateStoryboardScriptColumn.css"></style>
