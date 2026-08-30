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
/** 所有仍需管理员确认用途的反馈数量。 */
const pendingFeedbackTotal = computed(() => props.pendingFeedbackCount)

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

/**
 * 把时间戳格式化为便于扫描的本地日期时间。
 * @param timestamp UTC Unix 毫秒时间戳。
 * @returns 使用当前浏览器时区的简短日期时间。
 */
function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(timestamp)
}
</script>

<template>
  <div>
    <section class="content-section" aria-labelledby="dashboard-priority-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">01 · 优先处理</p>
          <h2 id="dashboard-priority-heading">需要你作决定</h2>
          <p>反馈只有在确认用途后才会执行一次性动作或成为人物学习资料。</p>
        </div>
        <NuxtLink to="/feedback" class="section-link">进入学习中心</NuxtLink>
      </div>

      <div v-if="pendingFeedbackTotal" class="log-list">
        <article v-if="pendingFeedbackCount" class="log-row">
          <span class="log-row-meta">反馈分类</span>
          <div class="log-row-main">
            <NuxtLink to="/feedback" class="log-row-title">确认反馈会影响哪一部分</NuxtLink>
            <span class="log-row-description">系统建议仅作参考，需要你确认是修正本次结果、记录参数建议、人物学习资料还是资料事实问题。</span>
          </div>
          <span class="log-row-end"><UBadge color="warning" variant="subtle">待处理 {{ pendingFeedbackCount }}</UBadge></span>
        </article>
      </div>
      <div v-else class="content-notice">
        <UIcon name="i-lucide-circle-check" class="content-notice-icon" aria-hidden="true" />
        <div class="content-notice-copy">
          <strong>当前没有需要确认的学习事项</strong>
          <p>新的反馈出现后，会在这里等待用途确认。</p>
        </div>
      </div>
    </section>

    <section class="content-section" aria-labelledby="dashboard-active-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">02 · 正在进行</p>
          <h2 id="dashboard-active-heading">继续任务</h2>
          <p>规划、等待确认、排队和执行中的任务集中在这里。</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UBadge color="neutral" variant="subtle">活动运行 {{ activeRuns.length }}</UBadge>
          <UBadge :color="pendingFeedbackTotal ? 'warning' : 'neutral'" variant="subtle">待处理反馈 {{ pendingFeedbackTotal }}</UBadge>
          <NuxtLink to="/history" class="section-link">查看全部任务</NuxtLink>
        </div>
      </div>

      <div v-if="activeRuns.length" class="log-list">
        <article v-for="run in activeRuns" :key="run.id" class="log-row">
          <span class="log-row-meta">{{ formatDateTime(run.updatedAt) }}</span>
          <div class="log-row-main">
            <NuxtLink :to="`/runs/${run.id}`" class="log-row-title">{{ run.personaName }} · {{ run.kind === 'interest_assessment' ? '兴趣判断' : '内容创作' }}</NuxtLink>
            <span class="log-row-description">{{ inputPreview(run) }}</span>
          </div>
          <span class="log-row-end"><UBadge color="neutral" variant="subtle">{{ statusLabels[run.status] }}</UBadge></span>
        </article>
      </div>
      <p v-else class="empty-log-row">当前没有活动运行，可以从新建任务开始。</p>
    </section>

    <section class="content-section" aria-labelledby="dashboard-personas-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">03 · 人物空间</p>
          <h2 id="dashboard-personas-heading">最近使用的人物</h2>
          <p>已启用的人物可以直接发起任务，禁用后仍保留全部历史。</p>
        </div>
        <NuxtLink to="/personas" class="section-link">查看人物列表</NuxtLink>
      </div>

      <div v-if="recentPersonas.length" class="archive-panel-grid">
        <article v-for="persona in recentPersonas" :key="persona.id" class="archive-panel">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="log-row-meta">{{ persona.worldName || '未关联世界' }}</span>
            <UBadge :color="persona.isEnabled ? 'success' : 'neutral'" variant="subtle">{{ persona.isEnabled ? '已启用' : '已禁用' }}</UBadge>
          </div>
          <h3 class="mt-4">
            <NuxtLink :to="`/personas/${persona.id}`" class="log-row-title">{{ persona.name }}</NuxtLink>
          </h3>
          <p class="mt-2 text-sm">{{ persona.currentSummary || '暂无灵魂提示词' }}</p>
          <p class="mt-3 text-xs">版本 {{ persona.versionCount }} · 资料 {{ persona.sourceCount }} · {{ persona.worldName || '未关联世界' }}</p>
          <NuxtLink :to="`/personas/${persona.id}`" class="section-link mt-3">进入人物工作区</NuxtLink>
        </article>
      </div>
      <p v-else class="empty-log-row">尚未创建人物。</p>
    </section>
  </div>
</template>
