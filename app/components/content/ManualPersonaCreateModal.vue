<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, watch } from 'vue'
import { createPersonaSchema, type CreatePersonaInput } from '#shared/schemas/content'
import type { SourceSummary, WorldSummary } from '#shared/types/content'

/** 手动创建人物弹窗属性。 */
interface Props {
  /** 可选世界列表。 */
  worlds: WorldSummary[]
  /** 可选参考资料列表。 */
  sources: SourceSummary[]
  /** 创建请求是否正在执行。 */
  loading: boolean
  /** 最近一次创建失败的安全消息。 */
  errorMessage: string | null
}

const props = defineProps<Props>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  /** 用户确认后提交完整的手动人物创建输入。 */
  submit: [input: CreatePersonaInput]
}>()

/** 手动创建人物的唯一表单状态。 */
const state = reactive<CreatePersonaInput>({
  name: '',
  worldId: null,
  sourceIds: [],
  snapshot: { promptText: '' },
  changeSummary: '手动创建初始人物灵魂',
})

/** 只有启用且已有当前灵魂的世界才能成为人物归属。 */
const availableWorlds = computed(() => props.worlds.filter(world => world.isEnabled && world.activeVersionId))
/** 只有启用资料才能在创建时直接关联。 */
const availableSources = computed(() => props.sources.filter(source => source.isEnabled).map(source => ({
  label: `${source.name} · ${sourceRoleLabel(source.role)}`,
  value: source.id,
})))

/**
 * 把资料业务角色转换为创建弹窗中的通俗名称。
 * @param role 资料的稳定角色编码。
 * @returns 用户可识别的中文名称。
 */
function sourceRoleLabel(role: SourceSummary['role']): string {
  return ({ canon_fact: '原著事实', reference: '普通参考', style_sample: '表达样例' })[role]
}

/**
 * 清空上一次已经关闭的手动创建表单。
 * @returns 无返回值。
 */
function resetState(): void {
  state.name = ''
  state.worldId = null
  state.sourceIds = []
  state.snapshot.promptText = ''
  state.changeSummary = '手动创建初始人物灵魂'
}

/**
 * 把 Nuxt UI 已校验的手动创建输入交给人物列表页。
 * @param event 已通过共享 Schema 校验的表单提交事件。
 * @returns 无返回值。
 */
function handleSubmit(event: FormSubmitEvent<CreatePersonaInput>): void {
  emit('submit', event.data)
}

watch(open, (isOpen, wasOpen) => {
  if (isOpen && wasOpen === false) resetState()
})
</script>

<template>
  <UModal
    v-model:open="open"
    title="手动创建人物"
    description="直接保存你输入的默认灵魂提示词，不调用 AI 分析。"
    :dismissible="!loading"
    :close="!loading"
  >
    <slot />
    <template #body>
      <UForm :schema="createPersonaSchema" :state="state" class="space-y-5" data-manual-persona-create @submit="handleSubmit">
        <UFormField name="name" label="人物名称" required>
          <UInput v-model="state.name" class="w-full" placeholder="例如：林默" :disabled="loading" />
        </UFormField>
        <UFormField name="snapshot.promptText" label="默认灵魂提示词" description="将按原文直接发布为初始当前灵魂。" required>
          <UTextarea
            v-model="state.snapshot.promptText"
            class="w-full"
            :rows="10"
            :maxrows="18"
            autoresize
            placeholder="输入可直接用于新任务的完整人物灵魂提示词。"
            :disabled="loading"
          />
        </UFormField>
        <div class="grid gap-5 md:grid-cols-2">
          <UFormField name="worldId" label="所属世界（可选）">
            <select v-model="state.worldId" class="native-control" :disabled="loading">
              <option :value="null">独立人物</option>
              <option v-for="world in availableWorlds" :key="world.id" :value="world.id">{{ world.name }}</option>
            </select>
          </UFormField>
          <UFormField name="sourceIds" label="参考资料（可选）" description="只建立关联，不会分析或改写灵魂。">
            <UInputMenu
              v-model="state.sourceIds"
              class="w-full"
              :items="availableSources"
              value-key="value"
              label-key="label"
              multiple
              placeholder="搜索并选择资料"
              :disabled="loading || availableSources.length === 0"
            >
              <template #empty="{ searchTerm }">
                {{ searchTerm ? `没有找到“${searchTerm}”` : '暂无可用资料' }}
              </template>
            </UInputMenu>
          </UFormField>
        </div>
        <UAlert color="neutral" variant="subtle" title="不使用 AI" description="创建后立即启用；人物名称和灵魂提示词均按当前输入保存。" />
        <UAlert v-if="errorMessage" color="error" title="创建失败" :description="errorMessage" />
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="ghost" :disabled="loading" @click="open = false">取消</UButton>
          <UButton type="submit" icon="i-lucide-save" :loading="loading">手动创建并发布</UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
