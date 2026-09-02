<script setup lang="ts">
import { reactive, shallowRef } from 'vue'
import { updateOpenVikingSettingsSchema, type UpdateOpenVikingSettingsInput } from '#shared/schemas/context'
import type { OpenVikingSettingsView } from '#shared/types/context'

const props = defineProps<{
  /** 当前数据库中的脱敏设置。 */
  settings: OpenVikingSettingsView
  /** 保存或检测是否正在执行。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 共享 Schema 校验通过后请求父页面保存。 */
  submit: [input: UpdateOpenVikingSettingsInput]
}>()

const form = reactive({
  enabled: props.settings.enabled,
  endpoint: props.settings.endpoint,
  accountId: props.settings.accountId,
  apiKey: '',
  timeoutMs: props.settings.timeoutMs,
})
const validationError = shallowRef<string | null>(null)

/** @returns 校验非敏感字段并在 ADMIN Key 留空时省略该字段。 */
function submit(): void {
  validationError.value = null
  const candidate = {
    enabled: form.enabled,
    endpoint: form.endpoint,
    accountId: form.accountId,
    timeoutMs: form.timeoutMs,
    ...(form.apiKey.trim() ? { apiKey: form.apiKey } : {}),
  }
  const parsed = updateOpenVikingSettingsSchema.safeParse(candidate)
  if (!parsed.success) {
    validationError.value = parsed.error.issues[0]?.message ?? 'OpenViking 设置无效'
    return
  }
  emit('submit', parsed.data)
}
</script>

<template>
  <form class="mt-5 grid gap-4" data-openviking-settings-form @submit.prevent="submit">
    <UAlert v-if="validationError" color="error" title="设置无效" :description="validationError" />
    <UFormField label="服务地址" description="填写 OpenViking HTTP 服务根地址。" required>
      <UInput v-model="form.endpoint" class="w-full" name="endpoint" placeholder="http://127.0.0.1:20000" />
    </UFormField>
    <UFormField label="Account ID" description="ADMIN Key 必须属于该 Account，切换后会从 SQLite 重建投影。" required>
      <UInput v-model="form.accountId" class="w-full" name="account-id" placeholder="ren-yang" />
    </UFormField>
    <UFormField
      label="ADMIN Key"
      :description="settings.hasApiKey ? '密钥已加密保存；留空保留当前值。' : '必须是所填 Account 下可管理 User 的 ADMIN Key。'"
      :required="!settings.hasApiKey"
    >
      <UInput v-model="form.apiKey" class="w-full" type="password" autocomplete="new-password" />
    </UFormField>
    <UFormField label="请求超时（毫秒）" description="适用于检测、检索、同步和重建请求。" required>
      <UInput v-model.number="form.timeoutMs" class="w-full" type="number" min="1000" max="300000" />
    </UFormField>
    <UCheckbox v-model="form.enabled" label="启用 OpenViking 上下文增强和异步同步" />
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-xs text-muted">保存启用设置后会立即检测服务及 ADMIN User 管理权限。</span>
      <UButton type="submit" :loading="loading">保存 OpenViking 设置</UButton>
    </div>
  </form>
</template>
