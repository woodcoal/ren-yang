<script setup lang="ts">
import { computed } from 'vue'

/** 人物头像展示属性。 */
interface Props {
  /** 人物名称，用于替代文本和无图片占位。 */
  name: string
  /** 头像读取地址；未设置时为 null。 */
  url: string | null
  /** 头像在列表、页首或编辑区使用的尺寸。 */
  size?: 'small' | 'header' | 'large'
}

const props = withDefaults(defineProps<Props>(), { size: 'small' })
/** 无头像时显示的人物名称首字符。 */
const fallbackInitial = computed(() => Array.from(props.name.trim())[0] ?? '人')
/** 根据使用位置确定头像尺寸，页首尺寸保持标题层级紧凑。 */
const sizeClass = computed(() => ({
  small: 'persona-avatar-small',
  header: 'persona-avatar-header',
  large: 'persona-avatar-large',
})[props.size])
</script>

<template>
  <img
    v-if="props.url"
    class="persona-avatar-image"
    :class="sizeClass"
    :src="props.url"
    :alt="`${props.name}的头像`"
  >
  <div v-else class="persona-avatar-fallback" :class="sizeClass" aria-hidden="true">{{ fallbackInitial }}</div>
</template>

<style scoped>
.persona-avatar-image,
.persona-avatar-fallback {
  flex: none;
  border-radius: 1rem;
}

.persona-avatar-image {
  object-fit: cover;
}

.persona-avatar-fallback {
  display: grid;
  place-items: center;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  font-weight: 700;
}

.persona-avatar-small {
  width: 2.75rem;
  height: 2.75rem;
  font-size: 1.125rem;
}

.persona-avatar-header {
  width: 4.5rem;
  height: 4.5rem;
  border-radius: 1.125rem;
  font-size: 1.75rem;
}

.persona-avatar-large {
  width: 8rem;
  height: 8rem;
  border-radius: 1.5rem;
  font-size: 2.5rem;
}

@media (max-width: 40rem) {
  .persona-avatar-header {
    width: 3.75rem;
    height: 3.75rem;
    border-radius: 1rem;
    font-size: 1.5rem;
  }
}
</style>
