<script setup lang="ts">
/** API Key 页面只负责页面语义和特性组件组合，不持有业务状态。 */
</script>

<template>
  <div>
    <ContentPageHeader title="API Key" description="为外部 Agent 和自动化脚本创建最小权限凭据；完整 Key 只展示一次。" />
    <UAlert class="mb-6" color="neutral" variant="soft" title="公共 API v2" description="交互文档位于 /api/v2/docs。API Key 只能调用人物、世界和资料库接口，不能管理其他 API Key。" />
    <ApiKeyManager />
  </div>
</template>
