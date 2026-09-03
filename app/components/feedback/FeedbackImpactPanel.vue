<script setup lang="ts">
import type { FeedbackResolutionImpact } from '#shared/types/feedback'

/** 已确认反馈处理结果的可审计展示属性。 */
interface Props {
  /** 当前已确认反馈的实际影响。 */
  impact: FeedbackResolutionImpact
}

const props = defineProps<Props>()

/**
 * 格式化可空时间戳。
 * @param timestamp UTC Unix 毫秒。
 * @returns 本地日期时间或占位文本。
 */
function formatTime(timestamp: number | null): string {
  return timestamp === null ? '尚未完成' : new Date(timestamp).toLocaleString('zh-CN')
}

/**
 * 返回成长分析的通俗状态。
 * @param status 当前分析批次状态。
 * @returns 对应中文状态。
 */
function analysisStatusLabel(status: NonNullable<Extract<FeedbackResolutionImpact, { targetType: 'persona' }>['analysis']>['status']): string {
  return {
    queued: '等待提炼',
    running: '提炼中',
    awaiting_review: '等待审核',
    completed: '已生成草稿',
    failed: '提炼失败',
  }[status]
}
</script>

<template>
  <div class="rounded-md border border-default bg-elevated/50 p-3 text-sm">
    <template v-if="props.impact.targetType === 'artifact'">
      <p class="font-medium text-highlighted">已创建当前产物修正</p>
      <p class="mt-1 text-muted">目标内容当前状态：{{ props.impact.blockStatus ?? '已不存在' }}。修正任务 {{ props.impact.task?.status ?? '已不存在' }}，已尝试 {{ props.impact.task?.attemptCount ?? 0 }} / {{ props.impact.task?.maxAttempts ?? 0 }} 次。</p>
      <p v-if="props.impact.task?.lastError" class="mt-1 text-error">最近错误：{{ props.impact.task.lastError }}</p>
    </template>

    <template v-else-if="props.impact.targetType === 'parameters'">
      <p class="font-medium text-highlighted">已记录运行参数建议</p>
      <p class="mt-1 text-muted">{{ props.impact.recommendation }}</p>
      <p class="mt-1 text-muted">适用范围：{{ props.impact.scope }}。当前不会自动修改已有或后续任务参数。</p>
    </template>

    <template v-else-if="props.impact.targetType === 'source_fact'">
      <p class="font-medium text-highlighted">已记录资料事实问题</p>
      <p class="mt-1 text-muted">资料：{{ props.impact.sourceName ?? '原资料已删除' }}；{{ props.impact.hasEvidenceConflict ? '已标记存在事实冲突。' : '未标记为事实冲突。' }}</p>
      <p class="mt-1 text-muted">系统不会自动修改资料或人物。</p>
    </template>

    <template v-else>
      <p class="font-medium text-highlighted">已加入人物成长链路</p>
      <p class="mt-1 text-muted">
        成长素材：{{ props.impact.material ? `评分 ${props.impact.material.importance}，${props.impact.material.isEnabled ? '参加提炼' : '已停用'}` : '已删除' }}。
      </p>
      <template v-if="props.impact.analysis">
        <p class="mt-1 text-muted">最近提炼：{{ analysisStatusLabel(props.impact.analysis.status) }}，{{ formatTime(props.impact.analysis.completedAt) }}。</p>
        <p v-if="props.impact.analysis.resultSummary" class="mt-1 text-muted">{{ props.impact.analysis.resultSummary }}</p>
        <p v-if="props.impact.analysis.errorMessage" class="mt-1 text-error">提炼错误：{{ props.impact.analysis.errorMessage }}</p>
      </template>
      <p v-else class="mt-1 text-muted">尚未使用这条素材进行成长提炼。</p>
      <p v-if="props.impact.publishedPrompt" class="mt-1 text-success">已发布成长提示词版本 {{ props.impact.publishedPrompt.versionNo }}。</p>
      <p v-else class="mt-1 text-muted">尚未发布成长提示词，因此不会影响后续任务。</p>
      <div v-if="props.impact.affectedRuns.length" class="mt-2">
        <p class="font-medium text-highlighted">已实际使用该版本的后续任务</p>
        <ul class="mt-1 space-y-1 text-muted">
          <li v-for="run in props.impact.affectedRuns" :key="run.id">
            <NuxtLink :to="`/runs/${run.id}`" class="hover:underline">{{ run.personaName }} · {{ run.status }} · {{ formatTime(run.createdAt) }}</NuxtLink>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
