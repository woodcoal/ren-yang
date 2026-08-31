<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { AiAlgorithmTestResult, AiAlgorithmTestStepResult } from '#shared/types/aiAlgorithmTest'
import type { AiAlgorithmView } from '#shared/types/aiConfiguration'
import { getApiErrorMessage } from '../../utils/apiError'

const props = defineProps<{
  /** 当前算法页选中的固定算法。 */
  algorithm: AiAlgorithmView
}>()

const soulText = ref('')
const baselineText = ref('')
const materialText = ref('')
const running = ref(false)
const errorMessage = ref<string | null>(null)
const result = ref<AiAlgorithmTestResult | null>(null)
const isGrowth = computed(() => props.algorithm.code.endsWith('_growth'))
const canRun = computed(() => props.algorithm.activeConfigurationVersion !== null
  && (isGrowth.value
    ? materialText.value.trim().length > 0
    : soulText.value.trim().length > 0))

/**
 * 使用已保存草稿优先策略真实调用当前算法，并保留服务端逐步诊断。
 * @returns 请求完成或失败处理完成时结束。
 */
async function runTest(): Promise<void> {
  if (!canRun.value || running.value) return
  running.value = true
  errorMessage.value = null
  result.value = null
  try {
    const body = isGrowth.value
      ? { baselineText: baselineText.value, materialText: materialText.value }
      : { soulText: soulText.value }
    const response = await $fetch<ApiResponse<AiAlgorithmTestResult>>(`/api/v1/ai/algorithms/${props.algorithm.code}/test`, {
      method: 'POST', body,
    })
    result.value = response.data
  }
  catch (error: unknown) {
    errorMessage.value = getApiErrorMessage(error, '算法测试失败')
  }
  finally {
    running.value = false
  }
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

        <form class="test-input-form" @submit.prevent="runTest">
          <template v-if="isGrowth">
            <UFormField label="当前成长提示词基线（首次生成可留空）">
              <UTextarea v-model="baselineText" :rows="7" autoresize placeholder="粘贴当前已生效或准备迭代的成长提示词" />
            </UFormField>
            <UFormField label="本次成长资料" required>
              <UTextarea v-model="materialText" :rows="9" autoresize placeholder="粘贴准备提取和综合的资料正文" />
            </UFormField>
          </template>
          <UFormField v-else label="灵魂原文" required>
            <UTextarea v-model="soulText" :rows="10" autoresize placeholder="粘贴准备整理的人物或世界灵魂原文" />
          </UFormField>

          <div class="test-actions">
            <UButton type="submit" icon="i-lucide-play" :loading="running" :disabled="!canRun">运行真实测试</UButton>
            <span v-if="algorithm.activeConfigurationVersion === null">请先发布算法配置</span>
          </div>
        </form>

        <UAlert v-if="errorMessage" color="error" title="测试请求失败" :description="errorMessage" />

        <div v-if="result" class="test-results" aria-live="polite">
          <div class="test-result-heading">
            <div><span class="eyebrow">逐步结果</span><h3>{{ result.succeeded ? '全部步骤通过' : '测试在失败步骤停止' }}</h3></div>
            <UBadge :color="result.succeeded ? 'success' : 'error'" variant="subtle">配置 v{{ result.configurationVersion }}</UBadge>
          </div>

          <article v-for="(step, index) in result.steps" :key="step.stepKey" class="test-step" :class="`test-step--${step.status}`">
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
