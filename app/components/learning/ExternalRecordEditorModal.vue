<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { parseDate, type DateValue } from '@internationalized/date'
import { reactive, shallowRef, watch } from 'vue'
import { saveExternalRecordSchema, type SaveExternalRecordInput } from '#shared/schemas/learning'
import type { PersonaExternalRecordView } from '#shared/types/learning'

const props = defineProps<{
  /** 弹窗是否打开。 */
  open: boolean
  /** 修改模式下的现有记录；新建时为空。 */
  initialValue: PersonaExternalRecordView | null
  /** 页面级动作是否正在执行。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 同步弹窗开关。 */
  'update:open': [open: boolean]
  /** 提交完整第三方经历记录。 */
  submit: [input: SaveExternalRecordInput]
}>()

/** 弹窗内唯一可变表单状态。 */
const state = reactive<SaveExternalRecordInput>({
  occurredOn: '', content: '', references: [], importance: 3,
})
const occurredOnDate = shallowRef<DateValue | undefined>()

/**
 * 新增一项空白参考来源，等待用户填写名称和地址。
 * @returns 参考列表更新时结束。
 */
function addReference(): void {
  state.references.push({ name: '', address: '' })
}

/**
 * 删除指定位置的参考来源。
 * @param index 从零开始的参考项位置。
 * @returns 参考列表更新时结束。
 */
function removeReference(index: number): void {
  state.references.splice(index, 1)
}

/**
 * 使用现有记录或空值重置完整表单。
 * @returns 表单状态替换完成时结束。
 */
function resetState(): void {
  state.occurredOn = props.initialValue?.occurredOn ?? ''
  occurredOnDate.value = state.occurredOn ? parseDate(state.occurredOn) : undefined
  state.content = props.initialValue?.content ?? ''
  state.references = props.initialValue?.references.map(item => ({ ...item })) ?? []
  state.importance = props.initialValue?.importance ?? 3
}

/**
 * 把 Nuxt UI 日期值同步为共享 Schema 使用的 ISO 日期字符串。
 * @param value 当前选择的无时区日期；清空时为 undefined。
 * @returns 无返回值。
 */
function updateOccurredOn(value: DateValue | null | undefined): void {
  occurredOnDate.value = value ?? undefined
  state.occurredOn = value?.toString() ?? ''
}

/**
 * 提交共享 Schema 已校验的完整记录。
 * @param event Nuxt UI 表单提交事件。
 * @returns 提交事件发出时结束。
 */
function handleSubmit(event: FormSubmitEvent<SaveExternalRecordInput>): void {
  emit('submit', event.data)
}

watch(() => props.open, (open) => {
  if (open) resetState()
})
</script>

<template>
  <UModal
    :open="open"
    :title="initialValue ? '修改第三方记录' : '添加第三方记录'"
    description="记录人物实际做过的事情，并附上可追溯的第三方来源。"
    :dismissible="!loading"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <UForm :schema="saveExternalRecordSchema" :state="state" class="space-y-4" data-external-record-form @submit="handleSubmit">
        <div class="grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
          <UFormField name="occurredOn" label="发生日期" required>
            <CommonDatePicker
              :model-value="occurredOnDate"
              label="发生日期"
              :disabled="loading"
              @update:model-value="updateOccurredOn"
            />
          </UFormField>
          <UFormField name="importance" label="记忆提炼评分" description="1 为弱参考，5 为最高优先级。" required>
            <UInput v-model.number="state.importance" type="number" min="1" max="5" class="w-full" :disabled="loading" />
          </UFormField>
        </div>
        <UFormField name="content" label="做了什么事情" required>
          <UTextarea v-model="state.content" class="w-full" :rows="6" autoresize :maxrows="12" :disabled="loading" />
        </UFormField>

        <div class="space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div><strong class="text-sm text-highlighted">参考来源</strong><p class="text-xs text-muted">可填写笔记名、小说名或网址；地址也允许使用文字位置说明。</p></div>
            <UButton type="button" size="xs" color="neutral" variant="soft" :disabled="loading || state.references.length >= 20" @click="addReference">添加参考</UButton>
          </div>
          <div v-for="(reference, index) in state.references" :key="index" class="grid gap-2 rounded-lg border border-default p-3 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
            <UFormField :name="`references.${index}.name`" label="参考名称" required>
              <UInput v-model="reference.name" class="w-full" placeholder="例如：项目复盘笔记" :disabled="loading" />
            </UFormField>
            <UFormField :name="`references.${index}.address`" label="参考地址" required>
              <UInput v-model="reference.address" class="w-full" placeholder="网址或第三方位置说明" :disabled="loading" />
            </UFormField>
            <UButton type="button" class="self-end" color="error" variant="ghost" icon="i-lucide-trash-2" :disabled="loading" :aria-label="`删除第 ${index + 1} 项参考`" @click="removeReference(index)" />
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="ghost" :disabled="loading" @click="emit('update:open', false)">取消</UButton>
          <UButton type="submit" :loading="loading">{{ initialValue ? '保存修改' : '添加记录' }}</UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
