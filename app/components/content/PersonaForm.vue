<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { reactive, watch } from 'vue'
import { createPersonaSchema, type CreatePersonaInput } from '#shared/schemas/content'
import type { SourceSummary, WorldSummary } from '#shared/types/content'

/** 人物创建表单属性。 */
interface Props {
  /** 可选世界。 */
  worlds: WorldSummary[]
  /** 可选参考资料。 */
  sources: SourceSummary[]
  /** 页面请求是否正在执行。 */
  loading: boolean
  /** 服务端返回的安全错误消息。 */
  errorMessage: string | null
  /** AI 生成或其他入口提供的完整初始候选值。 */
  initialValue?: CreatePersonaInput | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** Schema 校验通过后提交完整人物输入。 */
  submit: [input: CreatePersonaInput]
}>()

/** 表单唯一可变状态。 */
const state = reactive<CreatePersonaInput>({
  name: '',
  worldId: null,
  sourceIds: [],
  snapshot: { promptText: '' },
  changeSummary: '建立初始人物档案',
})

watch(() => props.initialValue, (value) => {
  if (!value) return
  applyInitialValue(value)
}, { immediate: true })

/**
 * 用新的完整候选值替换表单字段，并复制数组与快照以避免修改属性对象。
 * @param value 页面提供的已校验初始候选值。
 * @returns 无返回值。
 */
function applyInitialValue(value: CreatePersonaInput): void {
  state.name = value.name
  state.worldId = value.worldId ?? null
  state.sourceIds = [...value.sourceIds]
  state.snapshot = { promptText: value.snapshot.promptText }
  state.changeSummary = value.changeSummary
}

/**
 * 上送 Nuxt UI 已通过共享 Schema 校验的数据。
 * @param event 表单提交事件。
 * @returns 无返回值。
 */
function handleSubmit(event: FormSubmitEvent<CreatePersonaInput>): void {
  emit('submit', event.data)
}
</script>

<template>
  <UForm :schema="createPersonaSchema" :state="state" class="space-y-6" @submit="handleSubmit">
    <div class="grid gap-5 md:grid-cols-2">
      <UFormField name="name" label="人物名称" required>
        <UInput v-model="state.name" class="w-full" :disabled="loading" />
      </UFormField>
      <UFormField name="worldId" label="世界（可选）">
        <select v-model="state.worldId" class="native-control" :disabled="loading">
          <option :value="null">不关联世界</option>
          <option v-for="world in worlds" :key="world.id" :value="world.id">{{ world.name }}</option>
        </select>
      </UFormField>
      <UFormField name="sourceIds" label="参考资料（可选）">
        <select v-model="state.sourceIds" class="native-control min-h-28" multiple :disabled="loading">
          <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
        </select>
      </UFormField>
    </div>

    <USeparator label="人物灵魂" />
    <UFormField name="snapshot.promptText" label="灵魂提示词" description="这段文本会在发布后直接进入人物任务。" required>
      <UTextarea v-model="state.snapshot.promptText" class="w-full" :rows="14" autoresize :disabled="loading" />
    </UFormField>
    <UFormField name="changeSummary" label="这次建立了什么" description="方便以后在灵魂版本记录中辨认。" required>
      <UInput v-model="state.changeSummary" class="w-full" :disabled="loading" />
    </UFormField>

    <p v-if="errorMessage" class="text-sm text-error" role="alert">{{ errorMessage }}</p>
    <div class="flex justify-end gap-2">
      <UButton to="/personas" color="neutral" variant="ghost">取消</UButton>
      <UButton type="submit" :loading="loading">创建人物并保存灵魂草稿</UButton>
    </div>
  </UForm>
</template>
