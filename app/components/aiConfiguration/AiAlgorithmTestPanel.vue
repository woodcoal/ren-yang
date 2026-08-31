<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { AiAlgorithmTestResult, AiAlgorithmTestStepResult } from '#shared/types/aiAlgorithmTest'
import type { AiAlgorithmView } from '#shared/types/aiConfiguration'
import { getApiErrorMessage } from '../../utils/apiError'

const props = defineProps<{
  /** 当前算法页选中的固定算法。 */
  algorithm: AiAlgorithmView
}>()

/** 成长或记忆第一步成功后由服务端返回的第二步精确输入。 */
interface LearningTestContinuation {
  /** 与第一步完全一致的长期提示词基线 JSON。 */
  baselineJson: string
  /** 第一步完成证据校验后的原子结论 JSON。 */
  factsJson: string
}

const soulText = shallowRef('')
const baselineText = shallowRef('')
const materialText = shallowRef('')
const { notifySuccess, notifyError } = useOperationNotifications()
const running = shallowRef(false)
const steps = shallowRef<AiAlgorithmTestStepResult[]>([])
const configurationVersion = shallowRef<number | null>(null)
const continuation = shallowRef<LearningTestContinuation | null>(null)
const isGrowth = computed(() => props.algorithm.code.endsWith('_growth'))
const isMemory = computed(() => props.algorithm.code === 'persona_memory')
const isMultiStep = computed(() => isGrowth.value || isMemory.value)
const multiStepCompleted = computed(() => steps.value.some(step => step.stepKey === 'synthesize' && step.status === 'succeeded'))
const canRun = computed(() => props.algorithm.activeConfigurationVersion !== null
  && (isMultiStep.value
    ? continuation.value !== null || materialText.value.trim().length > 0
    : soulText.value.trim().length > 0))
const actionLabel = computed(() => isMultiStep.value
  ? continuation.value ? '测试第 2 步：综合编译' : '测试第 1 步：原子提取'
  : '运行真实测试')
const runningLabel = computed(() => isMultiStep.value
  ? continuation.value ? '正在测试第 2 步：综合编译' : '正在测试第 1 步：原子提取'
  : '正在运行真实测试')
const resultTitle = computed(() => {
  const last = steps.value.at(-1)
  if (!last) return ''
  if (last.status === 'failed') return '当前步骤测试失败'
  if (multiStepCompleted.value) return '全部步骤通过'
  if (isMultiStep.value) return '第一步通过，请继续第二步'
  return '测试通过'
})

/**
 * 使用已保存草稿优先策略真实调用当前算法，并保留服务端逐步诊断。
 * @returns 请求完成或失败处理完成时结束。
 */
async function runTest(): Promise<void> {
  if (!canRun.value || running.value) return
  running.value = true
  try {
    const body = isMultiStep.value
      ? continuation.value
        ? {
            stepKey: 'synthesize',
            configurationVersion: configurationVersion.value,
            baselineJson: continuation.value.baselineJson,
            factsJson: continuation.value.factsJson,
          }
        : { stepKey: 'extract', baselineText: baselineText.value, materialText: materialText.value }
      : { soulText: soulText.value }
    const response = await $fetch<ApiResponse<AiAlgorithmTestResult>>(`/api/v1/ai/algorithms/${props.algorithm.code}/test`, {
      method: 'POST', body,
    })
    const step = response.data.steps[0]
    if (!step) throw new Error('测试接口没有返回步骤结果')
    configurationVersion.value = response.data.configurationVersion
    steps.value = step.stepKey === 'extract'
      ? [step]
      : [...steps.value.filter(item => item.stepKey !== step.stepKey), step]
    if (step.stepKey === 'extract' && step.status === 'succeeded') {
      continuation.value = readLearningContinuation(step.nextStepInput)
      if (!continuation.value) {
        notifyError('第一步未返回有效的第二步输入，请重新开始测试', '算法测试失败')
        return
      }
    }
    if (step.status === 'failed') notifyError(step.error ?? '当前步骤没有完成', `${step.stepName}测试失败`)
    else notifySuccess(step.stepKey === 'extract' && isMultiStep.value ? '第一步已通过，可继续测试第二步。' : '当前步骤已通过真实调用测试。', '算法测试通过')
  }
  catch (error: unknown) {
    notifyError(getApiErrorMessage(error, '算法测试失败'), '测试请求失败')
  }
  finally {
    running.value = false
  }
}

/**
 * 清除当前步骤结果与延续数据，允许重新编辑原始输入并从第一步开始。
 * @returns 无返回值。
 */
function resetTest(): void {
  steps.value = []
  configurationVersion.value = null
  continuation.value = null
}

/**
 * 从未知步骤结果中读取服务端生成的学习算法第二步输入。
 * @param value 第一步诊断中的下一步数据。
 * @returns 两个 JSON 字段完整时返回延续数据，否则返回 null。
 */
function readLearningContinuation(value: unknown): LearningTestContinuation | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.baselineJson !== 'string' || typeof record.factsJson !== 'string') return null
  return { baselineJson: record.baselineJson, factsJson: record.factsJson }
}

/**
 * 把任意诊断值稳定格式化为可复制的文本。
 * @param value 服务端返回的模型、解析或步骤传递数据。
 * @returns 字符串原值或缩进后的 JSON；空值返回“无”。
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '无'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

/**
 * 汇总模型供应商报告的 Token 用量。
 * @param step 当前步骤诊断。
 * @returns 输入、输出和总 Token 的紧凑说明。
 */
function formatUsage(step: AiAlgorithmTestStepResult): string {
  const input = step.inputTokens === null ? '未报告' : step.inputTokens.toLocaleString('zh-CN')
  const output = step.outputTokens === null ? '未报告' : step.outputTokens.toLocaleString('zh-CN')
  const total = step.totalTokens === null ? '未报告' : step.totalTokens.toLocaleString('zh-CN')
  return `输入 ${input} · 输出 ${output} · 总计 ${total}`
}
</script>

<template>
  <section class="content-section algorithm-test-panel" data-ai-algorithm-test-panel aria-labelledby="algorithm-test-heading">
    <details>
      <summary>
        <span><span class="eyebrow">运行诊断</span><strong id="algorithm-test-heading">测试算法</strong></span>
        <span class="test-summary-copy">真实调用模型 · 不写入业务数据</span>
      </summary>

      <div class="test-panel-body">
        <UAlert
          color="warning"
          variant="subtle"
          title="这是一次真实模型调用，可能产生费用"
          description="优先使用已保存但未发布的提示词草稿；没有草稿时使用当前发布版本。测试输入和结果不会保存，也不会创建人物、世界、成长、记忆或分析批次。"
        />

        <div v-if="running" class="test-running-state" role="status" aria-live="assertive">
          <UIcon name="i-lucide-loader-circle" class="test-running-icon" aria-hidden="true" />
          <strong>{{ runningLabel }}</strong>
          <p>正在等待模型返回，请勿重复提交或切换算法。</p>
        </div>

        <template v-else>
          <form class="test-input-form w-full" @submit.prevent="runTest">
            <template v-if="isMultiStep">
              <UFormField class="w-full" :label="isMemory ? '当前记忆提示词基线（首次生成可留空）' : '当前成长提示词基线（首次生成可留空）'">
                <UTextarea v-model="baselineText" class="w-full" :disabled="continuation !== null" :rows="7" autoresize :placeholder="isMemory ? '粘贴当前已生效或准备迭代的记忆提示词' : '粘贴当前已生效或准备迭代的成长提示词'" />
              </UFormField>
              <UFormField class="w-full" :label="isMemory ? '本次记忆素材' : '本次成长资料'" required>
                <UTextarea v-model="materialText" class="w-full" :disabled="continuation !== null" :rows="9" autoresize :placeholder="isMemory ? '粘贴第三方记忆素材；多条独立证据请用单独一行 --- 分隔' : '粘贴准备提取和综合的资料正文'" />
              </UFormField>
            </template>
            <UFormField v-else class="w-full" label="灵魂原文" required>
              <UTextarea v-model="soulText" class="w-full" :rows="10" autoresize placeholder="粘贴准备整理的人物或世界灵魂原文" />
            </UFormField>

            <div class="test-actions">
              <div class="flex flex-wrap gap-2">
                <UButton v-if="!multiStepCompleted" type="submit" icon="i-lucide-play" :loading="running" :disabled="!canRun">{{ actionLabel }}</UButton>
                <UButton v-if="steps.length" type="button" color="neutral" variant="soft" :disabled="running" @click="resetTest">重新开始</UButton>
              </div>
              <span v-if="algorithm.activeConfigurationVersion === null">请先发布算法配置</span>
            </div>
          </form>

          <div v-if="steps.length" class="test-results" aria-live="polite">
            <div class="test-result-heading">
              <div><span class="eyebrow">逐步结果</span><h3>{{ resultTitle }}</h3></div>
              <UBadge :color="steps.at(-1)?.status === 'succeeded' ? 'success' : 'error'" variant="subtle">配置 v{{ configurationVersion }}</UBadge>
            </div>

            <article v-for="(step, index) in steps" :key="step.stepKey" class="test-step" :class="`test-step--${step.status}`">
              <header>
                <span class="test-step-index">{{ index + 1 }}</span>
                <div><strong>{{ step.stepName }}</strong><code>{{ step.stepKey }}</code></div>
                <UBadge :color="step.status === 'succeeded' ? 'success' : 'error'" variant="subtle">{{ step.status === 'succeeded' ? '成功' : '失败' }}</UBadge>
              </header>

              <UAlert v-if="step.error" color="error" title="本步未完成" :description="step.error" />

              <dl class="test-step-metadata">
                <div><dt>模型</dt><dd>{{ step.model }}</dd></div>
                <div><dt>接口</dt><dd>{{ step.endpointOrigin }}</dd></div>
                <div><dt>参数</dt><dd>temperature {{ step.parameters.temperature }} · max tokens {{ step.parameters.maxOutputTokens }} · timeout {{ step.parameters.timeoutMs }} ms</dd></div>
                <div><dt>提示词</dt><dd>{{ step.promptSource === 'draft' ? '已保存草稿' : `发布版 v${step.promptVersion}` }} · {{ step.promptCode }}</dd></div>
                <div><dt>耗时</dt><dd>{{ step.durationMs.toLocaleString('zh-CN') }} ms</dd></div>
                <div><dt>用量</dt><dd>{{ formatUsage(step) }}</dd></div>
              </dl>

              <div class="test-step-details">
                <details><summary>本步输入变量</summary><pre>{{ formatValue(step.variables) }}</pre></details>
                <details><summary>实际系统提示词</summary><pre>{{ step.systemPrompt || '无' }}</pre></details>
                <details><summary>实际用户提示词</summary><pre>{{ step.userPrompt }}</pre></details>
                <details><summary>模型原始响应</summary><pre>{{ step.rawOutput ?? '供应商适配器未返回原始正文' }}</pre></details>
                <details><summary>业务解析结果</summary><pre>{{ formatValue(step.parsedOutput) }}</pre></details>
                <details><summary>传给下一步的数据</summary><pre>{{ formatValue(step.nextStepInput) }}</pre></details>
              </div>
            </article>
          </div>
        </template>
      </div>
    </details>
  </section>
</template>

<style scoped>
.algorithm-test-panel > details > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  cursor: pointer;
  list-style: none;
}

.algorithm-test-panel > details > summary::-webkit-details-marker { display: none; }
.algorithm-test-panel > details > summary > span:first-child { display: grid; gap: 0.25rem; }

.test-summary-copy,
.test-actions span { color: var(--app-muted); font-size: 0.8125rem; }

.test-panel-body,
.test-input-form,
.test-results { display: grid; gap: 1rem; }

.test-input-form { width: 100%; }

.test-running-state {
  display: grid;
  min-height: 14rem;
  place-items: center;
  align-content: center;
  gap: 0.75rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-control);
  background: var(--app-surface-soft);
  text-align: center;
}

.test-running-state p { margin: 0; color: var(--app-muted); }

.test-running-icon {
  width: 2rem;
  height: 2rem;
  color: var(--app-accent);
  animation: test-running-spin 1s linear infinite;
}

@keyframes test-running-spin {
  to { transform: rotate(360deg); }
}

.test-panel-body {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--app-border);
}

.test-actions,
.test-result-heading,
.test-step > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.test-result-heading h3 { margin-top: 0.25rem; }

.test-step {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-control);
  background: var(--app-surface-raised);
}

.test-step--succeeded { border-left: 3px solid var(--app-success); }
.test-step--failed { border-left: 3px solid var(--app-danger); }
.test-step > header > div { display: grid; flex: 1; gap: 0.2rem; }
.test-step > header code { color: var(--app-muted); font-size: 0.75rem; }

.test-step-index {
  display: grid;
  width: 1.75rem;
  height: 1.75rem;
  place-items: center;
  border-radius: 999px;
  background: var(--app-surface-soft);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.test-step-metadata {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.test-step-metadata div { min-width: 0; }
.test-step-metadata dt { color: var(--app-muted); font-size: 0.75rem; }
.test-step-metadata dd { margin: 0.2rem 0 0; overflow-wrap: anywhere; font-size: 0.875rem; }
.test-step-details { display: grid; gap: 0.5rem; }

.test-step-details details {
  border: 1px solid var(--app-border);
  border-radius: var(--radius-control);
  background: var(--app-surface-soft);
}

.test-step-details summary { padding: 0.75rem; cursor: pointer; font-size: 0.875rem; font-weight: 600; }

.test-step-details pre {
  max-height: 26rem;
  margin: 0;
  overflow: auto;
  padding: 0 0.75rem 0.75rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.6;
}

@media (max-width: 40rem) {
  .algorithm-test-panel > details > summary,
  .test-result-heading,
  .test-actions { align-items: flex-start; flex-direction: column; }
  .test-step-metadata { grid-template-columns: 1fr; }
}
</style>
