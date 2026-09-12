<template>
  <el-alert type="info" :closable="false" class="sd2-intro" show-icon>
    <template #title>
      <span>
        对接 BytePlus ModelArk / 火山方舟<strong>私有资产库</strong>，Seedance 2.0 会使用的 <code>Asset://</code> 素材。
        配置完成后请点击下方<strong>「保存到 AI 配置」</strong>。创作页「认证资产」将优先使用「即梦2角色认证」；若未配置则使用此处保存的官方资产库配置。
        官方流程：<a href="https://docs.byteplus.com/en/docs/ModelArk/2318270" target="_blank" rel="noopener">创建资产组</a>
        、创建资产，以及列表 / 查询 / 更新 / 删除。
        带查询参数的接口是<strong>控制台 OpenAPI</strong>，请使用控制台
        <a href="https://console.volcengine.com/iam/keymanage" target="_blank" rel="noopener">访问密钥（AK/SK）</a>签名，不能用推理用的 ARK API 密钥当令牌（Bearer），否则会报无效授权（见
        <a href="https://docs.byteplus.com/en/docs/ModelArk/1298459" target="_blank" rel="noopener">鉴权说明</a>）。
        若已能调通接口但返回<strong>没有权限</strong>，说明访问密钥对应的账号<strong>缺策略</strong>：在控制台为该用户绑定含 ModelArk 私有资产/资产组管理的权限（参见
        <a href="https://docs.byteplus.com/en/docs/ModelArk/1263493" target="_blank" rel="noopener">IAM 策略控制</a>），保存后再试。
      </span>
    </template>
  </el-alert>
</template>

<script setup>
// 只展示认证资产库说明；保存仍由父级写配置，不在认证资产库子页发请求。
</script>

<style scoped>
.sd2-intro {
  margin-bottom: 14px;
}
.sd2-intro code {
  font-size: 12px;
}
</style>
