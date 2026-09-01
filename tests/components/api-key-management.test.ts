import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { CalendarDate } from '@internationalized/date'
import { beforeEach, describe, expect, it } from 'vitest'
import ApiKeyCreateForm from '../../app/components/apiKey/ApiKeyCreateForm.vue'
import ApiKeyManager from '../../app/components/apiKey/ApiKeyManager.vue'
import type { ApiKeyView } from '../../shared/types/publicApi'

const ACTIVE_KEY: ApiKeyView = {
  id: '00000000-0000-4000-8000-000000000301',
  name: '资料同步',
  prefix: 'ry_v2_abcdef',
  scopes: ['library:read', 'library:write', 'generation:read', 'generation:write'],
  status: 'active',
  createdAt: Date.parse('2026-09-01T08:00:00.000Z'),
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
}

let keys: ApiKeyView[] = [ACTIVE_KEY]

beforeEach(() => {
  keys = [ACTIVE_KEY]
})

registerEndpoint('/api/v1/api-keys', {
  method: 'GET',
  handler: () => ({ data: keys }),
})
registerEndpoint('/api/v1/api-keys', {
  method: 'POST',
  handler: async () => ({
    data: {
      key: { ...ACTIVE_KEY, id: '00000000-0000-4000-8000-000000000302', name: '新脚本' },
      secret: 'ry_v2_once_only_secret',
    },
  }),
})
registerEndpoint('/api/v1/api-keys/00000000-0000-4000-8000-000000000301/revoke', {
  method: 'POST',
  handler: () => {
    const revoked: ApiKeyView = { ...ACTIVE_KEY, status: 'revoked', revokedAt: Date.parse('2026-09-01T09:00:00.000Z') }
    keys = [revoked]
    return { data: revoked }
  },
})
registerEndpoint('/api/v1/api-keys/00000000-0000-4000-8000-000000000301', {
  method: 'DELETE',
  handler: () => {
    keys = []
    return null
  },
})

describe('API Key 管理界面', () => {
  it('展示用途、前缀、权限、使用状态且不展示摘要', async () => {
    keys = [ACTIVE_KEY]
    const wrapper = await mountSuspended(ApiKeyManager)

    expect(wrapper.text()).toContain('资料同步')
    expect(wrapper.text()).toContain('ry_v2_abcdef')
    expect(wrapper.text()).toContain('资料读取')
    expect(wrapper.text()).toContain('资料写入')
    expect(wrapper.text()).toContain('兴趣与图文结果读取')
    expect(wrapper.text()).toContain('兴趣与图文创建及操作')
    expect(wrapper.text()).toContain('尚未使用')
    expect(wrapper.text()).not.toContain('keyDigest')
  })

  it('默认只显示 Key 列表并通过弹窗打开创建表单', async () => {
    const wrapper = await mountSuspended(ApiKeyManager)

    expect(wrapper.findComponent({ name: 'ApiKeyCreateForm' }).exists()).toBe(false)
    await wrapper.findAll('button').find(button => button.text() === '创建 API Key')!.trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ApiKeyCreateForm' }).exists()).toBe(true)
    expect(document.body.textContent).toContain('按调用方实际用途授予最少权限')
    wrapper.unmount()
    document.body.innerHTML = ''
  })

  it('权限中文名和稳定标识分两行展示', async () => {
    const wrapper = await mountSuspended(ApiKeyCreateForm, { props: { loading: false } })
    const option = wrapper.get('[data-api-key-scope="generation:write"]')

    expect(option.get('[data-scope-label]').text()).toBe('兴趣与图文创建及操作')
    expect(option.get('[data-scope-code]').text()).toBe('generation:write')
    expect(option.get('[data-scope-label]').element.parentElement).toBe(option.get('[data-scope-code]').element.parentElement)
  })

  it('到期日期与时间分两行，并使用 Nuxt UI 日历和时分下拉转换为 UTC', async () => {
    const wrapper = await mountSuspended(ApiKeyCreateForm, { props: { loading: false } })
    const date = new CalendarDate(2026, 9, 30)

    expect(wrapper.find('input[type="datetime-local"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'UInputDate' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'UInputTime' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'CommonDatePicker' }).exists()).toBe(true)
    expect(wrapper.get('[data-expiration-fields]').classes()).toContain('space-y-4')
    const timeSelectors = wrapper.get('[data-expiration-time]').findAllComponents({ name: 'USelect' })
    expect(timeSelectors).toHaveLength(2)
    wrapper.findComponent({ name: 'CommonDatePicker' }).vm.$emit('update:modelValue', date)
    timeSelectors[0]!.vm.$emit('update:modelValue', '18')
    timeSelectors[1]!.vm.$emit('update:modelValue', '30')
    await wrapper.get('input[type="text"]').setValue('定时脚本')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')).toEqual([[
      {
        name: '定时脚本', scopes: ['persona:read'],
        expiresAt: new Date(2026, 8, 30, 18, 30).toISOString(),
      },
    ]])
  })

  it('创建后只在当前页面状态展示一次完整明文，关闭后无法恢复', async () => {
    const wrapper = await mountSuspended(ApiKeyManager)
    await wrapper.findAll('button').find(button => button.text() === '创建 API Key')!.trigger('click')
    await flushPromises()
    const form = wrapper.findComponent({ name: 'ApiKeyCreateForm' })

    form.vm.$emit('submit', { name: '新脚本', scopes: ['persona:read'], expiresAt: null })
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('ry_v2_once_only_secret')
    wrapper.findComponent({ name: 'ApiKeyCreatedSecret' }).vm.$emit('dismiss')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('ry_v2_once_only_secret')
  })

  it('明确确认后吊销 Key 并刷新状态', async () => {
    keys = [ACTIVE_KEY]
    const wrapper = await mountSuspended(ApiKeyManager)
    const list = wrapper.findComponent({ name: 'ApiKeyList' })

    list.vm.$emit('revoke', ACTIVE_KEY.id)
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('已吊销')
  })

  it('已吊销 Key 可确认后永久删除，有效 Key 不显示删除入口', async () => {
    keys = [ACTIVE_KEY]
    const wrapper = await mountSuspended(ApiKeyManager)
    expect(wrapper.findAll('button').some(button => button.text() === '删除')).toBe(false)

    wrapper.findComponent({ name: 'ApiKeyList' }).vm.$emit('revoke', ACTIVE_KEY.id)
    await flushPromises()
    await flushPromises()
    const deleteButton = wrapper.findAll('button').find(button => button.text() === '删除')
    expect(deleteButton).toBeDefined()
    await deleteButton!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '确认删除')!.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('尚未创建 API Key')
  })
})
