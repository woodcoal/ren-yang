<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { CreateInterestBatchInput } from '#shared/schemas/generation'
import type { PersonaSummary } from '#shared/types/content'

const props = defineProps<{
  /** 当前可以执行新兴趣判断的已启用人物。 */
  personas: PersonaSummary[]
  /** 批量兴趣判定算法是否已经完整配置。 */
  configured: boolean
  /** 父页面是否正在创建批次。 */
  loading?: boolean
}>()

const emit = defineEmits<{
  /** 用户提交同一人物、顺序文本和整批附加提示词。 */
  submit: [input: CreateInterestBatchInput]
}>()

/** 单条待判断文本的本地编辑状态。 */
interface InterestTextDraft {
  /** 仅用于 Vue 列表稳定渲染的本地编号。 */
  key: number
  /** 用户输入的完整待判断文本。 */
  text: string
}

const form = reactive({
  personaId: '',
  additionalPrompt: '',
  items: [{ key: 1, text: '' }] as InterestTextDraft[],
})
let nextDraftKey = 2
const canSubmit = computed(() => props.configured
  && !props.loading
  && Boolean(form.personaId)
  && form.items.length >= 1
  && form.items.length <= 20
  && form.items.every(item => Boolean(item.text.trim())))

/**
 * 在批次末尾增加一条独立文本输入。
 * @returns 达到二十条上限时不修改状态，否则加入一个空白输入。
 */
function addItem(): void {
  if (form.items.length >= 20) return
  form.items.push({ key: nextDraftKey, text: '' })
  nextDraftKey += 1
}

/**
 * 删除指定位置的待判断文本。
 * @param index 当前可见顺序中的零基位置。
 * @returns 批次只剩一条时不删除，否则移除目标输入。
 */
function removeItem(index: number): void {
  if (form.items.length <= 1) return
  form.items.splice(index, 1)
}

/**
 * 规范化全部文本并按当前顺序生成批次内稳定编号。
 * @returns 输入不完整时不发出事件，否则提交共享批量契约。
 */
function submit(): void {
  if (!canSubmit.value) return
  emit('submit', {
    personaId: form.personaId,
    additionalPrompt: form.additionalPrompt.trim(),
    items: form.items.map((item, index) => ({ itemId: `item-${index + 1}`, text: item.text.trim() })),
  })
}
</script>

<template>
  <form class="space-y-6" @submit.prevent="submit">
    <section class="workflow-panel" aria-labelledby="interest-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">批量兴趣判断</p>
          <h2 id="interest-heading">选择人物并添加待判断文本</h2>
          <p>同一人物的多条文本只发起一次主模型调用，每条结果独立保存。</p>
        </div>
      </div>

      <div class="space-y-5">
        <UFormField label="人物" required>
          <select v-model="form.personaId" class="native-control" aria-label="使用的人物" required>
            <option value="" disabled>请选择人物</option>
            <option v-for="persona in personas" :key="persona.id" :value="persona.id">{{ persona.name }}</option>
          </select>
        </UFormField>

        <UFormField label="附加提示词" description="可选；对本批次全部文本生效，不会修改人物长期设定。">
          <UTextarea
            v-model="form.additionalPrompt"
            class="w-full"
            :rows="3"
            :maxlength="4000"
            aria-label="附加提示词"
            placeholder="例如：只判断长期兴趣，不考虑短期热点"
          />
        </UFormField>

        <div class="space-y-4">
          <article v-for="(item, index) in form.items" :key="item.key" class="rounded-lg border border-default p-4">
            <div class="mb-3 flex items-center justify-between gap-3">
              <p class="font-medium text-highlighted">待判断文本 {{ index + 1 }}</p>
              <UButton
                v-if="form.items.length > 1"
                type="button"
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-trash-2"
                :aria-label="`删除待判断文本 ${index + 1}`"
                @click="removeItem(index)"
              />
            </div>
            <UTextarea
              v-model="item.text"
              class="w-full"
              :rows="5"
              :maxlength="50000"
              :aria-label="`待判断文本 ${index + 1}`"
              required
              placeholder="输入一条需要人物判断是否感兴趣的完整文本"
            />
          </article>
        </div>

        <UButton
          type="button"
          color="neutral"
          variant="soft"
          icon="i-lucide-plus"
          aria-label="添加待判断文本"
          :disabled="form.items.length >= 20"
          @click="addItem"
        >
          添加一条
        </UButton>
      </div>
    </section>

    <div class="sticky-action-bar">
      <p class="text-sm text-muted">最多 20 条；输出顺序与输入顺序一致，单条失败不影响其他结果。</p>
      <UButton type="submit" size="lg" :disabled="!canSubmit" :loading="loading">开始判断</UButton>
    </div>
  </form>
</template>
