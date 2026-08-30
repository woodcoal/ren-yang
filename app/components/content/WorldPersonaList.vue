<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { PersonaSummary } from '#shared/types/content'

/** 世界人物关系管理属性。 */
interface Props {
  /** 当前直接使用该世界的人物。 */
  personas: PersonaSummary[]
  /** 全部人物，用于筛选尚未归属世界的可添加对象。 */
  availablePersonas: PersonaSummary[]
  /** 页面是否正在修改人物关系。 */
  loading: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  /** 请求把一个独立人物加入当前世界。 */
  add: [persona: PersonaSummary]
  /** 请求解除人物与当前世界的关系。 */
  remove: [persona: PersonaSummary]
}>()

/** 已关联人物名称筛选词。 */
const linkedQuery = shallowRef('')
/** 待添加人物名称模糊搜索词。 */
const addQuery = shallowRef('')

/** 按名称筛选后的关联人物。 */
const filteredPersonas = computed(() => {
  const keyword = normalizeSearchKeyword(linkedQuery.value)
  if (!keyword) return props.personas
  return props.personas.filter(persona => normalizeSearchKeyword(persona.name).includes(keyword))
})

/** 名称模糊匹配且尚未归属任何世界的人物。 */
const addablePersonas = computed(() => {
  const keyword = normalizeSearchKeyword(addQuery.value)
  if (!keyword) return []
  const linkedIds = new Set(props.personas.map(persona => persona.id))
  return props.availablePersonas.filter(persona => persona.worldId === null
    && !linkedIds.has(persona.id)
    && normalizeSearchKeyword(persona.name).includes(keyword))
})

/**
 * 统一人物名称和搜索词的大小写及首尾空白。
 * @param value 待标准化的人物名称或用户输入。
 * @returns 可用于中文和英文包含匹配的字符串。
 */
function normalizeSearchKeyword(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN')
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold text-highlighted">使用这个世界的人物</h2>
          <p class="mt-1 text-sm text-muted">添加只支持未归属世界的人物；移除不会删除人物。</p>
        </div>
        <UBadge color="neutral" variant="subtle">{{ props.personas.length }} 人</UBadge>
      </div>
    </template>

    <section class="mb-5 space-y-3" aria-labelledby="add-world-persona-heading">
      <div>
        <h3 id="add-world-persona-heading" class="text-sm font-medium text-highlighted">添加已有的人物</h3>
        <p class="mt-1 text-xs text-muted">输入部分名称，搜索未关联世界的人物。</p>
      </div>
      <UInput v-model="addQuery" icon="i-lucide-search" aria-label="搜索可添加人物" placeholder="输入人物名称"
        class="w-full" :disabled="loading" />
      <div v-if="addablePersonas.length" class="max-h-52 space-y-2 overflow-y-auto pr-1">
        <div v-for="persona in addablePersonas" :key="persona.id"
          class="flex items-center justify-between gap-3 rounded-md border border-default px-3 py-2 text-sm">
          <span class="truncate font-medium text-highlighted">{{ persona.name }}</span>
          <UButton size="xs" color="primary" variant="soft" :disabled="loading" @click="emit('add', persona)">添加</UButton>
        </div>
      </div>
      <p v-else-if="addQuery.trim()" class="py-2 text-center text-sm text-muted">没有匹配的独立人物</p>
    </section>

    <USeparator class="mb-5" />
    <UInput v-if="props.personas.length > 6" v-model="linkedQuery" icon="i-lucide-search" placeholder="查找已关联人物"
      aria-label="查找已关联人物" class="mb-3 w-full" />
    <div v-if="filteredPersonas.length" class="max-h-80 space-y-2 overflow-y-auto pr-1">
      <div v-for="persona in filteredPersonas" :key="persona.id"
        class="flex items-center justify-between gap-3 rounded-md border border-default px-3 py-2 text-sm">
        <NuxtLink :to="`/personas/${persona.id}`" class="truncate font-medium text-highlighted hover:underline">
          {{ persona.name }}
        </NuxtLink>
        <UButton size="xs" color="error" variant="ghost" :disabled="loading" @click="emit('remove', persona)">移除</UButton>
      </div>
    </div>
    <p v-else class="py-5 text-center text-sm text-muted">{{ props.personas.length ? '没有匹配的人物' : '还没有人物使用这个世界' }}</p>
  </UCard>
</template>
