<script setup lang="ts">
/** 全局遮罩只消费只读任务状态，所有生命周期统一由 useAiLoading 管理。 */
const { isLoading, currentTask } = useAiLoading()
</script>

<template>
  <UModal
    :open="isLoading"
    :title="currentTask.title"
    :description="currentTask.description"
    fullscreen
    :close="false"
    :dismissible="false"
    :ui="{
      overlay: 'bg-default/70 backdrop-blur-md',
      content: 'bg-transparent shadow-none ring-0',
    }"
  >
    <template #content>
      <div
        data-ai-loading-overlay
        class="flex min-h-dvh items-center justify-center px-6 py-12 text-center"
        role="status"
        aria-live="assertive"
        aria-busy="true"
      >
        <UCard class="w-full max-w-lg border border-primary/20 bg-default/95 shadow-2xl">
          <div class="flex flex-col items-center px-2 py-5">
            <div data-ai-loading-animation class="relative mb-6 flex size-24 items-center justify-center" aria-hidden="true">
              <span class="absolute inset-1 animate-ping rounded-full bg-primary/10 motion-reduce:animate-none" />
              <UIcon name="i-lucide-loader-circle" class="absolute size-20 animate-spin text-primary motion-reduce:animate-none" />
              <span class="relative flex size-12 items-center justify-center rounded-full bg-primary/10 shadow-lg shadow-primary/15">
                <UIcon name="i-lucide-sparkles" class="size-6 animate-pulse text-primary motion-reduce:animate-none" />
              </span>
            </div>
            <h2 class="text-xl font-semibold text-highlighted">{{ currentTask.title }}</h2>
            <p class="mt-3 text-sm leading-6 text-muted">{{ currentTask.description }}</p>
            <UProgress class="mt-6 w-full" animation="carousel" size="sm" aria-label="AI 任务处理进度" />
            <p class="mt-5 text-sm leading-6 text-muted">{{ currentTask.completionHint }}</p>
            <p class="mt-1 text-xs text-dimmed">请勿刷新页面或重复提交</p>
          </div>
        </UCard>
      </div>
    </template>
  </UModal>
</template>
