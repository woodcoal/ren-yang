<script setup lang="ts">
/** 工作区内部可切换模块。 */
export interface WorkspaceModuleItem {
  /** 模块稳定标识。 */
  id: string
  /** 模块显示名称。 */
  label: string
  /** 模块用途说明。 */
  description: string
}

/** 工作区二级模块导航属性。 */
interface Props {
  /** 按业务顺序展示的模块。 */
  items: WorkspaceModuleItem[]
  /** 辅助技术读取的导航名称。 */
  ariaLabel: string
}

defineProps<Props>()
const selectedModule = defineModel<string>({ required: true })
</script>

<template>
  <nav class="mb-6 rounded-lg border border-default bg-elevated/40 p-2" :aria-label="ariaLabel">
    <div class="grid gap-2 sm:grid-cols-2 lg:flex">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="min-w-0 rounded-md px-4 py-3 text-left transition-colors lg:flex-1"
        :class="selectedModule === item.id ? 'bg-default text-highlighted shadow-sm' : 'text-muted hover:bg-muted/50 hover:text-highlighted'"
        :aria-label="item.label"
        :aria-current="selectedModule === item.id ? 'page' : undefined"
        @click="selectedModule = item.id"
      >
        <span class="block text-sm font-semibold">{{ item.label }}</span>
        <span class="mt-1 block text-xs leading-5">{{ item.description }}</span>
      </button>
    </div>
  </nav>
</template>
