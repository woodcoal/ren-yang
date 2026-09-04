<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, shallowRef, watch } from 'vue'
import type { SourceFileSubmission } from '../content/SourceImportForm.vue'
import { createPersonaDistillationSchema, type CreatePersonaDistillationInput } from '#shared/schemas/personaDistillation'
import type { ApiResponse } from '#shared/types/api'
import type { SourceDetails, SourceSummary, WorldSummary } from '#shared/types/content'
import { getApiErrorMessage } from '../../utils/apiError'

/** 人物蒸馏创建弹窗属性。 */
interface Props {
  /** 可选世界列表。 */
  worlds: WorldSummary[]
  /** 可选参考资料列表。 */
  sources: SourceSummary[]
  /** 创建请求是否正在执行。 */
  loading: boolean
  /** 最近一次创建失败的安全消息。 */
  errorMessage: string | null
}

const props = defineProps<Props>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  /** 用户确认后提交人物名称、用途和可选上下文。 */
  submit: [input: CreatePersonaDistillationInput]
}>()

/** 创建人物蒸馏运行的唯一表单状态。 */
const state = reactive<CreatePersonaDistillationInput>({
  requestedName: '',
  objective: '',
  worldId: null,
  sourceIds: [],
})

/** 本次打开创建窗口后刚导入、尚未写入父列表的资料。 */
const uploadedSources = shallowRef<SourceSummary[]>([])
/** 上传资料期间禁止重复提交蒸馏运行。 */
const uploadingSources = shallowRef(false)
/** 文件逐项导入后的可展示错误。 */
const sourceUploadError = shallowRef<string | null>(null)

/** 人物名称规范化后可用于资料标题的前缀。 */
const sourceTitlePrefix = computed(() => state.requestedName.trim())
/** 上传文件前必须先确定人物名称。 */
const sourceUploadBlockedMessage = computed(() => sourceTitlePrefix.value ? '' : '请先填写人物名称，再上传资料')
const { notifySuccess, notifyWarning } = useOperationNotifications()

/** 只有启用且已有当前灵魂的世界才能进入新人物上下文。 */
const availableWorlds = computed(() => props.worlds.filter(world => world.isEnabled && world.activeVersionId))
/** 已启用的既有资料与本次刚导入的资料共同构成可选素材。 */
const availableSources = computed(() => [...props.sources, ...uploadedSources.value]
  .filter((source, index, values) => source.isEnabled && values.findIndex(value => value.id === source.id) === index)
  .map(source => ({
    label: `${source.name} · ${sourceRoleLabel(source.role)}`,
    value: source.id,
  })))

/**
 * 把资料业务角色转换为创建弹窗中的通俗名称。
 * @param role 资料的稳定角色编码。
 * @returns 用户可识别的中文名称。
 */
function sourceRoleLabel(role: SourceSummary['role']): string {
  return ({ canon_fact: '原著事实', reference: '普通参考', style_sample: '表达样例' })[role]
}

/**
 * 清空上一次已经关闭的创建表单和仅属于本次创建的资料。
 * @returns 无返回值。
 */
function resetState(): void {
  state.requestedName = ''
  state.objective = ''
  state.worldId = null
  state.sourceIds = []
  uploadedSources.value = []
  sourceUploadError.value = null
}

/**
 * 逐个导入创建时拖入或选择的资料，并把成功资料立即选为本次蒸馏素材。
 * @param input 共用角色和待导入文件。
 * @returns 全部文件处理完成时结束。
 */
async function uploadSourceFiles(input: SourceFileSubmission): Promise<void> {
  const requestedName = sourceTitlePrefix.value
  if (!requestedName || uploadingSources.value || props.loading) return
  uploadingSources.value = true
  sourceUploadError.value = null
  let succeeded = 0
  const failures: string[] = []
  try {
    for (const item of input.files) {
      const body = new FormData()
      body.set('name', item.name)
      body.set('role', input.role)
      body.set('targets', '[]')
      body.set('file', item.file)
      try {
        const response = await $fetch<ApiResponse<SourceDetails>>('/api/v1/sources/files', { method: 'POST', body })
        const source = response.data.source
        uploadedSources.value = [...uploadedSources.value, source]
        state.sourceIds = [...new Set([...state.sourceIds, source.id])]
        succeeded += 1
      }
      catch (error: unknown) {
        failures.push(`${item.file.name}：${getApiErrorMessage(error, '导入失败')}`)
      }
    }
    if (failures.length > 0) {
      sourceUploadError.value = `成功 ${succeeded} 个，失败 ${failures.length} 个。${failures.join('；')}`
      notifyWarning(sourceUploadError.value, '资料导入部分完成')
      return
    }
    notifySuccess(`${succeeded} 项资料已导入并选为本次蒸馏素材。`, '资料导入完成')
  }
  finally {
    uploadingSources.value = false
  }
}

/**
 * 把 Nuxt UI 已校验的创建输入交给人物列表页。
 * @param event 已通过共享 Schema 校验的表单提交事件。
 * @returns 无返回值。
 */
function handleSubmit(event: FormSubmitEvent<CreatePersonaDistillationInput>): void {
  emit('submit', event.data)
}

watch(open, (isOpen, wasOpen) => {
  if (isOpen && wasOpen === false) resetState()
})
</script>

<template>
  <UModal
    v-model:open="open"
    title="AI 自由蒸馏创建人物"
    description="模型会在一次分析中理解你选择的资料、处理冲突和未知边界，再生成分析报告与人物候选；最终确认前不会创建人物。"
    :dismissible="!loading && !uploadingSources"
    :close="!loading && !uploadingSources"
    :ui="{ content: 'max-w-5xl' }"
  >
    <slot />
    <template #body>
      <div class="space-y-5">
        <UForm id="persona-distillation-create-form" :schema="createPersonaDistillationSchema" :state="state" class="space-y-5" data-persona-distillation-create @submit="handleSubmit">
          <UFormField name="requestedName" label="人物名称" description="这是候选名称，最终确认前仍可修改。" required>
            <UInput v-model="state.requestedName" class="w-full" placeholder="例如：查理·芒格" :disabled="loading || uploadingSources" />
          </UFormField>
          <UFormField name="objective" label="人物用途与聚焦方向" description="说明希望提炼哪些判断方式、表达特征，以及人物将用于什么场景。" required>
            <UTextarea
              v-model="state.objective"
              class="w-full"
              :rows="6"
              :maxrows="12"
              autoresize
              placeholder="例如：全面提炼他的决策框架，用于商业判断；事实不足时必须承认未知，不模仿本人身份。"
              :disabled="loading || uploadingSources"
            />
          </UFormField>
          <div class="grid gap-5 md:grid-cols-2">
            <UFormField name="worldId" label="所属世界（可选）" description="只影响创建后的人物归属，不作为人物证据。">
              <select v-model="state.worldId" class="native-control" :disabled="loading || uploadingSources">
                <option :value="null">独立人物</option>
                <option v-for="world in availableWorlds" :key="world.id" :value="world.id">{{ world.name }}</option>
              </select>
            </UFormField>
            <UFormField name="sourceIds" label="参考资料（可选）" description="可选择已有资料，或在下方上传后直接用于本次蒸馏；最多 100 项。">
              <UInputMenu
                v-model="state.sourceIds"
                class="w-full"
                :items="availableSources"
                value-key="value"
                label-key="label"
                multiple
                placeholder="搜索并选择资料"
                :disabled="loading || uploadingSources || availableSources.length === 0"
              >
                <template #empty="{ searchTerm }">
                  {{ searchTerm ? `没有找到“${searchTerm}”` : '暂无可用资料' }}
                </template>
              </UInputMenu>
            </UFormField>
          </div>
        </UForm>
        <ContentSourceImportForm
          file-only
          class="w-full"
          :loading="loading || uploadingSources"
          :file-disabled="Boolean(sourceUploadBlockedMessage)"
          :file-disabled-message="sourceUploadBlockedMessage"
          :file-name-prefix="sourceTitlePrefix"
          :error-message="sourceUploadError"
          @file="uploadSourceFiles"
        />
        <UAlert
          color="neutral"
          variant="subtle"
          title="一次分析，人工确认"
          description="模型完成分析后展示完整分析报告和候选灵魂。你可直接校准候选，确认前不会创建人物。中途可以离开，稍后按运行记录继续。"
        />
        <UAlert v-if="errorMessage" color="error" title="创建失败" :description="errorMessage" />
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="ghost" :disabled="loading || uploadingSources" @click="open = false">取消</UButton>
          <UButton type="submit" form="persona-distillation-create-form" icon="i-lucide-sparkles" :loading="loading" :disabled="uploadingSources">开始人物蒸馏</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
