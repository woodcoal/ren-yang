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
  /** 保存或确认请求是否正在执行。 */
  loading: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  /** 保存编辑后的完整候选。 */
  save: [input: SavePersonaDistillationCandidateInput]
  /** 确认当前候选并创建或更新人物。 */
  confirm: [input: ConfirmPersonaDistillationCandidateInput]
}>()

/** 最终人工校准的人物名称和完整灵魂正文。 */
const state = reactive({ name: '', promptText: '' })
/** 当前编辑内容相对已保存候选是否改变。 */
const candidateChanged = computed(() => state.promptText.trim() !== (props.run.candidatePromptText ?? '').trim())
/** 候选正文已由分析或人工编辑准备完成时允许确认。 */
const canConfirm = computed(() => Boolean(
  props.run.candidatePromptHash
  && props.run.candidatePromptHash === props.run.preparedPromptHash
  && !candidateChanged.value,
))
/** 最终确认动作在当前运行模式下的用户可见名称。 */
const confirmationLabel = computed(() => props.run.mode === 'update' ? '确认更新人物灵魂' : '确认创建人物')

/** 从服务端候选快照初始化当前页面编辑状态。 */
function initializeCandidate(): void {
  state.name = props.run.candidateName ?? props.run.requestedName
  state.promptText = props.run.candidatePromptText ?? ''
}

/** 保存当前完整候选正文。 */
function saveCandidate(): void {
  emit('save', savePersonaDistillationCandidateSchema.parse({
    expectedUpdatedAt: props.run.updatedAt,
    promptText: state.promptText,
  }))
}

/** 确认当前未修改且已准备完成的候选。 */
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
        <p class="eyebrow">人工确认</p>
        <h2 id="distillation-candidate-heading">审阅分析并确认人物候选</h2>
        <p>模型已自主完成资料理解、冲突处理和灵魂编写。核对分析边界与候选正文后再发布。</p>
      </div>
    </div>

    <UCard v-if="props.run.analysisReport" class="mb-6">
      <template #header>
        <div>
          <h3 class="font-semibold text-highlighted">人物分析报告</h3>
          <p class="mt-1 text-sm text-muted">这是模型根据固定资料形成的可读分析，不会直接写入人物运行提示词。</p>
        </div>
      </template>
      <pre class="m-0 whitespace-pre-wrap break-words font-sans text-sm leading-7 text-toned">{{ props.run.analysisReport }}</pre>
    </UCard>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
      <UCard>
        <template #header>
          <div>
            <h3 class="font-semibold text-highlighted">完整人物灵魂</h3>
            <p class="mt-1 text-sm text-muted">{{ props.run.mode === 'update'
              ? '确认后会发布为当前人物的新灵魂版本。'
              : '确认后会写入人物的首个当前灵魂版本。' }}</p>
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
            title="已改为人工校准版本"
            description="保存后可直接确认；系统不会再用另一轮模型评测覆盖你的判断。"
          />
          <UButton
            icon="i-lucide-save"
            color="neutral"
            variant="soft"
            :loading="loading"
            :disabled="!candidateChanged || !state.promptText.trim()"
            @click="saveCandidate"
          >保存校准版本</UButton>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div>
            <h3 class="font-semibold text-highlighted">固定输入</h3>
            <p class="mt-1 text-sm text-muted">本次分析只使用这些运行快照。</p>
          </div>
        </template>
        <ul class="m-0 space-y-3 p-0" aria-label="人物蒸馏固定输入">
          <li v-for="input in props.run.inputs" :key="input.id" class="list-none rounded-md border border-default p-3">
            <p class="m-0 font-medium text-highlighted">{{ input.name }}</p>
            <p class="mt-1 text-xs text-muted">{{ input.inputType === 'user_statement' ? '用户明确要求或当前灵魂' : '参考资料' }}</p>
          </li>
        </ul>
      </UCard>
    </div>

    <div class="sticky-action-bar mt-6">
      <div>
        <p class="m-0 font-medium text-highlighted">{{ canConfirm ? '当前候选已准备确认' : '请先保存当前修改' }}</p>
        <p class="mt-1 text-xs text-muted">确认后才会{{ props.run.mode === 'update' ? '发布人物新灵魂' : '创建人物及其初始灵魂' }}。</p>
      </div>
      <UButton icon="i-lucide-check" :loading="loading" :disabled="!canConfirm || !state.name.trim()" @click="confirmCandidate">
        {{ confirmationLabel }}
      </UButton>
    </div>
  </section>
</template>
