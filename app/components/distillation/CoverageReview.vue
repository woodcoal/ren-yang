<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { reviewPersonaDistillationSourcesSchema, type ReviewPersonaDistillationSourcesInput } from '#shared/schemas/personaDistillation'
import {
  PERSONA_DISTILLATION_COVERAGE_DIMENSIONS,
  PERSONA_DISTILLATION_MATERIAL_SOURCE_RELATIONS,
} from '#shared/types/personaDistillation'
import type {
  PersonaDistillationCoverageDimension,
  PersonaDistillationMaterialSourceRelation,
  PersonaDistillationRunView,
  PersonaDistillationSourceRole,
} from '#shared/types/personaDistillation'

/** 资料覆盖确认组件属性。 */
interface Props {
  /** 当前等待资料确认的完整运行。 */
  run: PersonaDistillationRunView
  /** 确认请求是否正在执行。 */
  loading: boolean
}

/** 一项可编辑的运行级资料分类。 */
interface ReviewRow {
  /** 运行内输入 UUID。 */
  inputId: string
  /** 用户可见资料名称。 */
  name: string
  /** 资料业务角色。 */
  sourceRole: PersonaDistillationSourceRole | null
  /** 原资料是否仍可用。 */
  sourceAvailable: boolean
  /** 是否进入后续认知提取。 */
  accepted: boolean
  /** 资料与目标人物的来源关系。 */
  sourceRelation: PersonaDistillationMaterialSourceRelation
  /** 当前确认的分析维度。 */
  coverageDimensions: PersonaDistillationCoverageDimension[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  /** 用户确认资料范围和分类纠正。 */
  submit: [input: ReviewPersonaDistillationSourcesInput]
}>()

/** 当前页面正在编辑的资料确认行。 */
const rows = ref<ReviewRow[]>([])
const coverage = computed(() => props.run.coverageSnapshot)
const acceptedSourceCount = computed(() => rows.value.filter(row => row.accepted && row.sourceAvailable).length)

/** 来源关系选择项。 */
const sourceRelationItems = PERSONA_DISTILLATION_MATERIAL_SOURCE_RELATIONS.map(value => ({
  value,
  label: sourceRelationLabel(value),
}))
/** 六类固定资料覆盖维度。 */
const coverageDimensionItems = PERSONA_DISTILLATION_COVERAGE_DIMENSIONS.map(value => ({
  value,
  label: coverageDimensionLabel(value),
}))

/**
 * 将运行中的资料快照复制为本地可编辑确认状态。
 * @returns 无返回值。
 */
function initializeRows(): void {
  rows.value = props.run.inputs
    .filter(input => input.inputType === 'source_material')
    .map(input => ({
      inputId: input.id,
      name: input.name,
      sourceRole: input.sourceRole,
      sourceAvailable: input.sourceAvailable,
      accepted: input.sourceAvailable && input.accepted,
      sourceRelation: input.sourceRelation === 'user_statement' || input.sourceRelation === null
        ? 'third_party'
        : input.sourceRelation,
      coverageDimensions: [...input.coverageDimensions],
    }))
}

/**
 * 修改一项资料是否进入后续认知提取。
 * @param row 当前资料确认行。
 * @param accepted 新选择状态。
 * @returns 无返回值。
 */
function updateAccepted(row: ReviewRow, accepted: boolean): void {
  row.accepted = row.sourceAvailable && accepted
}

/**
 * 修改一项资料是否覆盖指定分析维度。
 * @param row 当前资料确认行。
 * @param dimension 固定覆盖维度。
 * @param selected 是否选中。
 * @returns 无返回值。
 */
function updateCoverageDimension(
  row: ReviewRow,
  dimension: PersonaDistillationCoverageDimension,
  selected: boolean,
): void {
  row.coverageDimensions = selected
    ? [...new Set([...row.coverageDimensions, dimension])]
    : row.coverageDimensions.filter(value => value !== dimension)
}

/**
 * 提交当前资料范围和完整运行级分类纠正。
 * @returns 无返回值。
 */
function submitReview(): void {
  const availableRows = rows.value.filter(row => row.sourceAvailable)
  emit('submit', reviewPersonaDistillationSourcesSchema.parse({
    expectedUpdatedAt: props.run.updatedAt,
    acceptedInputIds: availableRows.filter(row => row.accepted).map(row => row.inputId),
    corrections: availableRows.map(row => ({
      inputId: row.inputId,
      sourceRelation: row.sourceRelation,
      coverageDimensions: row.coverageDimensions,
    })),
  }))
}

/**
 * 将资料业务角色转换为通俗名称。
 * @param role 资料角色或空值。
 * @returns 用户可见的中文名称。
 */
function sourceRoleLabel(role: PersonaDistillationSourceRole | null): string {
  if (!role) return '未分类'
  return ({ canon_fact: '原著事实', reference: '普通参考', style_sample: '表达样例' })[role]
}

/**
 * 将来源关系转换为通俗名称。
 * @param relation 固定来源关系。
 * @returns 用户可见的中文名称。
 */
function sourceRelationLabel(relation: PersonaDistillationMaterialSourceRelation): string {
  return ({
    subject_authored: '本人著作',
    direct_conversation: '直接对话',
    observed_decision: '实际决策记录',
    subject_social: '本人公开短表达',
    third_party: '他者观察或转述',
  })[relation]
}

/**
 * 将覆盖维度转换为通俗名称。
 * @param dimension 固定覆盖维度。
 * @returns 用户可见的中文名称。
 */
function coverageDimensionLabel(dimension: PersonaDistillationCoverageDimension): string {
  return ({
    writings: '著作与系统思考',
    conversations: '长对话与即兴推理',
    expression: '表达方式',
    external_views: '他者观察与批评',
    decisions: '实际决策',
    timeline: '时间线与观点变化',
  })[dimension]
}

watch(() => props.run.id, initializeRows, { immediate: true })
</script>

<template>
  <section class="workflow-panel" aria-labelledby="distillation-coverage-heading">
    <div class="section-heading">
      <div class="section-heading-copy">
        <p class="eyebrow">人工检查点 1 / 2</p>
        <h2 id="distillation-coverage-heading">确认资料覆盖</h2>
        <p>分类由 AI 建议，最终以你的选择为准。取消勾选的资料不会进入认知提取。</p>
      </div>
    </div>

    <div v-if="coverage" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <UCard><p class="text-xs text-muted">资料</p><p class="mt-1 text-2xl font-semibold text-highlighted">{{ coverage.sourceCount }}</p></UCard>
      <UCard><p class="text-xs text-muted">独立来源</p><p class="mt-1 text-2xl font-semibold text-highlighted">{{ coverage.independentSourceCount }}</p></UCard>
      <UCard><p class="text-xs text-muted">本人直接来源</p><p class="mt-1 text-2xl font-semibold text-highlighted">{{ coverage.directIndependentSourceCount }}</p></UCard>
      <UCard><p class="text-xs text-muted">重复或同源</p><p class="mt-1 text-2xl font-semibold text-highlighted">{{ coverage.duplicateSourceCount }}</p></UCard>
    </div>

    <div v-if="coverage" class="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="item in coverageDimensionItems" :key="item.value" class="rounded-lg border border-default p-3">
        <p class="text-sm font-medium text-highlighted">{{ item.label }}</p>
        <p class="mt-1 text-xs text-muted">{{ coverage.dimensionIndependentSourceCounts[item.value] }} 个独立来源</p>
      </div>
    </div>

    <UAlert
      v-for="warning in coverage?.warnings ?? []"
      :key="warning"
      class="mt-3"
      color="warning"
      variant="subtle"
      title="资料覆盖提醒"
      :description="warning"
    />

    <form class="mt-6 space-y-4" @submit.prevent="submitReview">
      <article v-for="row in rows" :key="row.inputId" class="rounded-lg border border-default p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold text-highlighted">{{ row.name }}</h3>
            <p class="mt-1 text-xs text-muted">{{ sourceRoleLabel(row.sourceRole) }}</p>
          </div>
          <UCheckbox
            :model-value="row.accepted"
            label="进入认知提取"
            :disabled="loading || !row.sourceAvailable"
            @update:model-value="updateAccepted(row, $event === true)"
          />
        </div>
        <UAlert v-if="!row.sourceAvailable" class="mt-3" color="error" variant="subtle" title="原资料已不可用" description="该资料不能继续进入人物蒸馏。" />
        <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(12rem,0.35fr)_1fr]">
          <UFormField label="与目标人物的关系">
            <select v-model="row.sourceRelation" class="native-control" :disabled="loading || !row.sourceAvailable">
              <option v-for="item in sourceRelationItems" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </UFormField>
          <fieldset>
            <legend class="text-sm font-medium text-highlighted">覆盖维度</legend>
            <div class="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              <UCheckbox
                v-for="item in coverageDimensionItems"
                :key="item.value"
                :model-value="row.coverageDimensions.includes(item.value)"
                :label="item.label"
                :disabled="loading || !row.sourceAvailable"
                @update:model-value="updateCoverageDimension(row, item.value, $event === true)"
              />
            </div>
          </fieldset>
        </div>
      </article>

      <UAlert
        v-if="rows.length === 0"
        color="neutral"
        variant="subtle"
        title="本次没有参考资料"
        description="系统将只根据你填写的人物用途提炼，并把资料不足作为明确边界。"
      />

      <div class="sticky-action-bar">
        <p class="m-0 text-sm text-muted">已选择 {{ acceptedSourceCount }} / {{ rows.length }} 项资料</p>
        <UButton type="submit" icon="i-lucide-arrow-right" :loading="loading">继续提炼</UButton>
      </div>
    </form>
  </section>
</template>
