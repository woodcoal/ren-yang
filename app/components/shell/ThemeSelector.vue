<script setup lang="ts">
import { onMounted, shallowRef } from 'vue'

/** 后台支持的视觉主题。 */
type AppTheme = 'mist' | 'sand' | 'ocean' | 'sage'

/** 主题选项使用可见文字表达含义，色点只提供视觉辅助。 */
const themeOptions: Array<{ label: string, value: AppTheme }> = [
  { label: '雾白', value: 'mist' },
  { label: '暖砂', value: 'sand' },
  { label: '海盐', value: 'ocean' },
  { label: '松岚', value: 'sage' },
]
const selectedTheme = shallowRef<AppTheme>('mist')
const themeStorageKey = 'renyang-theme'

/**
 * 将主题写入根节点和本机偏好。
 * @param theme 用户选择的主题标识。
 * @returns 无返回值。
 */
function applyTheme(theme: AppTheme): void {
  selectedTheme.value = theme
  document.documentElement.dataset.theme = theme
  window.localStorage.setItem(themeStorageKey, theme)
}

/**
 * 从本机恢复有效主题；未知值回退到默认雾白主题。
 * @returns 无返回值。
 */
function restoreTheme(): void {
  const storedTheme = window.localStorage.getItem(themeStorageKey)
  const theme = themeOptions.some(option => option.value === storedTheme) ? storedTheme as AppTheme : 'mist'
  applyTheme(theme)
}

onMounted(restoreTheme)
</script>

<template>
  <label class="theme-control">
    <span class="theme-swatch" :data-theme-swatch="selectedTheme" aria-hidden="true" />
    <span class="visually-hidden">界面主题</span>
    <select
      :value="selectedTheme"
      class="theme-select"
      aria-label="界面主题"
      @change="applyTheme(($event.target as HTMLSelectElement).value as AppTheme)"
    >
      <option v-for="option in themeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
  </label>
</template>
