<template>
  <div class="sd2-asset-dialogs">
    <!-- 新建资产组 -->
    <AccessibleDialog v-model="dlgGroupCreate" title="创建资产组" width="480px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="名称" required>
          <el-input v-model="formGroupName" placeholder="资产组名称" />
        </el-form-item>
        <el-form-item label="扩展 JSON">
          <el-input v-model="formGroupExtraJson" type="textarea" :rows="3" placeholder="可选，合并进请求体，例如填写描述说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="dlgLoading" :title="dlgLoading ? '正在提交资产请求，请稍候' : undefined" :aria-label="dlgLoading ? '正在提交资产请求，请稍候' : '取消新建资产组'" @click="dlgGroupCreate = false">取消</el-button>
        <el-button type="primary" :loading="dlgLoading" :disabled="Boolean(submitLockReason)" :title="submitLockReason" :aria-label="dlgLoading ? '正在提交资产请求，请稍候' : (submitLockReason || '提交新建资产组')" @click="submitCreateGroup">提交</el-button>
      </template>
    </AccessibleDialog>

    <!-- 编辑资产组 -->
    <AccessibleDialog v-model="dlgGroupEdit" title="更新资产组" width="520px" destroy-on-close>
      <el-alert type="warning" :closable="false" title="按官方文档填写需更新的字段；以下为常用名称修改。" style="margin-bottom: 12px" />
      <el-form label-width="100px">
        <el-form-item label="标识" required>
          <el-input v-model="editGroupId" disabled title="已保存的资产组标识不能修改" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="editGroupName" />
        </el-form-item>
        <el-form-item label="完整 JSON">
          <el-input v-model="editGroupFullJson" type="textarea" :rows="6" placeholder='若填写则优先整段作为请求体（须含 Id）' />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="dlgLoading" :title="dlgLoading ? '正在提交资产请求，请稍候' : undefined" :aria-label="dlgLoading ? '正在提交资产请求，请稍候' : '取消编辑资产组'" @click="dlgGroupEdit = false">取消</el-button>
        <el-button type="primary" :loading="dlgLoading" :disabled="Boolean(submitLockReason)" :title="submitLockReason" :aria-label="dlgLoading ? '正在提交资产请求，请稍候' : (submitLockReason || '提交编辑资产组')" @click="submitUpdateGroup">提交</el-button>
      </template>
    </AccessibleDialog>

    <!-- 新建资产 -->
    <AccessibleDialog v-model="dlgAssetCreate" title="创建资产" width="520px" destroy-on-close>
      <el-form label-width="110px">
        <el-form-item label="资产组编号" required>
          <el-input v-model="formAssetGroupId" placeholder="资产组编号" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="formAssetName" placeholder="资产名称" />
        </el-form-item>
        <el-form-item label="资产类型">
          <el-select v-model="formAssetType" style="width: 100%">
            <el-option label="图片" value="Image" />
            <el-option label="视频" value="Video" />
            <el-option label="音频" value="Audio" />
          </el-select>
        </el-form-item>
        <el-form-item label="模型">
          <el-input v-model="formAssetModel" placeholder="视频建议 volc-asset-video；音频 volc-asset-audio；图片可空" clearable />
        </el-form-item>
        <el-form-item label="资源地址">
          <el-input v-model="formAssetUrl" type="textarea" :rows="2" placeholder="公网资源地址，或图片的 Base64 数据" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="dlgLoading" :title="dlgLoading ? '正在提交资产请求，请稍候' : undefined" :aria-label="dlgLoading ? '正在提交资产请求，请稍候' : '取消新建资产'" @click="dlgAssetCreate = false">取消</el-button>
        <el-button type="primary" :loading="dlgLoading" :disabled="Boolean(submitLockReason)" :title="submitLockReason" :aria-label="dlgLoading ? '正在提交资产请求，请稍候' : (submitLockReason || '提交新建资产')" @click="submitCreateAsset">提交</el-button>
      </template>
    </AccessibleDialog>

    <!-- 编辑资产 -->
    <AccessibleDialog v-model="dlgAssetEdit" title="更新资产" width="520px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="标识" required>
          <el-input v-model="editAssetId" disabled title="已保存的资产标识不能修改" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="editAssetName" />
        </el-form-item>
        <el-form-item label="完整 JSON">
          <el-input v-model="editAssetFullJson" type="textarea" :rows="6" placeholder="若填写则整段作为请求体（须含 Id）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="dlgLoading" :title="dlgLoading ? '正在提交资产请求，请稍候' : undefined" :aria-label="dlgLoading ? '正在提交资产请求，请稍候' : '取消编辑资产'" @click="dlgAssetEdit = false">取消</el-button>
        <el-button type="primary" :loading="dlgLoading" :disabled="Boolean(submitLockReason)" :title="submitLockReason" :aria-label="dlgLoading ? '正在提交资产请求，请稍候' : (submitLockReason || '提交编辑资产')" @click="submitUpdateAsset">提交</el-button>
      </template>
    </AccessibleDialog>

    <!-- 详情 JSON -->
    <AccessibleDialog v-model="dlgDetail" title="详情" width="640px" destroy-on-close>
      <el-input :model-value="detailJson" type="textarea" :rows="16" readonly class="mono" />
      <template #footer>
        <el-button type="primary" aria-label="关闭资产详情" @click="dlgDetail = false">关闭</el-button>
      </template>
    </AccessibleDialog>
  </div>
</template>

<script setup>
defineOptions({ inheritAttrs: false })

// 仅展示资产组/资产对话框；提交、校验和接口调用仍留在认证资产管理页。
defineProps({
  dlgLoading: { type: Boolean, default: false },
  submitLockReason: { type: String, default: undefined },
  submitCreateGroup: { type: Function, required: true },
  submitUpdateGroup: { type: Function, required: true },
  submitCreateAsset: { type: Function, required: true },
  submitUpdateAsset: { type: Function, required: true },
})

const dlgGroupCreate = defineModel('dlgGroupCreate', { type: Boolean, default: false })
const formGroupName = defineModel('formGroupName', { type: String, default: '' })
const formGroupExtraJson = defineModel('formGroupExtraJson', { type: String, default: '' })

const dlgGroupEdit = defineModel('dlgGroupEdit', { type: Boolean, default: false })
const editGroupId = defineModel('editGroupId', { type: String, default: '' })
const editGroupName = defineModel('editGroupName', { type: String, default: '' })
const editGroupFullJson = defineModel('editGroupFullJson', { type: String, default: '' })

const dlgAssetCreate = defineModel('dlgAssetCreate', { type: Boolean, default: false })
const formAssetGroupId = defineModel('formAssetGroupId', { type: String, default: '' })
const formAssetName = defineModel('formAssetName', { type: String, default: '' })
const formAssetType = defineModel('formAssetType', { type: String, default: 'Image' })
const formAssetModel = defineModel('formAssetModel', { type: String, default: '' })
const formAssetUrl = defineModel('formAssetUrl', { type: String, default: '' })

const dlgAssetEdit = defineModel('dlgAssetEdit', { type: Boolean, default: false })
const editAssetId = defineModel('editAssetId', { type: String, default: '' })
const editAssetName = defineModel('editAssetName', { type: String, default: '' })
const editAssetFullJson = defineModel('editAssetFullJson', { type: String, default: '' })

const dlgDetail = defineModel('dlgDetail', { type: Boolean, default: false })
const detailJson = defineModel('detailJson', { type: String, default: '' })
</script>

<style scoped>
.mono :deep(textarea) {
  font-family: Menlo, Consolas, monospace;
  font-size: 12px;
}
</style>
