<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import { computed, shallowRef } from 'vue'

const props = withDefaults(defineProps<{
  /** 当前选择的无时区日期。 */
  modelValue: DateValue | undefined
  /** 未选择日期时显示的提示。 */
  placeholder?: string
  /** 是否禁止打开、选择和清空日期。 */
  disabled?: boolean
  /** 日期按钮的业务名称。 */
  label: string
}>(), {
  placeholder: '选择日期',
  disabled: false,
})

const emit = defineEmits<{
  /** 用户选择或清空日期时同步无时区日期值。 */
  'update:modelValue': [value: DateValue | undefined]
}>()

const open = shallowRef(false)
const displayValue = computed(() => props.modelValue
  ? `${props.modelValue.year}年${props.modelValue.month}月${props.modelValue.day}日`
  : props.placeholder)

/**
 * 接收 Nuxt UI 日历选择并关闭弹层。
 * @param value 日历当前选中的未知值；单日期模式下只接受 DateValue。
 * @returns 无返回值；同步模型值并关闭日期弹层。
 */
function selectDate(value: unknown): void {
  if (value !== undefined && !isDateValue(value)) return
  emit('update:modelValue', value)
  open.value = false
}

/**
 * 判断 Nuxt UI 日历事件是否为单一无时区日期。
 * @param value 日历组件返回的未知选择值。
 * @returns 同时包含整数年月日时返回 true。
 */
function isDateValue(value: unknown): value is DateValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return Number.isInteger(candidate.year) && Number.isInteger(candidate.month) && Number.isInteger(candidate.day)
}

/**
 * 清空当前日期且不打开日历。
 * @returns 无返回值；向上层同步空日期。
 */
function clearDate(): void {
  emit('update:modelValue', undefined)
}
</script>

<template>
  <div class="flex w-full gap-2" data-nuxt-date-picker>
    <UPopover v-model:open="open">
      <UButton
        type="button"
        class="min-w-0 flex-1 justify-start"
        color="neutral"
        variant="outline"
        icon="i-lucide-calendar-days"
        :disabled="disabled"
        :aria-label="label"
      >{{ displayValue }}</UButton>
      <template #content>
        <UCalendar
          :model-value="modelValue"
          locale="zh-CN"
          :disabled="disabled"
          @update:model-value="selectDate"
        />
      </template>
    </UPopover>
    <UButton
      v-if="modelValue"
      type="button"
      color="neutral"
      variant="ghost"
      icon="i-lucide-x"
      :disabled="disabled"
      :aria-label="`清空${label}`"
      @click="clearDate"
    />
  </div>
</template>
