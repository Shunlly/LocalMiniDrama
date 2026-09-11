<template>
  <el-alert type="info" :closable="false" class="sd2-intro" show-icon>
    <template #title>
      <span>
        对接 BytePlus ModelArk / 火山方舟<strong>私有资产库</strong>（Seedance 2.0 等使用的 <code>Asset://</code> 素材）。
        配置完成后请点击下方<strong>「保存到 AI 配置」</strong>，创作页「认证资产」将优先使用「即梦2角色认证」；若未配置则使用此处保存的官方资产库配置。
        官方流程：<a href="https://docs.byteplus.com/en/docs/ModelArk/2318270" target="_blank" rel="noopener">创建资产组（CreateAssetGroup）</a>
        → 创建资产（CreateAsset）→ 列表 / 查询 / 更新 / 删除。
        带 <code>?Action=</code> 的接口为<strong>控制面 OpenAPI</strong>，须使用控制台
        <a href="https://console.volcengine.com/iam/keymanage" target="_blank" rel="noopener">访问密钥（AK/SK）</a>签名，不能用推理用的 ARK API 密钥当令牌（Bearer），否则会报无效授权，原文为 Invalid Authorization（见
        <a href="https://docs.byteplus.com/en/docs/ModelArk/1298459" target="_blank" rel="noopener">认证说明</a>）。
        若已能调通接口但返回 <strong>403 无权限</strong>（原文可能含 <code>not authorized</code> / <code>ark:CreateAssetGroup</code>），说明访问密钥对应的账号<strong>缺策略</strong>：在控制台为该用户绑定含 ModelArk 私有资产/资产组管理的权限（参见
        <a href="https://docs.byteplus.com/en/docs/ModelArk/1263493" target="_blank" rel="noopener">IAM 访问控制</a>），勿仅用「能推理」的极简权限。
      </span>
    </template>
  </el-alert>
</template>

<script setup>
// 仅展示认证资产库说明；连接表单和写操作仍留在认证资产管理页。
</script>

<style scoped>
.sd2-intro {
  margin-bottom: 14px;
}
.sd2-intro code {
  font-size: 12px;
}
</style>
