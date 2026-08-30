<script setup lang="ts">
import { computed, shallowRef } from 'vue'
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
  /** 是否在选择器下方按人物和世界展示当前关系。 */
  showSelectedGroups?: boolean
}

const props = withDefaults(defineProps<Props>(), { showSelectedGroups: false })
const targets = defineModel<SourceCreationTarget[]>({ default: () => [] })
/** 详情页新增关系使用的人物或世界名称搜索词。 */
const addQuery = shallowRef('')

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

/** 详情页按名称模糊匹配且尚未关联的人物和世界。 */
const addableOptions = computed(() => {
  const keyword = normalizeSearchKeyword(addQuery.value)
  if (!keyword) return []
  const linkedKeys = new Set(targets.value.map(createTargetKey))
  return options.value.filter(option => !linkedKeys.has(option.key)
    && normalizeSearchKeyword(option.label).includes(keyword))
})

/** 已选人物及其详情入口。 */
const selectedPersonas = computed(() => targets.value
  .filter(target => target.targetType === 'persona')
  .map(target => ({
    id: target.targetId,
    name: props.personas.find(persona => persona.id === target.targetId)?.name ?? target.targetId,
  })))

/** 已选世界及其详情入口。 */
const selectedWorlds = computed(() => targets.value
  .filter(target => target.targetType === 'world')
  .map(target => ({
    id: target.targetId,
    name: props.worlds.find(world => world.id === target.targetId)?.name ?? target.targetId,
  })))

/**
 * 从当前资料使用关系中移除一个人物或世界。
 * @param targetType 需要移除的目标类型。
 * @param targetId 需要移除的目标 UUID。
 * @returns 本地选择更新完成时结束。
 */
function removeTarget(targetType: SourceCreationTarget['targetType'], targetId: string): void {
  if (props.disabled) return
  targets.value = targets.value.filter(target => target.targetType !== targetType || target.targetId !== targetId)
}

/**
 * 把搜索结果中的人物或世界加入当前资料使用关系。
 * @param option 用户选择的待关联对象。
 * @returns 本地选择更新且搜索词清空时结束。
 */
function addTarget(option: TargetOption): void {
  if (props.disabled || targets.value.some(target => createTargetKey(target) === option.key)) return
  targets.value = [...targets.value, { targetType: option.targetType, targetId: option.targetId }]
  addQuery.value = ''
}

/**
 * 统一关系对象名称和搜索词的大小写及首尾空白。
 * @param value 待标准化的对象名称或搜索词。
 * @returns 可用于中文和英文包含匹配的字符串。
 */
function normalizeSearchKeyword(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN')
}
</script>

<template>
  <fieldset class="space-y-3">
    <legend class="text-sm font-medium text-highlighted">具体使用对象（可选）</legend>
    <p class="text-sm text-muted">输入名称或“人物/世界”查找对象；已选对象显示为可移除标签。不选择时，资料只保存到资料库。</p>
    <UInputMenu
      v-if="!showSelectedGroups"
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

    <template v-else>
      <section class="space-y-3" aria-labelledby="add-source-target-heading">
        <div>
          <h3 id="add-source-target-heading" class="text-sm font-medium text-highlighted">添加人物或世界</h3>
          <p class="mt-1 text-xs text-muted">输入部分名称，搜索尚未关联的对象。</p>
        </div>
        <UInput
          v-model="addQuery"
          icon="i-lucide-search"
          aria-label="搜索可添加人物或世界"
          placeholder="输入人物或世界名称"
          class="w-full"
          :disabled="disabled"
        />
        <div v-if="addableOptions.length" class="max-h-52 space-y-2 overflow-y-auto pr-1">
          <div
            v-for="option in addableOptions"
            :key="option.key"
            class="flex items-center justify-between gap-3 rounded-md border border-default px-3 py-2 text-sm"
          >
            <div class="flex min-w-0 items-center gap-2">
              <UBadge color="neutral" variant="subtle" size="sm">{{ option.targetType === 'persona' ? '人物' : '世界' }}</UBadge>
              <NuxtLink
                :to="`/${option.targetType === 'persona' ? 'personas' : 'worlds'}/${option.targetId}`"
                class="truncate font-medium text-highlighted hover:underline"
              >{{ option.label.replace(/^(?:人物|世界) · /, '') }}</NuxtLink>
            </div>
            <UButton
              size="xs"
              color="primary"
              variant="soft"
              :aria-label="`添加${option.targetType === 'persona' ? '人物' : '世界'}关系：${option.label.replace(/^(?:人物|世界) · /, '')}`"
              :disabled="disabled"
              @click="addTarget(option)"
            >添加</UButton>
          </div>
        </div>
        <p v-else-if="addQuery.trim()" class="py-2 text-center text-sm text-muted">没有匹配的未关联对象</p>
      </section>

      <USeparator />

      <div class="grid gap-4 md:grid-cols-2">
      <section class="rounded-lg border border-default p-4" aria-labelledby="selected-personas-title">
        <h3 id="selected-personas-title" class="text-sm font-semibold text-highlighted">已选人物（{{ selectedPersonas.length }}）</h3>
        <p v-if="selectedPersonas.length === 0" class="mt-3 text-sm text-muted">尚未关联人物。</p>
        <ul v-else class="mt-3 space-y-2">
          <li v-for="persona in selectedPersonas" :key="persona.id" class="flex items-center justify-between gap-3 rounded-md bg-elevated px-3 py-2">
            <NuxtLink class="min-w-0 truncate text-sm font-medium text-primary hover:underline" :to="`/personas/${persona.id}`">{{ persona.name }}</NuxtLink>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="`移除人物关系：${persona.name}`"
              :disabled="disabled"
              @click="removeTarget('persona', persona.id)"
            >移除</UButton>
          </li>
        </ul>
      </section>

      <section class="rounded-lg border border-default p-4" aria-labelledby="selected-worlds-title">
        <h3 id="selected-worlds-title" class="text-sm font-semibold text-highlighted">已选世界（{{ selectedWorlds.length }}）</h3>
        <p v-if="selectedWorlds.length === 0" class="mt-3 text-sm text-muted">尚未关联世界。</p>
        <ul v-else class="mt-3 space-y-2">
          <li v-for="world in selectedWorlds" :key="world.id" class="flex items-center justify-between gap-3 rounded-md bg-elevated px-3 py-2">
            <NuxtLink class="min-w-0 truncate text-sm font-medium text-primary hover:underline" :to="`/worlds/${world.id}`">{{ world.name }}</NuxtLink>
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="`移除世界关系：${world.name}`"
              :disabled="disabled"
              @click="removeTarget('world', world.id)"
            >移除</UButton>
          </li>
        </ul>
      </section>
      </div>
    </template>
  </fieldset>
</template>
