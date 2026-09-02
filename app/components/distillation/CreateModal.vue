<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, watch } from 'vue'
import { createPersonaDistillationSchema, type CreatePersonaDistillationInput } from '#shared/schemas/personaDistillation'
import type { SourceSummary, WorldSummary } from '#shared/types/content'

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

/** 只有启用且已有当前灵魂的世界才能进入新人物上下文。 */
const availableWorlds = computed(() => props.worlds.filter(world => world.isEnabled && world.activeVersionId))
/** 只有启用资料才能固定到新蒸馏运行。 */
const availableSources = computed(() => props.sources.filter(source => source.isEnabled).map(source => ({
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
 * 清空上一次已经关闭的创建表单。
 * @returns 无返回值。
 */
function resetState(): void {
  state.requestedName = ''
  state.objective = ''
  state.worldId = null
  state.sourceIds = []
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
    title="创建人物"
    description="系统先检查资料覆盖，再提炼和评测候选；最终确认前不会创建人物。"
    :dismissible="!loading"
    :close="!loading"
  >
    <slot />
    <template #body>
      <UForm :schema="createPersonaDistillationSchema" :state="state" class="space-y-5" data-persona-distillation-create @submit="handleSubmit">
        <UFormField name="requestedName" label="人物名称" description="这是候选名称，最终确认前仍可修改。" required>
          <UInput v-model="state.requestedName" class="w-full" placeholder="例如：查理·芒格" :disabled="loading" />
        </UFormField>
        <UFormField name="objective" label="人物用途与聚焦方向" description="说明希望提炼哪些判断方式、表达特征，以及人物将用于什么场景。" required>
          <UTextarea
            v-model="state.objective"
            class="w-full"
            :rows="6"
            :maxrows="12"
            autoresize
            placeholder="例如：全面提炼他的决策框架，用于商业判断；事实不足时必须承认未知，不模仿本人身份。"
            :disabled="loading"
          />
        </UFormField>
        <div class="grid gap-5 md:grid-cols-2">
          <UFormField name="worldId" label="所属世界（可选）" description="只影响创建后的人物归属，不作为人物证据。">
            <select v-model="state.worldId" class="native-control" :disabled="loading">
              <option :value="null">独立人物</option>
              <option v-for="world in availableWorlds" :key="world.id" :value="world.id">{{ world.name }}</option>
            </select>
          </UFormField>
          <UFormField name="sourceIds" label="参考资料（可选）" description="只使用已导入并启用的文本资料；最多 100 项。">
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
        </div>
        <UAlert
          color="neutral"
          variant="subtle"
          title="两次人工确认"
          description="资料覆盖完成后确认一次；候选正文和评测完成后再确认一次。中途可以离开，稍后按运行记录继续。"
        />
        <UAlert v-if="errorMessage" color="error" title="创建失败" :description="errorMessage" />
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="ghost" :disabled="loading" @click="open = false">取消</UButton>
          <UButton type="submit" icon="i-lucide-sparkles" :loading="loading">开始人物蒸馏</UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
