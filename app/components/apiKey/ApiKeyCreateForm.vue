<script setup lang="ts">
import { computed, reactive } from 'vue'
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
  { value: 'generation:read', label: '图文运行读取' },
  { value: 'generation:write', label: '图文运行创建与操作' },
]

const form = reactive<{ name: string, scopes: ApiKeyScope[], expiresAt: string }>({
  name: '',
  scopes: [],
  expiresAt: '',
})
const canSubmit = computed(() => form.name.trim().length > 0 && form.scopes.length > 0)

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
 * 在满足最小表单条件后提交 API Key 创建输入。
 * @returns 无返回值；无效表单不发出事件。
 * @remarks 浏览器本地时间会在边界处转换为带时区的 ISO 8601 UTC 时间。
 */
function submit(): void {
  if (!canSubmit.value) return
  emit('submit', {
    name: form.name.trim(),
    scopes: [...form.scopes],
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
  })
}
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <h2 class="font-semibold text-highlighted">创建 API Key</h2>
        <p class="mt-1 text-sm text-muted">按调用方实际用途授予最少权限；完整 Key 只展示一次。</p>
      </div>
    </template>
    <form class="space-y-5" @submit.prevent="submit">
      <UFormField label="名称" required>
        <UInput v-model="form.name" class="w-full" maxlength="100" placeholder="例如：夜间资料同步" />
      </UFormField>
      <fieldset>
        <legend class="mb-2 text-sm font-medium text-highlighted">权限范围</legend>
        <div class="grid gap-2 sm:grid-cols-2">
          <label v-for="option in scopeOptions" :key="option.value" class="flex items-center gap-2 rounded-lg border border-default px-3 py-2 text-sm">
            <input
              type="checkbox"
              :checked="form.scopes.includes(option.value)"
              @change="toggleScope(option.value, ($event.target as HTMLInputElement).checked)"
            >
            <span>{{ option.label }}</span>
            <code class="ml-auto text-xs text-muted">{{ option.value }}</code>
          </label>
        </div>
      </fieldset>
      <UFormField label="到期时间" hint="可选；按浏览器本地时区输入">
        <UInput v-model="form.expiresAt" class="w-full" type="datetime-local" />
      </UFormField>
      <UButton type="submit" :loading="loading" :disabled="!canSubmit" icon="i-lucide-key-round">创建 Key</UButton>
    </form>
  </UCard>
</template>
