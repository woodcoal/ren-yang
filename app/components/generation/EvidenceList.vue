<script setup lang="ts">
import { computed } from 'vue'
import type { EvidenceSnapshotView } from '#shared/types/generation'

const props = withDefaults(defineProps<{
  /** 运行创建时复制的不可变证据正文。 */
  evidence: EvidenceSnapshotView[]
  /** 兴趣判断明确引用的支持证据标识。 */
  supportingEvidenceIds?: string[]
  /** 兴趣判断明确引用的反对证据标识。 */
  opposingEvidenceIds?: string[]
}>(), { supportingEvidenceIds: () => [], opposingEvidenceIds: () => [] })

/** 证据角色中文标签。 */
const roleLabels: Record<EvidenceSnapshotView['role'], string> = {
  user_setting: '用户设定', canon_fact: '原著事实', reference: '参考资料', style_sample: '风格样本',
}
/** 支持当前 AI 推断的证据集合。 */
const supportingEvidence = computed(() => new Set(props.supportingEvidenceIds))
/** 反对当前 AI 推断的证据集合。 */
const opposingEvidence = computed(() => new Set(props.opposingEvidenceIds))

/**
 * 返回证据与当前 AI 推断的明确关系。
 * @param evidenceId 证据快照 UUID。
 * @returns 支持、反对或未被结论直接引用。
 */
function relationLabel(evidenceId: string): string | null {
  if (supportingEvidence.value.has(evidenceId)) return '支持 AI 推断'
  if (opposingEvidence.value.has(evidenceId)) return '反对 AI 推断'
  return null
}
</script>

<template>
  <div v-if="props.evidence.length" class="space-y-3">
    <details v-for="item in props.evidence" :key="item.id" class="rounded-md border border-default p-3">
      <summary class="cursor-pointer text-sm font-medium text-highlighted">
        {{ roleLabels[item.role] }} · 排名 {{ item.rank + 1 }}
        <UBadge v-if="relationLabel(item.id)" class="ml-2" :color="supportingEvidence.has(item.id) ? 'success' : 'error'" variant="subtle">{{ relationLabel(item.id) }}</UBadge>
      </summary>
      <pre class="content-pre mt-3">{{ item.content }}</pre>
      <p class="mt-2 break-all text-xs text-muted">
        来源：<NuxtLink v-if="item.sourceId" :to="`/sources/${item.sourceId}`" class="hover:underline">资料 {{ item.sourceId }}</NuxtLink><span v-else>人物版本内设定</span>
      </p>
      <p class="mt-2 break-all text-xs text-dimmed">SHA-256：{{ item.contentHash }}</p>
    </details>
  </div>
  <p v-else class="text-sm text-muted">本次运行没有检索到资料证据。</p>
</template>
