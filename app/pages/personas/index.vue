<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaDetails, PersonaDraftView, PersonaSummary } from '#shared/types/content'
import { getApiErrorMessage } from '../../utils/apiError'

const { data, error, refresh } = await useFetch<ApiResponse<PersonaSummary[]>>('/api/v1/personas')
const personas = computed(() => data.value?.data ?? [])
const usablePersonaCount = computed(() => personas.value.filter(persona => persona.activeVersionId).length)
const pendingPersonaCount = computed(() => personas.value.length - usablePersonaCount.value)
const independentPersonaCount = computed(() => personas.value.filter(persona => !persona.worldName).length)
const showCreate = shallowRef(false)
const createLoading = shallowRef(false)
const createErrorMessage = shallowRef<string | null>(null)

/** 人物来源模式中文标签。 */
const originLabels: Record<PersonaSummary['origin'], string> = {
  original: '原创',
  source_based: '资料型',
  hybrid: '混合型',
}

/**
 * 打开人物快速创建弹窗并清除上一次请求错误。
 * @returns 无返回值。
 */
function openCreateModal(): void {
  createErrorMessage.value = null
  showCreate.value = true
}

/**
 * 先把自然语言生成为原创人物草稿，再使用现有内容服务创建人物并进入详情。
 * @param prompt 用户在弹窗中确认的人物描述。
 * @returns 生成、创建和导航全部完成时结束。
 */
async function createPersona(prompt: string): Promise<void> {
  createLoading.value = true
  createErrorMessage.value = null
  try {
    const draft = await $fetch<ApiResponse<PersonaDraftView>>('/api/v1/personas/draft', {
      method: 'POST',
      body: { prompt, origin: 'original', worldId: null, sourceIds: [] },
    })
    const created = await $fetch<ApiResponse<PersonaDetails>>('/api/v1/personas', {
      method: 'POST',
      body: {
        name: draft.data.name,
        origin: 'original',
        worldId: null,
        sourceIds: [],
        snapshot: draft.data.snapshot,
        changeSummary: '根据自然语言生成初始人物灵魂草稿',
      },
    })
    await navigateTo(`/personas/${created.data.persona.id}`)
  }
  catch (requestError: unknown) {
    createErrorMessage.value = getApiErrorMessage(requestError, '人物创建失败')
  }
  finally {
    createLoading.value = false
  }
}
</script>

<template>
  <div>
    <ContentPageHeader title="人物工作区" description="查看每个人物当前是否可工作，以及其灵魂版本、所属世界、资料和待确认状态。">
      <ContentQuickCreateSubjectModal
        v-model:open="showCreate"
        subject-type="persona"
        :loading="createLoading"
        :error-message="createErrorMessage"
        @submit="createPersona"
      >
        <UButton icon="i-lucide-plus">创建人物</UButton>
      </ContentQuickCreateSubjectModal>
    </ContentPageHeader>

    <div class="status-strip page-status-strip" aria-label="人物状态摘要">
      <div class="status-cell"><span class="status-kicker">全部人物</span><strong class="status-value">{{ personas.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">可创建任务</span><strong class="status-value">{{ usablePersonaCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">待确认设定</span><strong class="status-value">{{ pendingPersonaCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">独立人物</span><strong class="status-value">{{ independentPersonaCount }}</strong></div>
    </div>

    <UAlert v-if="error" color="error" title="人物列表加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <section v-else-if="personas.length" class="content-section" aria-labelledby="persona-list-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">人物状态</p>
          <h2 id="persona-list-heading">可工作的人物与待确认事项</h2>
          <p>先处理待确认的人物设定，再开始会引用这些人物的新任务。</p>
        </div>
      </div>
      <div class="content-table-wrap">
        <table class="content-table">
          <thead><tr><th>人物</th><th>世界</th><th>版本与资料</th><th>当前状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="persona in personas" :key="persona.id">
              <td data-label="人物"><strong class="content-table-title">{{ persona.name }}</strong><span class="content-table-description">{{ persona.currentSummary || '还没有确认使用的人物设定' }}</span></td>
              <td data-label="世界"><span class="content-table-title">{{ persona.worldName || '独立人物' }}</span><span class="content-table-description">{{ originLabels[persona.origin] }}</span></td>
              <td data-label="版本与资料"><span>{{ persona.versionCount }} 条修改记录</span><span class="content-table-description">{{ persona.sourceCount }} 项参考资料</span></td>
              <td data-label="当前状态"><UBadge :color="persona.activeVersionId ? 'success' : 'warning'" variant="subtle">{{ persona.activeVersionId ? '可创建任务' : '等待确认设定' }}</UBadge></td>
              <td data-label="操作"><UButton :to="`/personas/${persona.id}`" color="neutral" variant="link">进入工作区</UButton></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <div v-else class="content-empty-state">
      <div>
        <strong>还没有人物</strong>
        <p class="mt-1 text-sm text-muted">原创人物不需要先导入资料。</p>
        <UButton class="mt-4" @click="openCreateModal">创建第一个人物</UButton>
      </div>
    </div>
  </div>
</template>
