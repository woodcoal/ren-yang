<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { DeletionImpact } from '#shared/types/content'

/** 支持统一生命周期操作的内容类型。 */
type SubjectType = 'persona' | 'world' | 'source'

/** 生命周期操作面板属性。 */
interface Props {
  /** 当前操作对象类型。 */
  subjectType: SubjectType
  /** 当前操作对象名称。 */
  subjectName: string
  /** 当前对象是否启用。 */
  isEnabled: boolean
  /** 用户主动查询后返回的删除影响；尚未查询时为 null。 */
  deletionImpact: DeletionImpact | null
  /** 页面是否正在执行其他操作。 */
  loading: boolean
}

/** 生命周期操作面板事件。 */
interface Emits {
  /** 请求页面打开启用或禁用二次确认框。 */
  requestStatusChange: []
  /** 请求页面查询永久删除影响。 */
  inspectDeletion: []
  /** 用户阅读影响并明确确认后请求页面执行删除。 */
  delete: []
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const deletionConfirmed = shallowRef(false)

/** 当前对象的中文类型名称。 */
const subjectLabel = computed(() => ({ persona: '人物', world: '世界', source: '资料' })[props.subjectType])

/** 禁用当前对象后受到影响的业务范围说明。 */
const statusDescription = computed(() => {
  if (props.subjectType === 'persona') return '禁用后不能用该人物创建新任务；人物设定、成长、记忆、资料关系和历史任务仍会保留。'
  if (props.subjectType === 'world') return '禁用后该世界不再进入新任务；世界版本、人物关系、资料和历史任务仍会保留。'
  return '禁用后资料不再进入人物或世界检索；正文、内容段落和使用关系仍会保留。'
})

/** 永久删除时必然移除的当前对象主体数据说明。 */
const primaryDeletionDescription = computed(() => {
  if (props.subjectType === 'persona') return '人物基础信息、账号信息、成长数据和记忆数据'
  if (props.subjectType === 'world') return '世界基础信息和成长数据'
  return '资料正文及系统整理的可检索数据'
})

/**
 * 删除影响变化时撤销旧的人工确认，避免复用过期确认状态。
 * @returns 确认状态重置后结束。
 */
function resetDeletionConfirmation(): void {
  deletionConfirmed.value = false
}

watch(() => props.deletionImpact, resetDeletionConfirmation)

/**
 * 在影响允许删除且用户明确确认后通知详情页执行永久删除。
 * @returns 删除事件发出或条件不满足时结束。
 */
function confirmDeletion(): void {
  if (!deletionConfirmed.value || !props.deletionImpact?.canDelete) return
  emit('delete')
}
</script>

<template>
  <div class="grid gap-6 xl:grid-cols-2">
    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">使用状态</h2>
          <p class="mt-1 text-sm text-muted">集中管理{{ subjectLabel }}是否参与后续任务和检索。</p>
        </div>
      </template>
      <div class="space-y-4">
        <UAlert
          :color="isEnabled ? 'success' : 'warning'"
          :title="`${subjectLabel}当前${isEnabled ? '已启用' : '已禁用'}`"
          :description="statusDescription"
        />
        <UButton
          :color="isEnabled ? 'error' : 'success'"
          variant="soft"
          :loading="loading"
          @click="emit('requestStatusChange')"
        >
          {{ isEnabled ? `禁用${subjectLabel}` : `启用${subjectLabel}` }}
        </UButton>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-error">永久删除{{ subjectLabel }}</h2>
          <p class="mt-1 text-sm text-muted">删除是永久且不可恢复的操作，必须先读取当前实际影响。</p>
        </div>
      </template>

      <UButton
        v-if="!deletionImpact"
        color="error"
        variant="soft"
        :loading="loading"
        @click="emit('inspectDeletion')"
      >
        查看删除影响
      </UButton>

      <div v-else class="space-y-4 text-sm">
        <UAlert
          v-if="!deletionImpact.canDelete"
          color="warning"
          title="当前不能删除"
          :description="deletionImpact.blockers.join('；')"
        />

        <template v-else>
          <UAlert color="error" title="以下内容将被永久删除或解除关系" description="请逐项核对后再确认，删除完成后无法撤销。" />
          <ul class="list-disc space-y-2 pl-5 text-muted">
            <li>{{ primaryDeletionDescription }}</li>
            <li v-if="deletionImpact.versionCount > 0">{{ deletionImpact.versionCount }} 个灵魂版本</li>
            <li v-if="deletionImpact.runHistory.runs > 0">{{ deletionImpact.runHistory.runs }} 次任务记录</li>
            <li v-if="deletionImpact.runHistory.tasks > 0">{{ deletionImpact.runHistory.tasks }} 个后台任务</li>
            <li v-if="deletionImpact.runHistory.evidenceSnapshots > 0">{{ deletionImpact.runHistory.evidenceSnapshots }} 项证据快照</li>
            <li v-if="deletionImpact.runHistory.documentSpecs > 0">{{ deletionImpact.runHistory.documentSpecs }} 项文档规格修订</li>
            <li v-if="deletionImpact.runHistory.artifactBlocks > 0 || deletionImpact.runHistory.blockAttempts > 0">
              {{ deletionImpact.runHistory.artifactBlocks }} 个产物块及 {{ deletionImpact.runHistory.blockAttempts }} 次生成尝试
            </li>
            <li v-if="deletionImpact.relatedPersonas.length > 0">
              解除 {{ deletionImpact.relatedPersonas.length }} 项人物关系：{{ deletionImpact.relatedPersonas.map(item => item.name).join('、') }}
            </li>
            <li v-if="deletionImpact.relatedWorlds.length > 0">
              解除 {{ deletionImpact.relatedWorlds.length }} 项世界关系：{{ deletionImpact.relatedWorlds.map(item => item.name).join('、') }}
            </li>
            <li v-if="deletionImpact.relatedSources.length > 0">
              解除 {{ deletionImpact.relatedSources.length }} 项资料关系：{{ deletionImpact.relatedSources.map(item => item.name).join('、') }}
            </li>
            <li v-if="deletionImpact.files.length > 0">{{ deletionImpact.files.length }} 项本地文件或目录</li>
          </ul>
          <UCheckbox v-model="deletionConfirmed" :label="`我已阅读以上影响，确认永久删除“${subjectName}”`" />
          <UButton color="error" :disabled="!deletionConfirmed" :loading="loading" @click="confirmDeletion">
            永久删除{{ subjectLabel }}
          </UButton>
        </template>
      </div>
    </UCard>
  </div>
</template>
