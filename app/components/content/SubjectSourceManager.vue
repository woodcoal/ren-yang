<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { CreateSourceWithTargetsInput } from '#shared/schemas/content'
import type { SourceSummary } from '#shared/types/content'
import type { SourceFileSubmission } from './SourceImportForm.vue'

/** 人物或世界资料管理组件属性。 */
interface Props {
  /** 当前资料所属对象类型。 */
  subjectType: 'persona' | 'world'
  /** 当前对象名称，用于确认提示。 */
  subjectName: string
  /** 当前对象已经关联的资料。 */
  linkedSources: SourceSummary[]
  /** 系统内全部可复用资料。 */
  allSources: SourceSummary[]
  /** 页面是否正在执行资料写操作。 */
  loading: boolean
  /** 创建或关联资料失败时显示的安全错误。 */
  errorMessage: string | null
}

/** 已有资料选择器选项。 */
interface SourceOption {
  /** 资料 UUID。 */
  value: string
  /** 资料名称。 */
  label: string
  /** 用于名称之外模糊匹配的正文摘要。 */
  searchText: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  /** 请求把一批已有资料加入当前对象。 */
  link: [sourceIds: string[]]
  /** 请求解除单项资料与当前对象的关系，但不删除资料。 */
  unlink: [sourceId: string]
  /** 请求创建粘贴文本资料并自动加入当前对象。 */
  paste: [input: CreateSourceWithTargetsInput]
  /** 请求上传文件资料并自动加入当前对象。 */
  file: [input: SourceFileSubmission]
}>()

/** 是否显示新建资料弹窗。 */
const createModalOpen = shallowRef(false)
/** 是否显示已有资料导入弹窗。 */
const importModalOpen = shallowRef(false)
/** 已有资料弹窗内选中的资料 UUID。 */
const selectedSourceIds = ref<string[]>([])
/** 等待用户确认解除关联的资料。 */
const pendingUnlinkSource = shallowRef<SourceSummary | null>(null)

/** 资料用途对应的通俗中文名称。 */
const roleLabels: Record<SourceSummary['role'], string> = {
  canon_fact: '原作事实',
  reference: '背景参考',
  style_sample: '写作风格参考',
}

/** 当前对象类型的通俗中文名称。 */
const subjectTypeLabel = computed(() => props.subjectType === 'persona' ? '人物' : '世界')

/**
 * 生成尚未关联的资料选择项；选择器会同时搜索名称和正文摘要。
 * @returns 可加入当前对象的资料选项。
 */
const availableSourceOptions = computed<SourceOption[]>(() => {
  const linkedIds = new Set(props.linkedSources.map(source => source.id))
  return props.allSources
    .filter(source => !linkedIds.has(source.id))
    .map(source => ({ value: source.id, label: source.name, searchText: source.contentText }))
})

/**
 * 打开已有资料导入弹窗，并清除上次未提交的选择。
 * @returns 无返回值。
 */
function openImportModal(): void {
  selectedSourceIds.value = []
  importModalOpen.value = true
}

/**
 * 提交选中的已有资料并关闭弹窗。
 * @returns 无返回值；实际关联由详情页处理。
 */
function linkSelectedSources(): void {
  if (selectedSourceIds.value.length === 0 || props.loading) return
  emit('link', [...selectedSourceIds.value])
  importModalOpen.value = false
  selectedSourceIds.value = []
}

/**
 * 打开解除资料关联二次确认框。
 * @param source 用户准备从当前对象移除的资料。
 * @returns 无返回值。
 */
function requestUnlink(source: SourceSummary): void {
  pendingUnlinkSource.value = source
}

/**
 * 关闭解除关联确认框且不执行写操作。
 * @returns 无返回值。
 */
function cancelUnlink(): void {
  pendingUnlinkSource.value = null
}

/**
 * 用户确认后发出解除关联事件。
 * @returns 无返回值；资料正文不会被删除。
 */
function confirmUnlink(): void {
  if (!pendingUnlinkSource.value || props.loading) return
  emit('unlink', pendingUnlinkSource.value.id)
  pendingUnlinkSource.value = null
}
</script>

<template>
  <section>
    <div class="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
      <div>
        <h2 class="text-lg font-semibold text-highlighted">资料</h2>
        <p class="mt-1 text-sm text-muted">这些资料可供当前{{ subjectTypeLabel }}处理任务时检索。解除关联不会删除资料本身。</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton icon="i-lucide-file-plus-2" color="neutral" variant="soft" @click="createModalOpen = true">新建资料</UButton>
        <UButton icon="i-lucide-folder-input" @click="openImportModal">导入资料</UButton>
      </div>
    </div>

    <div v-if="props.linkedSources.length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <UCard v-for="source in props.linkedSources" :key="source.id">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <NuxtLink :to="`/sources/${source.id}`" class="block truncate font-medium text-highlighted hover:text-primary">{{ source.name }}</NuxtLink>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <UBadge color="neutral" variant="subtle">{{ roleLabels[source.role] }}</UBadge>
              <UBadge :color="source.isEnabled ? 'success' : 'neutral'" variant="subtle">{{ source.isEnabled ? '已启用' : '已禁用' }}</UBadge>
            </div>
            <p class="mt-3 line-clamp-3 text-sm leading-6 text-muted">{{ source.contentText }}</p>
          </div>
          <UButton
            icon="i-lucide-unlink"
            :aria-label="`解除资料关联：${source.name}`"
            color="error"
            variant="ghost"
            size="xs"
            :disabled="props.loading"
            @click="requestUnlink(source)"
          />
        </div>
      </UCard>
    </div>
    <div v-else class="content-empty-state">
      <div><strong>还没有关联资料</strong><p class="mt-1 text-sm text-muted">可以新建资料，或从资料库导入已有资料。</p></div>
    </div>

    <UModal v-model:open="createModalOpen" title="新建资料" :description="`创建后会自动加入当前${subjectTypeLabel}“${props.subjectName}”。`" scrollable :ui="{ content: 'max-w-6xl' }">
      <template #body>
        <ContentSourceImportForm :loading="props.loading" :error-message="props.errorMessage" @paste="emit('paste', $event)" @file="emit('file', $event)" />
      </template>
    </UModal>

    <UModal v-model:open="importModalOpen" title="导入已有资料" :description="`只显示尚未加入当前${subjectTypeLabel}的资料。`">
      <template #body>
        <div class="space-y-4">
          <UInputMenu
            v-model="selectedSourceIds"
            class="w-full"
            :items="availableSourceOptions"
            value-key="value"
            label-key="label"
            :filter-fields="['label', 'searchText']"
            placeholder="输入资料名称或正文关键词"
            aria-label="选择已有资料"
            multiple
            :disabled="props.loading || availableSourceOptions.length === 0"
          >
            <template #empty="{ searchTerm }">
              {{ searchTerm ? `没有找到“${searchTerm}”` : '没有可导入的资料' }}
            </template>
          </UInputMenu>
          <p class="text-sm text-muted">可同时选择多项；导入只新增使用关系，不复制资料。</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="props.loading" @click="importModalOpen = false">取消</UButton>
          <UButton :loading="props.loading" :disabled="selectedSourceIds.length === 0" @click="linkSelectedSources">加入所选资料</UButton>
        </div>
      </template>
    </UModal>

    <UModal :open="pendingUnlinkSource !== null" title="确认解除资料关联" description="只解除当前使用关系，资料仍保留在资料库中。" :dismissible="!props.loading" :close="false">
      <template #body>
        <p class="text-sm text-muted">确定从{{ subjectTypeLabel }}“{{ props.subjectName }}”中移除“{{ pendingUnlinkSource?.name }}”吗？</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="props.loading" @click="cancelUnlink">取消</UButton>
          <UButton color="error" :loading="props.loading" @click="confirmUnlink">确认解除</UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>
