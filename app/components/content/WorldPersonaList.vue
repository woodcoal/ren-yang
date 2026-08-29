<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { PersonaSummary } from '#shared/types/content'

/** 世界关联人物列表属性。 */
interface Props {
  /** 当前直接使用该世界的人物。 */
  personas: PersonaSummary[]
}

const props = defineProps<Props>()
/** 人物名称筛选词。 */
const query = shallowRef('')

/** 按名称筛选后的关联人物。 */
const filteredPersonas = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase('zh-CN')
  if (!keyword) return props.personas
  return props.personas.filter(persona => persona.name.toLocaleLowerCase('zh-CN').includes(keyword))
})
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold text-highlighted">使用这个世界的人物</h2>
          <p class="mt-1 text-sm text-muted">这些人物的新任务会读取当前生效的世界。</p>
        </div>
        <UBadge color="neutral" variant="subtle">{{ props.personas.length }} 人</UBadge>
      </div>
    </template>
    <UInput v-if="props.personas.length > 6" v-model="query" icon="i-lucide-search" placeholder="查找人物"
      class="mb-3 w-full" />
    <div v-if="filteredPersonas.length" class="max-h-80 space-y-2 overflow-y-auto pr-1">
      <NuxtLink v-for="persona in filteredPersonas" :key="persona.id" :to="`/personas/${persona.id}`"
        class="flex items-center justify-between gap-3 rounded-md border border-default px-3 py-2 text-sm hover:bg-elevated">
        <span class="truncate font-medium text-highlighted">{{ persona.name }}</span>
        <span class="shrink-0 text-xs text-muted">查看</span>
      </NuxtLink>
    </div>
    <p v-else class="py-5 text-center text-sm text-muted">{{ props.personas.length ? '没有匹配的人物' : '还没有人物使用这个世界' }}</p>
  </UCard>
</template>
