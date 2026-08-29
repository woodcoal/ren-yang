<script setup lang="ts">
import type { AuditEventView } from '#shared/types/system'

const props = defineProps<{
  /** 新记录在前的关键动作审计历史。 */
  events: AuditEventView[]
}>()

/** 审计动作的固定中文名称。 */
const ACTION_LABELS: Record<string, string> = {
  administrator_created: '创建管理员',
  administrator_password_reset: '重置管理员密码',
  persona_version_published: '发布人物版本',
  persona_rolled_back: '回滚人物版本',
  persona_deleted: '删除人物',
  world_version_published: '发布世界版本',
  world_version_deleted: '删除世界版本',
  world_rolled_back: '回滚世界版本',
  world_deleted: '删除世界',
  source_deleted: '删除资料',
  revision_proposal_published: '发布人物修订提案',
  revision_proposal_rejected: '拒绝人物修订提案',
  data_restored: '恢复数据备份',
}

/** @param action 稳定审计动作。 @returns 已知动作中文名或原始稳定名称。 */
function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

/** @param actor 审计主体。 @returns 中文主体名称。 */
function actorLabel(actor: AuditEventView['actor']): string {
  if (actor === 'administrator') return '管理员'
  if (actor === 'maintenance') return '本机维护命令'
  return '系统'
}

/** @param timestamp UTC Unix 毫秒。 @returns 本地时间。 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <h2 class="font-semibold text-highlighted">关键动作审计</h2>
        <p class="mt-1 text-sm text-muted">只记录动作、资源标识和时间，不保存密码、资料正文或模型内容。</p>
      </div>
    </template>
    <div v-if="props.events.length" class="divide-y divide-default">
      <div v-for="event in props.events" :key="event.id" class="py-3 first:pt-0 last:pb-0">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-highlighted">{{ actionLabel(event.action) }}</span>
            <UBadge color="neutral" variant="subtle">{{ actorLabel(event.actor) }}</UBadge>
          </div>
          <time class="text-xs text-dimmed" :datetime="new Date(event.createdAt).toISOString()">{{ formatTime(event.createdAt) }}</time>
        </div>
        <p class="mt-2 break-all text-xs text-muted">
          {{ event.targetType }} · {{ event.targetId ?? '全局动作' }}
        </p>
      </div>
    </div>
    <p v-else class="py-6 text-center text-sm text-muted">尚无关键动作审计记录。</p>
  </UCard>
</template>
