<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaSummary } from '#shared/types/content'
import { getApiErrorMessage } from '../../utils/apiError'

/** 人物头像编辑器属性。 */
interface Props {
  /** 人物 UUID。 */
  personaId: string
  /** 人物名称，用于无头像时的首字占位和替代文本。 */
  personaName: string
  /** 已保存头像的读取地址；未设置时为 null。 */
  avatarUrl: string | null
}

/** 人物头像编辑器事件。 */
interface Emits {
  /** 上传或生成成功后通知页面刷新人物摘要。 */
  updated: []
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const activeAction = shallowRef<'upload' | 'generate' | null>(null)
const errorMessage = shallowRef<string | null>(null)
const avatarRevision = shallowRef(0)
/** 浏览器可直接显示且在替换后强制刷新的头像地址。 */
const displayedAvatarUrl = computed(() => props.avatarUrl
  ? `${props.avatarUrl}?v=${avatarRevision.value}`
  : null)

/**
 * 打开系统文件选择器。
 * @returns 文件选择器打开时结束。
 */
function chooseAvatarFile(): void {
  fileInput.value?.click()
}

/**
 * 校验并上传用户刚选择的单张头像。
 * @param event 文件输入框 change 事件。
 * @returns 上传、公开事件和输入框复位完成时结束。
 */
async function uploadAvatar(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  errorMessage.value = null
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    errorMessage.value = '仅支持 PNG、JPEG 或 WebP 图片'
    input.value = ''
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    errorMessage.value = '上传头像不能超过 2 MB'
    input.value = ''
    return
  }

  activeAction.value = 'upload'
  try {
    const body = new FormData()
    body.set('file', file)
    await $fetch<ApiResponse<PersonaSummary>>(`/api/v1/personas/${props.personaId}/avatar`, {
      method: 'PUT',
      body,
    })
    avatarRevision.value += 1
    emit('updated')
  }
  catch (error: unknown) {
    errorMessage.value = getApiErrorMessage(error, '头像上传失败')
  }
  finally {
    activeAction.value = null
    input.value = ''
  }
}

/**
 * 请求图片模型根据人物当前灵魂生成并替换头像。
 * @returns 生成、公开事件和等待状态恢复完成时结束。
 */
async function generateAvatar(): Promise<void> {
  activeAction.value = 'generate'
  errorMessage.value = null
  try {
    await $fetch<ApiResponse<PersonaSummary>>(`/api/v1/personas/${props.personaId}/avatar/generate`, {
      method: 'POST',
    })
    avatarRevision.value += 1
    emit('updated')
  }
  catch (error: unknown) {
    errorMessage.value = getApiErrorMessage(error, '头像生成失败')
  }
  finally {
    activeAction.value = null
  }
}
</script>

<template>
  <UCard>
    <div class="persona-avatar-editor">
      <ContentPersonaAvatar :name="props.personaName" :url="displayedAvatarUrl" size="large" />
      <div class="persona-avatar-copy">
        <h2 class="font-semibold text-highlighted">人物头像</h2>
        <p class="mt-1 text-sm text-muted">上传现有图片，或根据人物当前名称和灵魂提示词生成 1:1 头像。</p>
        <UAlert v-if="errorMessage" class="mt-3" color="error" title="头像更新失败" :description="errorMessage" />
        <div class="mt-4 flex flex-wrap gap-2">
          <input
            ref="fileInput"
            data-persona-avatar-input
            class="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            @change="uploadAvatar"
          >
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-upload"
            :loading="activeAction === 'upload'"
            :disabled="activeAction !== null"
            @click="chooseAvatarFile"
          >上传头像</UButton>
          <UButton
            icon="i-lucide-sparkles"
            :loading="activeAction === 'generate'"
            :disabled="activeAction !== null"
            @click="generateAvatar"
          >生成头像</UButton>
        </div>
        <p class="mt-3 text-xs text-muted">支持 PNG、JPEG、WebP，上传文件最大 2 MB。</p>
      </div>
    </div>
  </UCard>
</template>

<style scoped>
.persona-avatar-editor {
  display: flex;
  align-items: center;
  gap: 1.25rem;
}

.persona-avatar-copy {
  min-width: 0;
}

@media (max-width: 40rem) {
  .persona-avatar-editor {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
