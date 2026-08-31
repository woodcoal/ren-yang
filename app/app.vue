<script setup lang="ts">
import { computed } from 'vue'
import { getPageDocumentTitle } from './utils/navigation'

const route = useRoute()
/** 当前路由对应的简洁页面标题。 */
const documentTitle = computed(() => getPageDocumentTitle(route.path))

/**
 * 把页面名称与应用名称组合成浏览器标签标题。
 * @param title 当前页面名称；页面未提供名称时为空。
 * @returns 完整浏览器标题。
 */
function formatDocumentTitle(title?: string | null): string {
  return title ? `${title} - 人样` : '人样'
}

useHead({ title: documentTitle, titleTemplate: formatDocumentTitle })
</script>

<template>
  <UApp>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <AiLoadingOverlay />
  </UApp>
</template>
