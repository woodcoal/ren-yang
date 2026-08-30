<script setup lang="ts">
import { computed } from 'vue'

/** 安全文本高亮组件属性。 */
interface Props {
  /** 原样展示的可信或非可信文本。 */
  text: string
  /** 需要按字面量高亮的搜索词。 */
  query: string
}

/** 文本高亮后的单个安全片段。 */
interface HighlightSegment {
  /** 由 Vue 按纯文本转义输出的内容。 */
  text: string
  /** 当前片段是否命中搜索词。 */
  highlighted: boolean
}

const props = defineProps<Props>()

/** 高亮渲染使用的顺序文本片段。 */
const segments = computed(() => splitHighlightedText(props.text, props.query))

/**
 * 把正则特殊字符转换为只能按字面量匹配的形式。
 * @param value 用户输入的搜索词。
 * @returns 可安全拼入正则表达式的字面量文本。
 */
function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 按搜索词拆分文本并标记全部命中片段，不生成任何 HTML 字符串。
 * @param text 需要展示的完整文本。
 * @param query 用户搜索词。
 * @returns 保持原文顺序的普通与高亮片段。
 */
function splitHighlightedText(text: string, query: string): HighlightSegment[] {
  const keyword = query.trim()
  if (!keyword) return [{ text, highlighted: false }]
  const pattern = new RegExp(`(${escapeRegularExpression(keyword)})`, 'gi')
  return text.split(pattern)
    .filter(segment => segment.length > 0)
    .map(segment => ({
      text: segment,
      highlighted: segment.toLocaleLowerCase('zh-CN') === keyword.toLocaleLowerCase('zh-CN'),
    }))
}
</script>

<template>
  <template v-for="(segment, index) in segments" :key="`${index}:${segment.text}`">
    <mark v-if="segment.highlighted" class="rounded bg-warning/25 px-0.5 text-highlighted">{{ segment.text }}</mark>
    <template v-else>{{ segment.text }}</template>
  </template>
</template>
