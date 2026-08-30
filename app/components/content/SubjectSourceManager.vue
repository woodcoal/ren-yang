<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
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

/** 等待用户确认的资料状态变更。 */
interface PendingSourceStatus {
  /** 准备修改状态的资料。 */
  source: SourceSummary
  /** 用户确认后写入的目标状态。 */
  isEnabled: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  /** 请求把一批已有资料加入当前对象。 */
  link: [sourceIds: string[]]
  /** 请求解除单项资料与当前对象的关系，但不删除资料。 */
  unlink: [sourceId: string]
  /** 请求修改资料的全局启用状态。 */
  status: [input: { sourceId: string, isEnabled: boolean }]
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
/** 等待用户确认的资料全局状态变更。 */
const pendingSourceStatus = shallowRef<PendingSourceStatus | null>(null)
/** 资料创建表单实例序号；递增后强制生成空白表单。 */
const sourceFormKey = shallowRef(0)
/** 是否正在等待一次资料创建请求完成。 */
const createSubmissionPending = shallowRef(false)

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
 * 打开一份全新的资料创建表单。
 * @returns 无返回值。
 */
function openCreateModal(): void {
  sourceFormKey.value += 1
  createSubmissionPending.value = false
  createModalOpen.value = true
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

/**
 * 打开资料启用或禁用二次确认框。
 * @param source 用户准备修改状态的资料。
 * @returns 无返回值。
 */
function requestSourceStatusChange(source: SourceSummary): void {
  pendingSourceStatus.value = { source, isEnabled: !source.isEnabled }
}

/**
 * 关闭资料状态确认框且不执行写操作。
 * @returns 无返回值。
 */
function cancelSourceStatusChange(): void {
  pendingSourceStatus.value = null
}

/**
 * 用户确认后发出资料全局状态变更事件。
 * @returns 无返回值。
 */
function confirmSourceStatusChange(): void {
  if (!pendingSourceStatus.value || props.loading) return
  emit('status', {
    sourceId: pendingSourceStatus.value.source.id,
    isEnabled: pendingSourceStatus.value.isEnabled,
  })
  pendingSourceStatus.value = null
}

/**
 * 提交粘贴文本资料，并标记当前创建弹窗等待父页处理结果。
 * @param input 已校验的粘贴文本资料。
 * @returns 无返回值。
 */
function submitPastedSource(input: CreateSourceWithTargetsInput): void {
  createSubmissionPending.value = true
  emit('paste', input)
}

/**
 * 提交文件资料，并标记当前创建弹窗等待父页处理结果。
 * @param input 已校验的批量文件资料。
 * @returns 无返回值。
 */
function submitSourceFiles(input: SourceFileSubmission): void {
  createSubmissionPending.value = true
  emit('file', input)
}

/**
 * 在一次创建请求结束后根据父页错误状态关闭或保留弹窗。
 * @param loading 当前加载状态。
 * @param previousLoading 上一次加载状态。
 * @returns 无返回值。
 */
function handleLoadingChange(loading: boolean, previousLoading: boolean): void {
  if (loading || !previousLoading || !createSubmissionPending.value) return
  createSubmissionPending.value = false
  if (props.errorMessage) return
  createModalOpen.value = false
  sourceFormKey.value += 1
}

watch(() => props.loading, handleLoadingChange)
</script>

<template>
  <section>
    <div class="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
      <div>
        <h2 class="text-lg font-semibold text-highlighted">资料</h2>
        <p class="mt-1 text-sm text-muted">这些资料可供当前{{ subjectTypeLabel }}处理任务时检索。解除关联不会删除资料本身。</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton icon="i-lucide-file-plus-2" color="neutral" variant="soft" @click="openCreateModal">新建资料</UButton>
        <UButton icon="i-lucide-folder-input" @click="openImportModal">导入资料</UButton>
      </div>
    </div>

    <div v-if="props.linkedSources.length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <ContentSubjectSourceCard
        v-for="source in props.linkedSources"
        :key="source.id"
        :source="source"
        :loading="props.loading"
        @status="requestSourceStatusChange"
        @unlink="requestUnlink"
      />
    </div>
    <div v-else class="content-empty-state">
      <div><strong>还没有关联资料</strong><p class="mt-1 text-sm text-muted">可以新建资料，或从资料库导入已有资料。</p></div>
    </div>

    <UModal v-model:open="createModalOpen" title="新建资料" :description="`创建后会自动加入当前${subjectTypeLabel}“${props.subjectName}”。`" scrollable :dismissible="!props.loading" :close="!props.loading" :ui="{ content: 'max-w-6xl' }">
      <template #body>
        <ContentSourceImportForm :key="sourceFormKey" :loading="props.loading" :error-message="props.errorMessage" @paste="submitPastedSource" @file="submitSourceFiles" />
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

    <UModal
      :open="pendingSourceStatus !== null"
      :title="pendingSourceStatus?.isEnabled ? '确认启用资料' : '确认禁用资料'"
      :description="pendingSourceStatus?.isEnabled ? '启用后，这项资料可以重新进入人物和世界检索。' : '禁用是资料的全局状态，不会删除正文或使用关系。'"
      :dismissible="!props.loading"
      :close="false"
    >
      <template #body>
        <p class="text-sm text-muted">
          {{ pendingSourceStatus?.isEnabled
            ? `确定启用“${pendingSourceStatus.source.name}”吗？启用后，关联的人物和世界可以重新使用这项资料。`
            : `确定禁用“${pendingSourceStatus?.source.name}”吗？禁用后，所有人物和世界都不会再使用这项资料。` }}
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="props.loading" @click="cancelSourceStatusChange">取消</UButton>
          <UButton
            :color="pendingSourceStatus?.isEnabled ? 'success' : 'error'"
            :loading="props.loading"
            @click="confirmSourceStatusChange"
          >{{ pendingSourceStatus?.isEnabled ? '确认启用' : '确认禁用' }}</UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>
