<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, shallowRef } from 'vue'
import {
  createPersonaVersionSchema,
  type CreatePersonaVersionInput,
  updatePersonaSchema,
  type UpdatePersonaInput,
} from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type {
  DeletionImpact,
  PersonaDetails,
  PersonaSnapshot,
  VersionFieldDiff,
  WorldSummary,
} from '#shared/types/content'
import { getApiErrorMessage } from '../../utils/apiError'

const route = useRoute()
const personaId = String(route.params.id)
const [{ data, error, refresh }, { data: worldData }] = await Promise.all([
  useFetch<ApiResponse<PersonaDetails>>(`/api/v1/personas/${personaId}`),
  useFetch<ApiResponse<WorldSummary[]>>('/api/v1/worlds'),
])
const details = computed(() => data.value?.data ?? null)
const worlds = computed(() => worldData.value?.data ?? [])
const actionLoading = shallowRef(false)
const actionError = shallowRef<string | null>(null)
const actionMessage = shallowRef<string | null>(null)
const deletionImpact = shallowRef<DeletionImpact | null>(null)
const deletionConfirmed = shallowRef(false)
const differences = shallowRef<VersionFieldDiff[] | null>(null)

const initialPersona = data.value?.data.persona
const initialVersion = data.value?.data.versions.find(version => version.id === initialPersona?.activeVersionId)
  ?? data.value?.data.versions[0]
const metadata = reactive<UpdatePersonaInput>({
  name: initialPersona?.name ?? '',
  worldId: initialPersona?.worldId ?? null,
})
const candidate = reactive<CreatePersonaVersionInput>({
  baseVersionId: initialVersion?.id ?? null,
  snapshot: cloneSnapshot(initialVersion?.snapshot),
  changeSummary: '',
})
const comparison = reactive({
  base: initialVersion?.id ?? '',
  target: data.value?.data.versions[0]?.id ?? '',
})

/** 人物档案编辑字段。 */
const snapshotFields: Array<{ key: keyof PersonaSnapshot, label: string }> = [
  { key: 'summary', label: '人物定位' },
  { key: 'identityFacts', label: '身份事实' },
  { key: 'interests', label: '兴趣偏好' },
  { key: 'valuesAndMotivations', label: '价值与动机' },
  { key: 'expressionStyle', label: '表达风格' },
  { key: 'appearance', label: '外观描述' },
  { key: 'visualStyle', label: '视觉风格' },
  { key: 'constraints', label: '约束' },
]

/**
 * 修改人物名称和世界关联，不触碰版本内容。
 * @param event 已通过共享 Schema 校验的表单事件。
 * @returns 请求完成时结束。
 */
async function saveMetadata(event: FormSubmitEvent<UpdatePersonaInput>): Promise<void> {
  await runAction('人物元数据已保存', async () => {
    await $fetch(`/api/v1/personas/${personaId}`, { method: 'PATCH', body: event.data })
    await refresh()
  })
}

/**
 * 从用户明确选择的基础版本创建新候选版本。
 * @param event 已通过共享 Schema 校验的表单事件。
 * @returns 请求完成时结束。
 */
async function createCandidate(event: FormSubmitEvent<CreatePersonaVersionInput>): Promise<void> {
  await runAction('候选版本已创建，发布前不会影响当前人物', async () => {
    await $fetch(`/api/v1/personas/${personaId}/versions`, { method: 'POST', body: event.data })
    candidate.changeSummary = ''
    await refresh()
  })
}

/**
 * 发布指定候选版本并切换当前版本。
 * @param versionId 候选版本 UUID。
 * @returns 请求完成时结束。
 */
async function publishVersion(versionId: string): Promise<void> {
  await runAction('候选版本已发布', async () => {
    await $fetch(`/api/v1/persona-versions/${versionId}/publish`, { method: 'POST' })
    await refresh()
  })
}

/**
 * 把当前指针切回指定历史已发布版本。
 * @param versionId 已发布版本 UUID。
 * @returns 请求完成时结束。
 */
async function rollbackVersion(versionId: string): Promise<void> {
  await runAction('当前版本指针已回滚，后续版本仍完整保留', async () => {
    await $fetch(`/api/v1/personas/${personaId}/rollback`, { method: 'POST', body: { versionId } })
    await refresh()
  })
}

/**
 * 查询所选两版的字段级差异。
 * @returns 请求完成时结束。
 */
async function compareVersions(): Promise<void> {
  await runAction(null, async () => {
    const response = await $fetch<ApiResponse<VersionFieldDiff[]>>('/api/v1/persona-versions/compare', {
      query: comparison,
    })
    differences.value = response.data
  })
}

/**
 * 读取永久删除人物前的版本与共享资料影响。
 * @returns 请求完成时结束。
 */
async function inspectDeletion(): Promise<void> {
  await runAction(null, async () => {
    const response = await $fetch<ApiResponse<DeletionImpact>>(`/api/v1/personas/${personaId}/deletion-impact`)
    deletionImpact.value = response.data
    deletionConfirmed.value = false
  })
}

/**
 * 在用户查看影响并再次确认后永久删除人物。
 * @returns 请求和导航完成时结束。
 */
async function deletePersona(): Promise<void> {
  if (!deletionConfirmed.value) return
  await runAction(null, async () => {
    await $fetch(`/api/v1/personas/${personaId}`, { method: 'DELETE' })
    await navigateTo('/personas')
  })
}

/**
 * 统一执行页面写操作并呈现安全结果。
 * @param successMessage 成功后消息；null 表示不显示。
 * @param action 具体异步操作。
 * @returns 操作结束时完成。
 */
async function runAction(successMessage: string | null, action: () => Promise<void>): Promise<void> {
  actionLoading.value = true
  actionError.value = null
  actionMessage.value = null
  try {
    await action()
    actionMessage.value = successMessage
  }
  catch (requestError: unknown) {
    actionError.value = getApiErrorMessage(requestError, '操作失败')
  }
  finally {
    actionLoading.value = false
  }
}

/**
 * 深复制人物快照，避免编辑候选时修改接口返回对象。
 * @param snapshot 可选基础快照。
 * @returns 独立可编辑快照。
 */
function cloneSnapshot(snapshot?: PersonaSnapshot): PersonaSnapshot {
  return snapshot ? { ...snapshot } : {
    summary: '', identityFacts: '', interests: '', valuesAndMotivations: '',
    expressionStyle: '', appearance: '', visualStyle: '', constraints: '',
  }
}

/**
 * 格式化 UTC 毫秒时间供本地管理界面阅读。
 * @param timestamp UTC Unix 毫秒。
 * @returns 本地日期时间文本。
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <div>
    <ContentPageHeader
      :title="details?.persona.name || '人物详情'"
      description="已发布版本不可原地修改；新设定先保存为候选，再由你明确发布。"
    >
      <UButton to="/personas" color="neutral" variant="ghost">返回列表</UButton>
    </ContentPageHeader>

    <UAlert v-if="error || !details" color="error" title="人物详情加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <template v-else>
      <UAlert v-if="actionError" class="mb-5" color="error" title="操作失败" :description="actionError" />
      <UAlert v-if="actionMessage" class="mb-5" color="success" title="操作完成" :description="actionMessage" />

      <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="space-y-6">
          <UCard>
            <template #header><h2 class="font-semibold text-highlighted">元数据</h2></template>
            <UForm :schema="updatePersonaSchema" :state="metadata" class="grid gap-4 md:grid-cols-2" @submit="saveMetadata">
              <UFormField name="name" label="人物名称" required><UInput v-model="metadata.name" class="w-full" /></UFormField>
              <UFormField name="worldId" label="世界设定">
                <select v-model="metadata.worldId" class="native-control">
                  <option :value="null">不关联世界</option>
                  <option v-for="world in worlds" :key="world.id" :value="world.id">{{ world.name }}</option>
                </select>
              </UFormField>
              <div class="md:col-span-2"><UButton type="submit" :loading="actionLoading">保存元数据</UButton></div>
            </UForm>
          </UCard>

          <UCard>
            <template #header>
              <div><h2 class="font-semibold text-highlighted">版本时间线</h2><p class="mt-1 text-sm text-muted">当前指针：{{ details.persona.activeVersionId || '尚未发布' }}</p></div>
            </template>
            <div class="space-y-4">
              <div v-for="version in details.versions" :key="version.id" class="rounded-md border border-default p-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div class="flex items-center gap-2">
                      <UBadge :color="version.status === 'published' ? 'success' : 'warning'" variant="subtle">{{ version.status === 'published' ? '已发布' : '候选' }}</UBadge>
                      <UBadge v-if="version.id === details.persona.activeVersionId" color="primary">当前</UBadge>
                    </div>
                    <p class="mt-2 font-medium text-highlighted">{{ version.changeSummary }}</p>
                    <p class="mt-1 text-xs text-muted">{{ formatTime(version.createdAt) }} · {{ version.id }}</p>
                  </div>
                  <div class="flex gap-2">
                    <UButton v-if="version.status === 'candidate'" size="sm" :loading="actionLoading" @click="publishVersion(version.id)">发布</UButton>
                    <UButton v-else-if="version.id !== details.persona.activeVersionId" size="sm" color="neutral" variant="soft" :loading="actionLoading" @click="rollbackVersion(version.id)">回滚到此版</UButton>
                  </div>
                </div>
                <p class="mt-3 whitespace-pre-wrap text-sm text-muted">{{ version.snapshot.summary }}</p>
              </div>
            </div>
          </UCard>

          <UCard>
            <template #header><h2 class="font-semibold text-highlighted">创建候选版本</h2></template>
            <UForm :schema="createPersonaVersionSchema" :state="candidate" class="space-y-5" @submit="createCandidate">
              <UFormField name="baseVersionId" label="基础版本" required>
                <select v-model="candidate.baseVersionId" class="native-control">
                  <option v-for="version in details.versions.filter(item => item.status !== 'rejected')" :key="version.id" :value="version.id">{{ version.changeSummary }}（{{ version.status === 'published' ? '已发布' : '候选' }}）</option>
                </select>
              </UFormField>
              <div class="grid gap-4 md:grid-cols-2">
                <UFormField v-for="field in snapshotFields" :key="field.key" :name="`snapshot.${field.key}`" :label="field.label" :class="field.key === 'summary' || field.key === 'constraints' ? 'md:col-span-2' : ''">
                  <UTextarea v-model="candidate.snapshot[field.key]" class="w-full" autoresize />
                </UFormField>
              </div>
              <UFormField name="changeSummary" label="变化摘要" required><UInput v-model="candidate.changeSummary" class="w-full" /></UFormField>
              <UButton type="submit" :loading="actionLoading">保存候选版本</UButton>
            </UForm>
          </UCard>

          <UCard>
            <template #header><h2 class="font-semibold text-highlighted">版本差异</h2></template>
            <div class="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <select v-model="comparison.base" class="native-control" aria-label="基础版本">
                <option v-for="version in details.versions" :key="version.id" :value="version.id">{{ version.changeSummary }}</option>
              </select>
              <select v-model="comparison.target" class="native-control" aria-label="目标版本">
                <option v-for="version in details.versions" :key="version.id" :value="version.id">{{ version.changeSummary }}</option>
              </select>
              <UButton color="neutral" variant="soft" :loading="actionLoading" @click="compareVersions">比较</UButton>
            </div>
            <ContentPersonaVersionDiff v-if="differences" class="mt-5" :differences="differences" />
          </UCard>
        </div>

        <div class="space-y-6">
          <UCard>
            <template #header><h2 class="font-semibold text-highlighted">关联资料</h2></template>
            <div v-if="details.sources.length" class="space-y-2">
              <UButton v-for="source in details.sources" :key="source.id" :to="`/sources/${source.id}`" color="neutral" variant="soft" block class="justify-start">{{ source.name }}</UButton>
            </div>
            <p v-else class="text-sm text-muted">未关联资料。可在资料详情中建立关联。</p>
          </UCard>

          <UCard>
            <template #header><h2 class="font-semibold text-error">永久删除</h2></template>
            <UButton v-if="!deletionImpact" color="error" variant="soft" :loading="actionLoading" @click="inspectDeletion">查看删除影响</UButton>
            <div v-else class="space-y-3 text-sm">
              <p>将删除 {{ deletionImpact.versionCount }} 个版本、{{ deletionImpact.runHistory.runs }} 次运行、{{ deletionImpact.runHistory.tasks }} 个任务、{{ deletionImpact.runHistory.evidenceSnapshots }} 个证据快照、{{ deletionImpact.runHistory.documentSpecs }} 个规格修订、{{ deletionImpact.runHistory.artifactBlocks }} 个产物块及 {{ deletionImpact.runHistory.blockAttempts }} 次块尝试，并解除 {{ deletionImpact.relatedSources.length }} 项资料关系。共享资料和世界不会删除。</p>
              <label class="flex items-start gap-2"><input v-model="deletionConfirmed" type="checkbox" class="mt-1"><span>我确认永久删除此人物，恢复只能依赖事先备份。</span></label>
              <UButton color="error" :disabled="!deletionConfirmed" :loading="actionLoading" @click="deletePersona">永久删除人物</UButton>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </div>
</template>
