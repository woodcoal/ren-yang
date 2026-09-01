<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import { computed, reactive, shallowRef } from 'vue'
import type { ApiKeyScope, CreateApiKeyInput } from '#shared/schemas/publicApi'

defineProps<{
  /** 创建请求是否正在执行。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 提交已在浏览器完成最小格式整理的创建输入。 */
  submit: [input: CreateApiKeyInput]
}>()

/** 可授权范围及面向管理员的解释。 */
const scopeOptions: Array<{ value: ApiKeyScope, label: string }> = [
  { value: 'persona:read', label: '人物读取' },
  { value: 'persona:write', label: '人物写入' },
  { value: 'world:read', label: '世界读取' },
  { value: 'world:write', label: '世界写入' },
  { value: 'library:read', label: '资料读取' },
  { value: 'library:write', label: '资料写入' },
  { value: 'generation:read', label: '兴趣与图文结果读取' },
  { value: 'generation:write', label: '兴趣与图文创建及操作' },
]

const form = reactive<{
  name: string
  scopes: ApiKeyScope[]
}>({
  name: '',
  scopes: [],
})
const expiresOn = shallowRef<DateValue | undefined>()
const expiresAtHour = shallowRef('')
const expiresAtMinute = shallowRef('')
const hourOptions = Array.from({ length: 24 }, (_, hour) => ({
  label: `${String(hour).padStart(2, '0')} 时`, value: String(hour),
}))
const minuteOptions = Array.from({ length: 60 }, (_, minute) => ({
  label: `${String(minute).padStart(2, '0')} 分`, value: String(minute),
}))
const expirationComplete = computed(() => {
  const hasDate = expiresOn.value !== undefined
  const hasHour = expiresAtHour.value !== ''
  const hasMinute = expiresAtMinute.value !== ''
  return (!hasDate && !hasHour && !hasMinute) || (hasDate && hasHour && hasMinute)
})
const canSubmit = computed(() => form.name.trim().length > 0 && form.scopes.length > 0 && expirationComplete.value)

/**
 * 切换单一权限范围。
 * @param scope 被切换的稳定权限值。
 * @param checked 复选框当前状态。
 * @returns 无返回值。
 */
function toggleScope(scope: ApiKeyScope, checked: boolean): void {
  form.scopes = checked
    ? [...new Set([...form.scopes, scope])]
    : form.scopes.filter(item => item !== scope)
}

/**
 * 同时清空到期小时和分钟选择。
 * @returns 无返回值；日期保留，表单会要求重新选择完整时间。
 */
function clearExpirationTime(): void {
  expiresAtHour.value = ''
  expiresAtMinute.value = ''
}

/**
 * 在满足最小表单条件后提交 API Key 创建输入。
 * @returns 无返回值；无效表单不发出事件。
 * @remarks 浏览器本地时间会在边界处转换为带时区的 ISO 8601 UTC 时间。
 */
function submit(): void {
  if (!canSubmit.value) return
  const expiresAt = expiresOn.value && expiresAtHour.value !== '' && expiresAtMinute.value !== ''
    ? new Date(
        expiresOn.value.year,
        expiresOn.value.month - 1,
        expiresOn.value.day,
        Number(expiresAtHour.value),
        Number(expiresAtMinute.value),
      ).toISOString()
    : null
  emit('submit', {
    name: form.name.trim(),
    scopes: [...form.scopes],
    expiresAt,
  })
}
</script>

<template>
  <form class="space-y-5" @submit.prevent="submit">
      <p class="text-sm text-muted">按调用方实际用途授予最少权限；完整 Key 只展示一次。</p>
      <UFormField label="名称" required>
        <UInput v-model="form.name" class="w-full" maxlength="100" placeholder="例如：夜间资料同步" />
      </UFormField>
      <fieldset>
        <legend class="mb-2 text-sm font-medium text-highlighted">权限范围</legend>
        <div class="grid gap-2 sm:grid-cols-2">
          <label
            v-for="option in scopeOptions"
            :key="option.value"
            class="flex items-start gap-3 rounded-lg border border-default px-3 py-2 text-sm"
            :data-api-key-scope="option.value"
          >
            <input
              class="mt-1"
              type="checkbox"
              :checked="form.scopes.includes(option.value)"
              @change="toggleScope(option.value, ($event.target as HTMLInputElement).checked)"
            >
            <span class="min-w-0">
              <span class="block text-highlighted" data-scope-label>{{ option.label }}</span>
              <code class="mt-1 block break-all text-xs text-muted" data-scope-code>{{ option.value }}</code>
            </span>
          </label>
        </div>
      </fieldset>
      <div class="space-y-4" data-expiration-fields>
        <UFormField label="到期日期" hint="可选；日期和时间需同时填写">
          <CommonDatePicker v-model="expiresOn" label="到期日期" />
        </UFormField>
        <UFormField label="到期时间" hint="浏览器本地时区">
          <div class="flex flex-wrap gap-2" data-expiration-time>
            <USelect v-model="expiresAtHour" class="min-w-32 flex-1" :items="hourOptions" placeholder="选择小时" />
            <USelect v-model="expiresAtMinute" class="min-w-32 flex-1" :items="minuteOptions" placeholder="选择分钟" />
            <UButton
              v-if="expiresAtHour !== '' || expiresAtMinute !== ''"
              type="button"
              color="neutral"
              variant="ghost"
              @click="clearExpirationTime"
            >清空时间</UButton>
          </div>
        </UFormField>
      </div>
      <UButton type="submit" :loading="loading" :disabled="!canSubmit" icon="i-lucide-key-round">创建 Key</UButton>
  </form>
</template>
