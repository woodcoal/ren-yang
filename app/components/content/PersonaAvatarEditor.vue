<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, nextTick, reactive, shallowRef, useTemplateRef } from 'vue'
import { generatePersonaAvatarSchema, type GeneratePersonaAvatarInput } from '#shared/schemas/content'
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
  /** 模型发生二次裁剪时保留的原图地址；未裁剪时为 null。 */
  avatarOriginalUrl?: string | null
}

/** 人物头像编辑器事件。 */
interface Emits {
  /** 上传或生成成功后通知页面刷新人物摘要。 */
  updated: []
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const { runWithAiLoading } = useAiLoading()
const { notifySuccess, notifyError } = useOperationNotifications()
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const activeAction = shallowRef<'upload' | 'generate' | null>(null)
const avatarRevision = shallowRef(0)
const customGenerationOpen = shallowRef(false)
/** 自定义生成弹窗的唯一表单状态；生成失败时保留输入以便修改后重试。 */
const customGenerationState = reactive<GeneratePersonaAvatarInput>({ additionalPrompt: '' })
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
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    notifyError('仅支持 PNG、JPEG 或 WebP 图片', '头像文件无效')
    input.value = ''
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    notifyError('上传头像不能超过 2 MB', '头像文件过大')
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
    notifySuccess('新头像已保存。', '头像上传完成')
  }
  catch (error: unknown) {
    notifyError(getApiErrorMessage(error, '头像上传失败'), '头像上传失败')
  }
  finally {
    activeAction.value = null
    input.value = ''
  }
}

/**
 * 请求图片模型根据人物当前灵魂和可选视觉要求生成并替换头像。
 * @param input 已通过共享 Schema 校验的可选视觉要求。
 * @returns 生成、公开事件和等待状态恢复完成时结束。
 */
async function generateAvatar(input: GeneratePersonaAvatarInput): Promise<void> {
  activeAction.value = 'generate'
  try {
    await runWithAiLoading({
      title: 'AI 正在生成人物头像',
      description: `图片模型正在根据“${props.personaName}”的名称与当前灵魂提示词生成 1:1 头像。`,
      completionHint: '完成后新头像会自动替换当前头像。',
    }, async () => await $fetch<ApiResponse<PersonaSummary>>(`/api/v1/personas/${props.personaId}/avatar/generate`, {
      method: 'POST',
      body: input,
    }))
    avatarRevision.value += 1
    emit('updated')
    customGenerationState.additionalPrompt = ''
    notifySuccess('新头像已生成并保存。', '头像生成完成')
  }
  catch (error: unknown) {
    notifyError(getApiErrorMessage(error, '头像生成失败'), '头像生成失败')
  }
  finally {
    activeAction.value = null
  }
}

/**
 * 使用人物名称与当前灵魂直接生成头像，不附加自定义视觉要求。
 * @returns 生成请求和界面状态更新完成时结束。
 */
async function generateDefaultAvatar(): Promise<void> {
  await generateAvatar({ additionalPrompt: '' })
}

/**
 * 打开自定义头像生成弹窗并初始化本次补充提示词。
 * @returns 无返回值。
 */
function openCustomGeneration(): void {
  customGenerationOpen.value = true
}

/**
 * 提交已经由 Nuxt UI 和共享 Schema 校验的自定义视觉要求。
 * @param event 包含去除首尾空白后补充提示词的表单提交事件。
 * @returns 生成请求和弹窗状态更新完成时结束。
 */
async function submitCustomGeneration(event: FormSubmitEvent<GeneratePersonaAvatarInput>): Promise<void> {
  // 先卸载自定义模态层，避免它覆盖随后打开的全局 AI 加载层。
  customGenerationOpen.value = false
  await nextTick()
  await generateAvatar(event.data)
}
</script>

<template>
  <UCard>
    <div class="persona-avatar-editor">
      <ContentPersonaAvatar :name="props.personaName" :url="displayedAvatarUrl" size="large" />
      <div class="persona-avatar-copy">
        <h2 class="font-semibold text-highlighted">人物头像</h2>
        <p class="mt-1 text-sm text-muted">上传现有图片，或根据人物当前名称和灵魂提示词生成头像；系统校验图片类型和大小后按原始尺寸保存。</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <input ref="fileInput" data-persona-avatar-input class="sr-only" type="file"
            accept="image/png,image/jpeg,image/webp" @change="uploadAvatar">
          <UButton color="neutral" variant="soft" icon="i-lucide-upload" :loading="activeAction === 'upload'"
            :disabled="activeAction !== null" @click="chooseAvatarFile">上传头像</UButton>
          <UButton icon="i-lucide-sparkles" :loading="activeAction === 'generate'" :disabled="activeAction !== null"
            @click="generateDefaultAvatar">生成头像</UButton>
          <UButton color="neutral" variant="soft" icon="i-lucide-wand-sparkles" :disabled="activeAction !== null"
            @click="openCustomGeneration">自定义生成</UButton>
          <UButton v-if="props.avatarOriginalUrl" :to="props.avatarOriginalUrl" external color="neutral" variant="ghost"
            :aria-label="`查看${props.personaName}头像的裁剪前原图`">查看原图</UButton>
        </div>
        <p class="mt-3 text-xs text-muted">支持 PNG、JPEG、WebP，上传文件最大 2 MB；上传图片按原始尺寸保存，算法触发尺寸裁剪时可查看原图。</p>
      </div>
    </div>
  </UCard>

  <UModal v-model:open="customGenerationOpen" title="自定义生成头像" description="人物名称和当前灵魂会自动加入提示词；这里只需补充画风、服饰、姿态或背景等视觉要求。"
    :dismissible="activeAction === null" :close="activeAction === null">
    <template #body>
      <UForm :schema="generatePersonaAvatarSchema" :state="customGenerationState" class="space-y-4"
        data-custom-avatar-form @submit="submitCustomGeneration">
        <UFormField name="additionalPrompt" label="补充提示词" hint="最多 2000 字">
          <UTextarea v-model="customGenerationState.additionalPrompt" class="w-full" :rows="6" autoresize :maxrows="12"
            maxlength="2000" placeholder="例如：水彩插画风格，暖色逆光，深蓝色大衣，神情沉静，背景为模糊的旧档案馆。" :disabled="activeAction !== null" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="ghost" :disabled="activeAction !== null"
            @click="customGenerationOpen = false">取消</UButton>
          <UButton type="submit" icon="i-lucide-sparkles" :loading="activeAction === 'generate'">生成头像</UButton>
        </div>
      </UForm>
    </template>
  </UModal>
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
