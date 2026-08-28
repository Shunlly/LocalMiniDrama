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
                  <el-tag :type="serviceCoverage.ready ? 'success' : 'warning'" size="small" effect="light">
                    {{ serviceCoverage.readyCount }}/{{ serviceCoverage.totalCount }} 类可用
                  </el-tag>
                </div>
                <p>每类服务可用需启用默认配置；默认配置还需凭据、模型或工作流完整。</p>
              </div>
              <span class="coverage-test-note">连接测试结果来自后端记录或此设备保存的最近结果</span>
            </div>
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
            <div class="coverage-grid">
              <article
                v-for="item in orderedCoverageServices"
                :key="item.type"
                :ref="(element) => setCoverageCardRef(item.type, element)"
                class="coverage-item"
                tabindex="-1"
                :aria-label="`${item.label}，${coverageStateLabel(item)}，${coverageTestLabel(item.test)}`"
                :class="[
                  `coverage-${item.state}`,
                  { 'is-selected': activeServiceFilter === item.type },
                ]"
              >
                <button
                  type="button"
                  class="coverage-select"
                  :aria-pressed="activeServiceFilter === item.type"
                  @click="onCoverageSelect(item)"
                >
                  <span :class="['coverage-icon', `coverage-icon-${item.type}`]">
                    <el-icon>
                      <ChatDotRound v-if="item.type === 'text'" />
                      <Picture v-else-if="item.type === 'image'" />
                      <Film v-else-if="item.type === 'storyboard_image'" />
                      <VideoCamera v-else-if="item.type === 'video'" />
                      <Microphone v-else />
                    </el-icon>
                  </span>
                  <span class="coverage-item-main">
                    <span class="coverage-item-heading">
                      <strong>{{ item.label }}</strong>
                      <el-tag :type="coverageStateTagType(item)" size="small" effect="plain">
                        {{ coverageStateLabel(item) }}
                      </el-tag>
                    </span>
                    <span class="coverage-description">{{ item.description }}</span>
                    <span class="coverage-config-count">{{ coverageInventoryLabel(item) }}</span>
                    <span class="coverage-config-detail">{{ coverageConfigDetail(item) }}</span>
                    <span :class="['coverage-test-status', `test-${item.test.status}`]">
                      <span class="coverage-status-dot" />
                      {{ coverageTestLabel(item.test) }}
                    </span>
                  </span>
                </button>
                <span class="coverage-actions">
                  <el-button
                    v-for="action in coverageActions(item)"
                    :key="`${item.type}-${action.key}`"
                    :link="action.action !== 'test'"
                    :plain="action.action === 'test'"
                    size="small"
                    :type="action.action === 'test' ? 'primary' : (action.emphasis === 'primary' ? 'primary' : 'info')"
                    :class="['coverage-action-link', { 'coverage-action-test': action.action === 'test' }]"
                    :aria-label="action.label"
                    :aria-busy="isCoverageActionTesting(item, action)"
                    :loading="isCoverageActionTesting(item, action)"
                    :disabled="isCoverageActionDisabled(item, action)"
                    @click.stop="onCoverageAction(item, action)"
                  >
                    {{ action.label }}
                  </el-button>
                </span>
              </article>
            </div>
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
              <input ref="importFileRef" type="file" accept=".json" style="display:none" :disabled="configWriteLocked" @change="importConfigs" />
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
                <span>🔒 当前为厂商锁定模式，AI 服务由管理员统一配置。你只能修改 <b>API Key</b> 和 <b>默认模型</b>。</span>
              </template>
            </el-alert>
            <el-button plain size="small" @click="exportConfigs">
              <el-icon><Download /></el-icon>
              导出配置
            </el-button>
            <el-button type="primary" size="small" class="vendor-bulk-key-btn" :disabled="configWriteLocked" @click="openBulkKey">
              <el-icon><Key /></el-icon>
              一键换Key
            </el-button>
          </div>
          <div v-if="activeServiceFilter" class="config-filter-bar">
            <span>
              当前只看：<strong>{{ serviceTypeLabel(activeServiceFilter) }}</strong>
              <span class="filter-count">{{ filteredList.length }} 条</span>
            </span>
            <el-button link type="primary" @click="clearServiceFilter">查看全部配置</el-button>
          </div>
          <p class="default-tip">生成任务会优先使用同类服务中已启用的默认配置。即梦2角色认证和 SD2 资产库属于扩展能力，不计入上方五类基础生成服务。</p>
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
            <el-table-column prop="base_url" label="Base URL" min-width="170" show-overflow-tooltip />
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
                <el-button link type="primary" size="small" @click="openTest(row)">测试</el-button>
                <el-button link type="primary" size="small" :disabled="configWriteLocked" @click="onRowEdit(row)">{{ vendorLock.enabled ? '修改Key' : '编辑' }}</el-button>
                <el-button v-if="!vendorLock.enabled" link type="danger" size="small" :disabled="configWriteLocked" @click="onDelete(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div class="config-empty-state">
                <el-icon class="config-empty-icon"><MagicStick /></el-icon>
                <strong>{{ activeServiceFilter ? `暂无${serviceTypeLabel(activeServiceFilter)}配置` : '还没有 AI 服务配置' }}</strong>
                <span>
                  {{ activeServiceFilter ? '添加一个配置并设为默认，即可用于对应生成环节。' : '先添加文本、图片或视频厂商，生成流程会自动使用默认配置。' }}
                </span>
                <div class="config-empty-actions">
                  <el-button
                    v-if="!vendorLock.enabled"
                    type="primary"
                    size="small"
                    :disabled="configWriteLocked"
                    @click="openAddForService(activeServiceFilter || 'text')"
                  >
                    <el-icon><Plus /></el-icon>
                    {{ activeServiceFilter ? `添加${serviceTypeLabel(activeServiceFilter)}配置` : '添加第一个配置' }}
                  </el-button>
                  <el-button v-if="activeServiceFilter" size="small" @click="clearServiceFilter">查看全部</el-button>
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
              placeholder="选择或输入并发数"
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
              placeholder="选择或输入并发数"
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
      <el-tab-pane v-if="hasSavedConfigs" label="SD2 资产管理" name="sd2_assets">
        <div class="tab-content">
        <Sd2AssetManagement :configs="list" :write-locked="configWriteLocked || vendorLock.enabled" @saved="handleSd2AssetSaved" />
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 添加/编辑 -->
    <AccessibleDialog
      v-model="dialogVisible"
      :title="vendorLock.enabled ? '修改 API Key / 默认模型' : (editingId ? '编辑配置' : '添加配置')"
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
              {{ item.label }}：{{ item.message }}
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
          <el-form-item prop="api_key" :rules="[{ required: true, message: '请输入 API Key', trigger: 'blur' }]">
            <template #label><span class="form-label-tip">API Key</span></template>
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
            <p v-else class="field-tip">实际调用时使用的模型，可从预设列表中选择。</p>
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
                    <b>即梦2角色认证</b>：将角色主图登记到即梦业务素材库（SD2 认证），仅填网关 URL 与 Token
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-select
            v-model="form.service_type"
            data-ai-config-field="service_type"
            placeholder="选择类型"
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
              <p>选择预设厂商可自动带入模型和接口参数，也支持自定义兼容服务。</p>
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
                    也可直接输入自定义厂商名（需手动填写其他字段）。<br>
                    <b>推荐</b>：通义千问 / 火山引擎，国内访问稳定。
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-select
            v-model="form.provider"
            data-ai-config-field="provider"
            placeholder="选择预设厂商（自动填充 URL 和模型）"
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
          <div class="protocol-help">
            <div class="ph-section-title">🖼 图片 / 分镜图 协议</div>
            <el-collapse accordion>
              <el-collapse-item name="openai-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> OpenAI 兼容 — 绝大多数中转站默认</template>
                <div class="ph-body">
                  <b>适用场景：</b>OpenAI 官方、各类中转/代理站（ChatFire、硅基流动等）<br>
                  <b>Endpoint：</b><code>POST /v1/images/generations</code><br>
                  <pre>{ "model": "dall-e-3", "prompt": "...", "n": 1, "size": "1024x1024" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="volcengine-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> 火山引擎 — 豆包 Seedream</template>
                <div class="ph-body">
                  <b>Endpoint：</b><code>POST /api/v3/images/generations</code><br>
                  <b>Base URL：</b><code>https://ark.cn-beijing.volces.com/api/v3</code><br>
                  <pre>{ "model": "doubao-seedream-4-5-251128", "prompt": "...", "size": "1024x1024" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="dashscope-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> 通义万象 DashScope</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>https://dashscope.aliyuncs.com</code><br>
                  <b>Endpoint：</b><code>POST /api/v1/services/aigc/text2image/image-synthesis</code>
                </div>
              </el-collapse-item>
              <el-collapse-item name="gemini-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> Google Gemini</template>
                <div class="ph-body">
                  <b>认证：</b>URL 参数 <code>?key=API_KEY</code><br>
                  <b>Endpoint：</b><code>POST /v1beta/models/{model}:generateContent</code>
                </div>
              </el-collapse-item>
            </el-collapse>

            <div class="ph-section-title" style="margin-top:16px">🎬 视频 协议</div>
            <el-collapse accordion>
              <el-collapse-item name="openai-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> OpenAI 兼容 — content 数组格式</template>
                <div class="ph-body">
                  <b>适用场景：</b>各类中转站视频接口（ChatFire 等）<br>
                  <b>Endpoint：</b>自定义，如 <code>POST /v1/video/create</code><br>
                  <pre>{ "model": "sora-2-pro",
  "content": [
    { "type": "text", "text": "..." },
    { "type": "image_url", "image_url": { "url": "https://..." }, "role": "reference_image" }
  ],
  "ratio": "9:16", "duration": 5, "watermark": false, "resolution": "720p" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="sora-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Sora 中转站 — multipart/form-data</template>
                <div class="ph-body">
                  <b>适用场景：</b>Sora API 格式的中转站<br>
                  <b>默认 Endpoint：</b><code>POST /v1/videos</code>（创建），<code>GET /v1/videos/{taskId}</code>（查询）<br>
                  <b>请求格式：</b>multipart/form-data（非 JSON）<br>
                  <pre>model       = "sora-2"
prompt      = "..."
seconds     = "4" | "8" | "12"
size        = "720x1280" | "1280x720" | "1024x1792" | "1792x1024"
watermark   = "false"
private     = "false"
input_reference = (图片文件，可选)</pre>
                  <b>注意：</b>参考图会自动 resize 到与 size 一致后上传。
                </div>
              </el-collapse-item>
              <el-collapse-item name="veo3-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Veo3 兼容 — images + enhance_prompt</template>
                <div class="ph-body">
                  <b>适用场景：</b>Veo3 系列模型的 JSON 格式接口<br>
                  <b>默认 Endpoint：</b><code>POST /v1/video/create</code>（创建），<code>GET /v1/video/query?id={taskId}</code>（查询）<br>
                  <pre>{ "model": "veo3.1",
  "prompt": "...",
  "enhance_prompt": true,
  "images": ["data:image/jpeg;base64,..."]
}</pre>
                  <b>注意：</b><code>enhance_prompt: true</code> 会让接口自动将提示词翻译为英文。localhost 图片会自动转为 base64 内嵌。
                </div>
              </el-collapse-item>
              <el-collapse-item name="volcengine-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> 火山引擎 — 豆包 Seedance</template>
                <div class="ph-body">
                  <b>Endpoint：</b><code>POST …/contents/generations/tasks</code>（与后端一致）<br>
                  <b>Base URL：</b><code>https://ark.cn-beijing.volces.com/api/v3</code><br>
                  <pre>{ "model": "doubao-seedance-1-5-pro-251215",
  "content": [{ "type": "text", "text": "..." }],
  "ratio": "9:16", "duration": 5,
  "watermark": false, "resolution": "720p" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="volcengine-omni-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> 火山即梦 Seedance 全能（多图参考）</template>
                <div class="ph-body">
                  <b>适用：</b>方舟 Seedance 2.0 等支持多参考图的全能链路；与「全能模式」分镜、<code>@图片1</code>… 提示词配合使用。<br>
                  <b>Endpoint：</b><code>POST {base}/contents/generations/tasks</code>，轮询 <code>GET {base}/contents/generations/tasks/{taskId}</code><br>
                  <b>厂商：</b>仍选「火山引擎」，<b>接口规范</b>选本项；模型填控制台接入点（如 <code>doubao-seedance-2-0-260128</code>，以控制台为准）。<br>
                  <pre>{ "model": "doubao-seedance-2-0-260128",
  "task_type": "i2v",
  "content": [
    { "type": "text", "text": "… @图片1 … @图片2 …" },
    { "type": "image_url", "image_url": { "url": "https://..." } },
    { "type": "image_url", "image_url": { "url": "https://..." }, "role": "reference_image" }
  ],
  "ratio": "9:16", "duration": 8, "watermark": false }</pre>
                  <b>说明：</b>全能模式下列均为参考图（场景、角色…），每张均 <code>role: reference_image</code>；最多 9 张，时长 Seedance 2.x 按 4–15 秒吸附。
                </div>
              </el-collapse-item>
              <el-collapse-item name="dashscope-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> 通义万象 DashScope</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>https://dashscope.aliyuncs.com</code><br>
                  <b>Endpoint：</b><code>POST /api/v1/services/aigc/video-generation/video-synthesis</code><br>
                  <pre>{ "model": "wan2.2-kf2v-flash",
  "input": { "prompt": "...", "img_url": "https://..." },
  "parameters": { "size": "1280*720", "duration": 5 } }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="gemini-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Google Gemini — Veo 视频</template>
                <div class="ph-body">
                  <b>认证：</b>URL 参数 <code>?key=API_KEY</code><br>
                  <b>Endpoint：</b><code>POST /v1beta/models/{model}:generateVideo</code>
                </div>
              </el-collapse-item>
              <el-collapse-item name="vidu-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Vidu</template>
                <div class="ph-body">
                  <b>适用场景：</b>Vidu 官方及兼容接口<br>
                  <b>认证：</b><code>Authorization: Token {api_key}</code>（非 Bearer）<br>
                  <b>默认 Endpoint：</b><code>POST /ent/v2/img2video</code>（创建），<code>GET /ent/v2/tasks/{taskId}/creations</code>（查询）<br>
                  <pre>{ "model": "viduq3-pro",
  "images": ["https://..."],
  "prompt": "...",
  "duration": 5,
  "resolution": "720p",
  "movement_amplitude": "auto",
  "audio": false,
  "watermark": false
}</pre>
                  <b>注意：</b>官方 api.vidu.cn 用 <code>Token</code> 认证，中转站用 <code>Bearer</code>，系统自动识别。localhost 图片自动上传图床。
                </div>
              </el-collapse-item>
              <el-collapse-item name="jimeng-ai-api-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Jimeng AI API（自建服务）</template>
                <div class="ph-body">
                  <b>说明：</b>需自行部署 <code>jimeng-free-api-all</code> 等即梦 OpenAI 兼容服务并启动（如 <code>http://127.0.0.1:8000</code>）。本系统仅作为客户端转发请求。<br>
                  <b>Base URL：</b>填你的服务根地址，无尾斜杠。<br>
                  <b>API Key：</b>填即梦网页 <b>Session</b>；多个账号用<b>英文逗号</b>分隔，由对方服务轮询使用。<br>
                  <b>默认路径：</b><code>POST /v1/videos/generations</code>（可在「Endpoint」覆盖）。Seedance 多图需分镜参考图；响应为同步 <code>data[0].url</code>。
                </div>
              </el-collapse-item>
            </el-collapse>
          </div>
          <template #footer>
            <el-button @click="showProtocolHelp = false">关闭</el-button>
          </template>
        </AccessibleDialog>
        <el-form-item prop="api_key">
          <template #label>
            <span class="form-label-tip">{{ form.service_type === 'jimeng2_character_auth' ? 'Token' : 'API Key' }}
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
            :placeholder="form.service_type === 'jimeng2_character_auth' ? 'Bearer Token' : (form.provider === 'jimeng_ai_api' ? '即梦 Session，多个用英文逗号分隔' : 'API 密钥')"
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
          title="用于创作页「角色生成 → SD2认证」"
          description="保存后，系统从此处读取网关与 Token 调用 POST /api/business/v1/assets 登记角色图；可用「列出素材」核对素材状态。角色主图需为外网可访问的 http(s) 地址（图床或本服务 storage.base_url）。"
        />
        <template v-if="form.service_type === 'video' && form.api_protocol === 'kling_omni'">
          <el-form-item>
            <template #label><span class="form-label-tip">AccessKey</span></template>
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
              若接口返回 <code>1000 Authorization signature is invalid</code>：请确认 AccessKey/SecretKey 未填反、无多余空格；并尝试勾选下方「SecretKey 为 Base64」；
              Base URL 区域（<code>api-beijing.klingai.com</code> / <code>api-singapore.klingai.com</code>）须与密钥所属区域一致。
            </p>
          </el-form-item>
          <el-form-item>
            <template #label><span class="form-label-tip">SecretKey</span></template>
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
              placeholder="选择或输入声音 ID"
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
              <span class="form-label-tip">Group ID
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
              <!-- 接口规范：仅图片/分镜/视频类型显示，预设厂商自动填充；自定义厂商必选 -->
              <el-form-item
                v-if="form.service_type !== 'text' && form.service_type !== 'tts' && form.service_type !== 'jimeng2_character_auth'"
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
                  style="width: 100%"
                  placeholder="选择接口规范（自定义厂商必选）"
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
                  <el-option label="NanoBanana" value="nano_banana" />
                  <el-option label="ComfyUI 本地工作流" value="comfyui" />
                </el-select>
                <span :id="configFieldDescriptionId('api_protocol')" class="config-field-a11y-description">
                  {{ configFieldDescription('api_protocol') }}
                </span>
              </el-form-item>
              <el-form-item prop="base_url">
                <template #label>
                  <span class="form-label-tip">{{ form.service_type === 'jimeng2_character_auth' ? '网关 URL' : 'Base URL' }}
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

              <el-form-item v-if="isComfyUiForm" prop="comfy_workflow_json" label="Workflow JSON">
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
        <template v-if="form.service_type !== 'text' && form.service_type !== 'tts' && form.service_type !== 'jimeng2_character_auth'">
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
          <p v-else-if="endpointPreviewInfo.isJimeng2Auth" class="ep-tip">角色「SD2认证」将调用上述地址注册素材（POST 创建、GET 查询状态）。</p>
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
        <el-form-item prop="modelText">
          <template #label>
            <span class="form-label-tip">模型列表
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    该厂商下可用的模型，多个用逗号或换行分隔。<br>
                    可从上方「追加预设模型」下拉快速添加，也可手动输入。
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <div class="model-row">
            <el-select
              v-model="presetModelPick"
              placeholder="追加预设模型"
              clearable
              filterable
              style="width: 220px; margin-bottom: 8px"
              @change="onPresetModelSelect"
            >
              <el-option v-for="m in availableModels" :key="m" :label="m" :value="m" />
            </el-select>
          </div>
          <el-input
            ref="modelListInputRef"
            v-model="form.modelText"
            data-ai-config-field="model"
            type="textarea"
            :rows="2"
            placeholder="选择预设厂商后自动填入，可编辑；多个用逗号或换行分隔"
            :aria-invalid="isConfigFieldInvalid('model')"
            :aria-describedby="configFieldDescriptionId('model')"
          />
          <span :id="configFieldDescriptionId('model')" class="config-field-a11y-description">
            {{ configFieldDescription('model') }}
          </span>
        </el-form-item>
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
            :placeholder="formModelList.length ? '从上面模型列表中选一个作为生成时使用的默认' : '请先填写上方模型列表'"
            clearable
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
          <p v-else class="field-tip">该配置被选为「默认」时，生成故事/图片/视频将使用此处指定的模型。</p>
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
              style="width: 140px"
            >
              <el-option label="high" value="high" />
              <el-option label="max" value="max" />
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
        <template v-if="filterableServiceTypes.has(form.service_type)">
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
        <el-button type="primary" :loading="saving" :disabled="configWriteLocked" @click="submit">确定</el-button>
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
        <el-table-column prop="asset_type" label="类型" width="88" />
        <el-table-column prop="status" label="状态" width="96">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : row.status === 'failed' ? 'danger' : 'info'" size="small">
              {{ row.status || '—' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="asset_url" label="asset_url" min-width="160" show-overflow-tooltip />
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
          v-else
          type="success"
          title="连接成功"
          description="文本生成接口已正常响应。"
          show-icon
          :closable="false"
        />
      </template>
      <el-alert v-else type="error" :title="testError || '连接失败'" show-icon :closable="false" />
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

    <!-- 一键换Key（锁定模式） -->
    <AccessibleDialog v-model="bulkKeyVisible" title="一键换Key" width="440px" class="ai-config-overlay" :close-on-click-modal="false" :before-close="confirmBulkKeyClose">
      <el-alert
        type="warning"
        :closable="false"
        style="margin-bottom: 16px"
        title="此操作将替换所有配置的 API Key，请确认新 Key 可用后再提交。"
        show-icon
      />
      <el-form label-width="80px">
        <el-form-item label="新 API Key">
          <el-input
            v-model="bulkKeyInput"
            type="password"
            show-password
            placeholder="粘贴新的 API Key"
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
import { Plus, MagicStick, QuestionFilled, Download, Upload, Delete, ChatDotRound, Picture, Film, VideoCamera, Key, Microphone, Folder } from '@element-plus/icons-vue'
import { aiAPI } from '@/api/ai'
import { generationSettingsAPI } from '@/api/prompts'
import { sanitizeConfigForExport, stripMaskedSecretsFromSettings } from '@/utils/aiConfigExport.js'
import { buildAiServiceCoverage, getAiServiceCoverageActions, sortAiServiceCoverage } from '@/utils/aiConfigCoverage.js'
import {
  createAiConfigConnectionStatusStore,
  resolveAiConfigConnectionStatusScope,
} from '@/utils/aiConfigConnectionStatusStore.js'
import {
  confirmAiConfigBulkKeyResult,
  confirmAiConfigMutationInList,
  confirmAiConfigMutationResult,
  isAiConfigBulkKeyResult,
  runAiConfigCreateBatch,
} from '@/utils/aiConfigMutations.js'
import { applyAiConfigRepairTarget } from '@/utils/aiConfigRepairTarget.js'
import {
  createAiConfigValidationSummary,
  focusFirstInvalidAiConfigField,
  getAiConfigFieldDescription,
} from '@/utils/aiConfigValidationFocus.js'
import { CUSTOM_PROVIDER_SENTINEL, getBaseUrlForProvider, getProviderEndpointDefaults, getProviderProtocol, isApiKeyOptionalProvider, providerConfigs } from '@/utils/aiProviderPresets.js'
import { buildProviderPricing, parseSettingsObject, readProviderPricingForm } from '@/utils/providerPricing.js'
import { getConfigWorkspaceKeyTarget, shouldApplyConfigWorkspaceRequest } from '@/utils/aiConfigWorkspace.js'
import PromptEditor from '@/components/PromptEditor.vue'
import SceneModelMap from '@/components/SceneModelMap.vue'
import Sd2AssetManagement from '@/components/Sd2AssetManagement.vue'
import { hasUnsavedAiConfigChanges } from '@/utils/aiConfigUnsavedGuard.js'
import { createOperationId, logOperation } from '@/utils/operationLog'
import {
  DEFAULT_CONNECTION_TEST_TIMEOUT_MS,
  DEFAULT_JSON_TIMEOUT_MS,
  describeServiceLoadError,
  isRequestCanceled,
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

const filterableServiceTypes = new Set(['text', 'image', 'storyboard_image', 'video', 'tts'])

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
const coverageCardRefs = new Map()
const lastTestedCoverageServiceType = ref('')

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
const genConcurrencyInput = ref(null)
const genVideoConcurrencyInput = ref(null)
const genSettingSaving = ref(false)
const genSettingSaved = ref(false)
const generationSettingsBaseline = ref('')
const generationSettingsLoadState = ref('loading')
const generationSettingsLoadError = ref('')
const generationSettingsWriteLocked = computed(() => generationSettingsLoadState.value !== 'ready' || genSettingSaving.value)

async function loadGenerationSettings() {
  generationSettingsAbortController?.abort()
  const controller = new AbortController()
  generationSettingsAbortController = controller
  generationSettingsLoadState.value = 'loading'
  try {
    const res = await withRequestRetry(
      () => generationSettingsAPI.get({
        signal: controller.signal,
        timeout: DEFAULT_JSON_TIMEOUT_MS,
        suppressErrorToast: true,
      }),
      { maxAttempts: 2, delayMs: 400, signal: controller.signal },
    )
    if (controller.signal.aborted) return
    const concurrency = Number(res?.concurrency)
    const videoConcurrency = Number(res?.video_concurrency)
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20
      || !Number.isInteger(videoConcurrency) || videoConcurrency < 1 || videoConcurrency > 20) {
      throw new Error('生成设置返回的数据无效，请重试。')
    }
    genConcurrencyInput.value = concurrency
    genVideoConcurrencyInput.value = videoConcurrency
    generationSettingsBaseline.value = generationSettingsFingerprint()
    generationSettingsLoadError.value = ''
    generationSettingsLoadState.value = 'ready'
  } catch (error) {
    if (isRequestCanceled(error) || controller.signal.aborted) return
    generationSettingsLoadError.value = describeServiceLoadError(error, {
      serviceLabel: '生成设置服务',
      fallback: '暂时无法读取生成设置，请稍后重试。',
      signal: controller.signal,
    })
    generationSettingsLoadState.value = 'error'
  } finally {
    if (generationSettingsAbortController === controller) {
      generationSettingsAbortController = null
    }
  }
}

function onConcurrencyChange(val) {
  const n = Number(val)
  if (!isNaN(n) && n >= 1) genConcurrencyInput.value = Math.min(20, Math.max(1, Math.round(n)))
}

function onVideoConcurrencyChange(val) {
  const n = Number(val)
  if (!isNaN(n) && n >= 1) genVideoConcurrencyInput.value = Math.min(20, Math.max(1, Math.round(n)))
}

async function saveGenerationSettings() {
  if (generationSettingsWriteLocked.value) {
    ElMessage.warning('生成设置尚未成功读取，请重试后再保存。')
    return
  }
  const n = Number(genConcurrencyInput.value)
  const nv = Number(genVideoConcurrencyInput.value)
  if (isNaN(n) || n < 1 || n > 20) {
    ElMessage.warning('图片并发数请填写 1-20 之间的整数')
    return
  }
  if (isNaN(nv) || nv < 1 || nv > 20) {
    ElMessage.warning('视频并发数请填写 1-20 之间的整数')
    return
  }
  genSettingSaving.value = true
  genSettingSaved.value = false
  try {
    const concurrency = Math.round(n)
    const videoConcurrency = Math.round(nv)
    await generationSettingsAPI.update({ concurrency, video_concurrency: videoConcurrency })
    genConcurrencyInput.value = concurrency
    genVideoConcurrencyInput.value = videoConcurrency
    generationSettingsBaseline.value = generationSettingsFingerprint()
    genSettingSaved.value = true
    setTimeout(() => { genSettingSaved.value = false }, 2000)
  } catch (e) {
    ElMessage.error('保存失败：' + (e?.message || ''))
  } finally {
    genSettingSaving.value = false
  }
}
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
let vendorLockAbortController = null
let generationSettingsAbortController = null
let connectionTestAbortController = null
let connectionStatusScopeAbortController = null
let lastTestedConfig = null

function abortAiConfigPageRequests() {
  configListAbortController?.abort()
  vendorLockAbortController?.abort()
  generationSettingsAbortController?.abort()
  connectionTestAbortController?.abort()
  connectionStatusScopeAbortController?.abort()
  configListAbortController = null
  vendorLockAbortController = null
  generationSettingsAbortController = null
  connectionTestAbortController = null
  connectionStatusScopeAbortController = null
}

function jsonRequestOptions(signal, timeout = DEFAULT_JSON_TIMEOUT_MS) {
  return { signal, timeout, suppressErrorToast: true }
}

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
const MASKED_SECRET = '********'
function isMaskedSecret(value) {
  return String(value || '').trim() === MASKED_SECRET
}
const vendorLock = ref({ enabled: false, config_file: '' })
const vendorLockResolved = ref(false)
const vendorLockLoading = ref(false)
const vendorLockError = ref('')
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
const DEFAULT_MODEL_VALIDATION_MESSAGE = '请选择模型列表中的有效默认模型'
const isDefaultModelUnavailable = computed(() => {
  const selected = String(form.value.default_model || '').trim()
  return Boolean(selected && !formModelList.value.includes(selected))
})

function isDefaultModelSelectionValid(value) {
  const selected = String(value || '').trim()
  if (isComfyUiForm.value && formModelList.value.length === 0 && !selected) return true
  return Boolean(selected && formModelList.value.includes(selected))
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

function configFieldDescriptionId(field) {
  return `ai-config-${field}-description`
}

function isConfigFieldInvalid(field) {
  return configValidationSummary.value.some((item) => item.field === field)
}

function configFieldDescription(field) {
  return configValidationSummary.value.find((item) => item.field === field)?.message
    || (field === 'default_model' ? DEFAULT_MODEL_VALIDATION_MESSAGE : '')
    || getAiConfigFieldDescription(field)
}

function clearConfigValidationSummary() {
  configValidationSummary.value = []
}

function clearConfigFieldValidation(prop) {
  configValidationSummary.value = configValidationSummary.value.filter(
    (item) => item.prop !== prop && item.field !== prop,
  )
}

function handleConfigFieldValidated(prop, isValid) {
  if (isValid) clearConfigFieldValidation(prop)
}

function expandConfigValidationSection(section) {
  if (!section || advancedFormSections.value.includes(section)) return
  advancedFormSections.value = [...advancedFormSections.value, section]
}

async function handleConfigValidationFailure(invalidFields) {
  const summary = createAiConfigValidationSummary(invalidFields)
  if (invalidFields?.default_model) {
    summary.push({
      field: 'default_model',
      prop: 'default_model',
      label: '默认模型',
      message: DEFAULT_MODEL_VALIDATION_MESSAGE,
      section: null,
    })
  }
  configValidationSummary.value = summary
  await focusFirstInvalidAiConfigField(configValidationSummary.value, {
    scrollContainer: configDialogScrollRef.value,
    expandSection: expandConfigValidationSection,
    nextTickFn: nextTick,
  })
}

// 新增配置延续首项默认值；编辑时保留已失效的历史值，等待用户显式修正。
watch(
  () => [formModelList.value, form.value.default_model],
  () => {
    const list = formModelList.value
    if (editingId.value || list.length === 0) return
    const current = form.value.default_model
    if (!current || !list.includes(current)) {
      form.value.default_model = list[0] || ''
    }
  },
  { immediate: true }
)

function onServiceTypeChange() {
  const st = form.value.service_type || 'text'
  if (st === 'jimeng2_character_auth') {
    if (!form.value.provider || form.value.provider === CUSTOM_PROVIDER_SENTINEL) {
      form.value.provider = 'jimeng_material_api'
    }
    const p = form.value.provider
    const pcfg = (providerConfigs.jimeng2_character_auth || []).find((x) => x.id === p)
    if (pcfg) {
      if (!form.value.base_url?.trim()) form.value.base_url = getBaseUrlForProvider(p, st)
      form.value.modelText = '-'
      form.value.default_model = '-'
      form.value.endpoint = ''
      form.value.query_endpoint = ''
      form.value.api_protocol = ''
    }
    if (!editingId.value && !form.value.name?.trim()) {
      form.value.name = '即梦2角色认证'
    }
    return
  }
  const listByType = providerConfigs[st] || []
  const current = form.value.provider
  if (!current || !listByType.some((p) => p.id === current)) {
    form.value.provider = ''
    form.value.api_protocol = ''
    form.value.base_url = ''
    form.value.endpoint = ''
    form.value.query_endpoint = ''
    form.value.modelText = ''
    form.value.default_model = ''
  }
}

function onPresetModelSelect(value) {
  if (!value) return
  const listParsed = parseModelText(form.value.modelText)
  if (listParsed.includes(value)) {
    presetModelPick.value = ''
    return
  }
  const append = listParsed.length ? '\n' + value : value
  form.value.modelText = (form.value.modelText || '').trim() + append
  presetModelPick.value = ''
}
const rules = computed(() => ({
  service_type: [{ required: true, message: '请选择服务类型', trigger: 'change' }],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  provider: [{ required: true, message: '请选择或输入厂商', trigger: 'change' }],
  base_url: [{ required: true, message: '请输入 Base URL', trigger: 'blur' }],
  api_key: [
    {
      validator: (_rule, v, cb) => {
        const st = form.value.service_type
        if (st === 'jimeng2_character_auth') {
          if (v != null && String(v).trim()) return cb()
          return cb(new Error('请填写 Token'))
        }
        const proto = form.value.api_protocol
        if (isApiKeyOptionalProvider(form.value.provider, proto)) return cb()
        const ak = (form.value.kling_access_key || '').trim()
        const sk = (form.value.kling_secret_key || '').trim()
        if (st === 'video' && proto === 'kling_omni' && ak && sk) return cb()
        if (v != null && String(v).trim()) return cb()
        cb(new Error('请输入 API Key，或使用官方 AccessKey + SecretKey（可不填 API Key）'))
      },
      trigger: 'blur',
    },
  ],
  api_protocol: [
    {
      validator: (_rule, value, cb) => {
        const st = form.value.service_type
        const protocolVisible = st !== 'text' && st !== 'tts' && st !== 'jimeng2_character_auth'
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
const testResultAnnouncement = ref('')
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

const configDependencyError = computed(() => (
  [configLoadError.value, vendorLockError.value].filter(Boolean).join('；')
))

watch(configWriteLocked, (locked) => {
  if (locked) selectedRows.value = []
})

const canAutoOpenMissingService = computed(() => (
  configLoadState.value === 'ready' && vendorLockResolved.value
))

function coverageStateLabel(item) {
  if (item.ready) return '可用'
  if (item.issue === 'missing_credentials') return '缺少凭据'
  if (item.issue === 'missing_model') return '缺少模型'
  if (item.issue === 'missing_workflow') return '缺少工作流'
  if (item.issue === 'connection_failed') return '连接失败'
  if (item.issue === 'inactive') return '未启用'
  if (item.state === 'configured') return '缺少默认'
  return '未配置'
}

function coverageStateTagType(item) {
  if (item.ready) return 'success'
  if (item.state === 'configured') return 'warning'
  return 'danger'
}

function coverageConfigDetail(item) {
  if (item.state === 'missing') return '尚无配置'
  if (item.issue === 'inactive') return `${item.configuredCount} 个配置，均未启用`
  if (!item.defaultConfig) return `${item.activeCount} 个启用配置，请设置默认项`
  if (item.issue === 'missing_credentials') return '默认配置缺少凭据'
  if (item.issue === 'missing_model') return '默认配置缺少模型'
  if (item.issue === 'missing_workflow') return '默认配置缺少工作流'
  if (item.issue === 'connection_failed') return '默认配置最近连接失败'
  const config = item.defaultConfig
  const model = config.default_model || (Array.isArray(config.model) ? config.model[0] : config.model)
  const identity = config.name || config.provider || '默认配置'
  return model ? `${identity} · ${model}` : identity
}

function coverageInventoryLabel(item) {
  if (item.state === 'missing') return '未配置'
  const active = item.activeCount ? `启用 ${item.activeCount}` : '启用 0'
  return `已配置 ${item.configuredCount} 条 · ${active}`
}

function coverageTestLabel(test) {
  if (test.status === 'passed') return test.source === 'session' ? '本次测试通过' : '最近测试通过'
  if (test.status === 'failed') return test.source === 'session' ? '本次测试失败' : '最近测试失败'
  return '尚无测试记录'
}

function clearServiceFilter() {
  activeServiceFilter.value = ''
}

function coverageActions(item) {
  return getAiServiceCoverageActions(item, {
    vendorLocked: vendorLock.value.enabled,
    writesLocked: configWriteLocked.value,
  })
}

function setCoverageCardRef(serviceType, element) {
  if (element) coverageCardRefs.set(serviceType, element)
  else coverageCardRefs.delete(serviceType)
}

async function restoreTestedCoverageCardFocus() {
  connectionTestAbortController?.abort()
  const serviceType = lastTestedCoverageServiceType.value
  lastTestedCoverageServiceType.value = ''
  if (!serviceType) return
  await nextTick()
  const target = coverageCardRefs.get(serviceType)
  if (target) target.focus()
  else coverageWorkspaceModeRef.value?.focus?.()
}

function isCoverageActionTesting(item, action) {
  if (action.action !== 'test' || testingConfigId.value === null) return false
  return String(testingConfigId.value) === String(item.targetConfig?.id)
}

function isCoverageActionDisabled(item, action) {
  if (['add', 'edit'].includes(action.action)) return configWriteLocked.value
  if (action.action !== 'test') return false
  return isCoverageActionTesting(item, action) || testingConfigId.value !== null
}

function isConfigRowSelectable() {
  return !configWriteLocked.value
}

async function focusServiceConfigs(serviceType, { focusMode = false } = {}) {
  selectConfigWorkspaceView('configs', { focus: focusMode })
  activeServiceFilter.value = serviceType
  await nextTick()
  configListSectionRef.value?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
}

async function applyRequestedService(serviceType) {
  const normalized = normalizeInitialServiceType(serviceType)
  if (normalized) configWorkspaceView.value = 'configs'
  activeServiceFilter.value = normalized
  if (!normalized) return
  const coverageItem = serviceCoverage.value.services.find((item) => item.type === normalized)
  if (shouldAutoOpenRequestedService(coverageItem)) {
    openAddForService(normalized)
    return
  }
  if (coverageItem?.targetConfig && !coverageItem.ready && !configWriteLocked.value) {
    await openEdit(coverageItem.targetConfig, { repairIssue: coverageItem.issue })
    return
  }
  await focusServiceConfigs(normalized)
}

async function onCoverageSelect(item) {
  if (shouldAutoOpenRequestedService(item)) {
    openAddForService(item.type)
    return
  }
  await focusServiceConfigs(item.type, { focusMode: true })
}

function shouldAutoOpenRequestedService(coverageItem) {
  return (
    canAutoOpenMissingService.value
    && coverageItem?.state === 'missing'
    && !vendorLock.value.enabled
  )
}

async function onCoverageAction(item, action) {
  if (configWriteLocked.value && ['add', 'edit'].includes(action.action)) return
  if (action.action === 'add') {
    openAddForService(item.type)
    return
  }
  if (action.action === 'edit') {
    if (item.targetConfig) {
      await openEdit(item.targetConfig, { repairIssue: item.issue })
    } else {
      openAddForService(item.type)
    }
    return
  }
  if (action.action === 'test') {
    if (item.targetConfig) {
      lastTestedCoverageServiceType.value = item.type
      await openTest(item.targetConfig)
    }
    return
  }
  await focusServiceConfigs(item.type, { focusMode: true })
}

function parseSettings(settings) {
  if (!settings) return {}
  if (typeof settings === 'object') return settings
  try {
    const parsed = JSON.parse(settings)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function parseComfyWorkflowJson(value) {
  let parsed
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value
  } catch (_) {
    throw new Error('Workflow JSON 格式无效')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
    throw new Error('Workflow JSON 必须是非空对象')
  }
  return parsed
}

function isDeepSeekOfficial(provider, baseUrl) {
  const p = String(provider || '').trim().toLowerCase()
  const base = String(baseUrl || '').trim().toLowerCase()
  return p === 'deepseek' || base.includes('api.deepseek.com')
}

function resolveDeepSeekFormSettings(row) {
  const s = parseSettings(row?.settings)
  const nested = s.deepseek && typeof s.deepseek === 'object' ? s.deepseek : {}
  let thinking = s.deepseek_thinking || s.thinking || nested.thinking || nested.type || ''
  const model = String(row?.default_model || '').toLowerCase()
  if (!thinking && model === 'deepseek-chat') thinking = 'disabled'
  if (!thinking && model === 'deepseek-reasoner') thinking = 'enabled'
  if (thinking !== 'enabled' && thinking !== 'disabled') thinking = 'disabled'

  let effort = s.deepseek_reasoning_effort || s.reasoning_effort || nested.reasoning_effort || nested.effort || 'high'
  effort = String(effort).toLowerCase() === 'max' ? 'max' : 'high'
  return { thinking, effort }
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
const availableProviderOptions = computed(() => {
  const st = form.value.service_type || 'text'
  const listByType = providerConfigs[st] || []
  const current = form.value.provider
  let result = [...listByType]
  if (editingId.value && current && current !== CUSTOM_PROVIDER_SENTINEL && !listByType.some((p) => p.id === current)) {
    result = [{ id: current, name: current + ' (当前)', models: [] }, ...result]
  }
  result.push({ id: CUSTOM_PROVIDER_SENTINEL, name: '✏️ 自定义（直接输入厂商名）', models: [] })
  return result
})

/** 当前厂商的预设模型列表（用于追加预设模型） */
const availableModels = computed(() => {
  const st = form.value.service_type
  const provider = form.value.provider
  if (!st || !provider) return []
  const p = (providerConfigs[st] || []).find((x) => x.id === provider)
  return p?.models || []
})

/** 根据当前厂商/协议/base_url 推算实际将使用的接口地址，供用户核对 */
const endpointPreviewInfo = computed(() => {
  const { provider, api_protocol, base_url, service_type, endpoint, query_endpoint } = form.value
  const p = String(provider || '').toLowerCase()
  const proto = api_protocol || getProviderProtocol(p, service_type) || ''
  const base = (base_url || '').replace(/\/$/, '')

  if (service_type === 'jimeng2_character_auth') {
    const root = base || '(请填写网关 URL)'
    const hasReal = !root.startsWith('(')
    return {
      submit: `${root}/api/business/v1/assets`,
      query: hasReal ? `${root}/api/business/v1/assets/{assetId}` : null,
      isAuto: true,
      isJimeng2Auth: true,
    }
  }

  if (!base && !proto && !p) return null

  let submitPath = '', queryPath = ''

  if (service_type === 'text') {
    submitPath = '/chat/completions'
  } else if (service_type === 'tts') {
    if (p === 'minimax') {
      submitPath = '/t2a_v2?GroupId={group_id}'
    } else {
      submitPath = endpoint || '/audio/speech'
    }
  } else if (service_type === 'image' || service_type === 'storyboard_image') {
    if (endpoint) {
      submitPath = endpoint
    } else if (proto === 'volcengine' || p === 'volcengine' || p === 'volces') {
      submitPath = '/images/generations'
    } else if (proto === 'dashscope' || p === 'dashscope' || p === 'qwen_image') {
      submitPath = '/api/v1/services/aigc/multimodal-generation/generation'
    } else if (proto === 'gemini' || p === 'gemini') {
      const m = form.value.default_model || '{模型名}'
      submitPath = `/v1beta/models/${m}:generateContent?key=***`
      return { submit: base + submitPath, query: null, isAuto: true, isGemini: true }
    } else if (proto === 'nano_banana' || p === 'nano_banana') {
      submitPath = '/v1/images/generations'  // nano_banana base_url 无 /v1
    } else if (proto === 'kling' || p === 'kling' || p === 'klingai') {
      submitPath = '/v1/images/generations'
    } else {
      submitPath = '/images/generations'  // openai 兼容：base_url 已含 /v1
    }
    } else if (service_type === 'video') {
    if (endpoint) {
      submitPath = endpoint
    } else if (proto === 'volcengine_omni') {
      submitPath = '/contents/generations/tasks'
    } else if (proto === 'volcengine' || p === 'volces' || p === 'volcengine') {
      submitPath = '/videos/generations'
    } else if (proto === 'dashscope' || p === 'dashscope') {
      submitPath = '/api/v1/services/aigc/video-generation/video-synthesis'
    } else if (proto === 'gemini' || p === 'gemini') {
      const m = form.value.default_model || '{模型名}'
      return {
        submit: `${base}/v1beta/models/${m}:predictLongRunning  （API Key 放 header: x-goog-api-key）`,
        query: `${base}/v1beta/{operationName}  （operationName 由提交响应返回）`,
        isAuto: true,
        isGemini: true
      }
    } else if (proto === 'vidu' || p === 'vidu') {
      submitPath = '/ent/v2/img2video'
    } else if (proto === 'sora') {
      submitPath = '/v1/videos'
    } else if (proto === 'agnes' || p === 'agnes') {
      submitPath = '/videos'
    } else if (proto === 'xai') {
      submitPath = '/v1/videos/generations'
    } else if (proto === 'veo3') {
      submitPath = '/v1/video/create'
    } else if (proto === 'jimeng_ai_api' || p === 'jimeng_ai_api') {
      submitPath = endpoint || '/v1/videos/generations'
      return {
        submit: (base || '(请填 Base URL)') + submitPath + '  （Bearer 为即梦 Session，可多账号英文逗号分隔；同步返回 data[0].url）',
        query: null,
        isAuto: true,
      }
    } else if (proto === 'kling_omni' || p === 'ffir' || p === 'klingai') {
      const omniFfir = p === 'ffir' || /ffir\.cn/i.test(base)
      const omniKlingOfficial = p === 'klingai' || /api(-beijing|-singapore)?\.klingai\.com/i.test(base)
      submitPath = omniFfir ? '/kling/v1/videos/omni-video' : omniKlingOfficial ? '/v1/videos/omni-video' : '/kling/v1/videos/omni-video'
    } else if (proto === 'kling' || p === 'kling' || p === 'klingai') {
      submitPath = '/v1/videos/text2video (T2V) 或 /v1/videos/image2video (I2V)'
    } else if (p === 'minimax') {
      submitPath = '/video_generation'  // minimax base_url 已含 /v1
    } else {
      submitPath = '/v1/video/create'
    }

    if (query_endpoint) {
      queryPath = query_endpoint
    } else if (proto === 'volcengine_omni') {
      queryPath = '/contents/generations/tasks/{taskId}'
    } else if (proto === 'volcengine' || p === 'volces' || p === 'volcengine') {
      queryPath = '/tasks/{taskId}/info'
    } else if (proto === 'dashscope' || p === 'dashscope') {
      queryPath = '/api/v1/tasks/{taskId}/info'
    } else if (proto === 'vidu' || p === 'vidu') {
      queryPath = '/ent/v2/tasks/{taskId}/creations'
    } else if (proto === 'sora') {
      queryPath = '/v1/videos/{taskId}'
    } else if (proto === 'agnes' || p === 'agnes') {
      queryPath = '/videos/{taskId}'
    } else if (proto === 'xai') {
      queryPath = '/v1/videos/{taskId}'
    } else if (proto === 'veo3') {
      queryPath = '/v1/video/query?id={taskId}'
    } else if (proto === 'kling_omni' || p === 'ffir' || p === 'klingai') {
      const omniFfirQ = p === 'ffir' || /ffir\.cn/i.test(base)
      const omniKlingOfficialQ = p === 'klingai' || /api(-beijing|-singapore)?\.klingai\.com/i.test(base)
      queryPath = omniFfirQ
        ? '/kling/v1/images/omni-image/{taskId}'
        : omniKlingOfficialQ
          ? '/v1/videos/omni-video/{taskId}'
          : '/kling/v1/images/omni-image/{taskId}'
    } else if (proto === 'kling' || p === 'kling' || p === 'klingai') {
      queryPath = '/v1/videos/{videoType}/{taskId}（自动按任务类型选择）'
    } else if (p === 'minimax') {
      queryPath = '/query/video_generation/{taskId}'  // minimax base_url 已含 /v1
    } else if (proto !== 'gemini' && p !== 'gemini') {
      queryPath = '/v1/video/query?id={taskId}'
    }
  }

  const submitUrl = base ? (base + submitPath) : ('(未填 Base URL)' + submitPath)
  const queryUrl = queryPath ? (base ? base + queryPath : '(未填 Base URL)' + queryPath) : null

  if (!submitPath) return null
  return {
    submit: submitUrl,
    query: queryUrl,
    isAuto: !endpoint  // 端点是自动推断的（非用户手填）
  }
})

function onProviderChange(providerId) {
  if (providerId === CUSTOM_PROVIDER_SENTINEL) {
    form.value.provider = ''
    form.value.api_protocol = ''
    form.value.base_url = ''
    form.value.endpoint = ''
    form.value.query_endpoint = ''
    form.value.modelText = ''
    form.value.default_model = ''
    return
  }
  const st = form.value.service_type || 'text'
  const p = (providerConfigs[st] || []).find((x) => x.id === providerId)
  if (!p) {
    form.value.base_url = ''
    form.value.endpoint = ''
    form.value.query_endpoint = ''
    form.value.modelText = ''
    form.value.default_model = ''
    return
  }
  form.value.base_url = getBaseUrlForProvider(providerId, st)
  form.value.modelText = (p.models || []).join('\n')
  form.value.default_model = (p.models && p.models[0]) || ''
  if (providerId === 'deepseek') {
    form.value.deepseek_thinking = 'disabled'
    form.value.deepseek_reasoning_effort = 'high'
  }
  // 自动填充接口规范与默认端点；先清理旧厂商残留的端点，避免切换后继续调用上一个厂商。
  form.value.api_protocol = getProviderProtocol(providerId, st) || (st === 'text' ? '' : 'openai')
  const endpointDefaults = getProviderEndpointDefaults(providerId, st, form.value.api_protocol)
  form.value.endpoint = endpointDefaults.endpoint || ''
  form.value.query_endpoint = endpointDefaults.query_endpoint || ''
  if (st === 'video' && providerId === 'jimeng_ai_api') {
    form.value.endpoint = ''
    form.value.query_endpoint = ''
  }
  if (st === 'video' && (providerId === 'ffir' || providerId === 'klingai')) {
    if (providerId === 'ffir') {
      form.value.endpoint = '/kling/v1/videos/omni-video'
      form.value.query_endpoint = '/kling/v1/images/omni-image/{taskId}'
    } else {
      form.value.endpoint = '/v1/videos/omni-video'
      form.value.query_endpoint = '/v1/videos/omni-video/{taskId}'
    }
  }
  if (st === 'video' && providerId === 'agnes') {
    form.value.api_protocol = 'agnes'
    form.value.endpoint = '/videos'
    form.value.query_endpoint = '/videos/{taskId}'
  }
  if (!editingId.value) {
    form.value.name = (p.name || providerId) + ' ' + serviceTypeLabel(st)
  }
}

/** 通义一键配置用 */
const TONGYI_CONFIGS = [
  { service_type: 'text', name: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', provider: 'qwen', model: ['qwen-plus'] },
  { service_type: 'image', name: '通义万象 文本生图', base_url: 'https://dashscope.aliyuncs.com', provider: 'dashscope', model: ['wan2.6-image'] },
  { service_type: 'image', name: '通义千问 文本生图', base_url: 'https://dashscope.aliyuncs.com', provider: 'qwen_image', model: ['qwen-image-max', 'qwen-image-plus', 'qwen-image'] },
  { service_type: 'storyboard_image', name: '通义万象 分镜图', base_url: 'https://dashscope.aliyuncs.com', provider: 'dashscope', model: ['wan2.6-image'] },
  { service_type: 'video', name: '通义万相', base_url: 'https://dashscope.aliyuncs.com', provider: 'dashscope', model: ['wan2.2-kf2v-flash'] }
]

/** 火山引擎一键配置用 */
const VOLCENGINE_CONFIGS = [
  { service_type: 'text', name: '火山引擎 文本', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volcengine', model: ['deepseek-v3-2-251201', 'doubao-1-5-pro-32k-250115', 'kimi-k2-thinking-251104'] },
  { service_type: 'image', name: '火山引擎 即梦 文本生图', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volcengine', model: ['doubao-seedream-4-5-251128'] },
  { service_type: 'storyboard_image', name: '火山引擎 即梦 分镜图', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volcengine', model: ['doubao-seedream-4-5-251128'] },
  { service_type: 'video', name: '火山引擎 即梦 视频', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volces', model: ['doubao-seedance-1-5-pro-251215'] }
]

/** Agnes 一键配置用 */
const AGNES_CONFIGS = [
  { service_type: 'text', name: 'Agnes 文本', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'openai', model: ['agnes-2.0-flash'] },
  { service_type: 'image', name: 'Agnes 文本生图', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'openai', model: ['agnes-image-2.1-flash'] },
  { service_type: 'storyboard_image', name: 'Agnes 分镜图', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'openai', model: ['agnes-image-2.1-flash'] },
  { service_type: 'video', name: 'Agnes 视频', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'agnes', endpoint: '/videos', query_endpoint: '/videos/{taskId}', model: ['agnes-video-v2.0'] },
]

function serviceTypeLabel(t) {
  const map = {
    text: '文本',
    image: '文本生成图片',
    storyboard_image: '分镜图片生成',
    video: '视频',
    tts: '语音合成 TTS',
    jimeng2_character_auth: '即梦2角色认证',
    model_ark_asset: 'SD2 资产库',
  }
  return map[t] || t
}

function onRowEdit(row) {
  if (configWriteLocked.value) return
  if (row.service_type === 'model_ark_asset') {
    activeTab.value = 'sd2_assets'
    ElMessage.info('请在「SD2 资产管理」标签页编辑此配置')
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

function parseModelText(text) {
  if (!text || !String(text).trim()) return []
  return String(text)
    .split(/[\n,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function resetForm() {
  editingId.value = null
  editingUpdatedAt.value = ''
  presetModelPick.value = ''
  advancedFormSections.value = []
  clearConfigValidationSummary()
  form.value = {
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
    is_default: true,  // 新增时默认勾选「设为默认」，便于理解当前会使用哪条配置
    voice_id: '',
    group_id: '',
    kling_access_key: '',
    kling_secret_key: '',
    kling_secret_key_base64: false,
    comfy_workflow_json: '',
    ...readProviderPricingForm(null),
  }
  formRef.value?.resetFields?.()
}

function configFormFingerprint() {
  return JSON.stringify(form.value)
}

function generationSettingsFingerprint() {
  return JSON.stringify([genConcurrencyInput.value, genVideoConcurrencyInput.value])
}

const configFormDirty = computed(() => (
  dialogVisible.value
  && Boolean(configFormBaseline.value)
  && configFormFingerprint() !== configFormBaseline.value
))
const generationSettingsDirty = computed(() => (
  generationSettingsLoadState.value === 'ready'
  && Boolean(generationSettingsBaseline.value)
  && generationSettingsFingerprint() !== generationSettingsBaseline.value
))
const credentialDraftDirty = computed(() => (
  (oneKeyTongyiVisible.value && Boolean(oneKeyTongyiKey.value.trim()))
  || (oneKeyVolcVisible.value && Boolean(oneKeyVolcKey.value.trim()))
  || (oneKeyAgnesVisible.value && Boolean(oneKeyAgnesKey.value.trim()))
  || (bulkKeyVisible.value && Boolean(bulkKeyInput.value.trim()))
))

function hasUnsavedChanges() {
  return configFormDirty.value
    || generationSettingsDirty.value
    || credentialDraftDirty.value
    || hasUnsavedAiConfigChanges([
      promptEditorRef.value,
      sceneModelMapRef.value,
    ])
}

async function confirmDiscard() {
  try {
    await ElMessageBox.confirm(
      '当前 AI 配置尚未保存，关闭后本次修改会丢失。',
      '放弃未保存修改？',
      {
        confirmButtonText: '放弃修改',
        cancelButtonText: '继续编辑',
        type: 'warning',
        distinguishCancelAndClose: true,
      },
    )
    return true
  } catch (_) {
    return false
  }
}

async function requestClose() {
  if (!hasUnsavedChanges()) return true
  if (!await confirmDiscard()) return false
  return true
}

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

async function confirmConfigDialogClose(done) {
  if (configDialogSaved.value || !configFormDirty.value || await confirmDiscard()) done()
}

async function requestConfigDialogClose() {
  if (configDialogSaved.value || !configFormDirty.value || await confirmDiscard()) dialogVisible.value = false
}

async function confirmCredentialDraftClose(input, done) {
  if (!input.value.trim() || await confirmDiscard()) done()
}

async function requestCredentialDraftClose(input, visible) {
  if (!input.value.trim() || await confirmDiscard()) visible.value = false
}

const confirmOneKeyTongyiClose = (done) => confirmCredentialDraftClose(oneKeyTongyiKey, done)
const confirmOneKeyVolcClose = (done) => confirmCredentialDraftClose(oneKeyVolcKey, done)
const confirmOneKeyAgnesClose = (done) => confirmCredentialDraftClose(oneKeyAgnesKey, done)
const confirmBulkKeyClose = (done) => confirmCredentialDraftClose(bulkKeyInput, done)
const requestOneKeyTongyiClose = () => requestCredentialDraftClose(oneKeyTongyiKey, oneKeyTongyiVisible)
const requestOneKeyVolcClose = () => requestCredentialDraftClose(oneKeyVolcKey, oneKeyVolcVisible)
const requestOneKeyAgnesClose = () => requestCredentialDraftClose(oneKeyAgnesKey, oneKeyAgnesVisible)
const requestBulkKeyClose = () => requestCredentialDraftClose(bulkKeyInput, bulkKeyVisible)

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
  const model = Array.isArray(row.model) ? row.model : (row.model ? [row.model] : [])
  const modelList = model.map((m) => String(m).trim()).filter(Boolean)
  const defaultModel = row.default_model == null ? '' : String(row.default_model).trim()
  // TTS / 可灵 Omni 等从 settings 解析
  let voice_id = row.voice_id || ''
  let group_id = row.group_id || ''
  let kling_access_key = ''
  let kling_secret_key = ''
  let kling_secret_key_base64 = false
  let comfy_workflow_json = ''
  const deepseekSettings = resolveDeepSeekFormSettings(row)
  const pricingForm = readProviderPricingForm(row.settings)
  if (row.settings) {
    try {
      const s = JSON.parse(row.settings)
      if (row.service_type === 'tts') {
        voice_id = s.voice_id || voice_id
        group_id = s.group_id || group_id
      }
      if (row.service_type === 'video' && row.api_protocol === 'kling_omni') {
        kling_access_key = s.kling_access_key || ''
        kling_secret_key = s.kling_secret_key || ''
        kling_secret_key_base64 = !!s.kling_secret_key_base64
      }
      const comfyWorkflow = s.workflow ?? s.workflow_json ?? s.workflow_template ?? s.comfyui?.workflow
      if (comfyWorkflow && typeof comfyWorkflow === 'object' && !Array.isArray(comfyWorkflow)) {
        comfy_workflow_json = JSON.stringify(comfyWorkflow, null, 2)
      }
    } catch (_) {}
  }
  form.value = {
    service_type: row.service_type,
    name: row.name,
    provider: row.provider,
    api_protocol: row.api_protocol || '',
    base_url: row.base_url,
    api_key: row.api_key,
    endpoint: row.endpoint || '',
    query_endpoint: row.query_endpoint || '',
    modelText: modelList.join('\n'),
    default_model: defaultModel,
    deepseek_thinking: deepseekSettings.thinking,
    deepseek_reasoning_effort: deepseekSettings.effort,
    priority: row.priority ?? 0,
    is_default: !!row.is_default,
    voice_id,
    group_id,
    kling_access_key,
    kling_secret_key,
    kling_secret_key_base64,
    comfy_workflow_json,
    ...pricingForm,
  }
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

async function submit() {
  if (configWriteLocked.value) return
  try {
    await formRef.value?.validate?.()
  } catch (invalidFields) {
    await handleConfigValidationFailure(invalidFields)
    return
  }
  clearConfigValidationSummary()
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
    const mutationResult = wasEditing
      ? await aiAPI.update(editingId.value, payload)
      : await aiAPI.create(payload)
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
    if (e?.response?.status === 409) {
      await loadList()
      ElMessage.warning('配置已被其他操作更新，本次修改未覆盖现有配置，请重新打开后再保存。')
    }
  } finally {
    saving.value = false
  }
}

function openBulkKey() {
  if (configWriteLocked.value) return
  bulkKeyInput.value = ''
  bulkKeyVisible.value = true
}

async function submitBulkKey() {
  if (configWriteLocked.value) return
  const key = bulkKeyInput.value.trim()
  if (!key) return
  bulkKeySaving.value = true
  try {
    const res = await aiAPI.bulkUpdateKey(key)
    if (!isAiConfigBulkKeyResult(res)) {
      await loadList()
      ElMessage.error('服务端未返回完整的批量换 Key 确认结果，请刷新后复核。')
      return
    }
    const listConfirmed = await loadList()
    const listMatches = listConfirmed && confirmAiConfigBulkKeyResult(res, list.value)
    if (Number(res?.updated) > 0) {
      invalidateConnectionTestResults()
      notifyConfigurationChanged()
    }
    bulkKeyVisible.value = false
    if (listMatches) ElMessage.success(res?.message || '所有配置的 API Key 已更新')
    else ElMessage.warning('服务端已确认批量换 Key，但配置列表刷新或并发校验未完全一致，请刷新后复核。')
  } catch (_) {
  } finally {
    bulkKeySaving.value = false
  }
}

function onJimeng2AssetsDialogClosed() {
  jimeng2AssetsRows.value = []
  jimeng2AssetsNextCursor.value = null
  jimeng2AssetsHasMore.value = false
}

async function fetchJimeng2MaterialAssets(firstPage) {
  if (!form.value.base_url?.trim() || !form.value.api_key?.trim()) {
    ElMessage.warning('请先填写网关 URL 与 Token')
    return
  }
  if (firstPage) {
    jimeng2AssetsRows.value = []
    jimeng2AssetsNextCursor.value = null
    jimeng2AssetsHasMore.value = false
    jimeng2AssetsDialogVisible.value = true
  }
  jimeng2AssetsLoading.value = true
  try {
    const data = await aiAPI.listJimeng2MaterialAssets({
      id: editingId.value || undefined,
      base_url: form.value.base_url.trim(),
      api_key: isMaskedSecret(form.value.api_key) ? undefined : form.value.api_key,
      limit: 20,
      cursor: firstPage ? undefined : jimeng2AssetsNextCursor.value || undefined,
    })
    const items = Array.isArray(data?.items) ? data.items : []
    if (firstPage) {
      jimeng2AssetsRows.value = items
    } else {
      jimeng2AssetsRows.value = [...jimeng2AssetsRows.value, ...items]
    }
    jimeng2AssetsNextCursor.value = data?.next_cursor ?? null
    jimeng2AssetsHasMore.value = !!data?.has_more
  } catch (_) {
    /* request 拦截器已 ElMessage */
  } finally {
    jimeng2AssetsLoading.value = false
  }
}

function openJimeng2MaterialAssetsDialog() {
  fetchJimeng2MaterialAssets(true)
}

function loadMoreJimeng2MaterialAssets() {
  if (!jimeng2AssetsHasMore.value || !jimeng2AssetsNextCursor.value) return
  fetchJimeng2MaterialAssets(false)
}

async function openTest(row) {
  if (row.service_type === 'jimeng2_character_auth') {
    ElMessage.info('即梦2角色认证无需在此联调；保存后请在创作页「角色生成」中点击「SD2认证」验证。')
    return
  }
  if (row.service_type === 'model_ark_asset') {
    ElMessage.info('SD2 资产库请在「SD2 资产管理」标签页使用「刷新列表」验证连接。')
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
  testResultAnnouncement.value = '正在测试连接'
  testServiceType.value = row.service_type || 'text'
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
    if (isRequestCanceled(e) || controller.signal.aborted) {
      if (testVisible.value && testingConfigId.value === row.id) {
        testResultAnnouncement.value = ''
      }
      return
    }
    testResult.value = false
    testError.value = describeServiceLoadError(e, {
      serviceLabel: 'AI 配置服务',
      fallback: e?.message || '请求失败',
      signal: controller.signal,
    })
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

async function onDelete(row) {
  if (configWriteLocked.value) return
  await ElMessageBox.confirm(`确定删除配置「${row.name}」？`, '删除确认', {
    type: 'warning'
  })
  try {
    await aiAPI.delete(row.id)
    ElMessage.success('已删除')
    invalidateConnectionTestResults()
    notifyConfigurationChanged()
    await loadList()
  } catch (_) {}
}

function onSelectionChange(rows) {
  selectedRows.value = rows
}

async function onBatchDelete() {
  if (configWriteLocked.value) return
  if (!selectedRows.value.length) return
  await ElMessageBox.confirm(
    `确定删除选中的 ${selectedRows.value.length} 条配置？此操作不可恢复。`,
    '批量删除确认',
    { type: 'warning', confirmButtonText: '确定删除', confirmButtonClass: 'el-button--danger' }
  )
  batchDeleting.value = true
  let success = 0, failed = 0
  for (const row of selectedRows.value) {
    try {
      await aiAPI.delete(row.id)
      success++
    } catch (_) { failed++ }
  }
  batchDeleting.value = false
  selectedRows.value = []
  if (success > 0) {
    invalidateConnectionTestResults()
    notifyConfigurationChanged()
  }
  ElMessage.success(`已删除 ${success} 条${failed ? `，${failed} 条失败` : ''}`)
  await loadList()
}

function openOneKeyTongyi() {
  if (configWriteLocked.value) return
  oneKeyTongyiKey.value = ''
  oneKeyTongyiVisible.value = true
}

async function submitPresetConfigs(configs, apiKey, closeDialog) {
  const createOne = (cfg) => {
    const models = cfg.model || []
    return aiAPI.create({
      service_type: cfg.service_type,
      name: cfg.name,
      provider: cfg.provider,
      api_protocol: cfg.api_protocol || '',
      base_url: cfg.base_url,
      api_key: apiKey,
      model: models,
      default_model: models[0] || null,
      endpoint: cfg.endpoint || '',
      query_endpoint: cfg.query_endpoint || '',
      priority: 10,
      is_default: true,
    })
  }
  const result = await runAiConfigCreateBatch(configs, createOne)
  const message = `预设配置完成：${result.success} 条成功，${result.failed} 条失败`
  const createdIds = result.created.map((item) => Number(item?.id)).filter(Number.isFinite)
  const listConfirmed = await loadList()
  const createdVisible = createdIds.length === result.success
    && createdIds.every((id) => list.value.some((item) => Number(item.id) === id))
  if (result.success > 0 && (!listConfirmed || !createdVisible)) {
    const unconfirmedMessage = '预设配置已写入但列表尚未确认，请勿重复提交。请点击“重试”刷新列表。'
    configLoadError.value = configLoadError.value
      ? `${unconfirmedMessage} ${configLoadError.value}`
      : unconfirmedMessage
    ElMessage.error(unconfirmedMessage)
    return result
  }
  if (result.success > 0) {
    invalidateConnectionTestResults()
    notifyConfigurationChanged()
    closeDialog()
    ElMessage.success(message)
  } else {
    ElMessage.error(message)
  }
  return result
}

async function submitOneKeyTongyi() {
  if (configWriteLocked.value) return
  const apiKey = oneKeyTongyiKey.value.trim()
  if (!apiKey) return
  oneKeyTongyiSaving.value = true
  try {
    await submitPresetConfigs(TONGYI_CONFIGS, apiKey, () => {
      oneKeyTongyiVisible.value = false
    })
  } finally {
    oneKeyTongyiSaving.value = false
  }
}

function openOneKeyVolc() {
  if (configWriteLocked.value) return
  oneKeyVolcKey.value = ''
  oneKeyVolcVisible.value = true
}

async function submitOneKeyVolc() {
  if (configWriteLocked.value) return
  const apiKey = oneKeyVolcKey.value.trim()
  if (!apiKey) return
  oneKeyVolcSaving.value = true
  try {
    await submitPresetConfigs(VOLCENGINE_CONFIGS, apiKey, () => {
      oneKeyVolcVisible.value = false
    })
  } finally {
    oneKeyVolcSaving.value = false
  }
}

function openOneKeyAgnes() {
  if (configWriteLocked.value) return
  oneKeyAgnesKey.value = ''
  oneKeyAgnesVisible.value = true
}

async function submitOneKeyAgnes() {
  if (configWriteLocked.value) return
  const apiKey = oneKeyAgnesKey.value.trim()
  if (!apiKey) return
  oneKeyAgnesSaving.value = true
  try {
    await submitPresetConfigs(AGNES_CONFIGS, apiKey, () => {
      oneKeyAgnesVisible.value = false
    })
  } finally {
    oneKeyAgnesSaving.value = false
  }
}

async function exportConfigs() {
  try {
    const configs = await aiAPI.list(undefined, { suppressErrorToast: true })
    const exportData = configs.map(sanitizeConfigForExport)
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-configs-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success(`已导出 ${exportData.length} 条配置`)
  } catch (e) {
    ElMessage.error(describeServiceLoadError(e, { serviceLabel: 'AI 配置服务', fallback: '导出失败，请稍后重试。' }))
  }
}

function triggerImport() {
  if (configWriteLocked.value) return
  importFileRef.value?.click()
}

async function importConfigs(event) {
  if (configWriteLocked.value) {
    event.target.value = ''
    return
  }
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const configs = JSON.parse(text)
    if (!Array.isArray(configs)) {
      ElMessage.error('文件格式不正确，需要 JSON 数组')
      return
    }
    const result = await runAiConfigCreateBatch(configs, (cfg) => {
      const models = Array.isArray(cfg.model) ? cfg.model : (cfg.model ? [cfg.model] : [])
      return aiAPI.create({
        service_type: cfg.service_type,
        name: cfg.name,
        provider: cfg.provider,
        api_protocol: cfg.api_protocol || null,
        base_url: cfg.base_url,
        api_key: isMaskedSecret(cfg.api_key) ? '' : (cfg.api_key || ''),
        endpoint: cfg.endpoint || null,
        query_endpoint: cfg.query_endpoint || null,
        model: models,
        default_model: cfg.default_model || null,
        priority: cfg.priority ?? 0,
        is_default: !!cfg.is_default,
        settings: stripMaskedSecretsFromSettings(cfg.settings) || null,
      })
    })
    const listConfirmed = await loadList()
    const createdIds = result.created.map((item) => Number(item?.id)).filter(Number.isFinite)
    const createdVisible = createdIds.length === result.success
      && createdIds.every((id) => list.value.some((item) => Number(item.id) === id))
    const message = `导入完成：${result.success} 条成功，${result.failed} 条失败`
    if (listConfirmed && (result.success === 0 || createdVisible)) {
      if (result.success > 0) {
        invalidateConnectionTestResults()
        notifyConfigurationChanged()
        ElMessage.success(message)
      }
      else ElMessage.error(message)
    } else if (result.success > 0) {
      const refreshError = configLoadError.value
      const unconfirmedMessage = '配置已导入但列表未确认，请勿重复导入。请点击“重试”刷新列表。'
      configLoadError.value = refreshError ? `${unconfirmedMessage} ${refreshError}` : unconfirmedMessage
      ElMessage.error(unconfirmedMessage)
    } else {
      ElMessage.error(message)
    }
  } catch (e) {
    ElMessage.error('导入失败：' + (e.message || '文件解析错误'))
  } finally {
    event.target.value = ''
  }
}

async function loadVendorLock() {
  vendorLockAbortController?.abort()
  const controller = new AbortController()
  vendorLockAbortController = controller
  vendorLockLoading.value = true
  vendorLockResolved.value = false
  try {
    vendorLock.value = await withRequestRetry(
      () => aiAPI.getVendorLock(jsonRequestOptions(controller.signal)),
      { maxAttempts: 2, delayMs: 400, signal: controller.signal },
    )
    if (controller.signal.aborted) return
    vendorLockError.value = ''
    vendorLockResolved.value = true
  } catch (error) {
    if (isRequestCanceled(error) || controller.signal.aborted) return
    vendorLockError.value = describeServiceLoadError(error, {
      serviceLabel: '厂商锁定服务',
      fallback: '暂时无法确认厂商锁定状态，请稍后重试。',
      signal: controller.signal,
    })
    vendorLockResolved.value = false
  } finally {
    if (vendorLockAbortController === controller) {
      vendorLockAbortController = null
      vendorLockLoading.value = false
    }
  }
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
.coverage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}
.coverage-item {
  min-width: 0;
  min-height: 132px;
  display: grid;
  grid-template-rows: 1fr auto;
  align-items: start;
  gap: 8px 10px;
  padding: 10px;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 6px;
  background: var(--el-fill-color-blank, #fff);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}
.coverage-item:hover {
  border-color: var(--el-color-primary-light-5, #a0cfff);
  box-shadow: 0 2px 8px rgba(31, 41, 55, 0.08);
}
.coverage-select:focus-visible {
  outline: 2px solid var(--el-color-primary, #409eff);
  outline-offset: 2px;
}
.coverage-item:focus-visible {
  outline: 2px solid var(--el-color-primary, #409eff);
  outline-offset: 2px;
}
.coverage-item.is-selected {
  border-color: var(--el-color-primary, #409eff);
  background: var(--el-color-primary-light-9, #ecf5ff);
}
.coverage-select {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  min-width: 0;
  min-height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.coverage-icon {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 16px;
}
.coverage-icon-text { color: var(--ai-config-info-text, #2563eb); background: var(--ai-config-info-surface, #eff6ff); }
.coverage-icon-image { color: var(--ai-config-success-text, #047857); background: var(--ai-config-success-surface, #ecfdf5); }
.coverage-icon-storyboard_image { color: #7c3aed; background: #f5f3ff; }
.coverage-icon-video { color: var(--ai-config-warning-text, #c2410c); background: var(--ai-config-warning-surface, #fff7ed); }
.coverage-icon-tts { color: #0f766e; background: #f0fdfa; }
.coverage-item-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.coverage-item-heading {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}
.coverage-item-heading strong {
  color: var(--el-text-color-primary, #303133);
  font-size: 13px;
  line-height: 20px;
}
.coverage-description,
.coverage-config-count,
.coverage-config-detail,
.coverage-test-status {
  display: block;
  font-size: 12px;
  line-height: 1.45;
}
.coverage-description {
  color: var(--el-text-color-regular, #606266);
}
.coverage-config-count {
  color: var(--el-text-color-secondary, #909399);
}
.coverage-config-detail {
  min-width: 0;
  color: var(--el-text-color-primary, #303133);
  overflow-wrap: anywhere;
}
.coverage-test-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--el-text-color-secondary, #909399);
}
.coverage-status-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: #9ca3af;
}
.coverage-test-status.test-passed { color: var(--ai-config-success-text, #047857); }
.coverage-test-status.test-passed .coverage-status-dot { background: #10b981; }
.coverage-test-status.test-failed { color: var(--ai-config-danger-text, #b91c1c); }
.coverage-test-status.test-failed .coverage-status-dot { background: #ef4444; }
.coverage-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin-top: 2px;
}
.coverage-action-link {
  min-height: 32px;
  padding: 4px 8px;
}
.coverage-action-test {
  min-height: 32px;
  padding: 4px 10px;
  font-weight: 600;
}
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
.model-row { margin-bottom: 4px; }
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
.ph-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular, #606266);
  padding: 4px 0 6px;
  border-bottom: 1px solid var(--el-border-color-light, #ebeef5);
  margin-bottom: 4px;
}
.ph-tag {
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  margin-right: 6px;
  font-weight: 600;
  vertical-align: middle;
}
.ph-tag-img {
  background: #ecf5ff;
  color: #409eff;
  border: 1px solid #b3d8ff;
}
.ph-tag-vid {
  background: #f0f9eb;
  color: #67c23a;
  border: 1px solid #b3e19d;
}
.protocol-help .ph-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-text-color-primary, #303133);
}
.protocol-help .ph-body pre {
  background: var(--el-fill-color-light, #f5f7fa);
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  margin: 6px 0 2px;
  white-space: pre-wrap;
  word-break: break-all;
}
.protocol-help .ph-body code {
  background: var(--ai-config-code-surface, #f0f2f5);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
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
@media (max-width: 1120px) {
  .coverage-grid {
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
  .coverage-grid,
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
