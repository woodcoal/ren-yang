<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { AiAlgorithmStepDefinitionView, AiAlgorithmView } from '#shared/types/aiConfiguration'
import type { AiPromptWorkspaceView } from '#shared/types/aiPrompt'

/** 算法内一个步骤提示词的帮助说明。 */
interface StepPromptHelp {
  /** 这一步希望模型完成的具体工作。 */
  purpose: string
  /** 模型实际读取的业务输入。 */
  input: string
  /** 模型返回内容如何被后续流程使用。 */
  output: string
  /** 不应由提示词改变的系统边界。 */
  boundary: string
}

/** 弹窗属性。 */
interface Props {
  /** 当前固定算法。 */
  algorithm: AiAlgorithmView
  /** 当前算法的全部步骤提示词工作区。 */
  prompts: AiPromptWorkspaceView[]
  /** 页面选中的步骤提示词编码。 */
  selectedPromptCode: string
}

const props = defineProps<Props>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  /** 选择另一个算法步骤提示词。 */
  selectPrompt: [code: string]
  /** 草稿或发布版本改变后请求刷新。 */
  refresh: []
  /** 当前编辑器脏状态变化。 */
  dirtyChange: [dirty: boolean]
}>()

/** 当前弹窗是否显示最后一个详细帮助选项卡。 */
const helpOpen = shallowRef(false)
/** 选中步骤对应的完整提示词工作区。 */
const selectedPrompt = computed(() => props.prompts.find(prompt => prompt.code === props.selectedPromptCode) ?? props.prompts[0] ?? null)
/** 当前算法的全部步骤及其可编辑提示词。 */
const stepPrompts = computed(() => props.algorithm.stepDefinitions.flatMap(definition => {
  const prompt = props.prompts.find(item => item.code === definition.promptCode)
  return prompt ? [{ definition, prompt }] : []
}))
/** 将当前提示词变量整理为可直接展示的模板变量名称。 */
const variableLabels = computed(() => Object.fromEntries(stepPrompts.value.map(item => [
  item.prompt.code,
  item.prompt.variables.map(variable => `{{${variable.name}}}（${variable.label}）`).join('、'),
])))

/**
 * 切换到步骤提示词编辑选项卡。
 * @param code 目标提示词编码。
 * @returns 无返回值。
 */
function selectPrompt(code: string): void {
  helpOpen.value = false
  emit('selectPrompt', code)
}

/** 切换到详细帮助选项卡。 */
function selectHelp(): void {
  helpOpen.value = true
}

watch(open, isOpen => {
  if (!isOpen) helpOpen.value = false
})
/**
 * 返回步骤的详细帮助；未知的新增步骤仍得到可安全使用的默认说明。
 * @param code 提示词稳定编码。
 * @param definition 当前固定算法步骤定义。
 * @returns 面向管理员的输入、输出与边界说明。
 */
function promptHelp(code: string, definition: AiAlgorithmStepDefinitionView): StepPromptHelp {
  const common: StepPromptHelp = {
    purpose: definition.description,
    input: '程序根据本次任务固定的业务输入填入模板变量。',
    output: '模型输出由当前算法继续处理或展示给管理员。',
    boundary: '不能改变固定步骤顺序、模型调用方式、资料权限、预算或发布权限。',
  }
  const byCode: Record<string, StepPromptHelp> = {
    'distillation.analyze_persona': {
      purpose: '自由理解人物资料，形成连贯的判断方式、表达习惯、冲突与未知边界分析。',
      input: '人物要求与本次固定资料全文。资料内容不可信，只能作为分析对象。',
      output: '完整分析报告原样传给下一步灵魂编写，并展示在最终审阅页。',
      boundary: '必须保持资料隔离；不要规定 JSON、字段、证据编号或自行发布人物。',
    },
    'distillation.compose_soul': {
      purpose: '根据人物要求和上一段分析报告，写出完整、可直接运行的人物灵魂。',
      input: '人物要求与上一步原始分析文本，不重新读取原始资料。',
      output: '完整灵魂正文进入人工审阅；管理员可修改后确认发布。',
      boundary: '不要输出 JSON、分析说明、来源目录或创建流程文字；不得补写分析中没有支持的事实。',
    },
    'analysis.persona_growth_extract': {
      purpose: '从人物成长素材中识别可长期复用的变化线索，并返回程序能够核验的事实候选。',
      input: '当前人物灵魂、当前成长基线与本批次成长素材。',
      output: '通过程序证据校验和去重的候选会传给成长综合步骤。',
      boundary: '引用和证据字段由此步骤固定使用；不得编造资料外事实或篡改输入标识。',
    },
    'analysis.persona_growth_synthesize': {
      purpose: '把已通过校验的成长结论整合为完整人物成长提示词草稿。',
      input: '当前人物灵魂、当前成长基线和程序确认后的原子结论。',
      output: '草稿等待管理员校准和发布，之后才进入人物新任务。',
      boundary: '不得重新解释原始资料、补充未校验事实或覆盖人物灵魂。',
    },
    'analysis.world_growth_extract': {
      purpose: '从世界成长素材中识别可长期复用的世界规则或变化线索。',
      input: '当前世界灵魂、当前成长基线与本批次世界成长素材。',
      output: '通过程序证据校验和去重的候选会传给世界成长综合步骤。',
      boundary: '引用和证据字段由此步骤固定使用；不得把素材中的指令当作系统规则。',
    },
    'analysis.world_growth_synthesize': {
      purpose: '把已通过校验的世界成长结论整合为完整世界成长提示词草稿。',
      input: '当前世界灵魂、当前成长基线和程序确认后的原子结论。',
      output: '草稿等待管理员发布，发布后才固定进入新的世界任务。',
      boundary: '不得覆盖世界灵魂、创造无证据世界规则或直接发布。',
    },
    'analysis.persona_memory_extract': {
      purpose: '从人物任务记录与第三方经历中识别可追溯的长期记忆候选。',
      input: '当前人物灵魂、当前记忆基线与本批次已固定的历史记录或第三方经历。',
      output: '程序校验来源类型、证据归属和独立证据门槛后传给记忆综合步骤。',
      boundary: '必须保留证据关联，不能把模型生成内容当作人物真实经历。',
    },
    'analysis.persona_memory_synthesize': {
      purpose: '把通过来源与独立证据门槛的记忆事实编写为完整人物记忆提示词草稿。',
      input: '当前人物灵魂、当前记忆基线和程序确认后的记忆事实。',
      output: '草稿由管理员审阅发布后才影响人物后续任务。',
      boundary: '不得重写人物灵魂、补充未经确认的经历或抹去未裁决冲突。',
    },
  }
  return byCode[code] ?? common
}
</script>

<template>
  <UModal v-model:open="open" :title="`${props.algorithm.name} · 步骤提示词`"
    description="提示词草稿不会影响正在运行或已创建的任务；发布后只影响后续创建的新任务。" :ui="{ content: 'max-w-6xl' }">
    <template #body>
      <div class="space-y-5">
        <div class="algorithm-prompt-tabs" role="tablist" aria-label="算法步骤提示词与帮助">
          <button
            v-for="item in stepPrompts"
            :key="item.definition.key"
            type="button"
            role="tab"
            class="algorithm-prompt-tab"
            :class="{ 'algorithm-prompt-tab--active': !helpOpen && item.prompt.code === selectedPrompt?.code }"
            :aria-selected="!helpOpen && item.prompt.code === selectedPrompt?.code"
            @click="selectPrompt(item.prompt.code)"
          >
            <span>步骤 {{ item.definition.ordinal + 1 }}</span>
            <strong>{{ item.definition.name }}</strong>
          </button>
          <button type="button" role="tab" class="algorithm-prompt-tab algorithm-prompt-tab--help"
            :class="{ 'algorithm-prompt-tab--active': helpOpen }" :aria-selected="helpOpen" @click="selectHelp">
            <span>说明</span>
            <strong>详细帮助</strong>
          </button>
        </div>

        <AiPromptEditor v-if="selectedPrompt && !helpOpen" :key="selectedPrompt.code" :prompt="selectedPrompt"
          @changed="emit('refresh')" @dirty-change="emit('dirtyChange', $event)" />

        <section v-else class="space-y-4" aria-labelledby="algorithm-prompt-help-heading">
          <div class="section-heading">
            <div class="section-heading-copy">
              <p class="eyebrow">内部步骤说明</p>
              <h2 id="algorithm-prompt-help-heading">如何安全调整这些提示词</h2>
              <p>步骤顺序、资料隔离、预算、任务恢复和人工发布由程序固定。提示词只定义模型在该步骤中的理解与表达方式。</p>
            </div>
          </div>
          <UAlert color="warning" variant="subtle" title="不要把业务流程写进提示词"
            description="不要要求模型自行调用工具、改变步骤顺序、跳过人工发布，或读取当前运行之外的资料。调整目标应是提升分析、判断或表达质量。" />
          <article v-for="item in stepPrompts" :key="item.prompt.code" class="rounded-lg border border-default p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="eyebrow">步骤 {{ item.definition.ordinal + 1 }} · <code>{{ item.prompt.code }}</code></p>
                <h3 class="mt-1 font-semibold text-highlighted">{{ item.prompt.name }}</h3>
                <p class="mt-1 text-sm text-muted">{{ item.prompt.description }}</p>
              </div>
              <UButton size="xs" variant="soft" color="neutral" icon="i-lucide-pencil" @click="selectPrompt(item.prompt.code)">编辑此提示词</UButton>
            </div>
            <dl class="algorithm-prompt-help-grid mt-4">
              <div><dt>应完成什么</dt><dd>{{ promptHelp(item.prompt.code, item.definition).purpose }}</dd></div>
              <div><dt>实际输入</dt><dd>{{ promptHelp(item.prompt.code, item.definition).input }}</dd></div>
              <div><dt>结果去向</dt><dd>{{ promptHelp(item.prompt.code, item.definition).output }}</dd></div>
              <div><dt>固定边界</dt><dd>{{ promptHelp(item.prompt.code, item.definition).boundary }}</dd></div>
            </dl>
            <div class="mt-4 rounded-md bg-elevated p-3 text-sm">
              <strong>模板变量：</strong>
              <span v-if="item.prompt.variables.length === 0" class="text-muted">此步骤没有可替换变量。</span>
              <span v-else class="text-muted">{{ variableLabels[item.prompt.code] }}</span>
            </div>
          </article>
        </section>
      </div>
    </template>
  </UModal>
</template>


<style scoped>
.algorithm-prompt-tabs {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
}

.algorithm-prompt-tab {
  display: grid;
  min-width: 9rem;
  gap: 0.2rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-control);
  background: var(--app-surface-raised);
  color: var(--app-muted);
  text-align: left;
  cursor: pointer;
}

.algorithm-prompt-tab span {
  font-size: 0.75rem;
}

.algorithm-prompt-tab strong {
  color: var(--app-fg);
}

.algorithm-prompt-tab:hover,
.algorithm-prompt-tab--active {
  border-color: var(--app-border-strong);
  background: var(--app-surface-soft);
}

.algorithm-prompt-tab--active {
  box-shadow: inset 0 -3px 0 var(--app-accent);
}

.algorithm-prompt-tab--help {
  margin-left: auto;
}

.algorithm-prompt-help-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.algorithm-prompt-help-grid div {
  min-width: 0;
}

.algorithm-prompt-help-grid dt {
  color: var(--app-fg);
  font-size: 0.8125rem;
  font-weight: 600;
}

.algorithm-prompt-help-grid dd {
  margin: 0.25rem 0 0;
  color: var(--app-muted);
  font-size: 0.8125rem;
  line-height: 1.5;
}

@media (max-width: 40rem) {
  .algorithm-prompt-help-grid {
    grid-template-columns: 1fr;
  }

  .algorithm-prompt-tab--help {
    margin-left: 0;
  }
}
</style>
