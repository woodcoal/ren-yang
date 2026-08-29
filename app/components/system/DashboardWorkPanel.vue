<script setup lang="ts">
import { computed } from 'vue'
import type { PersonaSummary } from '#shared/types/content'
import type { RunSummary } from '#shared/types/generation'

/** 仪表盘最近工作的只读属性。 */
interface Props {
  /** 全部人物摘要；组件只展示最近更新的四项。 */
  personas: PersonaSummary[]
  /** 最近运行摘要；组件只展示仍需处理的五项。 */
  runs: RunSummary[]
  /** 尚未确认分类的反馈事件数量。 */
  pendingFeedbackCount: number
  /** 尚未发布或拒绝的修订提案数量。 */
  pendingProposalCount: number
}

const props = defineProps<Props>()

/** 最近更新的人物，避免修改父级数组。 */
const recentPersonas = computed(() => [...props.personas]
  .sort((left, right) => right.updatedAt - left.updatedAt)
  .slice(0, 4))
/** 仍在规划、确认或执行阶段的最近运行。 */
const activeRuns = computed(() => props.runs
  .filter(run => ['planning', 'awaiting_confirmation', 'queued', 'running'].includes(run.status))
  .slice(0, 5))
/** 所有仍需管理员处理的反馈和提案合计。 */
const pendingFeedbackTotal = computed(() => props.pendingFeedbackCount + props.pendingProposalCount)

/** 活动运行状态的中文标签。 */
const statusLabels: Partial<Record<RunSummary['status'], string>> = {
  planning: '规划中', awaiting_confirmation: '等待确认', queued: '排队中', running: '执行中',
}

/**
 * 返回运行输入的单行预览。
 * @param run 活动运行摘要。
 * @returns 最多六十个字符的输入摘要。
 */
function inputPreview(run: RunSummary): string {
  const input = 'content' in run.input ? run.input.content : run.input.requirement
  return input.length > 60 ? `${input.slice(0, 60)}…` : input
}
</script>

<template>
  <div class="grid gap-6 xl:grid-cols-2">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-semibold text-highlighted">最近人物</h2>
          <UButton to="/personas" color="neutral" variant="link" size="sm">查看全部</UButton>
        </div>
      </template>
      <div v-if="recentPersonas.length" class="space-y-2">
        <NuxtLink v-for="persona in recentPersonas" :key="persona.id" :to="`/personas/${persona.id}`" class="block rounded-md border border-default p-3 hover:bg-elevated">
          <div class="flex items-center justify-between gap-3">
            <p class="font-medium text-highlighted">{{ persona.name }}</p>
            <UBadge :color="persona.activeVersionId ? 'success' : 'warning'" variant="subtle">{{ persona.activeVersionId ? '已发布' : '仅候选' }}</UBadge>
          </div>
          <p class="mt-1 line-clamp-2 text-sm text-muted">{{ persona.currentSummary || '尚无已发布人物摘要' }}</p>
        </NuxtLink>
      </div>
      <p v-else class="py-6 text-center text-sm text-muted">尚未创建人物。</p>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-semibold text-highlighted">待处理工作</h2>
          <div class="flex gap-2">
            <UBadge color="neutral" variant="subtle">活动运行 {{ activeRuns.length }}</UBadge>
            <UBadge :color="pendingFeedbackTotal ? 'warning' : 'neutral'" variant="subtle">待处理反馈 {{ pendingFeedbackTotal }}</UBadge>
          </div>
        </div>
      </template>
      <div v-if="activeRuns.length" class="space-y-2">
        <NuxtLink v-for="run in activeRuns" :key="run.id" :to="`/runs/${run.id}`" class="block rounded-md border border-default p-3 hover:bg-elevated">
          <div class="flex items-center justify-between gap-3">
            <p class="font-medium text-highlighted">{{ run.personaName }}</p>
            <UBadge color="neutral" variant="subtle">{{ statusLabels[run.status] }}</UBadge>
          </div>
          <p class="mt-1 line-clamp-2 text-sm text-muted">{{ inputPreview(run) }}</p>
        </NuxtLink>
      </div>
      <p v-else class="py-6 text-center text-sm text-muted">当前没有活动运行。</p>
      <template #footer>
        <div class="flex flex-wrap gap-2">
          <UButton to="/history" color="neutral" variant="soft">运行历史</UButton>
          <UButton to="/feedback" color="neutral" variant="soft">反馈与版本</UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>
