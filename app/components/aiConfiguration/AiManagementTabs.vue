<template>
  <nav class="management-tabs" aria-label="AI 管理分区">
    <NuxtLink class="management-tab" active-class="management-tab--active" to="/ai-models">
      接口与模型
    </NuxtLink>
    <NuxtLink class="management-tab" active-class="management-tab--active" to="/ai-algorithms">
      算法配置
    </NuxtLink>
  </nav>
</template>

<style scoped>
.management-tabs {
  display: flex;
  gap: 0.5rem;
  margin-top: 2rem;
  padding: 0.375rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-control);
  background: var(--app-surface-raised);
}

.management-tab {
  flex: 1;
  padding: 0.75rem 1rem;
  border-radius: calc(var(--radius-control) - 0.25rem);
  color: var(--app-muted);
  text-align: center;
}

.management-tab:hover,
.management-tab--active {
  background: var(--app-surface);
  color: var(--app-fg);
}
</style>
