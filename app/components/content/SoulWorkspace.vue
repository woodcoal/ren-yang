<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { reactive, watch } from 'vue'
import { saveSoulDraftSchema, type SaveSoulDraftInput } from '#shared/schemas/content'
import type { SoulSnapshot, SoulWorkspaceView } from '#shared/types/content'

/** 灵魂工作区属性。 */
interface Props {
  /** 世界或人物灵魂工作区数据。 */
  workspace: SoulWorkspaceView
  /** 页面动作是否正在执行。 */
  loading: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 保存当前可编辑草稿。 */
  save: [input: SaveSoulDraftInput]
  /** 发布当前草稿。 */
  publish: []
  /** 删除当前草稿。 */
  delete: []
  /** 从指定历史版本覆盖建立当前草稿。 */
  'from-version': [versionId: string]
}>()

/** 可编辑草稿状态；只保存用户正在修改的最小事实。 */
const draft = reactive<SaveSoulDraftInput>(createEditableDraft(props.workspace))

watch(() => props.workspace, (workspace) => {
  applyWorkspace(workspace)
}, { deep: true })

/**
 * 使用服务端最新工作区完整替换本地编辑值。
 * @param workspace 最新灵魂工作区。
 * @returns 无返回值。
 */
function applyWorkspace(workspace: SoulWorkspaceView): void {
  const value = createEditableDraft(workspace)
  draft.baseVersionId = value.baseVersionId
  draft.snapshot = cloneSnapshot(value.snapshot)
  draft.changeSummary = value.changeSummary
}

/**
 * 上送已通过共享 Schema 校验的草稿。
 * @param event Nuxt UI 表单提交事件。
 * @returns 无返回值。
 */
function handleSave(event: FormSubmitEvent<SaveSoulDraftInput>): void {
  emit('save', event.data)
}

/**
 * 把指定历史版本内容先复制到本地编辑区，不立即写入服务端。
 * @param versionId 历史灵魂版本 UUID。
 * @returns 无返回值。
 */
function previewVersion(versionId: string): void {
  const version = props.workspace.versions.find(item => item.id === versionId)
  if (!version) return
  draft.baseVersionId = version.id
  draft.snapshot = cloneSnapshot(version.snapshot)
  draft.changeSummary = `基于“${version.changeSummary}”继续修改`
}

/**
 * 格式化发布历史时间。
 * @param timestamp UTC Unix 毫秒。
 * @returns 本地中文时间。
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

/**
 * 根据服务端草稿、当前版本或空模板建立编辑状态。
 * @param workspace 灵魂工作区。
 * @returns 可独立修改的草稿输入。
 */
function createEditableDraft(workspace: SoulWorkspaceView): SaveSoulDraftInput {
  const source = workspace.draft ?? workspace.activeVersion
  const snapshot = source?.snapshot ?? createEmptySnapshot(workspace.subjectType)
  return {
    baseVersionId: workspace.draft?.baseVersionId ?? workspace.activeVersion?.id ?? null,
    snapshot: cloneSnapshot(snapshot),
    changeSummary: workspace.draft?.changeSummary ?? '',
  }
}

/**
 * 创建指定对象类型的最小灵魂模板。
 * @param subjectType 世界或人物。
 * @returns 含一个核心章节的空快照。
 */
function createEmptySnapshot(subjectType: 'world' | 'persona'): SoulSnapshot {
  return {
    chapters: [{
      id: crypto.randomUUID(),
      title: subjectType === 'world' ? '基本规则与背景' : '核心人设',
      content: '',
      order: 0,
      required: true,
    }],
    runtimeSummary: '',
  }
}

/**
 * 深复制灵魂快照，避免编辑属性对象。
 * @param snapshot 服务端或父组件快照。
 * @returns 独立快照。
 */
function cloneSnapshot(snapshot: SoulSnapshot): SoulSnapshot {
  return {
    chapters: snapshot.chapters.map(chapter => ({ ...chapter })),
    runtimeSummary: snapshot.runtimeSummary,
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="grid gap-6 xl:grid-cols-2">
      <UCard>
        <template #header>
          <div>
            <p class="text-xs font-medium uppercase tracking-wider text-muted">当前已发布</p>
            <h2 class="mt-1 font-semibold text-highlighted">新任务正在使用的灵魂</h2>
          </div>
        </template>
        <template v-if="workspace.activeVersion">
          <p class="whitespace-pre-wrap text-sm leading-6 text-muted">{{ workspace.activeVersion.snapshot.runtimeSummary }}</p>
          <div class="mt-4 flex flex-wrap gap-2 text-xs text-dimmed">
            <span>{{ workspace.activeVersion.snapshot.chapters.length }} 个完整章节</span>
            <span>·</span>
            <span>{{ workspace.activeVersion.runtimeTokenCount }} Token</span>
            <span>·</span>
            <span>{{ formatTime(workspace.activeVersion.publishedAt) }}</span>
          </div>
        </template>
        <UAlert v-else color="warning" title="还没有已发布灵魂" description="先完善右侧草稿并发布；未发布前不能创建这个对象的新任务。" />
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs font-medium uppercase tracking-wider text-muted">未发布修改稿</p>
              <h2 class="mt-1 font-semibold text-highlighted">发布前不会影响任何任务</h2>
            </div>
            <UBadge :color="workspace.draft ? 'warning' : 'neutral'" variant="subtle">{{ workspace.draft ? '有待确认修改' : '尚未保存修改' }}</UBadge>
          </div>
        </template>
        <p class="text-sm leading-6 text-muted">完整章节用于编辑和追溯，任务只读取你确认过的运行摘要。保存草稿与发布是两个独立动作。</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <UButton v-if="workspace.draft" :loading="loading" @click="emit('publish')">确认并发布</UButton>
          <UButton v-if="workspace.draft" color="error" variant="soft" :disabled="loading" @click="emit('delete')">删除修改稿</UButton>
        </div>
      </UCard>
    </div>

    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">编辑灵魂修改稿</h2>
          <p class="mt-1 text-sm text-muted">自由组织章节，再写一份受长度限制的运行摘要。</p>
        </div>
      </template>
      <UForm :schema="saveSoulDraftSchema" :state="draft" class="space-y-5" @submit="handleSave">
        <ContentSoulChapterEditor v-model="draft.snapshot" :subject-type="workspace.subjectType" :disabled="loading" />
        <UFormField name="changeSummary" label="这次改了什么" required>
          <UInput v-model="draft.changeSummary" class="w-full" :disabled="loading" placeholder="例如：补充冲突资料的处理顺序" />
        </UFormField>
        <UButton type="submit" :loading="loading">保存修改稿</UButton>
      </UForm>
    </UCard>

    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">已发布版本</h2>
          <p class="mt-1 text-sm text-muted">历史版本只读。需要恢复时，先复制成修改稿，检查后重新发布新版本。</p>
        </div>
      </template>
      <div v-if="workspace.versions.length" class="space-y-3">
        <article v-for="version in workspace.versions" :key="version.id" class="rounded-lg border border-default p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <UBadge :color="version.id === workspace.activeVersion?.id ? 'primary' : 'neutral'" variant="subtle">{{ version.id === workspace.activeVersion?.id ? '正在使用' : '历史版本' }}</UBadge>
                <span class="font-medium text-highlighted">{{ version.changeSummary }}</span>
              </div>
              <p class="mt-2 text-xs text-muted">{{ formatTime(version.publishedAt) }} · {{ version.runtimeTokenCount }} Token · {{ version.snapshot.chapters.length }} 个章节</p>
            </div>
            <div class="flex gap-2">
              <UButton color="neutral" variant="ghost" :disabled="loading" @click="previewVersion(version.id)">先在本地查看</UButton>
              <UButton color="neutral" variant="soft" :disabled="loading" @click="emit('from-version', version.id)">复制为修改稿</UButton>
            </div>
          </div>
        </article>
      </div>
      <p v-else class="text-sm text-muted">发布第一份灵魂后，这里会保留完整版本记录。</p>
    </UCard>
  </div>
</template>
