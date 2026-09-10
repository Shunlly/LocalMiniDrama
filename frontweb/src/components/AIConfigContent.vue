<template>
  <div class="ai-config-content">
    <el-tabs v-model="activeTab" class="config-tabs">
      <el-tab-pane label="AI 配置" name="configs">
        <div class="tab-content">
          <div
            v-if="configDependencyError"
            class="config-load-state config-load-state--error"
            role="alert"
            aria-live="assertive"
          >
            <div class="config-load-copy">
              <strong>AI 配置依赖加载失败</strong>
              <span>
                {{ configDependencyError }}
                <template v-if="configLoadError && list.length">当前显示的是上次成功加载的数据，写操作已暂停。</template>
              </span>
            </div>
            <el-button size="small" type="primary" plain :loading="loading || vendorLockLoading" @click="retryConfigDependencies">
              重试
            </el-button>
          </div>

          <div class="config-workspace-switch" role="tablist" aria-label="AI 配置工作区">
            <button
              ref="coverageWorkspaceModeRef"
              id="ai-config-mode-coverage"
              type="button"
              role="tab"
              class="config-workspace-mode"
              data-testid="ai-config-mode-coverage"
              :class="{ active: configWorkspaceView === 'coverage' }"
              :aria-selected="configWorkspaceView === 'coverage'"
              :tabindex="configWorkspaceView === 'coverage' ? 0 : -1"
              aria-controls="ai-config-coverage-panel"
              @click="selectConfigWorkspaceView('coverage')"
              @keydown="onConfigWorkspaceKeydown('coverage', $event)"
            >
              服务状态
            </button>
            <button
              ref="configsWorkspaceModeRef"
              id="ai-config-mode-configs"
              type="button"
              role="tab"
              class="config-workspace-mode"
              data-testid="ai-config-mode-configs"
              :class="{ active: configWorkspaceView === 'configs' }"
              :aria-selected="configWorkspaceView === 'configs'"
              :tabindex="configWorkspaceView === 'configs' ? 0 : -1"
              aria-controls="ai-config-configs-panel"
              @click="selectConfigWorkspaceView('configs')"
              @keydown="onConfigWorkspaceKeydown('configs', $event)"
            >
              配置管理
            </button>
          </div>

          <div
            id="ai-config-coverage-panel"
            v-show="configWorkspaceView === 'coverage'"
            class="config-workspace-panel"
            role="tabpanel"
            aria-labelledby="ai-config-mode-coverage"
          >
          <section class="coverage-panel" aria-labelledby="ai-service-coverage-title">
            <div class="coverage-header">
              <div>
                <div class="coverage-title-row">
                  <h2 id="ai-service-coverage-title">AI 服务配置与验证</h2>
                  <el-tag
                    v-if="!configListPendingEmpty && !configListFailedEmpty"
                    :type="serviceCoverage.ready ? 'success' : 'warning'"
                    size="small"
                    effect="light"
                  >
                    {{ serviceCoverage.readyCount }}/{{ serviceCoverage.totalCount }} 类可用
                  </el-tag>
                </div>
                <p>每类服务可用需启用默认配置；默认配置还需凭据、模型或工作流完整。上方统计只看五类正式制作服务。</p>
              </div>
              <span class="coverage-test-note">连接测试结果来自后端记录或此设备保存的最近结果</span>
            </div>
            <div
              v-if="configListPendingEmpty"
              class="coverage-unresolved-state"
              role="status"
              aria-live="polite"
            >
              正在读取 AI 配置...
            </div>
            <div
              v-else-if="configListFailedEmpty"
              class="coverage-unresolved-state coverage-unresolved-state--error"
              role="alert"
            >
              <div class="coverage-unresolved-copy">
                <strong>暂时无法确认服务状态</strong>
                <span>配置列表还没有成功加载，当前不能判断五类服务是否已配置。</span>
              </div>
              <el-button size="small" type="primary" plain :loading="loading || vendorLockLoading" @click="retryConfigDependencies">
                重试
              </el-button>
            </div>
            <template v-else>
            <div class="coverage-summary-strip">
              <div
                v-for="card in coverageSummaryCards"
                :key="card.key"
                class="coverage-summary-card"
                :class="`summary-${card.tone}`"
              >
                <span>{{ card.label }}</span>
                <strong>{{ card.value }}</strong>
              </div>
            </div>
            <AiConfigCoverageCards
              :ordered-coverage-services="orderedCoverageServices"
              :ordered-extraction-coverage-services="orderedExtractionCoverageServices"
              :active-service-filter="activeServiceFilter"
              :coverage-actions="coverageActions"
              :is-coverage-action-testing="isCoverageActionTesting"
              :is-coverage-action-disabled="isCoverageActionDisabled"
              :set-coverage-card-ref="setCoverageCardRef"
              @select="onCoverageSelect"
              @action="onCoverageAction"
            />
            </template>
          </section>
          </div>

          <div
            id="ai-config-configs-panel"
            v-show="configWorkspaceView === 'configs'"
            class="config-workspace-panel config-management-panel"
            role="tabpanel"
            aria-labelledby="ai-config-mode-configs"
          >
          <!-- 普通模式操作栏 -->
          <div v-if="!vendorLock.enabled" class="content-actions">
            <div class="actions-left">
              <el-button type="primary" :disabled="configWriteLocked" @click="openAdd">
                <el-icon><Plus /></el-icon>
                添加配置
              </el-button>
              <el-button plain @click="exportConfigs">
                <el-icon><Download /></el-icon>
                导出配置
              </el-button>
              <el-button plain :disabled="configWriteLocked" @click="triggerImport">
                <el-icon><Upload /></el-icon>
                导入配置
              </el-button>
              <input ref="importFileRef" type="file" accept=".json" style="display:none" aria-hidden="true" tabindex="-1" :disabled="configWriteLocked" @change="importConfigs" />
              <el-button type="success" plain :disabled="configWriteLocked" @click="openOneKeyVolc">
                <el-icon><MagicStick /></el-icon>
                一键配置火山
              </el-button>
              <el-button type="success" plain :disabled="configWriteLocked" @click="openOneKeyAgnes">
                <el-icon><MagicStick /></el-icon>
                一键配置 Agnes
              </el-button>
              <el-button type="info" plain :disabled="configWriteLocked" @click="openOneKeyTongyi">
                <el-icon><MagicStick /></el-icon>
                一键配置通义
                <span class="one-key-not-recommended">不推荐</span>
              </el-button>
            </div>
            <div class="actions-right">
              <transition name="fade-slide">
                <el-button
                  v-if="selectedRows.length > 0"
                  type="danger"
                  :loading="batchDeleting"
                  :disabled="configWriteLocked"
                  @click="onBatchDelete"
                >
                  <el-icon><Delete /></el-icon>
                  删除选中 ({{ selectedRows.length }})
                </el-button>
              </transition>
            </div>
          </div>
          <!-- 锁定模式提示栏 -->
          <div v-else class="vendor-lock-bar">
            <el-alert
              type="info"
              :closable="false"
              class="vendor-lock-tip"
            >
              <template #title>
                <span>🔒 当前为厂商锁定模式，AI 服务由管理员统一配置。你只能修改 <b>API 密钥</b> 和 <b>默认模型</b>。</span>
              </template>
            </el-alert>
            <el-button plain size="small" @click="exportConfigs">
              <el-icon><Download /></el-icon>
              导出配置
            </el-button>
            <el-button type="primary" size="small" class="vendor-bulk-key-btn" :disabled="configWriteLocked" @click="openBulkKey">
              <el-icon><Key /></el-icon>
              一键换密钥
            </el-button>
          </div>
          <div v-if="activeServiceFilter" class="config-filter-bar">
            <span>
              当前只看：<strong>{{ serviceTypeLabel(activeServiceFilter) }}</strong>
              <span class="filter-count">{{ filteredList.length }} 条</span>
            </span>
            <el-button link type="primary" @click="clearServiceFilter">查看全部配置</el-button>
          </div>
          <p class="default-tip">生成任务会优先使用同类服务中已启用的默认配置。即梦2角色认证、认证资产库、图片识别和语音转写属于扩展能力，不计入上方五类基础生成服务。</p>
          <div ref="configListSectionRef" class="config-list-section">
          <el-table
            v-loading="loading"
            :data="filteredList"
            stripe
            style="width: 100%"
            @selection-change="onSelectionChange"
          >
            <el-table-column v-if="!vendorLock.enabled" type="selection" width="46" :selectable="isConfigRowSelectable" />
            <el-table-column prop="name" label="名称" min-width="220" show-overflow-tooltip />
            <el-table-column prop="provider" label="提供商" min-width="180" show-overflow-tooltip />
            <el-table-column prop="base_url" label="接口地址（Base URL）" min-width="170" show-overflow-tooltip />
            <el-table-column prop="default_model" label="默认模型" min-width="130" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.default_model || (Array.isArray(row.model) && row.model[0]) || '—' }}
              </template>
            </el-table-column>
            <el-table-column prop="service_type" label="类型" width="148">
              <template #default="{ row }">
                <span :class="['type-badge', 'type-' + row.service_type]">
                  <el-icon class="type-icon">
                    <ChatDotRound v-if="row.service_type === 'text'" />
                    <Picture v-else-if="row.service_type === 'image'" />
                    <Film v-else-if="row.service_type === 'storyboard_image'" />
                    <VideoCamera v-else-if="row.service_type === 'video'" />
                    <Microphone v-else-if="row.service_type === 'tts'" />
                    <Document v-else-if="row.service_type === 'ocr'" />
                    <Headset v-else-if="row.service_type === 'transcription'" />
                    <Key v-else-if="row.service_type === 'jimeng2_character_auth'" />
                    <Folder v-else-if="row.service_type === 'model_ark_asset'" />
                  </el-icon>
                  {{ serviceTypeLabel(row.service_type) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="is_default" label="默认" width="60">
              <template #default="{ row }">
                <el-tag v-if="row.is_default" type="success" size="small">✓</el-tag>
                <span v-else class="no-default">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" :aria-label="configActionLabel('测试', row)" @click="openTest(row)">测试</el-button>
                <el-button link type="primary" size="small" :disabled="configWriteLocked" :aria-label="configActionLabel(vendorLock.enabled ? '修改密钥' : '编辑', row)" @click="onRowEdit(row)">{{ vendorLock.enabled ? '修改密钥' : '编辑' }}</el-button>
                <el-button v-if="!vendorLock.enabled" link type="danger" size="small" :disabled="configWriteLocked" :aria-label="configActionLabel('删除', row)" @click="onDelete(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div class="config-empty-state">
                <el-icon class="config-empty-icon"><MagicStick /></el-icon>
                <strong>{{ configEmptyTitle }}</strong>
                <span>{{ configEmptyDescription }}</span>
                <div class="config-empty-actions">
                  <el-button
                    v-if="configListFailedEmpty"
                    type="primary"
                    size="small"
                    :loading="loading || vendorLockLoading"
                    @click="retryConfigDependencies"
                  >
                    重试
                  </el-button>
                  <el-button
                    v-else-if="!vendorLock.enabled && !configListPendingEmpty"
                    type="primary"
                    size="small"
                    :disabled="configWriteLocked"
                    @click="openAddForService(activeServiceFilter || 'text')"
                  >
                    <el-icon><Plus /></el-icon>
                    {{ activeServiceFilter ? `添加${serviceTypeLabel(activeServiceFilter)}配置` : '添加第一个配置' }}
                  </el-button>
                  <el-button v-if="activeServiceFilter && !configListFailedEmpty" size="small" @click="clearServiceFilter">查看全部</el-button>
                </div>
              </div>
            </template>
          </el-table>
          </div>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane v-if="hasSavedConfigs" label="高级设置（提示词）" name="prompts">
        <div class="tab-content">
          <PromptEditor ref="promptEditorRef" />
        </div>
      </el-tab-pane>
      <el-tab-pane v-if="hasSavedConfigs" label="高级设置（业务场景）" name="sceneModelMap">
        <div class="tab-content">
          <SceneModelMap ref="sceneModelMapRef" />
        </div>
      </el-tab-pane>
      <el-tab-pane label="生成设置" name="generation">
        <div class="tab-content generation-settings">
          <div class="gs-section-title">⚡ 一键生成并发设置</div>
          <p class="gs-desc">控制「一键生成视频」和「补全并生成」流水线中，各类任务同时并行生成的数量。并发数越高速度越快，但过高可能触发 API 限流（429 错误）。建议根据你的 API 额度选择。</p>

          <div
            v-if="generationSettingsLoadState === 'error'"
            class="generation-settings-load-state generation-settings-load-state--error"
            role="alert"
            aria-live="assertive"
          >
            <div class="generation-settings-load-copy">
              <strong>生成设置读取失败</strong>
              <span>{{ generationSettingsLoadError }}</span>
            </div>
            <el-button size="small" type="primary" plain @click="loadGenerationSettings">重试</el-button>
          </div>
          <div
            v-else-if="generationSettingsLoadState === 'loading'"
            class="generation-settings-load-state"
            role="status"
            aria-live="polite"
          >
            正在读取生成设置...
          </div>
          <template v-else>
          <div class="gs-row">
            <span class="gs-label">图片并发数</span>
            <el-select
              v-model="genConcurrencyInput"
              filterable
              allow-create
              default-first-option
              aria-label="图片并发数"
              placeholder="选择或输入并发数"
              no-data-text="暂无可选项，可直接输入"
              style="width: 180px"
              @change="onConcurrencyChange"
            >
              <el-option label="1（串行，最稳定）" :value="1" />
              <el-option label="2" :value="2" />
              <el-option label="3（默认）" :value="3" />
              <el-option label="5" :value="5" />
              <el-option label="8" :value="8" />
              <el-option label="10" :value="10" />
            </el-select>
            <span class="gs-unit">个任务同时生成</span>
          </div>

          <div class="gs-row" style="margin-top: 10px">
            <span class="gs-label">视频并发数</span>
            <el-select
              v-model="genVideoConcurrencyInput"
              filterable
              allow-create
              default-first-option
              aria-label="视频并发数"
              placeholder="选择或输入并发数"
              no-data-text="暂无可选项，可直接输入"
              style="width: 180px"
              @change="onVideoConcurrencyChange"
            >
              <el-option label="1（串行，最稳定）" :value="1" />
              <el-option label="2" :value="2" />
              <el-option label="3（默认）" :value="3" />
              <el-option label="5" :value="5" />
              <el-option label="8" :value="8" />
              <el-option label="10" :value="10" />
            </el-select>
            <span class="gs-unit">个任务同时生成</span>
          </div>

          <div style="margin-top: 14px">
            <el-button
              type="primary"
              size="small"
              aria-label="保存生成设置"
              :loading="genSettingSaving"
              :disabled="generationSettingsWriteLocked"
              @click="saveGenerationSettings"
            >保存</el-button>
          </div>
          <el-alert
            v-if="genSettingSaved"
            type="success"
            title="已保存"
            :closable="false"
            show-icon
            style="margin-top: 12px; width: fit-content"
          />
          </template>
          <div class="gs-tip-box">
            <div class="gs-tip-title">📌 适用范围</div>
            <ul class="gs-tip-list">
              <li>图片并发：步骤 2 角色图、步骤 4 场景图、步骤 6 分镜图</li>
              <li>视频并发：步骤 7 分镜视频</li>
            </ul>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane v-if="hasSavedConfigs" label="认证资产管理" name="sd2_assets">
        <div class="tab-content">
        <Sd2AssetManagement :configs="list" :write-locked="configWriteLocked || vendorLock.enabled" @saved="handleSd2AssetSaved" />
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 添加/编辑 -->
    <AccessibleDialog
      v-model="dialogVisible"
      :title="vendorLock.enabled ? '修改 API 密钥 / 默认模型' : (editingId ? '编辑配置' : '添加配置')"
      width="720px"
      top="4vh"
      class="ai-config-dialog ai-config-form-dialog ai-config-overlay"
      append-to-body
      :close-on-click-modal="false"
      :before-close="confirmConfigDialogClose"
      @closed="handleConfigDialogClosed"
    >
      <div ref="configDialogScrollRef" class="ai-config-dialog-scroll">
        <div
          v-if="configValidationSummary.length"
          class="ai-config-validation-summary"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <strong>无法保存，请检查以下字段：</strong>
          <ul>
            <li v-for="item in configValidationSummary" :key="item.prop">
              {{ configFieldDisplayLabel(item.label) }}：{{ item.message }}
            </li>
          </ul>
        </div>
      <!-- 锁定模式：只展示 api_key 和 default_model -->
      <template v-if="vendorLock.enabled">
        <el-descriptions :column="1" border style="margin-bottom: 16px">
          <el-descriptions-item label="名称">{{ form.name }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ serviceTypeLabel(form.service_type) }}</el-descriptions-item>
          <el-descriptions-item label="厂商">{{ form.provider }}</el-descriptions-item>
        </el-descriptions>
        <el-form ref="formRef" :model="form" label-width="100px" @validate="handleConfigFieldValidated">
          <el-form-item prop="api_key" :rules="[{ required: true, message: '请输入 API 密钥', trigger: 'blur' }]">
            <template #label><span class="form-label-tip">API 密钥</span></template>
            <el-input
              ref="apiKeyInputRef"
              v-model="form.api_key"
              data-ai-config-field="api_key"
              type="password"
              :placeholder="form.provider === 'jimeng_ai_api' ? '即梦 Session，多个用英文逗号分隔' : '输入你的 API 密钥'"
              show-password
              :aria-invalid="isConfigFieldInvalid('api_key')"
              :aria-describedby="configFieldDescriptionId('api_key')"
            />
            <span :id="configFieldDescriptionId('api_key')" class="config-field-a11y-description">
              {{ configFieldDescription('api_key') }}
            </span>
          </el-form-item>
          <el-form-item prop="default_model" :rules="defaultModelRules">
            <template #label><span class="form-label-tip">默认模型</span></template>
            <el-select
              v-model="form.default_model"
              data-ai-config-field="default_model"
              clearable
              filterable
              default-first-option
              aria-label="默认模型"
              placeholder="搜索或选择已有模型"
              no-data-text="暂无可用模型"
              style="width: 100%"
              :aria-invalid="isConfigFieldInvalid('default_model') || isDefaultModelUnavailable"
              :aria-describedby="configFieldDescriptionId('default_model')"
            >
              <el-option
                v-if="isDefaultModelUnavailable"
                :label="`${form.default_model}（已失效）`"
                :value="form.default_model"
                disabled
              />
              <el-option v-for="m in formModelList" :key="m" :label="m" :value="m" />
            </el-select>
            <p v-if="isDefaultModelUnavailable" class="field-tip field-tip-warning" role="alert">
              当前默认模型已不在模型列表中，请显式选择有效模型后保存。
            </p>
            <p v-else class="field-tip">实际调用时使用的模型，可搜索已有模型名。锁定模式下不能新增模型列表。</p>
            <span :id="configFieldDescriptionId('default_model')" class="config-field-a11y-description">
              {{ configFieldDescription('default_model') }}
            </span>
          </el-form-item>
          <el-form-item>
            <template #label>
              <span class="form-label-tip">设为默认
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      每种服务类型只有一个「默认」配置。<br>
                      生成时系统会优先使用默认配置，建议每类至少设一个默认。
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-switch v-model="form.is_default" :disabled="configWriteLocked" />
          </el-form-item>
        </el-form>
      </template>

      <!-- 普通模式：完整表单 -->
      <el-form v-else ref="formRef" :model="form" :rules="rules" label-width="100px" @validate="handleConfigFieldValidated">
        <section class="config-form-section">
          <div class="config-section-header">
            <div>
              <h4>基础信息</h4>
              <p>先确定服务用途和便于识别的配置名称。</p>
            </div>
            <span class="config-section-index">01</span>
          </div>
        <el-form-item prop="service_type">
          <template #label>
            <span class="form-label-tip">服务类型
              <el-tooltip placement="top" :show-arrow="true" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    <b>文本/对话</b>：用于 AI 生成故事剧本<br>
                    <b>文本生成图片</b>：角色、场景、道具的图片生成（不支持参考图）<br>
                    <b>分镜图片生成</b>：生成分镜图片，支持传入角色参考图<br>
                    <b>视频生成</b>：根据分镜图生成视频片段<br>
                    <b>语音合成 TTS</b>：为分镜对白自动合成语音（点分镜配音按钮时使用）<br>
                    <b>图片识别 OCR</b>：用于 PDF、扫描件和图片抽文字。本机也可安装 Tesseract。预设只用于填表，不代表已跑通该厂商<br>
                    <b>语音转写</b>：用于音频、视频对白转成文字。预设只用于填表，不代表已跑通该厂商<br>
                    <b>即梦2角色认证</b>：将角色主图登记到即梦业务素材库（认证资产），仅填网关 URL 与 Token
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-select
            v-model="form.service_type"
            data-ai-config-field="service_type"
            aria-label="服务类型"
            placeholder="选择类型"
            no-data-text="暂无可选服务类型"
            style="width: 100%"
            :disabled="Boolean(editingId)"
            :aria-invalid="isConfigFieldInvalid('service_type')"
            :aria-describedby="configFieldDescriptionId('service_type')"
            @change="onServiceTypeChange"
          >
            <el-option label="文本/对话" value="text" />
            <el-option label="文本生成图片" value="image" />
            <el-option label="分镜图片生成" value="storyboard_image" />
            <el-option label="视频生成" value="video" />
            <el-option label="语音合成 TTS" value="tts" />
            <el-option label="图片识别 OCR" value="ocr" />
            <el-option label="语音转写" value="transcription" />
            <el-option label="即梦2角色认证" value="jimeng2_character_auth" />
          </el-select>
          <span :id="configFieldDescriptionId('service_type')" class="config-field-a11y-description">
            {{ configFieldDescription('service_type') }}
          </span>
        </el-form-item>
        <el-form-item prop="name">
          <template #label>
            <span class="form-label-tip">名称
              <el-tooltip content="配置的显示名，用于在列表中区分不同配置，选择厂商后可自动生成。" placement="top" popper-class="cfg-tip-popper">
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input
            v-model="form.name"
            data-ai-config-field="name"
            placeholder="如：OpenAI 图文，可自动生成"
            :aria-invalid="isConfigFieldInvalid('name')"
            :aria-describedby="configFieldDescriptionId('name')"
          />
          <span :id="configFieldDescriptionId('name')" class="config-field-a11y-description">
            {{ configFieldDescription('name') }}
          </span>
        </el-form-item>
        </section>

        <section class="config-form-section">
          <div class="config-section-header">
            <div>
              <h4>厂商与认证</h4>
              <p>选择预设厂商可自动带入中文名称、Base URL 和常用模型，也支持自定义兼容服务。预设只用于填表，不代表对应厂商已在本应用中真实跑通生成。</p>
            </div>
            <span class="config-section-index">02</span>
          </div>
        <el-form-item prop="provider">
          <template #label>
            <span class="form-label-tip">厂商
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    从下拉选择预设厂商，会自动填入 Base URL 和模型列表。<br>
                    覆盖 OpenRouter、硅基流动、Moonshot、DeepSeek、智谱、MiniMax、可灵、Runway、Luma、Ollama、ComfyUI 等常见目录。<br>
                    也可选择「自定义」并直接输入厂商名（需手动填写其他字段）。<br>
                    <b>推荐</b>：通义千问 / 火山引擎 / 硅基流动，国内访问较稳。预设不代表已真实接入生成。
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-select
            v-model="form.provider"
            data-ai-config-field="provider"
            aria-label="厂商"
            placeholder="选择预设厂商（自动填充 URL 和模型）"
            no-data-text="没有匹配的厂商，可直接输入自定义名称"
            clearable
            filterable
            allow-create
            default-first-option
            style="width: 100%"
            :aria-invalid="isConfigFieldInvalid('provider')"
            :aria-describedby="configFieldDescriptionId('provider')"
            @change="onProviderChange"
          >
            <el-option
              v-for="p in availableProviderOptions"
              :key="p.id"
              :label="p.name"
              :value="p.id"
              :class="p.id === '__custom__' ? 'provider-custom-option' : ''"
            />
          </el-select>
          <span :id="configFieldDescriptionId('provider')" class="config-field-a11y-description">
            {{ configFieldDescription('provider') }}
          </span>
        </el-form-item>

        <!-- 接口规范帮助 Dialog -->
        <AccessibleDialog v-model="showProtocolHelp" title="接口规范说明" width="700px" top="5vh" class="ai-config-overlay">
          <AiConfigPresetHelpCollapse />
          <template #footer>
            <el-button @click="showProtocolHelp = false">关闭</el-button>
          </template>
        </AccessibleDialog>
        <el-form-item prop="api_key">
          <template #label>
            <span class="form-label-tip">{{ form.service_type === 'jimeng2_character_auth' ? '令牌（Token）' : 'API 密钥' }}
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    <template v-if="form.service_type === 'jimeng2_character_auth'">
                      素材库要求的 <code>Authorization: Bearer …</code> Token，由网关或即梦侧签发。
                    </template>
                    <template v-else>
                      在对应 AI 平台申请的密钥，用于身份验证。<br>
                      通义：<b>dashscope.aliyuncs.com</b><br>
                      火山：<b>console.volcengine.com/ark</b>
                    </template>
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input
            ref="apiKeyInputRef"
            v-model="form.api_key"
            data-ai-config-field="api_key"
            type="password"
            :placeholder="form.service_type === 'jimeng2_character_auth' ? '请输入 Bearer 令牌' : (form.provider === 'jimeng_ai_api' ? '即梦 Session，多个用英文逗号分隔' : 'API 密钥')"
            show-password
            :aria-invalid="isConfigFieldInvalid('api_key')"
            :aria-describedby="configFieldDescriptionId('api_key')"
          />
          <span :id="configFieldDescriptionId('api_key')" class="config-field-a11y-description">
            {{ configFieldDescription('api_key') }}
          </span>
        </el-form-item>
        <el-form-item v-if="form.service_type === 'jimeng2_character_auth'">
          <template #label><span class="form-label-tip">素材列表</span></template>
          <div class="jimeng2-assets-actions">
            <el-button type="primary" plain :loading="jimeng2AssetsLoading" @click="openJimeng2MaterialAssetsDialog">
              列出素材
            </el-button>
            <span class="field-tip jimeng2-assets-tip">
              调用网关
              <code>GET /api/business/v1/assets</code>
              ，与
              <a href="https://83zi.com/sd2realperson.html" target="_blank" rel="noopener noreferrer">素材管理 API 文档</a>
              一致（使用当前表单中的网关 URL 与 Token，无需先保存）。
            </span>
          </div>
        </el-form-item>
        <el-alert
          v-if="form.service_type === 'jimeng2_character_auth'"
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 12px"
          title="用于创作页「角色」面板的「认证资产」"
          description="保存后，系统从此处读取网关与 Token 调用 POST /api/business/v1/assets 登记角色图；可用「列出素材」核对素材状态。角色主图需为外网可访问的 http(s) 地址（图床或本服务 storage.base_url）。"
        />
        <template v-if="form.service_type === 'video' && form.api_protocol === 'kling_omni'">
          <el-form-item>
            <template #label><span class="form-label-tip">访问密钥（AccessKey）</span></template>
            <el-input
              v-model="form.kling_access_key"
              type="password"
              show-password
              placeholder="可灵开放平台 AccessKey（与 SecretKey 成对，可不填上方 API Key）"
              autocomplete="off"
            />
            <p class="field-tip">
              官方 JWT 规则见
              <a href="https://klingai.com/document-api/apiReference/commonInfo" target="_blank" rel="noopener noreferrer">commonInfo</a>
              （<a href="https://app.klingai.com/cn/dev/document-api/apiReference/commonInfo" target="_blank" rel="noopener noreferrer">中文版</a>）。
              后端使用与官方示例一致的 HS256（<code>iss</code>=AccessKey，<code>exp</code>、<code>nbf</code>）生成 Token。
              若接口返回签名无效（错误码 <code>1000 Authorization signature is invalid</code>）：请确认访问密钥和私有密钥未填反、无多余空格；并尝试勾选下方「私有密钥为 Base64」；
              Base URL 区域（<code>api-beijing.klingai.com</code> / <code>api-singapore.klingai.com</code>）须与密钥所属区域一致。
            </p>
          </el-form-item>
          <el-form-item>
            <template #label><span class="form-label-tip">私有密钥（SecretKey）</span></template>
            <el-input
              v-model="form.kling_secret_key"
              type="password"
              show-password
              placeholder="可灵开放平台 SecretKey"
              autocomplete="off"
            />
            <el-checkbox v-model="form.kling_secret_key_base64" style="margin-top: 8px; display: block">
              SecretKey 为 Base64 字符串（解码后的二进制再用于签名；若仍报签名无效可切换此项重试）
            </el-checkbox>
            <p class="field-tip">
              官方域名：<code>POST {base}/v1/videos/omni-video</code>，轮询
              <code>GET {base}/v1/videos/omni-video/{taskId}</code>；飞儿等中转仍为
              <code>/kling/v1/videos/omni-video</code> 与
              <code>/kling/v1/images/omni-image/{taskId}</code>。详见
              <a href="https://klingai.com/document-api/apiReference/model/OmniVideo" target="_blank" rel="noopener noreferrer">OmniVideo</a>。
            </p>
          </el-form-item>
        </template>
        <!-- TTS 专属字段：声音 ID 和 MiniMax Group ID -->
        <template v-if="form.service_type === 'tts'">
          <el-form-item>
            <template #label>
              <span class="form-label-tip">声音 ID
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      TTS 合成使用的音色 ID。<br>
                      <b>MiniMax 常用音色：</b><br>
                      female-shaonv（少女）、female-chengshu（成熟）<br>
                      male-qingxin（清新男）、male-zhicheng（知城男）<br>
                      audiobook_female_2（有声书女）、audiobook_male_1（有声书男）
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-select
              v-model="form.voice_id"
              filterable
              allow-create
              default-first-option
              aria-label="声音 ID"
              placeholder="选择或输入声音 ID"
              no-data-text="暂无预设声音，可直接输入"
              style="width: 100%"
            >
              <el-option-group label="MiniMax 女声">
                <el-option label="female-shaonv（少女）" value="female-shaonv" />
                <el-option label="female-chengshu（成熟）" value="female-chengshu" />
                <el-option label="female-tianmei（甜美）" value="female-tianmei" />
                <el-option label="audiobook_female_2（有声书）" value="audiobook_female_2" />
              </el-option-group>
              <el-option-group label="MiniMax 男声">
                <el-option label="male-qingxin（清新）" value="male-qingxin" />
                <el-option label="male-zhicheng（知城）" value="male-zhicheng" />
                <el-option label="audiobook_male_1（有声书）" value="audiobook_male_1" />
              </el-option-group>
            </el-select>
            <p class="field-tip">MiniMax 必填；不填默认 female-shaonv。</p>
          </el-form-item>
          <el-form-item>
            <template #label>
              <span class="form-label-tip">组 ID（GroupId）
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      MiniMax 账号的 GroupId，调用 T2A v2 接口时附在 URL 参数里。<br>
                      登录 <b>platform.minimaxi.com</b> → 账户设置 → 即可查看 GroupId。
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-input v-model="form.group_id" placeholder="MiniMax GroupId，如 1234567890" />
            <p class="field-tip">仅 MiniMax T2A 需要此字段。</p>
          </el-form-item>
        </template>
        </section>

        <el-collapse v-model="advancedFormSections" class="advanced-config-collapse">
          <el-collapse-item name="endpoint">
            <template #title>
              <div class="advanced-config-title">
                <span>
                  <strong>高级接口设置</strong>
                  <small>Base URL、接口规范及自定义端点</small>
                </span>
                <el-tag size="small" type="info" effect="plain">一般无需修改</el-tag>
              </div>
            </template>
            <div class="advanced-config-content">
              <!-- 接口规范：仅图片/分镜/视频类型显示；文本、语音、图片识别、语音转写按 OpenAI 兼容处理 -->
              <el-form-item
                v-if="!hidesApiProtocolField(form.service_type)"
                prop="api_protocol"
              >
                <template #label>
                  <span class="form-label-tip">接口规范
                    <button type="button" class="tip-button" aria-label="查看接口规范说明" title="查看接口规范说明" @click.stop="showProtocolHelp = true">
                      <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                    </button>
                  </span>
                </template>
                <el-select
                  v-model="form.api_protocol"
                  data-ai-config-field="api_protocol"
                  aria-label="接口规范"
                  style="width: 100%"
                  placeholder="选择接口规范（自定义厂商必选）"
                  no-data-text="暂无匹配的接口规范"
                  clearable
                  :aria-invalid="isConfigFieldInvalid('api_protocol')"
                  :aria-describedby="configFieldDescriptionId('api_protocol')"
                >
                  <el-option label="OpenAI 兼容（大多数中转站默认）" value="openai" />
                  <el-option label="火山引擎（豆包 Seedream / Seedance）" value="volcengine" />
                  <el-option label="火山即梦 Seedance 全能（方舟多图参考，Seedance 2.0 等）" value="volcengine_omni" />
                  <el-option label="通义万象 DashScope" value="dashscope" />
                  <el-option label="Google Gemini（图片 / Veo 视频）" value="gemini" />
                  <el-option label="Sora 中转站（multipart/form-data，seconds+size）" value="sora" />
                  <el-option label="Veo3 兼容（JSON，images+enhance_prompt，自动翻译英文）" value="veo3" />
                  <el-option label="Vidu 视频" value="vidu" />
                  <el-option label="可灵 Omni-Video（官方 api-beijing / ffir 中转，O1 全能）" value="kling_omni" />
                  <el-option label="xAI Grok Imagine（官方 prompt + aspect_ratio，/v1/videos/generations）" value="xai" />
                  <el-option label="NanoBanana（图像）" value="nano_banana" />
                  <el-option label="Fal.ai" value="fal" />
                  <el-option label="Replicate" value="replicate" />
                  <el-option label="ComfyUI 本地工作流" value="comfyui" />
                </el-select>
                <span :id="configFieldDescriptionId('api_protocol')" class="config-field-a11y-description">
                  {{ configFieldDescription('api_protocol') }}
                </span>
              </el-form-item>
              <el-form-item prop="base_url">
                <template #label>
                  <span class="form-label-tip">{{ form.service_type === 'jimeng2_character_auth' ? '网关 URL' : '接口地址（Base URL）' }}
                    <el-tooltip placement="top" popper-class="cfg-tip-popper">
                      <template #content>
                        <div class="cfg-tip-content">
                          <template v-if="form.service_type === 'jimeng2_character_auth'">
                            即梦业务素材库网关的<b>根地址</b>（不含 <code>/api/business/v1</code> 路径）。须与素材库实际部署一致。
                          </template>
                          <template v-else>
                            API 接口地址，选择预设厂商后自动填入，一般无需修改。<br>
                            示例：https://dashscope.aliyuncs.com
                          </template>
                        </div>
                      </template>
                      <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                    </el-tooltip>
                  </span>
                </template>
                <el-input
                  v-model="form.base_url"
                  data-ai-config-field="base_url"
                  :placeholder="form.service_type === 'jimeng2_character_auth' ? '如 https://your-gateway.com' : '选择预设厂商后自动填充，可修改'"
                  :aria-invalid="isConfigFieldInvalid('base_url')"
                  :aria-describedby="configFieldDescriptionId('base_url')"
                />
                <span :id="configFieldDescriptionId('base_url')" class="config-field-a11y-description">
                  {{ configFieldDescription('base_url') }}
                </span>
              </el-form-item>

              <el-form-item v-if="canConfigureLocalHttp" label="本地 HTTP">
                <el-switch v-model="form.allow_local_http" />
                <p class="field-tip">仅用于明确选择的本地或内网网关；公网服务仍需使用 HTTPS。</p>
              </el-form-item>

              <el-form-item v-if="isComfyUiForm" prop="comfy_workflow_json" label="工作流 JSON">
                <el-input
                  ref="workflowInputRef"
                  v-model="form.comfy_workflow_json"
                  class="comfy-workflow-input"
                  data-ai-config-field="comfy_workflow_json"
                  type="textarea"
                  :rows="10"
                  resize="vertical"
                  spellcheck="false"
                  placeholder='{"1":{"class_type":"KSampler","inputs":{}}}'
                  :aria-invalid="isConfigFieldInvalid('comfy_workflow_json')"
                  :aria-describedby="configFieldDescriptionId('comfy_workflow_json')"
                />
                <span :id="configFieldDescriptionId('comfy_workflow_json')" class="config-field-a11y-description">
                  {{ configFieldDescription('comfy_workflow_json') }}
                </span>
              </el-form-item>

        <!-- 端点配置：视频必填（自定义厂商）；图片/分镜在使用代理或特殊厂商时填写 -->
        <template v-if="!hidesApiProtocolField(form.service_type)">
          <el-form-item prop="endpoint">
            <template #label>
              <span class="form-label-tip">提交端点
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      接口路径，追加在 Base URL 之后。<br>
                      <b>预设厂商</b>（火山 / 通义 / NanoBanana）留空，系统自动推断。<br>
                      <b>视频自定义厂商</b>必须填写，如 /v1/videos/generations<br>
                      <b>NanoBanana 代理</b>填写代理路径，如 /fal-ai/nano-banana
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-input
              v-model="form.endpoint"
              data-ai-config-field="endpoint"
              :placeholder="form.service_type === 'video' ? '自定义视频厂商必填，如 /v1/videos/generations；预设厂商留空' : '代理或特殊厂商时填写，如 /fal-ai/nano-banana；预设厂商留空'"
              :aria-invalid="isConfigFieldInvalid('endpoint')"
              :aria-describedby="configFieldDescriptionId('endpoint')"
            />
            <span :id="configFieldDescriptionId('endpoint')" class="config-field-a11y-description">
              {{ configFieldDescription('endpoint') }}
            </span>
          </el-form-item>
          <el-form-item>
            <template #label>
              <span class="form-label-tip">查询端点
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      查询任务状态的接口路径，{taskId} 会被替换为实际任务 ID。<br>
                      <b>预设厂商</b>留空即可，由系统自动推断。<br>
                      <b>视频自定义厂商</b>必须填写，如 /v1/video/tasks/{taskId}<br>
                      <b>图片/NanoBanana</b> 代理若不支持轮询可留空
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-input v-model="form.query_endpoint" placeholder="自定义视频厂商必填，如 /v1/video/tasks/{taskId}；预设厂商留空" />
          </el-form-item>
        </template>

        <!-- 接口地址预览：选择厂商/协议后自动展示，帮助用户核对 -->
        <div v-if="endpointPreviewInfo" class="endpoint-preview-box" :class="{ 'ep-box-gemini': endpointPreviewInfo.isGemini }">
          <div class="ep-preview-header">
            <span>📌 系统将使用以下接口地址</span>
            <span v-if="endpointPreviewInfo.isGemini" class="ep-auto-badge ep-badge-gemini">Gemini 固定模式</span>
            <span v-else-if="endpointPreviewInfo.isJimeng2Auth" class="ep-auto-badge">即梦2角色认证</span>
            <span v-else-if="endpointPreviewInfo.isAuto && form.service_type !== 'text'" class="ep-auto-badge">自动推断</span>
          </div>
          <div class="ep-row">
            <span class="ep-label">提交地址：</span>
            <code class="ep-url">{{ endpointPreviewInfo.submit }}</code>
          </div>
          <div v-if="endpointPreviewInfo.query" class="ep-row">
            <span class="ep-label">查询地址：</span>
            <code class="ep-url">{{ endpointPreviewInfo.query }}</code>
          </div>
          <p v-if="endpointPreviewInfo.isGemini" class="ep-tip ep-tip-warn">
            ⚠️ Gemini 端点由系统根据模型名固定生成，上方「提交端点」和「查询端点」字段对 Gemini 无效，填了也不生效。
          </p>
          <p v-else-if="endpointPreviewInfo.isJimeng2Auth" class="ep-tip">角色「认证资产」将调用上述地址注册素材（POST 创建、GET 查询状态）。</p>
          <p v-else class="ep-tip">以上为系统推断的实际调用地址（可手动填写上方端点字段来覆盖）</p>
        </div>
            </div>
          </el-collapse-item>
        </el-collapse>

        <section v-if="form.service_type !== 'jimeng2_character_auth'" class="config-form-section">
          <div class="config-section-header">
            <div>
              <h4>模型</h4>
              <p>维护该厂商可用模型，并指定生成任务实际使用的默认模型。</p>
            </div>
            <span class="config-section-index">03</span>
          </div>
        <template v-if="form.service_type !== 'jimeng2_character_auth'">
        <AiConfigModelListSection
          :form="form"
          v-model:preset-model-pick="presetModelPick"
          :available-models="availableModels"
          :discover-models-loading="discoverModelsLoading"
          :discover-models-disabled="discoverModelsDisabled"
          :discover-models-disabled-reason="discoverModelsDisabledReason"
          :provider-model-empty-hint="providerModelEmptyHint"
          :is-config-field-invalid="isConfigFieldInvalid"
          :config-field-description-id="configFieldDescriptionId"
          :config-field-description="configFieldDescription"
          :set-model-list-input-ref="setModelListInputRef"
          :discover-models-from-service="discoverModelsFromService"
          :on-preset-model-select="onPresetModelSelect"
        />
        <el-form-item prop="default_model">
          <template #label>
            <span class="form-label-tip">默认模型
              <el-tooltip content="有多个模型时，实际调用哪个进行生成。建议选响应快、效果好的那个。" placement="top" popper-class="cfg-tip-popper">
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-select
            v-model="form.default_model"
            data-ai-config-field="default_model"
            aria-label="默认模型"
            placeholder="选择或输入默认模型名"
            no-data-text="暂无模型，可直接输入或先填写模型列表"
            clearable
            filterable
            allow-create
            default-first-option
            style="width: 100%"
            :aria-invalid="isConfigFieldInvalid('default_model') || isDefaultModelUnavailable"
            :aria-describedby="configFieldDescriptionId('default_model')"
            @change="onDefaultModelChange"
          >
            <el-option
              v-if="isDefaultModelUnavailable"
              :label="`${form.default_model}（已失效）`"
              :value="form.default_model"
              disabled
            />
            <el-option v-for="m in formModelList" :key="m" :label="m" :value="m" />
          </el-select>
          <p v-if="isDefaultModelUnavailable" class="field-tip field-tip-warning" role="alert">
            当前默认模型已不在模型列表中，请显式选择有效模型后保存。
          </p>
          <p v-else class="field-tip">可搜索已有模型，也可直接输入自定义模型名；输入后会加入上方模型列表。</p>
          <span :id="configFieldDescriptionId('default_model')" class="config-field-a11y-description">
            {{ configFieldDescription('default_model') }}
          </span>
        </el-form-item>
        <el-form-item v-if="isDeepSeekOfficialForm">
          <template #label>
            <span class="form-label-tip">思考模式
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    DeepSeek V4 官方模型用 thinking 参数控制思考模式。<br>
                    关闭思考对应旧 deepseek-chat；开启思考对应旧 deepseek-reasoner。
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <div class="deepseek-settings">
            <el-radio-group v-model="form.deepseek_thinking">
              <el-radio-button label="disabled">关闭思考</el-radio-button>
              <el-radio-button label="enabled">开启思考</el-radio-button>
            </el-radio-group>
            <el-select
              v-if="form.deepseek_thinking === 'enabled'"
              v-model="form.deepseek_reasoning_effort"
              aria-label="思考强度"
              no-data-text="暂无可选思考强度"
              style="width: 140px"
            >
              <el-option label="高（high）" value="high" />
              <el-option label="最高（max）" value="max" />
            </el-select>
          </div>
          <p class="field-tip">官方旧模型名将在 2026-07-24 废弃；新配置建议使用 deepseek-v4-flash 或 deepseek-v4-pro。</p>
        </el-form-item>
        </template>
        </section>

        <section class="config-form-section config-policy-section">
          <div class="config-section-header">
            <div>
              <h4>调用策略</h4>
              <p>同类服务有多个配置时，默认项优先于普通配置，优先级用于后续排序。</p>
            </div>
            <span class="config-section-index">{{ form.service_type === 'jimeng2_character_auth' ? '03' : '04' }}</span>
          </div>
        <template v-if="['text', 'image', 'storyboard_image', 'video', 'tts'].includes(form.service_type)">
          <el-form-item v-if="form.service_type === 'text'" label="输入单价">
            <div class="pricing-field-row">
              <el-input-number v-model="form.pricing_input_per_million_tokens" :min="0" :precision="4" :step="0.1" controls-position="right" />
              <span>USD / 百万 tokens</span>
            </div>
          </el-form-item>
          <el-form-item v-if="form.service_type === 'text'" label="输出单价">
            <div class="pricing-field-row">
              <el-input-number v-model="form.pricing_output_per_million_tokens" :min="0" :precision="4" :step="0.1" controls-position="right" />
              <span>USD / 百万 tokens</span>
            </div>
          </el-form-item>
          <el-form-item v-else-if="form.service_type === 'image' || form.service_type === 'storyboard_image'" label="图片单价">
            <div class="pricing-field-row">
              <el-input-number v-model="form.pricing_per_image" :min="0" :precision="6" :step="0.01" controls-position="right" />
              <span>USD / 张</span>
            </div>
          </el-form-item>
          <el-form-item v-else-if="form.service_type === 'video'" label="视频单价">
            <div class="pricing-field-row">
              <el-input-number v-model="form.pricing_per_second" :min="0" :precision="6" :step="0.01" controls-position="right" />
              <span>USD / 秒</span>
            </div>
          </el-form-item>
          <el-form-item v-else-if="form.service_type === 'tts'" label="语音单价">
            <div class="pricing-field-row">
              <el-input-number v-model="form.pricing_per_1000_characters" :min="0" :precision="6" :step="0.01" controls-position="right" />
              <span>USD / 千字符</span>
            </div>
          </el-form-item>
          <p class="pricing-help">选填。用于 Production 工作流成本估算；留空会明确显示为“未配置价格”，不会误报为零成本。</p>
        </template>
        <el-form-item>
          <template #label>
            <span class="form-label-tip">优先级
              <el-tooltip content="同一服务类型有多个配置时，数字越大越优先被调用。默认 0，一般设为 10 即可。" placement="top" popper-class="cfg-tip-popper">
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input-number v-model="form.priority" :min="0" :max="999" />
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="form-label-tip">设为默认
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    每种服务类型只有一个「默认」配置。<br>
                    生成时系统会优先使用默认配置，建议每类至少设一个默认。
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-switch v-model="form.is_default" :disabled="configWriteLocked" />
        </el-form-item>
        </section>
      </el-form>
      </div>
      <template #footer>
        <el-button @click="requestConfigDialogClose">取消</el-button>
        <el-button type="primary" aria-label="保存配置" :loading="saving" :disabled="configWriteLocked" @click="submit">保存</el-button>
      </template>
    </AccessibleDialog>

    <!-- 一键配置通义 -->
    <AccessibleDialog
      v-model="oneKeyTongyiVisible"
      title="一键配置通义千问 / 万象（不推荐）"
      width="520px"
      class="ai-config-dialog ai-config-overlay"
      :close-on-click-modal="false"
      :before-close="confirmOneKeyTongyiClose"
      @closed="oneKeyTongyiKey = ''"
    >
      <div class="one-key-help">
        <div class="one-key-section">
          <div class="one-key-section-title">📋 将自动创建以下配置</div>
          <ul class="one-key-list">
            <li><b>文本/对话</b>：通义千问（qwen-plus）— 生成故事剧本</li>
            <li><b>文本生成图片</b>：通义万象（wan2.6-image）— 角色/场景/道具图</li>
            <li><b>文本生成图片</b>：通义千问图像（qwen-image-max）— 角色/场景图备选</li>
            <li><b>分镜图片生成</b>：通义万象（wan2.6-image）— 支持角色参考图</li>
            <li><b>视频生成</b>：通义万相（wan2.2-kf2v-flash）— 生成视频片段</li>
          </ul>
        </div>
        <div class="one-key-section">
          <div class="one-key-section-title">🔑 如何申请 API Key</div>
          <ol class="one-key-list">
            <li>前往阿里云百炼控制台：<a href="https://bailian.console.aliyun.com/" target="_blank" rel="noopener noreferrer" class="one-key-link">bailian.console.aliyun.com</a></li>
            <li>注册/登录阿里云账号，开通「百炼」服务（新用户有免费额度）</li>
            <li>左侧菜单点击「API Key」→「创建 API Key」</li>
            <li>复制生成的 Key（格式：<code>sk-xxxxxxxx</code>）填入下方</li>
          </ol>
          <p class="one-key-note">💡 通义一个 Key 同时支持文本、图片、视频等所有服务</p>
        </div>
      </div>
      <el-form label-width="0" style="margin-top: 8px">
        <el-form-item>
          <el-input
            v-model="oneKeyTongyiKey"
            type="password"
            aria-label="通义 API Key"
            placeholder="请输入通义（DashScope）API Key，格式：sk-xxxxxxxx"
            show-password-on="click"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requestOneKeyTongyiClose">取消</el-button>
        <el-button type="success" :loading="oneKeyTongyiSaving" :disabled="configWriteLocked || !oneKeyTongyiKey.trim()" @click="submitOneKeyTongyi">
          确定，一键创建配置
        </el-button>
      </template>
    </AccessibleDialog>

    <!-- 一键配置火山 -->
    <AccessibleDialog
      v-model="oneKeyVolcVisible"
      title="一键配置火山引擎（方舟）"
      width="520px"
      class="ai-config-dialog ai-config-overlay"
      :close-on-click-modal="false"
      :before-close="confirmOneKeyVolcClose"
      @closed="oneKeyVolcKey = ''"
    >
      <div class="one-key-help">
        <div class="one-key-section">
          <div class="one-key-section-title">📋 将自动创建以下配置</div>
          <ul class="one-key-list">
            <li><b>文本/对话</b>：DeepSeek V3（deepseek-v3-2-251201）— 生成故事剧本</li>
            <li><b>文本生成图片</b>：即梦 4.5（doubao-seedream-4-5-251128）— 角色/场景/道具图</li>
            <li><b>分镜图片生成</b>：即梦 4.5（doubao-seedream-4-5-251128）— 支持角色参考图</li>
            <li><b>视频生成</b>：即梦 Seedance 1.5 Pro — 生成视频片段</li>
          </ul>
        </div>
        <div class="one-key-section">
          <div class="one-key-section-title">🔑 如何申请 API Key</div>
          <ol class="one-key-list">
            <li>前往火山引擎方舟控制台：<a href="https://console.volcengine.com/ark" target="_blank" rel="noopener noreferrer" class="one-key-link">console.volcengine.com/ark</a></li>
            <li>注册/登录字节跳动火山引擎账号（新用户有免费 token 额度）</li>
            <li>左侧菜单点击「API Key 管理」→「创建 API Key」</li>
            <li>复制生成的 Key 填入下方</li>
          </ol>
          <p class="one-key-note">💡 方舟平台一个 Key 同时支持豆包文本、即梦图片与视频等所有服务</p>
          <p class="one-key-note">⚠️ 视频生成需在控制台「开通」对应模型（即梦 Seedance）后方可使用</p>
        </div>
      </div>
      <el-form label-width="0" style="margin-top: 8px">
        <el-form-item>
          <el-input
            v-model="oneKeyVolcKey"
            type="password"
            aria-label="火山引擎 API Key"
            placeholder="请输入火山引擎（方舟）API Key"
            show-password-on="click"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requestOneKeyVolcClose">取消</el-button>
        <el-button type="success" :loading="oneKeyVolcSaving" :disabled="configWriteLocked || !oneKeyVolcKey.trim()" @click="submitOneKeyVolc">
          确定，一键创建配置
        </el-button>
      </template>
    </AccessibleDialog>

    <!-- 一键配置 Agnes -->
    <AccessibleDialog
      v-model="oneKeyAgnesVisible"
      title="一键配置 Agnes AI"
      width="520px"
      class="ai-config-dialog ai-config-overlay"
      :close-on-click-modal="false"
      :before-close="confirmOneKeyAgnesClose"
      @closed="oneKeyAgnesKey = ''"
    >
      <div class="one-key-help">
        <div class="one-key-section">
          <div class="one-key-section-title">📋 将自动创建以下配置</div>
          <ul class="one-key-list">
            <li><b>文本/对话</b>：Agnes 2.0 Flash（agnes-2.0-flash）— 生成故事剧本</li>
            <li><b>文本生成图片</b>：Agnes Image 2.1 Flash — 角色/场景/道具图</li>
            <li><b>分镜图片生成</b>：Agnes Image 2.1 Flash — 支持参考图编辑</li>
            <li><b>视频生成</b>：Agnes Video V2.0（agnes-video-v2.0）— 生成视频片段</li>
          </ul>
        </div>
        <div class="one-key-section">
          <div class="one-key-section-title">🔑 如何申请 API Key</div>
          <ol class="one-key-list">
            <li>前往 Agnes 平台：<a href="https://platform.agnes-ai.com/settings/apiKeys" target="_blank" rel="noopener noreferrer" class="one-key-link">platform.agnes-ai.com/settings/apiKeys</a></li>
            <li>注册/登录账号，进入 Settings → API Keys</li>
            <li>点击「Create new secret key」创建密钥</li>
            <li>复制 Key 填入下方</li>
          </ol>
          <p class="one-key-note">💡 一个 Key 同时支持文本、图片、视频；接口文档见 <a href="https://agnes-ai.com/doc/agnes-20-flash" target="_blank" rel="noopener noreferrer" class="one-key-link">agnes-ai.com/doc</a></p>
        </div>
      </div>
      <el-form label-width="0" style="margin-top: 8px">
        <el-form-item>
          <el-input
            v-model="oneKeyAgnesKey"
            type="password"
            aria-label="Agnes API Key"
            placeholder="请输入 Agnes API Key"
            show-password-on="click"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requestOneKeyAgnesClose">取消</el-button>
        <el-button type="success" :loading="oneKeyAgnesSaving" :disabled="configWriteLocked || !oneKeyAgnesKey.trim()" @click="submitOneKeyAgnes">
          确定，一键创建配置
        </el-button>
      </template>
    </AccessibleDialog>

    <!-- 即梦2角色认证：素材列表 -->
    <AccessibleDialog
      v-model="jimeng2AssetsDialogVisible"
      title="素材库列表（GET /api/business/v1/assets）"
      width="720px"
      class="jimeng2-assets-dialog ai-config-overlay"
      destroy-on-close
      @closed="onJimeng2AssetsDialogClosed"
    >
      <p class="field-tip" style="margin-top: 0">
        文档：
        <a href="https://83zi.com/sd2realperson.html" target="_blank" rel="noopener noreferrer">SilvaMux 素材管理 API</a>
        ；仅 <code>status=active</code> 的素材可用于 Seedance 2.0 视频引用。
      </p>
      <el-table v-loading="jimeng2AssetsLoading" :data="jimeng2AssetsRows" stripe max-height="420" empty-text="暂无数据或未加载">
        <el-table-column prop="id" label="素材 ID" min-width="120" show-overflow-tooltip />
        <el-table-column prop="name" label="名称" width="100" show-overflow-tooltip />
        <el-table-column prop="asset_type" label="类型" width="88">
          <template #default="{ row }">{{ jimeng2AssetTypeLabel(row.asset_type) }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="96">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : row.status === 'failed' ? 'danger' : 'info'" size="small">
              {{ jimeng2AssetStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="asset_url" label="素材地址" min-width="160" show-overflow-tooltip />
        <el-table-column prop="url" label="原始 URL" min-width="120" show-overflow-tooltip />
        <el-table-column prop="created_at" label="创建时间" width="160" show-overflow-tooltip />
      </el-table>
      <div v-if="jimeng2AssetsHasMore" style="margin-top: 12px; text-align: center">
        <el-button :loading="jimeng2AssetsLoading" @click="loadMoreJimeng2MaterialAssets">加载更多</el-button>
      </div>
      <template #footer>
        <el-button @click="jimeng2AssetsDialogVisible = false">关闭</el-button>
      </template>
    </AccessibleDialog>

    <!-- 测试连接 -->
    <AccessibleDialog v-model="testVisible" title="测试连接" width="420px" class="ai-config-overlay" @closed="restoreTestedCoverageCardFocus">
      <p class="test-result-announcement" role="status" aria-live="polite">{{ testResultAnnouncement }}</p>
      <p v-if="testResult === null">正在测试…</p>
      <template v-else-if="testResult">
        <el-alert
          v-if="testServiceType === 'image' || testServiceType === 'storyboard_image' || testServiceType === 'video'"
          type="success"
          title="连接成功"
          description="连通性探针通过。提示：测试不等同于真实生成验收，模型名填错、账号未开通该功能、配额不足或服务商临时不可用时，实际生成仍可能报错。"
          show-icon
          :closable="false"
        />
        <el-alert
          v-else-if="testServiceType === 'ocr'"
          type="success"
          title="连接成功"
          description="图片识别接口已正常响应。测试只验证连通性，不代表 PDF/图片识别已真实跑通。"
          show-icon
          :closable="false"
        />
        <el-alert
          v-else-if="testServiceType === 'transcription'"
          type="success"
          title="连接成功"
          description="语音转写接口已正常响应。测试只验证连通性，不代表音频/视频转写已真实跑通。"
          show-icon
          :closable="false"
        />
        <el-alert
          v-else
          type="success"
          title="连接成功"
          description="文本生成接口已正常响应。"
          show-icon
          :closable="false"
        />
        <p v-if="testSuggestDiscoverModels" class="field-tip">也可以读取模型目录，不会自动覆盖已填写的模型列表。</p>
      </template>
      <el-alert
        v-else
        type="error"
        :title="testError || '连接失败'"
        :description="testErrorDetail || undefined"
        show-icon
        :closable="false"
      />
      <template #footer>
        <el-button
          v-if="testResult === false"
          type="primary"
          :loading="testingConfigId !== null"
          @click="retryConnectionTest"
        >重试</el-button>
        <el-button @click="testVisible = false">关闭</el-button>
      </template>
    </AccessibleDialog>

    <!-- 一键换密钥（锁定模式） -->
    <AccessibleDialog v-model="bulkKeyVisible" title="一键换密钥" width="440px" class="ai-config-overlay" :close-on-click-modal="false" :before-close="confirmBulkKeyClose">
      <el-alert
        type="warning"
        :closable="false"
        style="margin-bottom: 16px"
        title="此操作将替换所有配置的 API 密钥，请确认新密钥可用后再提交。"
        show-icon
      />
      <el-form label-width="80px">
        <el-form-item label="新 API 密钥">
          <el-input
            v-model="bulkKeyInput"
            type="password"
            show-password
            aria-label="新 API 密钥"
            placeholder="粘贴新的 API 密钥"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="requestBulkKeyClose">取消</el-button>
        <el-button type="primary" :loading="bulkKeySaving" :disabled="configWriteLocked || !bulkKeyInput.trim()" @click="submitBulkKey">确认替换</el-button>
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { toUserFacingError, isUserFacingAbort } from '@/utils/userFacingError'
import { runWithOwnedRequestErrorToast } from '@/utils/request'
import { Plus, MagicStick, QuestionFilled, Download, Upload, Delete, ChatDotRound, Picture, Film, VideoCamera, Key, Microphone, Folder, Document, Headset } from '@element-plus/icons-vue'
import { aiAPI } from '@/api/ai'
import { generationSettingsAPI } from '@/api/prompts'
import { useAiConfigGenerationSettings } from '@/composables/useAiConfigGenerationSettings.js'
import { useAiConfigOneKeyPresets } from '@/composables/useAiConfigOneKeyPresets.js'
import { useAiConfigImportExport } from '@/composables/useAiConfigImportExport.js'
import { useAiConfigRowMutations } from '@/composables/useAiConfigRowMutations.js'
import { useAiConfigDiscoverModels } from '@/composables/useAiConfigDiscoverModels.js'
import { useAiConfigVendorLock } from '@/composables/useAiConfigVendorLock.js'
import { useAiConfigJimeng2Assets } from '@/composables/useAiConfigJimeng2Assets.js'
import {
  parseModelText,
  isOpenAiCompatibleConfig,
  hasDiscoverableCredential,
} from '@/utils/aiConfigDiscoverModels.js'
import {
  hidesApiProtocolField,
  serviceTypeLabel,
  configFieldDisplayLabel,
  jimeng2AssetTypeLabel,
  jimeng2AssetStatusLabel,
  configActionLabel,
} from '@/utils/aiConfigLabels.js'
import { describeConnectionTestError } from '@/utils/aiConfigConnectionTest.js'
import {
  parseSettings,
  parseComfyWorkflowJson,
  isDeepSeekOfficial,
  resolveDeepSeekFormSettings,
} from '@/utils/aiConfigFormSettings.js'
import { applyProviderSelection } from '@/utils/aiConfigProviderSelection.js'
import { createBlankAiConfigForm, hydrateAiConfigForm } from '@/utils/aiConfigFormState.js'
import {
  buildAvailableProviderOptions,
  buildAvailableModels,
  providerModelEmptyHint as describeProviderModelEmptyHint,
  describeConfigEditTarget,
} from '@/utils/aiConfigProviderOptions.js'
import {
  applyServiceTypeChange,
  appendModelToList,
  applyPresetModelSelect,
} from '@/utils/aiConfigServiceTypeChange.js'
import { buildEndpointPreviewInfo } from '@/utils/aiConfigEndpointPreview.js'
import { buildAiServiceCoverage, sortAiServiceCoverage } from '@/utils/aiConfigCoverage.js'
import { useAiConfigCoverage } from '@/composables/useAiConfigCoverage.js'
import {
  DEFAULT_MODEL_VALIDATION_MESSAGE,
  isMaskedSecret,
  isDefaultModelSelectionValid as isValidDefaultModelSelection,
  configFormFingerprint as fingerprintConfigForm,
  useAiConfigUnsaved,
} from '@/composables/useAiConfigUnsaved.js'
import {
  createAiConfigConnectionStatusStore,
  resolveAiConfigConnectionStatusScope,
} from '@/utils/aiConfigConnectionStatusStore.js'
import {
  confirmAiConfigMutationInList,
  confirmAiConfigMutationResult,
  runAiConfigCreateBatch,
} from '@/utils/aiConfigMutations.js'
import { applyAiConfigRepairTarget } from '@/utils/aiConfigRepairTarget.js'
import { CUSTOM_PROVIDER_SENTINEL, getBaseUrlForProvider, getProviderEndpointDefaults, getProviderProtocol, isApiKeyOptionalProvider, providerConfigs } from '@/utils/aiProviderPresets.js'
import { buildProviderPricing, parseSettingsObject, readProviderPricingForm } from '@/utils/providerPricing.js'
import { getConfigWorkspaceKeyTarget, shouldApplyConfigWorkspaceRequest } from '@/utils/aiConfigWorkspace.js'
import PromptEditor from '@/components/PromptEditor.vue'
import SceneModelMap from '@/components/SceneModelMap.vue'
import Sd2AssetManagement from '@/components/Sd2AssetManagement.vue'
import AiConfigCoverageCards from '@/components/aiConfig/AiConfigCoverageCards.vue'
import AiConfigModelListSection from '@/components/aiConfig/AiConfigModelListSection.vue'
import AiConfigPresetHelpCollapse from '@/components/aiConfig/AiConfigPresetHelpCollapse.vue'
import { createOperationId, logOperation } from '@/utils/operationLog'
import {
  DEFAULT_CONNECTION_TEST_TIMEOUT_MS,
  DEFAULT_JSON_TIMEOUT_MS,
  describeServiceLoadError,
  isRequestCanceled,
  isRequestTimeout,
  withRequestRetry,
} from '@/utils/requestError'
const props = defineProps({
  initialServiceType: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['configuration-changed'])

function notifyConfigurationChanged() {
  emit('configuration-changed')
}

const filterableServiceTypes = new Set(['text', 'image', 'storyboard_image', 'video', 'tts', 'ocr', 'transcription'])

function normalizeInitialServiceType(value) {
  const normalized = String(value || '').trim()
  return filterableServiceTypes.has(normalized) ? normalized : ''
}

const activeTab = ref('configs')
const promptEditorRef = ref(null)
const sceneModelMapRef = ref(null)
const configWorkspaceView = ref(
  normalizeInitialServiceType(props.initialServiceType) ? 'configs' : 'coverage',
)
const coverageWorkspaceModeRef = ref(null)
const configsWorkspaceModeRef = ref(null)

function selectConfigWorkspaceView(view, { focus = false } = {}) {
  configWorkspaceView.value = view
  if (!focus) return
  nextTick(() => {
    const target = view === 'coverage' ? coverageWorkspaceModeRef.value : configsWorkspaceModeRef.value
    target?.focus?.()
  })
}

function onConfigWorkspaceKeydown(currentView, event) {
  const target = getConfigWorkspaceKeyTarget(currentView, event.key)
  if (!target) return
  event.preventDefault()
  selectConfigWorkspaceView(target, { focus: true })
}
const importFileRef = ref(null)

// ---- 生成设置 ----
const {
  genConcurrencyInput,
  genVideoConcurrencyInput,
  genSettingSaving,
  genSettingSaved,
  generationSettingsLoadState,
  generationSettingsLoadError,
  generationSettingsWriteLocked,
  generationSettingsDirty,
  loadGenerationSettings,
  saveGenerationSettings,
  onConcurrencyChange,
  onVideoConcurrencyChange,
  abortGenerationSettingsRequest,
} = useAiConfigGenerationSettings({
  generationSettingsAPI,
  ElMessage,
  runWithOwnedRequestErrorToast,
})
const loading = ref(false)
const configLoadState = ref('idle')
const configLoadError = ref('')
const list = ref([])
const hasSavedConfigs = computed(() => (list.value || []).length > 0)
const ADVANCED_CONFIG_TABS = new Set(['prompts', 'sceneModelMap', 'sd2_assets'])
watch(hasSavedConfigs, (hasConfigs) => {
  if (!hasConfigs && ADVANCED_CONFIG_TABS.has(activeTab.value)) {
    activeTab.value = 'configs'
  }
})
let configListLoadSequence = 0
const activeServiceFilter = ref(normalizeInitialServiceType(props.initialServiceType))
const configListSectionRef = ref(null)
watch(
  () => props.initialServiceType,
  async (value) => {
    const normalized = normalizeInitialServiceType(value)
    if (!shouldApplyConfigWorkspaceRequest({
      requestedServiceType: normalized,
      activeServiceType: activeServiceFilter.value,
      workspaceView: configWorkspaceView.value,
    })) return
    await applyRequestedService(normalized)
  },
)
const sessionTestStatusById = ref({})
let connectionStatusStore = createAiConfigConnectionStatusStore()
let configListAbortController = null
let connectionTestAbortController = null
let connectionStatusScopeAbortController = null
let lastTestedConfig = null
let abortDiscoverModelsRequest = () => {}
let resetDiscoverModelsState = () => {}
let abortVendorLockRequest = () => {}

function abortAiConfigPageRequests() {
  configListAbortController?.abort()
  abortVendorLockRequest()
  abortGenerationSettingsRequest()
  connectionTestAbortController?.abort()
  connectionStatusScopeAbortController?.abort()
  abortDiscoverModelsRequest()
  configListAbortController = null
  connectionTestAbortController = null
  connectionStatusScopeAbortController = null
}

function jsonRequestOptions(signal, timeout = DEFAULT_JSON_TIMEOUT_MS) {
  return { signal, timeout, suppressErrorToast: true }
}

const {
  vendorLock,
  vendorLockResolved,
  vendorLockLoading,
  vendorLockError,
  loadVendorLock,
  abortVendorLockRequest: abortVendorLockFromComposable,
} = useAiConfigVendorLock({
  aiAPI,
  jsonRequestOptions,
})
abortVendorLockRequest = abortVendorLockFromComposable

async function initializeConnectionStatusStore() {
  connectionStatusScopeAbortController?.abort()
  const controller = new AbortController()
  connectionStatusScopeAbortController = controller
  const scope = await resolveAiConfigConnectionStatusScope({
    fallbackScope: import.meta.env.VITE_LOCALMINIDRAMA_INSTANCE_ID || '',
    signal: controller.signal,
  })
  if (controller.signal.aborted) return
  connectionStatusStore = createAiConfigConnectionStatusStore({ scope })
}

function invalidateConnectionTestResults() {
  connectionStatusStore.invalidateAll()
  sessionTestStatusById.value = {}
}
const selectedRows = ref([])
const batchDeleting = ref(false)
const dialogVisible = ref(false)
const editingId = ref(null)
const editingUpdatedAt = ref('')
const saving = ref(false)
const configFormBaseline = ref('')
const configDialogSaved = ref(false)
const showProtocolHelp = ref(false)
const bulkKeyVisible = ref(false)
const bulkKeyInput = ref('')
const bulkKeySaving = ref(false)
const jimeng2AssetsDialogVisible = ref(false)
const jimeng2AssetsLoading = ref(false)
const jimeng2AssetsRows = ref([])
const jimeng2AssetsHasMore = ref(false)
const jimeng2AssetsNextCursor = ref(null)
const formRef = ref(null)
const configDialogScrollRef = ref(null)
const configValidationSummary = ref([])
const apiKeyInputRef = ref(null)
const modelListInputRef = ref(null)
function setModelListInputRef(element) {
  modelListInputRef.value = element
}
const workflowInputRef = ref(null)
const advancedFormSections = ref([])
const form = ref({
  service_type: 'text',
  name: '',
  provider: '',
  api_protocol: '',
  base_url: '',
  api_key: '',
  endpoint: '',
  query_endpoint: '',
  modelText: '',
  default_model: '',
  deepseek_thinking: 'disabled',
  deepseek_reasoning_effort: 'high',
  priority: 0,
  is_default: false,
  // 可灵 Omni 官方 AK/SK（存 settings，后端生成 JWT）
  kling_access_key: '',
  kling_secret_key: '',
  kling_secret_key_base64: false,
  comfy_workflow_json: '',
  // TTS 专属字段
  voice_id: '',
  group_id: '',
})
const presetModelPick = ref('')

const formModelList = computed(() => parseModelText(form.value.modelText))
const discoverModelsDisabledReason = computed(() => {
  if (!String(form.value.base_url || '').trim()) return '请先填写接口地址'
  if (hasDiscoverableCredential(form.value)) return ''
  return '请先填写 API 密钥后再读取模型'
})
const discoverModelsDisabled = computed(() => Boolean(discoverModelsDisabledReason.value))
const {
  discoverModelsLoading,
  discoverModelsFromService,
  abortDiscoverModelsRequest: abortDiscoverModelsRequestFromComposable,
  resetDiscoverModelsState: resetDiscoverModelsStateFromComposable,
} = useAiConfigDiscoverModels({
  ElMessage,
  aiAPI,
  form,
  editingId,
  dialogVisible,
  discoverModelsDisabled,
})
abortDiscoverModelsRequest = abortDiscoverModelsRequestFromComposable
resetDiscoverModelsState = resetDiscoverModelsStateFromComposable
const {
  onJimeng2AssetsDialogClosed,
  openJimeng2MaterialAssetsDialog,
  loadMoreJimeng2MaterialAssets,
} = useAiConfigJimeng2Assets({
  ElMessage,
  aiAPI,
  form,
  editingId,
  jimeng2AssetsDialogVisible,
  jimeng2AssetsLoading,
  jimeng2AssetsRows,
  jimeng2AssetsHasMore,
  jimeng2AssetsNextCursor,
})
const isDefaultModelUnavailable = computed(() => {
  const selected = String(form.value.default_model || '').trim()
  return Boolean(selected && !formModelList.value.includes(selected))
})

function isDefaultModelSelectionValid(value) {
  return isValidDefaultModelSelection(value, {
    isComfyUi: isComfyUiForm.value,
    modelList: formModelList.value,
  })
}

const defaultModelRules = [
  {
    validator: (_rule, value, cb) => {
      if (isDefaultModelSelectionValid(value)) return cb()
      cb(new Error(DEFAULT_MODEL_VALIDATION_MESSAGE))
    },
    trigger: 'change',
  },
]

// 新增配置延续首项默认值；用户手填的自定义模型会同步进列表，避免被首项覆盖。编辑时保留已失效历史值。
watch(
  () => [formModelList.value, form.value.default_model],
  () => {
    const list = formModelList.value
    const current = String(form.value.default_model || '').trim()
    if (current && !list.includes(current) && form.value.service_type !== 'jimeng2_character_auth') {
      if (!editingId.value) ensureModelInList(current)
      return
    }
    if (editingId.value || list.length === 0) return
    if (!current || !list.includes(current)) {
      form.value.default_model = list[0] || ''
    }
  },
  { immediate: true }
)

function onServiceTypeChange() {
  applyServiceTypeChange(form.value, { editingId: editingId.value })
}

function ensureModelInList(modelName) {
  appendModelToList(form.value, modelName)
}

function onPresetModelSelect(value) {
  applyPresetModelSelect(form.value, value)
  presetModelPick.value = ''
}

function onDefaultModelChange(value) {
  appendModelToList(form.value, value)
}

const rules = computed(() => ({
  service_type: [{ required: true, message: '请选择服务类型', trigger: 'change' }],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  provider: [{ required: true, message: '请选择或输入厂商', trigger: 'change' }],
  base_url: [{ required: true, message: '请输入接口地址（Base URL）', trigger: 'blur' }],
  api_key: [
    {
      validator: (_rule, v, cb) => {
        const st = form.value.service_type
        if (st === 'jimeng2_character_auth') {
          if (v != null && String(v).trim()) return cb()
          return cb(new Error('请填写令牌（Token）'))
        }
        const proto = form.value.api_protocol
        if (isApiKeyOptionalProvider(form.value.provider, proto)) return cb()
        const ak = (form.value.kling_access_key || '').trim()
        const sk = (form.value.kling_secret_key || '').trim()
        if (st === 'video' && proto === 'kling_omni' && ak && sk) return cb()
        if (v != null && String(v).trim()) return cb()
        cb(new Error('请输入 API 密钥，或使用官方 AccessKey + SecretKey（可不填 API 密钥）'))
      },
      trigger: 'blur',
    },
  ],
  api_protocol: [
    {
      validator: (_rule, value, cb) => {
        const st = form.value.service_type
        const protocolVisible = !hidesApiProtocolField(st)
        const presetProvider = (providerConfigs[st] || []).some((item) => item.id === form.value.provider)
        if (!protocolVisible || presetProvider || String(value || '').trim()) return cb()
        cb(new Error('自定义厂商请选择接口规范'))
      },
      trigger: 'change',
    },
  ],
  endpoint: [
    {
      validator: (_rule, value, cb) => {
        const st = form.value.service_type
        const presetProvider = (providerConfigs[st] || []).some((item) => item.id === form.value.provider)
        if (st !== 'video' || presetProvider || String(value || '').trim()) return cb()
        cb(new Error('自定义视频厂商请输入提交端点'))
      },
      trigger: 'blur',
    },
  ],
  modelText: [
    {
      validator: (_rule, value, cb) => {
        if (form.value.service_type === 'jimeng2_character_auth' || isComfyUiForm.value || parseModelText(value).length > 0) return cb()
        cb(new Error('请填写至少一个模型'))
      },
      trigger: 'blur',
    },
  ],
  default_model: defaultModelRules,
  comfy_workflow_json: [
    {
      validator: (_rule, value, cb) => {
        if (!isComfyUiForm.value) return cb()
        try {
          parseComfyWorkflowJson(value)
          cb()
        } catch (error) {
          cb(error)
        }
      },
      trigger: 'blur',
    },
  ],
}))
const testVisible = ref(false)
const testResult = ref(null)
const testServiceType = ref('')
const testError = ref('')
const testErrorDetail = ref('')
const testResultAnnouncement = ref('')
const testSuggestDiscoverModels = ref(false)
const testingConfigId = ref(null)
const oneKeyTongyiVisible = ref(false)
const oneKeyTongyiKey = ref('')
const oneKeyTongyiSaving = ref(false)
const oneKeyVolcVisible = ref(false)
const oneKeyVolcKey = ref('')
const oneKeyVolcSaving = ref(false)
const oneKeyAgnesVisible = ref(false)
const oneKeyAgnesKey = ref('')
const oneKeyAgnesSaving = ref(false)

const serviceCoverage = computed(() => (
  buildAiServiceCoverage(list.value, sessionTestStatusById.value)
))
const orderedCoverageServices = computed(() => sortAiServiceCoverage(serviceCoverage.value.services))
const orderedExtractionCoverageServices = computed(() => (
  sortAiServiceCoverage(serviceCoverage.value.extractionServices || [])
))

const coverageSummaryCards = computed(() => ([
  {
    key: 'ready',
    label: '可用',
    value: `${serviceCoverage.value.readyCount}/${serviceCoverage.value.totalCount}`,
    tone: serviceCoverage.value.ready ? 'success' : 'warning',
  },
  {
    key: 'attention',
    label: '待补齐',
    value: serviceCoverage.value.attentionCount,
    tone: serviceCoverage.value.attentionCount ? 'warning' : 'success',
  },
  {
    key: 'failed-tests',
    label: '测试失败',
    value: serviceCoverage.value.testFailedCount,
    tone: serviceCoverage.value.testFailedCount ? 'danger' : 'success',
  },
  {
    key: 'untested',
    label: '待测试',
    value: serviceCoverage.value.untestedCount,
    tone: serviceCoverage.value.untestedCount ? 'info' : 'success',
  },
]))

const filteredList = computed(() => {
  if (!activeServiceFilter.value) return list.value
  return list.value.filter((row) => row.service_type === activeServiceFilter.value)
})

const configWriteLocked = computed(() => (
  configLoadState.value !== 'ready'
  || !vendorLockResolved.value
  || saving.value
  || bulkKeySaving.value
  || batchDeleting.value
  || oneKeyTongyiSaving.value
  || oneKeyVolcSaving.value
  || oneKeyAgnesSaving.value
))

const {
  openOneKeyTongyi,
  submitOneKeyTongyi,
  openOneKeyVolc,
  submitOneKeyVolc,
  openOneKeyAgnes,
  submitOneKeyAgnes,
} = useAiConfigOneKeyPresets({
  ElMessage,
  aiAPI,
  runAiConfigCreateBatch,
  configWriteLocked,
  oneKeyTongyiVisible,
  oneKeyTongyiKey,
  oneKeyTongyiSaving,
  oneKeyVolcVisible,
  oneKeyVolcKey,
  oneKeyVolcSaving,
  oneKeyAgnesVisible,
  oneKeyAgnesKey,
  oneKeyAgnesSaving,
  loadList,
  list,
  configLoadError,
  invalidateConnectionTestResults,
  notifyConfigurationChanged,
})

const {
  exportConfigs,
  triggerImport,
  importConfigs,
} = useAiConfigImportExport({
  ElMessage,
  aiAPI,
  runAiConfigCreateBatch,
  configWriteLocked,
  importFileRef,
  loadList,
  list,
  configLoadError,
  invalidateConnectionTestResults,
  notifyConfigurationChanged,
})

const {
  openBulkKey,
  submitBulkKey,
  onDelete,
  onSelectionChange,
  onBatchDelete,
} = useAiConfigRowMutations({
  ElMessage,
  ElMessageBox,
  aiAPI,
  configWriteLocked,
  bulkKeyInput,
  bulkKeyVisible,
  bulkKeySaving,
  selectedRows,
  batchDeleting,
  loadList,
  list,
  invalidateConnectionTestResults,
  notifyConfigurationChanged,
})

const configListPendingEmpty = computed(() => (
  !list.value.length && configLoadState.value !== 'ready' && configLoadState.value !== 'error'
))
const configListFailedEmpty = computed(() => (
  !list.value.length && configLoadState.value === 'error'
))
const configEmptyTitle = computed(() => {
  if (configListFailedEmpty.value) return '暂时无法读取配置列表'
  if (configListPendingEmpty.value) return '正在读取配置列表'
  if (activeServiceFilter.value) return `暂无${serviceTypeLabel(activeServiceFilter.value)}配置`
  return '还没有 AI 服务配置'
})
const configEmptyDescription = computed(() => {
  if (configListFailedEmpty.value) {
    return configLoadError.value || '请点击重试后再查看或添加配置。'
  }
  if (configListPendingEmpty.value) return '正在从本地服务读取已保存的厂商配置。'
  if (activeServiceFilter.value === 'ocr') return '添加一个配置并设为默认，即可用于 PDF/图片识别。'
  if (activeServiceFilter.value === 'transcription') return '添加一个配置并设为默认，即可用于音频/视频转写。'
  if (activeServiceFilter.value) return '添加一个配置并设为默认，即可用于对应生成环节。'
  return '先添加文本、图片或视频厂商，生成流程会自动使用默认配置。'
})

const configDependencyError = computed(() => (
  [configLoadError.value, vendorLockError.value].filter(Boolean).join('；')
))

watch(configWriteLocked, (locked) => {
  if (locked) selectedRows.value = []
})

const canAutoOpenMissingService = computed(() => (
  configLoadState.value === 'ready' && vendorLockResolved.value
))

const {
  coverageActions,
  onCoverageSelect,
  onCoverageAction,
  shouldAutoOpenRequestedService,
  focusServiceConfigs,
  applyRequestedService,
  setCoverageCardRef,
  isCoverageActionTesting: isCoverageActionTestingFromCoverage,
  restoreTestedCoverageCardFocus: restoreCoverageCardFocus,
} = useAiConfigCoverage({
  vendorLock,
  configWriteLocked,
  testingConfigId,
  canAutoOpenMissingService,
  configWorkspaceView,
  activeServiceFilter,
  serviceCoverage,
  coverageWorkspaceModeRef,
  configListSectionRef,
  selectConfigWorkspaceView,
  normalizeInitialServiceType,
  openAddForService,
  openEdit,
  openTest,
  abortConnectionTest: () => { connectionTestAbortController?.abort() },
})

function clearServiceFilter() {
  activeServiceFilter.value = ''
}

function isCoverageActionTesting(item, action) {
  return isCoverageActionTestingFromCoverage(item, action)
}

function isCoverageActionDisabled(item, action) {
  if (['add', 'edit'].includes(action.action)) return configWriteLocked.value
  if (action.action !== 'test') return false
  return isCoverageActionTesting(item, action) || testingConfigId.value !== null
}

function isConfigRowSelectable() {
  return !configWriteLocked.value
}

async function restoreTestedCoverageCardFocus() {
  connectionTestAbortController?.abort()
  await restoreCoverageCardFocus()
}

const isDeepSeekOfficialForm = computed(() => (
  form.value.service_type === 'text'
  && isDeepSeekOfficial(form.value.provider, form.value.base_url)
))

const isComfyUiForm = computed(() => (
  ['image', 'storyboard_image'].includes(String(form.value.service_type || '').toLowerCase())
    && ['comfyui', 'comfy_ui'].includes(String(form.value.api_protocol || form.value.provider || '').toLowerCase())
))

/** 当前服务类型下的预设厂商列表（编辑时若当前 provider 不在列表则补一项；末尾始终附一项自定义入口） */
const availableProviderOptions = computed(() => buildAvailableProviderOptions(
  form.value.service_type,
  form.value.provider,
  { editingId: editingId.value },
))

/** 当前厂商的预设模型列表（用于追加预设模型） */
const availableModels = computed(() => buildAvailableModels(form.value.service_type, form.value.provider))

const providerModelEmptyHint = computed(() => describeProviderModelEmptyHint(
  form.value.service_type,
  form.value.provider,
  availableModels.value,
))

const endpointPreviewInfo = computed(() => buildEndpointPreviewInfo(form.value))

function onProviderChange(providerId) {
  applyProviderSelection(form.value, providerId, { editingId: editingId.value })
}

function onRowEdit(row) {
  if (configWriteLocked.value) return
  const target = describeConfigEditTarget(row)
  if (target.tab) {
    activeTab.value = target.tab
    ElMessage.info(target.message)
    return
  }
  openEdit(row)
}

async function handleSd2AssetSaved() {
  invalidateConnectionTestResults()
  notifyConfigurationChanged()
  await loadList()
}

async function loadList() {
  configListAbortController?.abort()
  const controller = new AbortController()
  configListAbortController = controller
  const requestId = ++configListLoadSequence
  loading.value = true
  configLoadState.value = list.value.length ? 'refreshing' : 'loading'
  try {
    const nextList = await withRequestRetry(
      () => aiAPI.list(undefined, jsonRequestOptions(controller.signal)),
      { maxAttempts: 2, delayMs: 400, signal: controller.signal },
    )
    if (requestId !== configListLoadSequence) return false
    list.value = nextList
    sessionTestStatusById.value = connectionStatusStore.forConfigs(list.value)
    configLoadError.value = ''
    configLoadState.value = 'ready'
    return true
  } catch (error) {
    if (isRequestCanceled(error) || requestId !== configListLoadSequence) return false
    configLoadError.value = describeServiceLoadError(error, {
      serviceLabel: 'AI 配置服务',
      fallback: '暂时无法读取 AI 配置，请稍后重试。',
      signal: controller.signal,
    })
    configLoadState.value = 'error'
    return false
  } finally {
    if (requestId === configListLoadSequence) loading.value = false
    if (configListAbortController === controller) configListAbortController = null
  }
}

function resetForm() {
  resetDiscoverModelsState()
  editingId.value = null
  editingUpdatedAt.value = ''
  presetModelPick.value = ''
  advancedFormSections.value = []
  clearConfigValidationSummary()
  form.value = createBlankAiConfigForm()
  formRef.value?.resetFields?.()
}

function configFormFingerprint() {
  return fingerprintConfigForm(form.value)
}

const configFormDirty = computed(() => (
  dialogVisible.value
  && Boolean(configFormBaseline.value)
  && configFormFingerprint() !== configFormBaseline.value
))
const credentialDraftDirty = computed(() => (
  (oneKeyTongyiVisible.value && Boolean(oneKeyTongyiKey.value.trim()))
  || (oneKeyVolcVisible.value && Boolean(oneKeyVolcKey.value.trim()))
  || (oneKeyAgnesVisible.value && Boolean(oneKeyAgnesKey.value.trim()))
  || (bulkKeyVisible.value && Boolean(bulkKeyInput.value.trim()))
))

const {
  configFieldDescriptionId,
  isConfigFieldInvalid,
  configFieldDescription,
  clearConfigValidationSummary,
  handleConfigFieldValidated,
  handleConfigValidationFailure,
  hasUnsavedChanges,
  confirmDiscard,
  requestClose,
  confirmConfigDialogClose,
  requestConfigDialogClose,
  confirmOneKeyTongyiClose,
  confirmOneKeyVolcClose,
  confirmOneKeyAgnesClose,
  confirmBulkKeyClose,
  requestOneKeyTongyiClose,
  requestOneKeyVolcClose,
  requestOneKeyAgnesClose,
  requestBulkKeyClose,
} = useAiConfigUnsaved({
  formModelList,
  isComfyUiForm,
  configValidationSummary,
  advancedFormSections,
  configDialogScrollRef,
  configFormDirty,
  generationSettingsDirty,
  credentialDraftDirty,
  promptEditorRef,
  sceneModelMapRef,
  configDialogSaved,
  dialogVisible,
  oneKeyTongyiKey,
  oneKeyTongyiVisible,
  oneKeyVolcKey,
  oneKeyVolcVisible,
  oneKeyAgnesKey,
  oneKeyAgnesVisible,
  bulkKeyInput,
  bulkKeyVisible,
  discardMessage: '当前 AI 配置尚未保存，关闭后本次修改会丢失。',
  discardTitle: '放弃未保存修改？',
  discardConfirmText: '放弃修改',
  discardCancelText: '继续编辑',
})

defineExpose({
  hasUnsavedChanges,
  requestClose,
})

function openConfigDialog() {
  configDialogSaved.value = false
  clearConfigValidationSummary()
  dialogVisible.value = true
  nextTick(() => {
    configFormBaseline.value = configFormFingerprint()
    if (configDialogScrollRef.value) configDialogScrollRef.value.scrollTop = 0
  })
}

function handleConfigDialogClosed() {
  resetForm()
  configFormBaseline.value = ''
  configDialogSaved.value = false
}

function openAdd() {
  if (configWriteLocked.value) return
  resetForm()
  openConfigDialog()
}

function openAddForService(serviceType) {
  if (configWriteLocked.value) return
  resetForm()
  form.value.service_type = serviceType || 'text'
  activeServiceFilter.value = form.value.service_type
  onServiceTypeChange()
  openConfigDialog()
}

async function openEdit(row, { repairIssue = '' } = {}) {
  if (configWriteLocked.value) return
  editingId.value = row.id
  editingUpdatedAt.value = String(row.updated_at || '')
  advancedFormSections.value = []
  form.value = hydrateAiConfigForm(row)
  openConfigDialog()
  await applyAiConfigRepairTarget(repairIssue, {
    advancedSections: advancedFormSections,
    fieldRefs: {
      credentials: apiKeyInputRef,
      model: modelListInputRef,
      workflow: workflowInputRef,
    },
    nextTickFn: nextTick,
  })
}

async function confirmReplaceDefaultConfig() {
  if (!form.value.is_default) return true
  const serviceType = form.value.service_type
  const currentId = editingId.value
  const existing = list.value.find((row) => (
    row.service_type === serviceType
    && row.is_default
    && String(row.id) !== String(currentId || '')
  ))
  if (!existing) return true
  const nextName = String(form.value.name || '').trim() || '未命名配置'
  const previousName = String(existing.name || '').trim() || '未命名配置'
  try {
    await ElMessageBox.confirm(
      `确定将「${nextName}」设为${serviceTypeLabel(serviceType)}的默认配置？当前默认「${previousName}」会被替换。`,
      '保存确认',
      { type: 'warning', confirmButtonText: '确认保存', cancelButtonText: '取消' },
    )
    return true
  } catch (error) {
    if (!isUserFacingAbort(error)) {
      ElMessage.error(toUserFacingError(error, '无法确认保存'))
    }
    return false
  }
}

async function submit() {
  if (configWriteLocked.value) return
  try {
    await formRef.value?.validate?.()
  } catch (invalidFields) {
    await handleConfigValidationFailure(invalidFields)
    return
  }
  clearConfigValidationSummary()
  if (!await confirmReplaceDefaultConfig()) return
  if (configWriteLocked.value) return
  saving.value = true
  try {
    let modelList = parseModelText(form.value.modelText)
    if (form.value.service_type === 'jimeng2_character_auth' && modelList.length === 0) {
      modelList = ['-']
    }
    const defaultModel = form.value.default_model || null
    // TTS / 可灵 Omni 官方 AKSK / DeepSeek V4 / 成本单价统一打包进 settings。
    const previous = editingId.value
      ? list.value.find((row) => String(row.id) === String(editingId.value))
      : null
    const settingsObject = parseSettingsObject(previous?.settings)
    if (isComfyUiForm.value) settingsObject.workflow = parseComfyWorkflowJson(form.value.comfy_workflow_json)
    else {
      delete settingsObject.workflow
      delete settingsObject.workflow_json
      delete settingsObject.workflow_template
    }
    if (form.value.service_type === 'tts') {
      if (form.value.voice_id) settingsObject.voice_id = form.value.voice_id
      else delete settingsObject.voice_id
      if (form.value.group_id) settingsObject.group_id = form.value.group_id
      else delete settingsObject.group_id
    } else if (form.value.service_type === 'video' && form.value.api_protocol === 'kling_omni') {
      if ((form.value.kling_access_key || '').trim()) settingsObject.kling_access_key = form.value.kling_access_key.trim()
      else delete settingsObject.kling_access_key
      if ((form.value.kling_secret_key || '').trim()) settingsObject.kling_secret_key = form.value.kling_secret_key.trim()
      else delete settingsObject.kling_secret_key
      if (form.value.kling_secret_key_base64) settingsObject.kling_secret_key_base64 = true
      else delete settingsObject.kling_secret_key_base64
    } else if (isDeepSeekOfficialForm.value) {
      settingsObject.deepseek_thinking = form.value.deepseek_thinking === 'enabled' ? 'enabled' : 'disabled'
      if (settingsObject.deepseek_thinking === 'enabled') {
        settingsObject.deepseek_reasoning_effort = form.value.deepseek_reasoning_effort === 'max' ? 'max' : 'high'
      } else {
        delete settingsObject.deepseek_reasoning_effort
      }
    }
    const pricing = buildProviderPricing(form.value.service_type, form.value)
    if (pricing) settingsObject.pricing = pricing
    else delete settingsObject.pricing
    const settings = Object.keys(settingsObject).length ? JSON.stringify(settingsObject) : null
    const payload = {
      service_type: form.value.service_type,
      name: form.value.name,
      provider: form.value.provider,
      api_protocol: form.value.api_protocol || '',
      base_url: form.value.base_url,
      api_key: form.value.api_key,
      endpoint: form.value.endpoint || '',
      query_endpoint: form.value.query_endpoint || '',
      model: modelList,
      default_model: defaultModel,
      priority: form.value.priority,
      is_default: form.value.is_default,
      settings,
      ...(editingId.value && editingUpdatedAt.value
        ? { expected_updated_at: editingUpdatedAt.value }
        : {}),
    }
    const wasEditing = Boolean(editingId.value)
    const mutationResult = await runWithOwnedRequestErrorToast(async () => (
      wasEditing
        ? await aiAPI.update(editingId.value, payload)
        : await aiAPI.create(payload)
    ))
    const serverConfirmation = confirmAiConfigMutationResult(mutationResult, payload, previous || {})
    if (!serverConfirmation) {
      await loadList()
      ElMessage.error('服务端返回的配置快照与本次提交不一致，未确认保存结果，请重新打开配置核对。')
      return
    }
    const listConfirmed = await loadList()
    const listMatches = listConfirmed && confirmAiConfigMutationInList(serverConfirmation, list.value)
    invalidateConnectionTestResults()
    notifyConfigurationChanged()
    configDialogSaved.value = true
    configFormBaseline.value = configFormFingerprint()
    dialogVisible.value = false
    if (listMatches) ElMessage.success(wasEditing ? '保存成功' : '添加成功')
    else ElMessage.warning('服务端已确认保存，但配置列表刷新或并发校验未完全一致，请刷新后复核。')
  } catch (e) {
    if (isUserFacingAbort(e)) return
    if (e?.response?.status === 409) {
      await loadList()
      ElMessage.warning('配置已被其他操作更新，本次修改未覆盖现有配置，请重新打开后再保存。')
      return
    }
    ElMessage.error(toUserFacingError(e, '保存失败'))
  } finally {
    saving.value = false
  }
}

async function openTest(row) {
  if (row.service_type === 'jimeng2_character_auth') {
    ElMessage.info('即梦2角色认证无需在此联调；保存后请在创作页「角色」面板中点击「认证资产」验证。')
    return
  }
  if (row.service_type === 'model_ark_asset') {
    ElMessage.info('认证资产库请在「认证资产管理」标签页使用「刷新列表」验证连接。')
    return
  }
  if (testingConfigId.value !== null && lastTestedConfig && String(lastTestedConfig.id) === String(row.id)) return
  connectionTestAbortController?.abort()
  const controller = new AbortController()
  connectionTestAbortController = controller
  lastTestedConfig = row
  testingConfigId.value = row.id
  testVisible.value = true
  testResult.value = null
  testError.value = ''
  testErrorDetail.value = ''
  testResultAnnouncement.value = '正在测试连接'
  testServiceType.value = row.service_type || 'text'
  testSuggestDiscoverModels.value = isOpenAiCompatibleConfig(row)
  const testModel = row.default_model || (Array.isArray(row.model) ? row.model[0] : row.model)
  const operationId = createOperationId('ai_config_test')
  const startedAt = Date.now()
  logOperation({
    operation: 'ai_config_test',
    operationId,
    phase: 'start',
    configId: row.id,
    serviceType: row.service_type || 'text',
  })
  try {
    await aiAPI.testConnection({
      id: row.id,
      base_url: row.base_url,
      api_key: isMaskedSecret(row.api_key) ? undefined : row.api_key,
      model: testModel,
      provider: row.provider,
      endpoint: row.endpoint,
      service_type: row.service_type,
      settings: row.settings
    }, {
      signal: controller.signal,
      timeout: DEFAULT_CONNECTION_TEST_TIMEOUT_MS,
      suppressErrorToast: true,
    })
    testResult.value = true
    const testedAt = new Date().toISOString()
    connectionStatusStore.set(row.id, 'passed', testedAt)
    sessionTestStatusById.value = {
      ...sessionTestStatusById.value,
      [row.id]: { status: 'passed', testedAt },
    }
    testResultAnnouncement.value = '连接测试通过'
    logOperation({
      operation: 'ai_config_test',
      operationId,
      phase: 'success',
      durationMs: Date.now() - startedAt,
      configId: row.id,
      serviceType: row.service_type || 'text',
    })
  } catch (e) {
    if (isUserFacingAbort(e, controller.signal) || controller.signal.aborted) {
      if (testVisible.value && testingConfigId.value === row.id) {
        testResultAnnouncement.value = ''
      }
      return
    }
    testResult.value = false
    const described = describeConnectionTestError(e, controller.signal, row.service_type)
    testError.value = described.title
    testErrorDetail.value = described.detail
    const testedAt = new Date().toISOString()
    connectionStatusStore.set(row.id, 'failed', testedAt)
    sessionTestStatusById.value = {
      ...sessionTestStatusById.value,
      [row.id]: { status: 'failed', testedAt },
    }
    testResultAnnouncement.value = `连接测试失败：${testError.value}`
    logOperation({
      operation: 'ai_config_test',
      operationId,
      phase: 'error',
      durationMs: Date.now() - startedAt,
      configId: row.id,
      serviceType: row.service_type || 'text',
      error: testError.value,
    })
  } finally {
    if (connectionTestAbortController === controller) connectionTestAbortController = null
    if (testingConfigId.value === row.id) testingConfigId.value = null
  }
}

function retryConnectionTest() {
  if (!lastTestedConfig || testingConfigId.value !== null) return
  openTest(lastTestedConfig)
}

async function retryConfigDependencies() {
  await Promise.all([loadVendorLock(), loadList()])
}

onMounted(async () => {
  await initializeConnectionStatusStore()
  await Promise.all([loadVendorLock(), loadList(), loadGenerationSettings()])
  if (activeServiceFilter.value) await applyRequestedService(activeServiceFilter.value)
})

onBeforeUnmount(() => {
  abortAiConfigPageRequests()
})
</script>

<style>
.provider-custom-option {
  border-top: 1px solid var(--el-border-color-light, #e4e7ed);
  margin-top: 4px;
  padding-top: 4px;
  color: var(--el-color-primary, #409eff) !important;
  font-style: italic;
}

.ai-config-form-dialog {
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-config-form-dialog > .el-dialog__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.ai-config-content,
.ai-config-overlay {
  --ai-config-success-surface: #ecfdf5;
  --ai-config-success-border: rgba(16, 185, 129, 0.24);
  --ai-config-success-text: #047857;
  --ai-config-warning-surface: #fffbeb;
  --ai-config-warning-border: rgba(245, 158, 11, 0.24);
  --ai-config-warning-text: #a16207;
  --ai-config-danger-surface: #fef2f2;
  --ai-config-danger-border: rgba(239, 68, 68, 0.24);
  --ai-config-danger-text: #b91c1c;
  --ai-config-info-surface: #eff6ff;
  --ai-config-info-border: rgba(59, 130, 246, 0.24);
  --ai-config-info-text: #0369a1;
  --ai-config-code-surface: var(--el-fill-color, #f0f2f5);
}

html.dark .ai-config-content,
html.dark .ai-config-overlay {
  color-scheme: dark;
  --el-bg-color: var(--bg-card);
  --el-bg-color-page: var(--bg-page);
  --el-bg-color-overlay: var(--bg-card);
  --el-fill-color: var(--bg-hover);
  --el-fill-color-light: var(--bg-inner);
  --el-fill-color-lighter: var(--bg-hover);
  --el-fill-color-extra-light: var(--bg-inner);
  --el-fill-color-blank: var(--bg-card);
  --el-text-color-primary: var(--text-bright);
  --el-text-color-regular: var(--text-primary);
  --el-text-color-secondary: var(--text-muted);
  --el-text-color-placeholder: var(--text-subtle);
  --el-text-color-disabled: var(--text-faint);
  --el-border-color: var(--border-muted);
  --el-border-color-light: var(--border-color);
  --el-border-color-lighter: var(--border-color);
  --el-border-color-extra-light: var(--border-color);
  --el-disabled-bg-color: var(--bg-hover);
  --el-disabled-text-color: var(--text-subtle);
  --el-mask-color: rgba(0, 0, 0, 0.72);
  --el-table-bg-color: var(--bg-card);
  --el-table-tr-bg-color: var(--bg-card);
  --el-table-header-bg-color: var(--bg-inner);
  --el-table-row-hover-bg-color: var(--bg-hover);
  --el-table-current-row-bg-color: var(--bg-hover);
  --el-table-border-color: var(--border-color);
  --el-table-text-color: var(--text-primary);
  --el-table-header-text-color: var(--text-muted);
  --el-color-primary-light-9: rgba(64, 158, 255, 0.14);
  --el-color-primary-light-8: rgba(64, 158, 255, 0.22);
  --el-color-primary-light-7: rgba(64, 158, 255, 0.34);
  --el-color-success-light-9: rgba(16, 185, 129, 0.14);
  --el-color-warning-light-9: rgba(245, 158, 11, 0.14);
  --el-color-danger-light-9: rgba(239, 68, 68, 0.14);
  --el-color-info-light-9: rgba(148, 163, 184, 0.14);
  --ai-config-success-surface: rgba(16, 185, 129, 0.14);
  --ai-config-success-border: rgba(52, 211, 153, 0.4);
  --ai-config-success-text: #6ee7b7;
  --ai-config-warning-surface: rgba(245, 158, 11, 0.14);
  --ai-config-warning-border: rgba(251, 191, 36, 0.4);
  --ai-config-warning-text: #fcd34d;
  --ai-config-danger-surface: rgba(239, 68, 68, 0.14);
  --ai-config-danger-border: rgba(248, 113, 113, 0.4);
  --ai-config-danger-text: #fca5a5;
  --ai-config-info-surface: rgba(59, 130, 246, 0.14);
  --ai-config-info-border: rgba(96, 165, 250, 0.4);
  --ai-config-info-text: #93c5fd;
  --ai-config-code-surface: var(--bg-hover);
}

html.dark .ai-config-overlay {
  --el-dialog-bg-color: var(--bg-card);
  background: var(--bg-card);
  border: 1px solid var(--border-muted);
  color: var(--text-primary);
}

html.dark .el-dialog:has(.ai-config-content) {
  --el-dialog-bg-color: var(--bg-card);
  background: var(--bg-card);
  border: 1px solid var(--border-muted);
  color: var(--text-primary);
}

html.dark .ai-config-overlay :is(.el-dialog__title, .el-dialog__body) {
  color: var(--text-primary);
}

html.dark .el-dialog:has(.ai-config-content) :is(.el-dialog__title, .el-dialog__body) {
  color: var(--text-primary);
}

html.dark :is(.ai-config-content, .ai-config-overlay) :is(
  .el-input__wrapper,
  .el-select__wrapper,
  .el-textarea__inner,
  .el-input-number
) {
  background: var(--bg-inner);
  color: var(--text-primary);
}

html.dark :is(.ai-config-content, .ai-config-overlay) .el-table {
  background: var(--el-table-bg-color);
  color: var(--el-table-text-color);
}

html.dark :is(.ai-config-content, .ai-config-overlay) .el-table__inner-wrapper::before {
  background-color: var(--el-table-border-color);
}

html.dark :is(.ai-config-content, .ai-config-overlay) :is(
  .tab-content,
  .el-dialog__body,
  .el-scrollbar__wrap,
  .el-table__body-wrapper
) {
  scrollbar-color: var(--border-muted) transparent;
  scrollbar-width: thin;
}

html.dark :is(.ai-config-content, .ai-config-overlay) :is(
  .tab-content,
  .el-dialog__body,
  .el-scrollbar__wrap,
  .el-table__body-wrapper
)::-webkit-scrollbar-thumb {
  background: var(--border-muted);
  border: 2px solid var(--bg-card);
  border-radius: 8px;
}
</style>

<style scoped>
.ai-config-content {
  padding: 0;
}
.ai-config-dialog-scroll {
  max-height: calc(92vh - 150px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 4px;
  scrollbar-gutter: stable;
}
.ai-config-validation-summary {
  position: sticky;
  top: 0;
  z-index: 3;
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid var(--ai-config-danger-border, #fbc4c4);
  border-radius: 6px;
  background: var(--ai-config-danger-surface, #fef0f0);
  color: var(--ai-config-danger-text, #b42318);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}
.ai-config-validation-summary strong {
  display: block;
  font-size: 13px;
  line-height: 20px;
}
.ai-config-validation-summary ul {
  margin: 4px 0 0;
  padding-left: 20px;
  font-size: 12px;
  line-height: 1.6;
}
.config-field-a11y-description {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.config-tabs {
  margin-top: -4px;
}
.tab-content {
  padding-top: 16px;
  min-width: 0;
}
.config-workspace-switch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 16px;
  padding: 3px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-inner);
}
.config-workspace-mode {
  min-width: 112px;
  min-height: 32px;
  padding: 5px 12px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  cursor: pointer;
}
.config-workspace-mode:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.config-workspace-mode.active {
  color: var(--accent-text);
  border-color: var(--border-muted);
  background: var(--bg-hover);
}
.config-workspace-mode:focus-visible {
  outline: 2px solid var(--accent-text);
  outline-offset: 2px;
}
.config-workspace-panel {
  min-width: 0;
}
.coverage-panel {
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  background: var(--el-bg-color, #fff);
}
.coverage-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 14px;
}
.coverage-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.coverage-title-row h2 {
  margin: 0;
  color: var(--el-text-color-primary, #303133);
  font-size: 16px;
  line-height: 24px;
  letter-spacing: 0;
}
.coverage-header p {
  margin: 4px 0 0;
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
  line-height: 1.5;
}
.coverage-test-note {
  max-width: 260px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  line-height: 1.5;
  text-align: right;
}
.test-result-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.coverage-unresolved-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 88px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  background: var(--el-fill-color-light, #f5f7fa);
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
  line-height: 1.5;
}
.coverage-unresolved-state--error {
  border-color: var(--ai-config-danger-border, #fbc4c4);
  background: var(--ai-config-danger-surface, #fef0f0);
  color: var(--ai-config-danger-text, #b42318);
}
.coverage-unresolved-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}
.coverage-unresolved-copy strong {
  font-size: 13px;
  line-height: 18px;
}
.coverage-unresolved-copy span,
.config-empty-state > span {
  overflow-wrap: anywhere;
}
.coverage-summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}
.coverage-summary-card {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 6px;
  background: var(--el-fill-color-blank, #fff);
}
.coverage-summary-card span {
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  line-height: 18px;
}
.coverage-summary-card strong {
  color: var(--el-text-color-primary, #303133);
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
}
.coverage-summary-card.summary-success {
  border-color: var(--ai-config-success-border, rgba(16, 185, 129, 0.24));
  background: var(--ai-config-success-surface, #ecfdf5);
}
.coverage-summary-card.summary-warning {
  border-color: var(--ai-config-warning-border, rgba(245, 158, 11, 0.24));
  background: var(--ai-config-warning-surface, #fffbeb);
}
.coverage-summary-card.summary-danger {
  border-color: var(--ai-config-danger-border, rgba(239, 68, 68, 0.24));
  background: var(--ai-config-danger-surface, #fef2f2);
}
.coverage-summary-card.summary-info {
  border-color: var(--ai-config-info-border, rgba(59, 130, 246, 0.24));
  background: var(--ai-config-info-surface, #eff6ff);
}
.coverage-summary-card.summary-success strong { color: var(--ai-config-success-text, #047857); }
.coverage-summary-card.summary-warning strong { color: var(--ai-config-warning-text, #a16207); }
.coverage-summary-card.summary-danger strong { color: var(--ai-config-danger-text, #b91c1c); }
.coverage-summary-card.summary-info strong { color: var(--ai-config-info-text, #0369a1); }
.config-filter-bar {
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 6px 10px;
  border: 1px solid var(--el-color-primary-light-7, #c6e2ff);
  border-radius: 6px;
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
}
.filter-count {
  margin-left: 6px;
  color: var(--el-text-color-secondary, #909399);
}
.config-empty-state {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--el-text-color-regular, #606266);
}
.config-empty-state strong {
  color: var(--el-text-color-primary, #303133);
  font-size: 14px;
}
.config-empty-state > span {
  max-width: 440px;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}
.config-empty-icon {
  color: var(--el-color-primary, #409eff);
  font-size: 28px;
}
.config-empty-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.config-form-section {
  margin-bottom: 18px;
  padding: 16px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  background: var(--el-fill-color-blank, #fff);
}
.config-list-section {
  scroll-margin-top: 88px;
}
.config-policy-section {
  margin-bottom: 0;
}
.config-section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.config-section-header h4 {
  margin: 0;
  color: var(--el-text-color-primary, #303133);
  font-size: 15px;
  line-height: 22px;
}
.config-section-header p {
  margin: 4px 0 0;
  color: var(--el-text-color-regular, #606266);
  font-size: 12px;
  line-height: 1.5;
}
.config-section-index {
  flex: 0 0 auto;
  min-width: 34px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--el-color-primary-light-9, #ecf5ff);
  color: var(--el-color-primary, #409eff);
  font-size: 12px;
  font-weight: 600;
}
.advanced-config-collapse {
  margin-bottom: 18px;
}
.advanced-config-title {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-right: 12px;
}
.advanced-config-title span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.advanced-config-title strong {
  color: var(--el-text-color-primary, #303133);
  font-size: 14px;
  line-height: 20px;
}
.advanced-config-title small {
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  line-height: 18px;
}
.advanced-config-content {
  padding-top: 8px;
}
.content-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 16px;
}
.config-load-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid var(--ai-config-info-border, #c6e2ff);
  border-radius: 8px;
  background: var(--ai-config-info-surface, #ecf5ff);
  color: var(--ai-config-info-text, #1d4ed8);
}
.config-load-state--error {
  border-color: var(--ai-config-danger-border, #fbc4c4);
  background: var(--ai-config-danger-surface, #fef0f0);
  color: var(--ai-config-danger-text, #b42318);
}
.config-load-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}
.config-load-copy strong {
  color: inherit;
  font-size: 13px;
  line-height: 18px;
}
.config-load-copy span {
  font-size: 12px;
  line-height: 1.45;
}
.actions-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.actions-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 过渡动画 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s ease;
}
.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(8px);
}

/* 类型徽章 */
.type-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  border: 1px solid transparent;
}
.type-icon {
  font-size: 13px;
  flex-shrink: 0;
}

/* 文本/对话 — 蓝色 */
.type-text {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
  border-color: rgba(59, 130, 246, 0.25);
}
/* 文本生成图片 — 绿色 */
.type-image {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.25);
}
/* 分镜图片生成 — 紫色 */
.type-storyboard_image {
  background: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
  border-color: rgba(139, 92, 246, 0.25);
}
/* 视频 — 橙色 */
.type-video {
  background: rgba(249, 115, 22, 0.12);
  color: #f97316;
  border-color: rgba(249, 115, 22, 0.25);
}
.type-ocr {
  background: rgba(14, 165, 233, 0.12);
  color: #0284c7;
  border-color: rgba(14, 165, 233, 0.25);
}
.type-transcription {
  background: rgba(234, 88, 12, 0.12);
  color: #c2410c;
  border-color: rgba(234, 88, 12, 0.25);
}
.jimeng2-assets-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  width: 100%;
}
.jimeng2-assets-tip {
  flex: 1;
  min-width: 200px;
  margin: 0;
  line-height: 1.5;
}

.type-jimeng2_character_auth {
  background: rgba(20, 184, 166, 0.14);
  color: #0d9488;
  border-color: rgba(20, 184, 166, 0.28);
}

.type-model_ark_asset {
  background: rgba(99, 102, 241, 0.12);
  color: #6366f1;
  border-color: rgba(99, 102, 241, 0.25);
}

.no-default {
  color: var(--el-text-color-secondary, #9ca3af);
  font-size: 13px;
}
.one-key-tip {
  margin: 0 0 12px;
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
  line-height: 1.5;
}
.one-key-not-recommended {
  margin-left: 4px;
  padding: 0 5px;
  font-size: 11px;
  line-height: 18px;
  border-radius: 4px;
  color: var(--el-color-warning, #e6a23c);
  background: var(--el-color-warning-light-9, #fdf6ec);
  border: 1px solid var(--el-color-warning-light-7, #f5dab1);
  vertical-align: middle;
}
.one-key-help {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.one-key-section {
  background: var(--el-fill-color-light, #f5f7fa);
  border-radius: 8px;
  padding: 12px 14px;
}
.one-key-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
  margin-bottom: 8px;
}
.one-key-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
  line-height: 1.8;
}
.one-key-list li {
  margin-bottom: 2px;
}
.one-key-link {
  color: var(--el-color-primary, #409eff);
  text-decoration: none;
}
.one-key-link:hover {
  text-decoration: underline;
}
.one-key-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.5;
}
.one-key-note + .one-key-note {
  margin-top: 4px;
}
code {
  background: var(--ai-config-code-surface, #f0f2f5);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
  font-family: monospace;
}
.cfg-tip-content code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
  font-family: monospace;
}
.default-tip {
  margin: 0 0 16px;
  padding: 10px 12px;
  border: 1px solid var(--ai-config-info-border, #bae6fd);
  background: var(--ai-config-info-surface, #f0f9ff);
  border-radius: 6px;
  font-size: 13px;
  color: var(--ai-config-info-text, #0369a1);
  line-height: 1.5;
}
.vendor-lock-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.vendor-lock-bar .vendor-lock-tip {
  flex: 1;
  margin-bottom: 0;
}
.vendor-bulk-key-btn {
  white-space: nowrap;
  flex-shrink: 0;
  color: #fff !important;
}
.vendor-lock-tip {
  margin-bottom: 16px;
}
.deepseek-settings {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.field-tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.4;
}
.field-tip-warning {
  color: var(--el-color-warning-dark-2, #b88230);
  font-weight: 500;
}
.form-label-tip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.tip-icon {
  font-size: 13px;
  color: var(--el-text-color-secondary, #909399);
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s;
}
.tip-icon:hover {
  color: var(--el-color-primary, #409eff);
}
.pricing-field-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.pricing-field-row span {
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  white-space: nowrap;
}
.pricing-help {
  margin: -4px 0 14px 100px;
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
  line-height: 1.5;
}
.tip-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.tip-button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.endpoint-preview-box {
  background: var(--ai-config-info-surface, #f0f7ff);
  border: 1px solid var(--ai-config-info-border, #c6e0ff);
  border-radius: 6px;
  padding: 10px 14px;
  margin: -4px 0 14px;
  font-size: 12px;
}
.ep-preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--ai-config-info-text, #409eff);
  margin-bottom: 8px;
  font-size: 12px;
}
.ep-auto-badge {
  background: var(--ai-config-info-surface, #e6f1ff);
  color: var(--ai-config-info-text, #409eff);
  border: 1px solid var(--ai-config-info-border, #b3d8ff);
  border-radius: 3px;
  padding: 0 5px;
  font-size: 11px;
  font-weight: 400;
}
.ep-row {
  display: flex;
  align-items: flex-start;
  margin-bottom: 5px;
  gap: 6px;
  line-height: 1.5;
}
.ep-row:last-of-type {
  margin-bottom: 0;
}
.ep-label {
  flex-shrink: 0;
  color: var(--el-text-color-regular, #606266);
  min-width: 68px;
}
.ep-url {
  word-break: break-all;
  color: var(--el-text-color-primary, #303133);
  background: var(--el-fill-color-blank, rgba(255,255,255,0.7));
  border: 1px solid var(--ai-config-info-border, #dce8fa);
  border-radius: 3px;
  padding: 1px 6px;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 11.5px;
  line-height: 1.6;
}
.ep-tip {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.4;
}
.ep-tip-warn {
  color: var(--ai-config-warning-text, #e6a23c);
}
.ep-box-gemini {
  background: var(--ai-config-warning-surface, #fffbf0);
  border-color: var(--ai-config-warning-border, #f5dfa0);
}
.ep-box-gemini .ep-preview-header {
  color: var(--ai-config-warning-text, #b8860b);
}
.ep-badge-gemini {
  background: var(--ai-config-warning-surface, #fef6e0);
  color: var(--ai-config-warning-text, #b8860b);
  border-color: var(--ai-config-warning-border, #f0d080);
}
.generation-settings {
  max-width: 600px;
}
.generation-settings-load-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 52px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 6px;
  background: var(--el-fill-color-light, #f5f7fa);
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
}
.generation-settings-load-state--error {
  border-color: var(--el-color-danger-light-5, #fab6b6);
  background: var(--el-color-danger-light-9, #fef0f0);
}
.generation-settings-load-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}
.generation-settings-load-copy strong {
  color: var(--el-color-danger, #f56c6c);
}
.generation-settings-load-copy span {
  overflow-wrap: anywhere;
}
.gs-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
  margin-bottom: 8px;
}
.gs-desc {
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
  line-height: 1.6;
  margin-bottom: 20px;
}
.gs-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.gs-label {
  font-size: 13px;
  color: var(--el-text-color-primary, #303133);
  font-weight: 500;
  white-space: nowrap;
}
.gs-unit {
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
  white-space: nowrap;
}
.gs-tip-box {
  margin-top: 20px;
  background: var(--el-fill-color-light, #f5f7fa);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  padding: 14px 16px;
  font-size: 13px;
}
.gs-tip-title {
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
  margin-bottom: 8px;
}
.gs-tip-list {
  margin: 0 0 8px 16px;
  padding: 0;
  color: var(--el-text-color-regular, #606266);
  line-height: 1.8;
}
.gs-tip-note {
  color: var(--el-text-color-secondary, #909399);
  font-size: 12px;
}
@media (max-width: 1440px) {
  .coverage-summary-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 760px) {
  .ai-config-content,
  .tab-content,
  .config-workspace-panel {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  .coverage-summary-strip {
    grid-template-columns: minmax(0, 1fr);
  }
  .coverage-header,
  .content-actions,
  .vendor-lock-bar,
  .generation-settings-load-state {
    align-items: stretch;
    flex-direction: column;
  }
  .coverage-header {
    gap: 8px;
  }
  .coverage-test-note {
    max-width: none;
    text-align: left;
  }
  .config-workspace-switch {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    box-sizing: border-box;
  }
  .config-workspace-mode {
    min-width: 0;
  }
  .actions-right,
  .config-empty-actions,
  .pricing-field-row,
  .gs-row {
    flex-wrap: wrap;
  }
  .actions-right {
    flex-shrink: 1;
    max-width: 100%;
  }
  .config-filter-bar,
  .config-section-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .pricing-help {
    margin-left: 0;
  }
  :deep(.el-tabs__content),
  :deep(.el-tab-pane),
  :deep(.el-form-item__content),
  :deep(.el-input),
  :deep(.el-select) {
    min-width: 0;
    max-width: 100%;
  }
}
@media (max-width: 520px) {
  .coverage-panel,
  .config-form-section {
    padding: 12px;
  }
  .config-workspace-switch {
    grid-template-columns: minmax(0, 1fr);
  }
  .config-empty-actions,
  .actions-right {
    align-items: stretch;
    flex-direction: column;
    width: 100%;
  }
  .actions-right :deep(.el-button),
  .config-empty-actions :deep(.el-button) {
    margin-left: 0;
    width: 100%;
  }
  .advanced-config-title {
    align-items: flex-start;
    flex-direction: column;
  }
  .ep-row {
    flex-direction: column;
  }
  .ep-label {
    min-width: 0;
  }
}
</style>
