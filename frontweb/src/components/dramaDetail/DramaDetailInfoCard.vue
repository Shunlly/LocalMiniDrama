<template>
      <!-- 基本信息 + 设置 -->
      <section class="section card">
        <div class="section-header section-header--info">
          <div class="section-title">剧集信息</div>
          <div
            class="info-save-status"
            :class="`is-${infoSaveState}`"
            :role="infoSaveState === 'error' ? 'alert' : 'status'"
            aria-live="polite"
          >
            <el-icon v-if="infoSaveState === 'saving' || infoSaveScheduled" class="is-loading"><Loading /></el-icon>
            <el-icon v-else-if="infoSaveState === 'error'"><WarningFilled /></el-icon>
            <span>{{ infoSaveStatusLabel }}</span>
            <el-button v-if="infoSaveState === 'error'" link type="primary" @click="emit('retry-save')">
              重试
            </el-button>
          </div>
        </div>
        <el-form :model="infoForm" label-width="110px" label-position="left" class="info-form">
          <el-row :gutter="24">
            <el-col :span="12">
              <el-form-item label="标题">
                <el-input v-model="infoForm.title" placeholder="剧集标题" aria-label="剧集标题" @blur="emit('save')" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="图片/视频风格">
                <el-select v-model="infoForm.style" placeholder="选择全剧统一风格" aria-label="图片/视频风格" clearable style="width: 100%" @change="emit('save')">
                  <el-option-group label="写实 / 影视">
                    <el-option label="写实" value="realistic" />
                    <el-option label="电影感" value="cinematic" />
                    <el-option label="纪录片" value="documentary" />
                    <el-option label="黑色电影" value="noir" />
                    <el-option label="复古胶片" value="retro film" />
                    <el-option label="恐怖" value="horror" />
                  </el-option-group>
                  <el-option-group label="动漫 / 卡通">
                    <el-option label="日本动漫" value="anime style" />
                    <el-option label="欧美漫画" value="comic style" />
                    <el-option label="卡通" value="cartoon" />
                  </el-option-group>
                  <el-option-group label="中国风格">
                    <el-option label="国画水墨" value="ink wash" />
                    <el-option label="中国风" value="chinese style" />
                    <el-option label="古装" value="historical" />
                    <el-option label="武侠" value="wuxia" />
                  </el-option-group>
                  <el-option-group label="绘画艺术">
                    <el-option label="水彩" value="watercolor" />
                    <el-option label="油画" value="oil painting" />
                    <el-option label="素描" value="sketch" />
                    <el-option label="版画" value="woodblock print" />
                    <el-option label="印象派" value="impressionist" />
                  </el-option-group>
                  <el-option-group label="幻想 / 科幻">
                    <el-option label="奇幻" value="fantasy" />
                    <el-option label="暗黑奇幻" value="dark fantasy" />
                    <el-option label="科幻" value="sci-fi" />
                    <el-option label="赛博朋克" value="cyberpunk" />
                    <el-option label="蒸汽朋克" value="steampunk" />
                    <el-option label="末世废土" value="post-apocalyptic" />
                  </el-option-group>
                  <el-option-group label="数字 / 现代">
                    <el-option label="3D 渲染" value="3d render" />
                    <el-option label="像素风" value="pixel art" />
                    <el-option label="低多边形" value="low poly" />
                    <el-option label="极简" value="minimalist" />
                    <el-option label="唯美梦幻" value="dreamy" />
                  </el-option-group>
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="画面比例">
                <el-select v-model="infoForm.aspect_ratio" aria-label="画面比例" style="width: 100%" @change="emit('save')">
                  <el-option label="16:9 横屏（默认）" value="16:9" />
                  <el-option label="9:16 竖屏（短视频）" value="9:16" />
                  <el-option label="3:4 竖版" value="3:4" />
                  <el-option label="1:1 方形" value="1:1" />
                  <el-option label="4:3 传统横屏" value="4:3" />
                  <el-option label="21:9 宽银幕" value="21:9" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="故事梗概">
                <el-input v-model="infoForm.description" type="textarea" :rows="3" placeholder="一句话描述故事梗概" aria-label="故事梗概" @blur="emit('save')" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </section>
</template>

<script setup>
import { Loading, WarningFilled } from '@element-plus/icons-vue'

// 剧集信息卡只负责展示，保存与重试仍由页面处理

defineProps({
  infoForm: { type: Object, required: true },
  infoSaveState: { type: String, default: 'saved' },
  infoSaveScheduled: { type: Boolean, default: false },
  infoSaveStatusLabel: { type: String, default: '' },
})

const emit = defineEmits(['save', 'retry-save'])
</script>

<style scoped>
.section.card {
  background: rgba(24, 24, 27, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 16px;
  padding: 20px 24px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
  transition: box-shadow 0.3s, border-color 0.3s;
}
.section.card:hover {
  border-color: rgba(139, 92, 246, 0.25);
  box-shadow: 0 6px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(139, 92, 246, 0.08);
}
html.light .section.card {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(139, 92, 246, 0.15);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.06);
}
html.light .section.card:hover {
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 6px 28px rgba(139, 92, 246, 0.1);
}
.section-title { font-size: 1rem; font-weight: 600; color: #fafafa; margin-bottom: 16px; }
html.light .section-title { color: #18181b; }
html.light .info-save-status {
  border-color: rgba(99, 102, 241, 0.18);
  color: #4b5563;
  background: rgba(255, 255, 255, 0.9);
}
html.light .info-save-status.is-saved { color: #166534; border-color: rgba(34, 197, 94, 0.24); }
html.light .info-save-status.is-saving { color: #1d4ed8; border-color: rgba(59, 130, 246, 0.24); }
html.light .info-save-status.is-error { color: #b91c1c; border-color: rgba(239, 68, 68, 0.24); }
.section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.section-header .section-title { margin-bottom: 0; }
.section-header--info { justify-content: space-between; align-items: flex-start; }
.info-form { max-width: 100%; }
.info-save-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 6px 10px;
  border: 1px solid rgba(113, 113, 122, 0.35);
  border-radius: 999px;
  color: #d4d4d8;
  background: rgba(39, 39, 42, 0.72);
  font-size: 12px;
  line-height: 1.4;
}
.info-save-status.is-saved {
  border-color: rgba(74, 222, 128, 0.28);
  color: #86efac;
}
.info-save-status.is-saving {
  border-color: rgba(96, 165, 250, 0.28);
  color: #bfdbfe;
}
.info-save-status.is-error {
  border-color: rgba(248, 113, 113, 0.35);
  color: #fecaca;
}
</style>
