<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, watch } from 'vue'
import { restartPersonaDistillationSchema, type RestartPersonaDistillationInput } from '#shared/schemas/personaDistillation'
import type { SourceSummary } from '#shared/types/content'

/** 已有人物重新蒸馏弹窗属性。 */
interface Props {
  /** 当前目标人物名称。 */
  personaName: string
  /** 可选参考资料列表。 */
  sources: SourceSummary[]
  /** 打开弹窗时默认选中的已关联资料 UUID。 */
  initialSourceIds: string[]
  /** 创建运行请求是否正在执行。 */
  loading: boolean
  /** 最近一次创建失败的安全消息。 */
  errorMessage: string | null
}

const props = defineProps<Props>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  /** 用户确认后提交聚焦方向和资料范围。 */
  submit: [input: RestartPersonaDistillationInput]
}>()

/** 重新蒸馏的唯一表单状态。 */
const state = reactive<RestartPersonaDistillationInput>({ objective: '', sourceIds: [] })
/** 只有启用资料才能固定到新运行。 */
const availableSources = computed(() => props.sources.filter(source => source.isEnabled).map(source => ({
  label: `${source.name} · ${sourceRoleLabel(source.role)}`,
  value: source.id,
})))

/**
 * 把资料业务角色转换为弹窗中的通俗名称。
 * @param role 资料的稳定角色编码。
 * @returns 用户可识别的中文名称。
 */
function sourceRoleLabel(role: SourceSummary['role']): string {
  return ({ canon_fact: '原著事实', reference: '普通参考', style_sample: '表达样例' })[role]
}

/**
 * 清空聚焦方向并恢复已关联的可用资料。
 * @returns 无返回值。
 */
function resetState(): void {
  const availableIds = new Set(availableSources.value.map(source => source.value))
  state.objective = ''
  state.sourceIds = props.initialSourceIds.filter(sourceId => availableIds.has(sourceId))
}

/**
 * 把已通过共享 Schema 校验的输入交给人物详情页。
 * @param event Nuxt UI 表单提交事件。
 * @returns 无返回值。
 */
function handleSubmit(event: FormSubmitEvent<RestartPersonaDistillationInput>): void {
  emit('submit', event.data)
}

watch(open, (isOpen, wasOpen) => {
  if (isOpen && wasOpen === false) resetState()
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`重新蒸馏·${personaName}`"
    description="固定当前灵魂和所选资料开始新运行；最终确认后只发布当前人物的新灵魂版本。"
    :dismissible="!loading"
    :close="!loading"
  >
    <template #body>
      <UForm :schema="restartPersonaDistillationSchema" :state="state" class="space-y-5" data-persona-redistillation-form @submit="handleSubmit">
        <UFormField name="objective" label="本次聚焦方向" description="说明希望重新检查或加强的判断方式、表达特征与未知边界。" required>
          <UTextarea
            v-model="state.objective"
            class="w-full"
            :rows="6"
            :maxrows="12"
            autoresize
            placeholder="例如：保留现有判断原则，重点校准新资料中的表达特征和冲突观点。"
            :disabled="loading"
          />
        </UFormField>
        <UFormField name="sourceIds" label="参考资料（可选）" description="默认选中当前人物已关联的可用资料。">
          <UInputMenu
            v-model="state.sourceIds"
            class="w-full"
            :items="availableSources"
            value-key="value"
            label-key="label"
            multiple
            placeholder="搜索并选择资料"
            :disabled="loading || availableSources.length === 0"
          >
            <template #empty="{ searchTerm }">
              {{ searchTerm ? `没有找到“${searchTerm}”` : '暂无可用资料' }}
            </template>
          </UInputMenu>
        </UFormField>
        <UAlert color="neutral" variant="subtle" title="两次人工确认" description="资料范围与最终候选都需要确认；期间可以离开并从任务记录继续。" />
        <UAlert v-if="errorMessage" color="error" title="重新蒸馏创建失败" :description="errorMessage" />
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="ghost" :disabled="loading" @click="open = false">取消</UButton>
          <UButton type="submit" icon="i-lucide-flask-conical" :loading="loading">开始重新蒸馏</UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
