<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { CreateSourceInput } from '#shared/schemas/content'
import type { SourceSummary } from '#shared/types/content'
import type { SourceFileSubmission } from './SourceImportForm.vue'

/** 世界参考资料管理组件属性。 */
interface Props {
  /** 当前已关联到世界的资料。 */
  linkedSources: SourceSummary[]
  /** 系统内全部可复用资料。 */
  allSources: SourceSummary[]
  /** 页面是否正在执行写操作。 */
  loading: boolean
  /** 创建资料失败时可在表单旁显示的安全错误。 */
  errorMessage: string | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  /** 请求把已有资料加入当前世界。 */
  link: [sourceId: string]
  /** 请求解除资料与当前世界的关系，但不删除资料。 */
  unlink: [sourceId: string]
  /** 请求创建粘贴文本资料并自动加入当前世界。 */
  paste: [input: CreateSourceInput]
  /** 请求上传文件资料并自动加入当前世界。 */
  file: [input: SourceFileSubmission]
}>()

/** 可复用资料的名称筛选词。 */
const query = shallowRef('')
/** 是否展开新资料创建表单。 */
const showCreate = shallowRef(false)

/** 当前尚未关联且符合名称筛选词的资料，最多展示八项。 */
const availableSources = computed(() => {
  const linkedIds = new Set(props.linkedSources.map(source => source.id))
  const keyword = query.value.trim().toLocaleLowerCase('zh-CN')
  return props.allSources
    .filter(source => !linkedIds.has(source.id))
    .filter(source => !keyword || source.name.toLocaleLowerCase('zh-CN').includes(keyword))
    .slice(0, 8)
})

/** 资料用途对应的通俗中文名称。 */
const roleLabels: Record<SourceSummary['role'], string> = {
  canon_fact: '原作事实',
  reference: '背景参考',
  style_sample: '写作风格参考',
}
</script>

<template>
  <section>
    <div class="mb-3">
      <h2 class="text-lg font-semibold text-highlighted">这个世界的参考资料</h2>
      <p class="mt-1 text-sm text-muted">人物执行新任务时，只会在自己和世界已关联的资料中查找相关内容。解除关联不会删除资料本身。</p>
    </div>
    <div class="grid gap-4 lg:grid-cols-2">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3"><h3 class="font-semibold text-highlighted">已加入</h3><UBadge color="neutral" variant="subtle">{{ props.linkedSources.length }} 项</UBadge></div>
        </template>
        <div v-if="props.linkedSources.length" class="max-h-96 space-y-2 overflow-y-auto pr-1">
          <div v-for="source in props.linkedSources" :key="source.id" class="flex items-center gap-3 rounded-md border border-default p-3">
            <div class="min-w-0 flex-1">
              <NuxtLink :to="`/sources/${source.id}`" class="block truncate text-sm font-medium text-highlighted hover:text-primary">{{ source.name }}</NuxtLink>
              <p class="mt-1 truncate text-xs text-muted">{{ roleLabels[source.role] }} · {{ source.contentText }}</p>
            </div>
            <UButton icon="i-lucide-unlink" aria-label="从世界中移除资料" color="error" variant="ghost" size="sm" :loading="props.loading" @click="emit('unlink', source.id)" />
          </div>
        </div>
        <p v-else class="py-8 text-center text-sm text-muted">还没有加入参考资料</p>
      </UCard>

      <UCard>
        <template #header>
          <div><h3 class="font-semibold text-highlighted">加入已有资料</h3><p class="mt-1 text-sm text-muted">资料可以同时用于多个世界或人物。</p></div>
        </template>
        <UInput v-model="query" icon="i-lucide-search" placeholder="按名称查找资料" class="mb-3 w-full" />
        <div v-if="availableSources.length" class="max-h-72 space-y-2 overflow-y-auto pr-1">
          <div v-for="source in availableSources" :key="source.id" class="flex items-center justify-between gap-3 rounded-md border border-default px-3 py-2">
            <div class="min-w-0"><p class="truncate text-sm font-medium text-highlighted">{{ source.name }}</p><p class="text-xs text-muted">{{ roleLabels[source.role] }}</p></div>
            <UButton size="sm" color="neutral" variant="soft" :loading="props.loading" @click="emit('link', source.id)">加入</UButton>
          </div>
        </div>
        <p v-else class="py-5 text-center text-sm text-muted">{{ props.allSources.length === props.linkedSources.length ? '所有资料都已加入' : '没有匹配的资料' }}</p>
        <div class="mt-4 border-t border-default pt-4">
          <UButton color="neutral" variant="ghost" icon="i-lucide-file-plus-2" @click="showCreate = !showCreate">{{ showCreate ? '收起新建表单' : '新建资料并自动加入' }}</UButton>
        </div>
      </UCard>
    </div>

    <ContentSourceImportForm v-if="showCreate" class="mt-4" :loading="props.loading" :error-message="props.errorMessage" @paste="emit('paste', $event)" @file="emit('file', $event)" />
  </section>
</template>
