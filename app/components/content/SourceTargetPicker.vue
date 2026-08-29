<script setup lang="ts">
import { computed } from 'vue'
import type { SourceCreationTarget } from '#shared/schemas/content'
import type { PersonaSummary, WorldSummary } from '#shared/types/content'

/** 资料关联对象选择器属性。 */
interface Props {
  /** 可选择的人物。 */
  personas: PersonaSummary[]
  /** 可选择的世界。 */
  worlds: WorldSummary[]
  /** 是否禁止修改选择。 */
  disabled: boolean
}

const props = defineProps<Props>()
const targets = defineModel<SourceCreationTarget[]>({ default: () => [] })

/**
 * 读取指定类型的已选目标标识。
 * @param targetType 人物或世界目标类型。
 * @returns 与目标类型匹配的 UUID 列表。
 */
function readTargetIds(targetType: SourceCreationTarget['targetType']): string[] {
  return targets.value.filter(target => target.targetType === targetType).map(target => target.targetId)
}

/**
 * 替换指定类型的已选目标，同时保留另一类型的选择。
 * @param targetType 人物或世界目标类型。
 * @param targetIds 原生多选框返回的 UUID 列表。
 * @returns 无返回值。
 */
function replaceTargetIds(targetType: SourceCreationTarget['targetType'], targetIds: string[]): void {
  targets.value = [
    ...targets.value.filter(target => target.targetType !== targetType),
    ...targetIds.map(targetId => ({ targetType, targetId })),
  ]
}

/** @returns 当前已选人物 UUID。 */
function readPersonaIds(): string[] {
  return readTargetIds('persona')
}

/** @param targetIds 新人物 UUID 列表。 @returns 无返回值。 */
function writePersonaIds(targetIds: string[]): void {
  replaceTargetIds('persona', targetIds)
}

/** @returns 当前已选世界 UUID。 */
function readWorldIds(): string[] {
  return readTargetIds('world')
}

/** @param targetIds 新世界 UUID 列表。 @returns 无返回值。 */
function writeWorldIds(targetIds: string[]): void {
  replaceTargetIds('world', targetIds)
}

const selectedPersonaIds = computed({ get: readPersonaIds, set: writePersonaIds })
const selectedWorldIds = computed({ get: readWorldIds, set: writeWorldIds })
</script>

<template>
  <fieldset class="space-y-3">
    <legend class="text-sm font-medium text-highlighted">具体使用对象（可选）</legend>
    <p class="text-sm text-muted">可同时选择多个人物和世界；不选择时，资料只保存到资料库。</p>
    <div class="grid gap-3 sm:grid-cols-2">
      <UFormField label="人物" description="按住 Ctrl 或 Command 可多选">
        <select v-model="selectedPersonaIds" class="native-control min-h-28" multiple :disabled="props.disabled || props.personas.length === 0">
          <option v-if="props.personas.length === 0" disabled>暂无人物</option>
          <option v-for="persona in props.personas" :key="persona.id" :value="persona.id">{{ persona.name }}</option>
        </select>
      </UFormField>
      <UFormField label="世界" description="资料会进入所选世界的参考范围">
        <select v-model="selectedWorldIds" class="native-control min-h-28" multiple :disabled="props.disabled || props.worlds.length === 0">
          <option v-if="props.worlds.length === 0" disabled>暂无世界</option>
          <option v-for="world in props.worlds" :key="world.id" :value="world.id">{{ world.name }}</option>
        </select>
      </UFormField>
    </div>
  </fieldset>
</template>
