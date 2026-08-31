<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { PublicTaskQueueStatus, SystemCapabilitiesResult } from '#shared/types/system'
import { appNavigationGroups, getPageRouteContext, isNavigationItemActive } from '../../utils/navigation'

/** 应用侧栏的只读属性。 */
interface Props {
  /** 桌面侧栏是否处于折叠状态。 */
  collapsed: boolean
  /** 移动侧栏是否已经打开。 */
  mobileOpen: boolean
  /** 当前管理员名称。 */
  username: string
  /** 后台任务队列摘要；首次加载时可以为空。 */
  taskQueue: PublicTaskQueueStatus | null
  /** 系统能力摘要；首次加载时可以为空。 */
  capabilities: SystemCapabilitiesResult | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 用户选择导航项后通知布局关闭移动抽屉。 */
  navigate: []
}>()

const route = useRoute()
/** 每个导航分组是否展开；首次只展开当前页面所属分组。 */
const expandedGroups = reactive<Record<string, boolean>>(
  Object.fromEntries(appNavigationGroups.map(group => [group.label, false])),
)

watch(
  () => getPageRouteContext(route.path).section,
  (section) => { expandedGroups[section] = true },
  { immediate: true },
)

/** 当前检索方式的通俗名称。 */
const retrievalLabel = computed(() => props.capabilities?.contextProvider === 'openviking'
  ? 'OpenViking 检索'
  : '本地资料检索')

/** 文本模型与检索能力是否可以支持新任务。 */
const systemReady = computed(() => Boolean(props.capabilities?.textModel.configured))

/**
 * 切换指定导航分组的展开状态。
 * @param label 导航分组名称。
 * @returns 无返回值。
 */
function toggleNavigationGroup(label: string): void {
  expandedGroups[label] = !expandedGroups[label]
}
</script>

<template>
  <aside
    class="app-sidebar"
    :class="{ 'app-sidebar--collapsed': collapsed, 'app-sidebar--open': mobileOpen }"
    aria-label="应用导航"
  >
    <NuxtLink to="/" class="sidebar-brand" aria-label="人样人物工作室首页" @click="emit('navigate')">
      <BrandMark />
    </NuxtLink>

    <nav class="sidebar-navigation" aria-label="主导航">
      <section v-for="(group, groupIndex) in appNavigationGroups" :key="group.label" class="sidebar-navigation-group">
        <h2 class="sidebar-navigation-heading">
          <button
            class="sidebar-navigation-title"
            type="button"
            :aria-expanded="expandedGroups[group.label]"
            :aria-controls="`sidebar-navigation-group-${groupIndex}`"
            @click="toggleNavigationGroup(group.label)"
          >
            <span>{{ group.label }}</span>
            <UIcon name="i-lucide-chevron-down" class="sidebar-navigation-title-icon" aria-hidden="true" />
          </button>
        </h2>
        <div
          :id="`sidebar-navigation-group-${groupIndex}`"
          class="sidebar-navigation-items"
          :class="{ 'sidebar-navigation-items--expanded': expandedGroups[group.label] }"
        >
          <NuxtLink
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            class="sidebar-navigation-item"
            :aria-current="isNavigationItemActive(route.path, item.to) ? 'page' : undefined"
            :title="collapsed ? item.label : undefined"
            @click="emit('navigate')"
          >
            <UIcon :name="item.icon" class="sidebar-navigation-icon" aria-hidden="true" />
            <span class="sidebar-navigation-copy">{{ item.label }}</span>
            <span v-if="item.to === '/history' && taskQueue?.total" class="sidebar-navigation-count">
              {{ taskQueue.total }}
            </span>
          </NuxtLink>
        </div>
      </section>
    </nav>

    <footer class="sidebar-footer">
      <div class="sidebar-system-status">
        <span class="sidebar-signal" :class="{ 'sidebar-signal--warning': !systemReady }" aria-hidden="true" />
        <span class="sidebar-footer-copy">
          <strong>{{ systemReady ? '创作能力可用' : '文本模型未配置' }}</strong>
          <span>{{ retrievalLabel }}</span>
        </span>
      </div>
      <NuxtLink to="/settings" class="sidebar-admin" @click="emit('navigate')">
        <UIcon name="i-lucide-user-round" class="sidebar-navigation-icon" aria-hidden="true" />
        <span class="sidebar-footer-copy">
          <strong>{{ username || '管理员' }}</strong>
          <span>系统与账户</span>
        </span>
      </NuxtLink>
    </footer>
  </aside>
</template>
