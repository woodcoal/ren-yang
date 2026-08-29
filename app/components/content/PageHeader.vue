<script setup lang="ts">
import { computed } from 'vue'
import { getPageRouteContext } from '../../utils/navigation'

/** 页面标题属性。 */
interface Props {
  /** 页面主标题。 */
  title: string
  /** 页面职责说明。 */
  description: string
}

const props = defineProps<Props>()
const route = useRoute()

/** 当前页面所属导航分组。 */
const routeContext = computed(() => getPageRouteContext(route.path))
</script>

<template>
  <div class="page-heading">
    <nav class="page-breadcrumbs" aria-label="面包屑">
      <span>{{ routeContext.section }}</span>
      <UIcon name="i-lucide-chevron-right" aria-hidden="true" />
      <strong>{{ props.title }}</strong>
    </nav>
    <header class="page-heading-header">
      <div class="page-heading-copy">
        <h1 class="page-title">
          {{ title }}
        </h1>
        <p class="page-description">{{ description }}</p>
      </div>
      <div v-if="$slots.default" class="page-actions">
        <slot />
      </div>
    </header>
  </div>
</template>
