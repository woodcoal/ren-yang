<script setup lang="ts">
import type { EvidenceSnapshotView } from '#shared/types/generation'

defineProps<{
  /** 运行创建时复制的不可变证据正文。 */
  evidence: EvidenceSnapshotView[]
}>()

/** 证据角色中文标签。 */
const roleLabels: Record<EvidenceSnapshotView['role'], string> = {
  user_setting: '用户设定', canon_fact: '原著事实', reference: '参考资料', style_sample: '风格样本',
}
</script>

<template>
  <div v-if="evidence.length" class="space-y-3">
    <details v-for="item in evidence" :key="item.id" class="rounded-md border border-default p-3">
      <summary class="cursor-pointer text-sm font-medium text-highlighted">{{ roleLabels[item.role] }} · 排名 {{ item.rank + 1 }}</summary>
      <pre class="content-pre mt-3">{{ item.content }}</pre>
      <p class="mt-2 break-all text-xs text-dimmed">SHA-256：{{ item.contentHash }}</p>
    </details>
  </div>
  <p v-else class="text-sm text-muted">本次运行没有检索到资料证据。</p>
</template>
