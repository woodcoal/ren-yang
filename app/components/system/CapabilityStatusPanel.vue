<script setup lang="ts">
import { computed } from 'vue'
import type { SystemCapabilitiesResult } from '#shared/types/system'

/** 外部能力状态面板的只读属性。 */
interface Props {
  /** 服务端返回的非敏感能力和默认运行参数。 */
  capabilities: SystemCapabilitiesResult
  /** 是否同时展示系统默认运行限制。 */
  showLimits?: boolean
}

const props = withDefaults(defineProps<Props>(), { showLimits: false })

/** 三项能力的明确状态、影响和视觉语义。 */
const capabilityItems = computed(() => [
  {
    label: '文本模型',
    status: props.capabilities.textModel.configured ? '文本生成可用' : '文本模型未配置',
    impact: props.capabilities.textModel.configured
      ? `${props.capabilities.textModel.model} · ${props.capabilities.textModel.endpointOrigin}`
      : '人物草稿、兴趣判断、创作与反馈评测不可执行',
    color: props.capabilities.textModel.configured ? 'success' as const : 'error' as const,
  },
  {
    label: '图片模型',
    status: props.capabilities.imageModel.configured ? '图片生成可用' : '图片模型未配置',
    impact: props.capabilities.imageModel.configured
      ? `${props.capabilities.imageModel.model} · ${props.capabilities.imageModel.endpointOrigin}`
      : '图片块已禁用，纯文本不受影响',
    color: props.capabilities.imageModel.configured ? 'success' as const : 'warning' as const,
  },
  {
    label: '上下文检索',
    status: props.capabilities.contextProvider === 'openviking' ? 'OpenViking 语义检索' : 'SQLite FTS5 本地检索',
    impact: props.capabilities.contextProvider === 'openviking'
      ? '新任务创建前若远端不可用会改用 SQLite FTS5；已经创建的任务保持原检索方式'
      : 'OpenViking 未启用，完整主流程仍可运行',
    color: props.capabilities.contextProvider === 'openviking' ? 'success' as const : 'neutral' as const,
  },
])
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <h2 class="font-semibold text-highlighted">外部能力</h2>
        <p class="mt-1 text-sm text-muted">只显示非敏感状态，并明确能力缺失的实际影响。</p>
      </div>
    </template>

    <div class="space-y-3">
      <div v-for="item in capabilityItems" :key="item.label" class="rounded-md border border-default p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm font-medium text-highlighted">{{ item.label }}</p>
          <UBadge :color="item.color" variant="subtle">{{ item.status }}</UBadge>
        </div>
        <p class="mt-2 break-all text-xs text-muted">{{ item.impact }}</p>
      </div>
    </div>

    <div v-if="props.showLimits" class="mt-5 border-t border-default pt-5">
      <h3 class="text-sm font-medium text-highlighted">系统默认运行限制</h3>
      <p class="mt-1 text-xs text-muted">选择生成设置后，本次任务会固定使用这些限制，之后修改设置不会影响旧任务。</p>
      <ul class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <li>最多 {{ props.capabilities.defaultParameters.maxTextBlocks }} 个文字块</li>
        <li>最多 {{ props.capabilities.defaultParameters.maxImageBlocks }} 个图片块</li>
        <li>单块最多 {{ props.capabilities.defaultParameters.maxBlockAttempts }} 次尝试</li>
        <li>运行累计 {{ props.capabilities.defaultParameters.maxTotalTokens }} Token</li>
        <li>提示最多 {{ props.capabilities.defaultParameters.maxPromptCharacters }} 字符</li>
        <li>单次输出最多 {{ props.capabilities.defaultParameters.maxOutputTokens }} Token</li>
      </ul>
    </div>
  </UCard>
</template>
