<script setup lang="ts">
import { computed } from 'vue'
import type { SourceCreationTarget } from '#shared/schemas/content'
import type { PersonaSummary, WorldSummary } from '#shared/types/content'

/** 可搜索并用于标签展示的统一对象选项。 */
interface TargetOption {
  /** 人物或世界前缀与 UUID 组成的稳定值。 */
  key: string
  /** 同时包含对象类型和名称的标签。 */
  label: string
  /** 用于模糊匹配的补充文本。 */
  searchText: string
  /** 关联目标类型。 */
  targetType: SourceCreationTarget['targetType']
  /** 关联目标 UUID。 */
  targetId: string
}

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
 * 生成标签选择器使用的稳定复合值。
 * @param target 人物或世界关联目标。
 * @returns `类型:UUID` 格式的唯一值。
 */
function createTargetKey(target: SourceCreationTarget): string {
  return `${target.targetType}:${target.targetId}`
}

/**
 * 把选择器复合值还原为服务端接受的关联目标。
 * @param key `类型:UUID` 格式的选择值。
 * @returns 人物或世界关联目标。
 */
function parseTargetKey(key: string): SourceCreationTarget {
  const separator = key.indexOf(':')
  return {
    targetType: key.slice(0, separator) as SourceCreationTarget['targetType'],
    targetId: key.slice(separator + 1),
  }
}

const options = computed<TargetOption[]>(() => [
  ...props.personas.map(persona => ({
    key: createTargetKey({ targetType: 'persona', targetId: persona.id }),
    label: `人物 · ${persona.name}`,
    searchText: `人物 ${persona.name}`,
    targetType: 'persona' as const,
    targetId: persona.id,
  })),
  ...props.worlds.map(world => ({
    key: createTargetKey({ targetType: 'world', targetId: world.id }),
    label: `世界 · ${world.name}`,
    searchText: `世界 ${world.name}`,
    targetType: 'world' as const,
    targetId: world.id,
  })),
])

const selectedKeys = computed<string[]>({
  get: () => targets.value.map(createTargetKey),
  set: keys => {
    targets.value = keys.map(parseTargetKey)
  },
})
</script>

<template>
  <fieldset class="space-y-3">
    <legend class="text-sm font-medium text-highlighted">具体使用对象（可选）</legend>
    <p class="text-sm text-muted">输入名称或“人物/世界”查找对象；已选对象显示为可移除标签。不选择时，资料只保存到资料库。</p>
    <UInputMenu
      v-model="selectedKeys"
      class="w-full"
      :items="options"
      value-key="key"
      label-key="label"
      :filter-fields="['label', 'searchText']"
      placeholder="搜索并选择人物或世界"
      aria-label="资料使用对象"
      multiple
      :disabled="props.disabled || options.length === 0"
    >
      <template #empty="{ searchTerm }">
        {{ searchTerm ? `没有找到“${searchTerm}”` : '暂无可选人物或世界' }}
      </template>
    </UInputMenu>
  </fieldset>
</template>
