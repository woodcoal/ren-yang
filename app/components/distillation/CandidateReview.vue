<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import {
  confirmPersonaDistillationCandidateSchema,
  savePersonaDistillationCandidateSchema,
  type ConfirmPersonaDistillationCandidateInput,
  type SavePersonaDistillationCandidateInput,
} from '#shared/schemas/personaDistillation'
import type { PersonaDistillationRunView } from '#shared/types/personaDistillation'

/** 人物候选最终确认组件属性。 */
interface Props {
  /** 当前等待候选确认的完整运行。 */
  run: PersonaDistillationRunView
  /** 保存、评测或确认请求是否正在执行。 */
  loading: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  /** 保存编辑后的完整候选并重新评测。 */
  save: [input: SavePersonaDistillationCandidateInput]
  /** 确认当前评测哈希并创建或更新人物。 */
  confirm: [input: ConfirmPersonaDistillationCandidateInput]
}>()

/** 最终人工校准的人物名称和完整灵魂正文。 */
const state = reactive({ name: '', promptText: '' })
const currentEvaluations = computed(() => props.run.evaluations
  .filter(item => item.candidatePromptHash === props.run.candidatePromptHash)
  .sort((left, right) => left.evaluationType.localeCompare(right.evaluationType)))
const currentHardFailures = computed(() => currentEvaluations.value
  .filter(item => item.status === 'failed')
  .flatMap(item => item.failureReasons.length > 0 ? item.failureReasons : [`${item.evaluationType} 评测未通过`]))
const candidateChanged = computed(() => state.promptText.trim() !== (props.run.candidatePromptText ?? '').trim())
const canConfirm = computed(() => Boolean(
  props.run.candidatePromptHash
  && props.run.candidatePromptHash === props.run.evaluatedPromptHash
  && currentEvaluations.value.length === 6
  && currentHardFailures.value.length === 0
  && !candidateChanged.value,
))
/** 最终确认动作在当前运行模式下的用户可见名称。 */
const confirmationLabel = computed(() => props.run.mode === 'update' ? '确认更新人物灵魂' : '确认创建人物')

/**
 * 从服务端候选快照初始化当前页面编辑状态。
 * @returns 无返回值。
 */
function initializeCandidate(): void {
  state.name = props.run.candidateName ?? props.run.requestedName
  state.promptText = props.run.candidatePromptText ?? ''
}

/**
 * 保存当前完整候选正文并使旧评测失效。
 * @returns 无返回值。
 */
function saveCandidate(): void {
  emit('save', savePersonaDistillationCandidateSchema.parse({
    expectedUpdatedAt: props.run.updatedAt,
    promptText: state.promptText,
  }))
}

/**
 * 确认当前未修改且已完整通过评测的候选。
 * @returns 无返回值。
 */
function confirmCandidate(): void {
  if (!props.run.candidatePromptHash || !canConfirm.value) return
  emit('confirm', confirmPersonaDistillationCandidateSchema.parse({
    expectedUpdatedAt: props.run.updatedAt,
    name: state.name,
    expectedPromptHash: props.run.candidatePromptHash,
  }))
}

watch(() => [props.run.id, props.run.candidatePromptHash] as const, initializeCandidate, { immediate: true })
</script>

<template>
  <section class="workflow-panel" aria-labelledby="distillation-candidate-heading">
    <div class="section-heading">
      <div class="section-heading-copy">
        <p class="eyebrow">人工检查点 2 / 2</p>
        <h2 id="distillation-candidate-heading">校准并确认人物候选</h2>
        <p>候选是基于资料生成的模拟对象，不代表本人真实意图或授权。正文改动后必须重新评测。</p>
      </div>
    </div>

    <UAlert
      v-for="failure in props.run.qualityGate?.hardFailures ?? []"
      :key="failure"
      class="mb-3"
      color="error"
      title="硬门禁未通过"
      :description="failure"
    />
    <UAlert
      v-for="warning in props.run.qualityGate?.softWarnings ?? []"
      :key="warning"
      class="mb-3"
      color="warning"
      variant="subtle"
      title="质量提醒"
      :description="warning"
    />

    <div v-if="props.run.coverageSnapshot" class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <UCard><p class="text-xs text-muted">资料</p><p class="mt-1 text-xl font-semibold text-highlighted">{{ props.run.coverageSnapshot.sourceCount }}</p></UCard>
      <UCard><p class="text-xs text-muted">独立来源</p><p class="mt-1 text-xl font-semibold text-highlighted">{{ props.run.coverageSnapshot.independentSourceCount }}</p></UCard>
      <UCard><p class="text-xs text-muted">本人直接来源</p><p class="mt-1 text-xl font-semibold text-highlighted">{{ props.run.coverageSnapshot.directIndependentSourceCount }}</p></UCard>
      <UCard><p class="text-xs text-muted">重复或同源</p><p class="mt-1 text-xl font-semibold text-highlighted">{{ props.run.coverageSnapshot.duplicateSourceCount }}</p></UCard>
    </div>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
      <UCard>
        <template #header>
          <div>
            <h3 class="font-semibold text-highlighted">完整人物灵魂</h3>
            <p class="mt-1 text-sm text-muted">{{ props.run.mode === 'update'
              ? '这是确认后发布为当前人物新灵魂版本的完整正文。'
              : '这是确认后写入首个当前灵魂版本的完整正文。' }}</p>
          </div>
        </template>
        <div class="space-y-4">
          <UFormField label="最终人物名称" required>
            <UInput v-model="state.name" class="w-full" :disabled="loading" />
          </UFormField>
          <UFormField label="候选灵魂正文" required>
            <UTextarea v-model="state.promptText" class="w-full font-mono" :rows="24" autoresize :maxrows="40" :disabled="loading" />
          </UFormField>
          <UAlert
            v-if="candidateChanged"
            color="warning"
            variant="subtle"
            title="当前正文尚未评测"
            :description="`保存后系统会重新执行六类评测；评测完成前不能${props.run.mode === 'update' ? '更新人物灵魂' : '创建人物'}。`"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="soft"
            :loading="loading"
            :disabled="!candidateChanged || !state.promptText.trim()"
            @click="saveCandidate"
          >保存并重新评测</UButton>
        </div>
      </UCard>

      <div class="space-y-4">
        <DistillationEvaluationList :evaluations="currentEvaluations" />
      </div>
    </div>

    <DistillationClaimEvidenceList class="mt-6" :claims="props.run.claims" :inputs="props.run.inputs" />

    <div class="sticky-action-bar mt-6">
      <div>
        <p class="m-0 font-medium text-highlighted">{{ canConfirm ? '当前候选已通过硬门禁' : '当前候选暂不能确认' }}</p>
        <p class="mt-1 text-xs text-muted">只有正文哈希与最近完整评测一致时才能{{ props.run.mode === 'update' ? '更新人物灵魂' : '创建人物' }}。</p>
      </div>
      <UButton icon="i-lucide-check" :loading="loading" :disabled="!canConfirm || !state.name.trim()" @click="confirmCandidate">
        {{ confirmationLabel }}
      </UButton>
    </div>
  </section>
</template>
