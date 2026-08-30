<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { reactive, watch } from 'vue'
import { personaCredentialSchema, type PersonaCredentialInput } from '#shared/schemas/content'
import type { PersonaCredentialSecretView, PersonaCredentialSummary } from '#shared/types/content'

const props = defineProps<{
  /** 当前人物账号信息的脱敏状态。 */
  credential: PersonaCredentialSummary
  /** 用户主动查看后暂存在页面中的密码和账号信息。 */
  revealed: PersonaCredentialSecretView | null
  /** 页面级动作是否正在执行。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 主动请求服务端解密当前密码。 */
  reveal: []
  /** 立即清除当前页面中的密码原文。 */
  conceal: []
  /** 提交三项分别可选的账号信息。 */
  save: [input: PersonaCredentialInput]
}>()

/** 账号信息编辑状态；未主动查看时绝不持有数据库中的密码原文。 */
const state = reactive<PersonaCredentialInput>({
  username: props.credential.username ?? '',
  email: props.credential.email ?? '',
  password: '',
})

/**
 * 提交共享 Schema 已校验的可选账号信息。
 * @param event Nuxt UI 表单提交事件。
 * @returns 事件发出时结束。
 */
function handleSubmit(event: FormSubmitEvent<PersonaCredentialInput>): void {
  emit('save', event.data)
}

watch(() => props.credential, (credential) => {
  state.username = credential.username ?? ''
  state.email = credential.email ?? ''
}, { deep: true })

watch(() => props.revealed, (credential) => {
  state.password = credential?.password ?? ''
})
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <h2 class="font-semibold text-highlighted">账号信息</h2>
        <p class="mt-1 text-sm text-muted">账号、密码和邮箱均可选填；账号和邮箱在所有人物中不可重复。</p>
      </div>
    </template>

    <UForm :schema="personaCredentialSchema" :state="state" class="grid gap-4 md:grid-cols-2" data-persona-credential-form @submit="handleSubmit">
      <UFormField name="username" label="账号">
        <UInput v-model="state.username" class="w-full" autocomplete="off" :disabled="loading" />
      </UFormField>
      <UFormField name="email" label="邮箱">
        <UInput v-model="state.email" class="w-full" type="email" autocomplete="off" :disabled="loading" />
      </UFormField>
      <UFormField name="password" label="密码" description="留空会保留已保存密码；主动查看后才会显示原文。" class="md:col-span-2">
        <div class="flex gap-2">
          <UInput v-model="state.password" class="min-w-0 flex-1" :type="revealed ? 'text' : 'password'" autocomplete="new-password" :disabled="loading" />
          <UButton
            v-if="credential.passwordConfigured && !revealed"
            type="button"
            color="neutral"
            variant="soft"
            :loading="loading"
            data-persona-credential-reveal
            @click="emit('reveal')"
          >查看已保存密码</UButton>
          <UButton
            v-else-if="revealed"
            type="button"
            color="neutral"
            variant="soft"
            :disabled="loading"
            @click="emit('conceal')"
          >隐藏密码</UButton>
        </div>
      </UFormField>
      <div class="md:col-span-2">
        <UButton type="submit" :loading="loading">保存账号信息</UButton>
      </div>
    </UForm>
  </UCard>
</template>
