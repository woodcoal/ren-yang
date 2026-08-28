<script setup lang="ts">
import type { VersionFieldDiff } from '#shared/types/content'

/** 人物版本差异展示属性。 */
interface Props {
  /** 按档案字段排序的差异。 */
  differences: VersionFieldDiff[]
}

defineProps<Props>()
</script>

<template>
  <div class="space-y-3">
    <p v-if="differences.length === 0" class="text-sm text-muted">两个版本没有字段差异。</p>
    <UCard v-for="difference in differences" :key="difference.field">
      <p class="mb-3 font-medium text-highlighted">{{ difference.label }}</p>
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <p class="mb-1 text-xs font-medium text-muted">变更前</p>
          <pre class="content-pre">{{ difference.before || '（空）' }}</pre>
        </div>
        <div>
          <p class="mb-1 text-xs font-medium text-muted">变更后</p>
          <pre class="content-pre">{{ difference.after || '（空）' }}</pre>
        </div>
      </div>
    </UCard>
  </div>
</template>
