<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { reactive } from 'vue'
import { createPersonaSchema, type CreatePersonaInput } from '#shared/schemas/content'
import type { SourceSummary, WorldSummary } from '#shared/types/content'

/** 人物创建表单属性。 */
interface Props {
  /** 可选世界设定。 */
  worlds: WorldSummary[]
  /** 可选参考资料。 */
  sources: SourceSummary[]
  /** 页面请求是否正在执行。 */
  loading: boolean
  /** 服务端返回的安全错误消息。 */
  errorMessage: string | null
}

defineProps<Props>()

const emit = defineEmits<{
  /** Schema 校验通过后提交完整人物输入。 */
  submit: [input: CreatePersonaInput]
}>()

/** 表单唯一可变状态。 */
const state = reactive<CreatePersonaInput>({
  name: '',
  origin: 'original',
  worldId: null,
  sourceIds: [],
  snapshot: {
    summary: '',
    identityFacts: '',
    interests: '',
    valuesAndMotivations: '',
    expressionStyle: '',
    appearance: '',
    visualStyle: '',
    constraints: '',
  },
  changeSummary: '建立初始人物档案',
})

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
      <UFormField name="origin" label="来源模式" required>
        <USelect
          v-model="state.origin"
          class="w-full"
          :items="[
            { label: '原创', value: 'original' },
            { label: '资料型', value: 'source_based' },
            { label: '混合型', value: 'hybrid' },
          ]"
          :disabled="loading"
        />
      </UFormField>
      <UFormField name="worldId" label="世界设定（可选）">
        <select v-model="state.worldId" class="native-control" :disabled="loading">
          <option :value="null">不关联世界</option>
          <option v-for="world in worlds" :key="world.id" :value="world.id">{{ world.name }}</option>
        </select>
      </UFormField>
      <UFormField name="sourceIds" label="参考资料（资料型至少一项）">
        <select v-model="state.sourceIds" class="native-control min-h-28" multiple :disabled="loading">
          <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
        </select>
      </UFormField>
    </div>

    <USeparator label="不可变人物快照" />
    <div class="grid gap-5 md:grid-cols-2">
      <UFormField name="snapshot.summary" label="人物定位" required class="md:col-span-2">
        <UTextarea v-model="state.snapshot.summary" class="w-full" autoresize :disabled="loading" />
      </UFormField>
      <UFormField name="snapshot.identityFacts" label="身份事实">
        <UTextarea v-model="state.snapshot.identityFacts" class="w-full" autoresize :disabled="loading" />
      </UFormField>
      <UFormField name="snapshot.interests" label="兴趣偏好">
        <UTextarea v-model="state.snapshot.interests" class="w-full" autoresize :disabled="loading" />
      </UFormField>
      <UFormField name="snapshot.valuesAndMotivations" label="价值与动机">
        <UTextarea v-model="state.snapshot.valuesAndMotivations" class="w-full" autoresize :disabled="loading" />
      </UFormField>
      <UFormField name="snapshot.expressionStyle" label="表达风格">
        <UTextarea v-model="state.snapshot.expressionStyle" class="w-full" autoresize :disabled="loading" />
      </UFormField>
      <UFormField name="snapshot.appearance" label="外观描述">
        <UTextarea v-model="state.snapshot.appearance" class="w-full" autoresize :disabled="loading" />
      </UFormField>
      <UFormField name="snapshot.visualStyle" label="视觉风格">
        <UTextarea v-model="state.snapshot.visualStyle" class="w-full" autoresize :disabled="loading" />
      </UFormField>
      <UFormField name="snapshot.constraints" label="约束" class="md:col-span-2">
        <UTextarea v-model="state.snapshot.constraints" class="w-full" autoresize :disabled="loading" />
      </UFormField>
      <UFormField name="changeSummary" label="版本变化摘要" required class="md:col-span-2">
        <UInput v-model="state.changeSummary" class="w-full" :disabled="loading" />
      </UFormField>
    </div>

    <p v-if="errorMessage" class="text-sm text-error" role="alert">{{ errorMessage }}</p>
    <div class="flex justify-end gap-2">
      <UButton to="/personas" color="neutral" variant="ghost">取消</UButton>
      <UButton type="submit" :loading="loading">保存候选人物</UButton>
    </div>
  </UForm>
</template>
