<template>
  <main class="min-h-screen bg-muted px-4 py-12 sm:py-20">
    <UContainer class="max-w-md">
      <div class="mb-6 flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-primary">
            人样
          </p>
          <p class="mt-1 text-sm text-muted">
            AI 人物模拟与图文创作工作台
          </p>
        </div>
        <UColorModeButton aria-label="切换颜色模式" />
      </div>
      <slot />
    </UContainer>
  </main>
</template>
