import { readBody } from 'h3'
import { useToast } from '#imports'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import OpenVikingSettingsForm from '../../app/components/system/OpenVikingSettingsForm.vue'
import SettingsPage from '../../app/pages/settings.vue'
import type { UpdateOpenVikingSettingsInput } from '../../shared/schemas/context'

/** 系统中心最后保存的 OpenViking 设置。 */
let savedSettings: UpdateOpenVikingSettingsInput | null = null
/** 系统中心执行 ADMIN 权限检测的次数。 */
let permissionCheckCount = 0

registerEndpoint('/api/v1/system/capabilities', () => ({ data: {
  textModel: { configured: true, provider: 'openai_compatible', model: 'text', endpointOrigin: 'https://model.test' },
  imageModel: { configured: false, provider: 'openai_compatible_images', model: null, endpointOrigin: null },
  openViking: { configured: false, enabled: false, provider: 'openviking', endpointOrigin: null },
  contextProvider: 'sqlite_fts5',
} }))
registerEndpoint('/api/v1/system/context/summary', () => ({ data: {
  capability: { configured: false, enabled: false, provider: 'openviking', endpointOrigin: null },
  failedCount: 0,
} }))
registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint('/api/v1/system/context/settings', () => ({ data: {
  enabled: false, endpoint: '', hasApiKey: false, timeoutMs: 60_000, updatedAt: null,
} }))
registerEndpoint('/api/v1/system/context/settings', {
  method: 'PUT',
  /** @param event Nuxt 测试服务器收到的设置请求。 @returns 脱敏保存结果。 */
  handler: async (event) => {
    savedSettings = await readBody<UpdateOpenVikingSettingsInput>(event)
    return { data: {
      enabled: savedSettings.enabled,
      endpoint: savedSettings.endpoint,
      hasApiKey: Boolean(savedSettings.apiKey),
      timeoutMs: savedSettings.timeoutMs,
      updatedAt: 8_000,
    } }
  },
})
registerEndpoint('/api/v1/system/providers/check', {
  method: 'POST',
  /** @returns 模拟 ADMIN Key 已通过 User 管理权限检测。 */
  handler: () => {
    permissionCheckCount += 1
    return { data: { healthy: true, version: '0.4.17', authMode: 'api_key' } }
  },
})

beforeEach(() => {
  savedSettings = null
  permissionCheckCount = 0
})

describe('OpenViking 后台设置', () => {
  it('表单提交完整新配置且已有密钥时留空不会要求覆盖', async () => {
    const wrapper = await mountSuspended(OpenVikingSettingsForm, {
      props: {
        settings: { enabled: false, endpoint: '', hasApiKey: false, timeoutMs: 60_000, updatedAt: null },
        loading: false,
      },
    })
    const inputs = wrapper.findAll('input')
    await inputs.find(input => input.attributes('type') !== 'password' && input.attributes('type') !== 'number' && input.attributes('type') !== 'checkbox')!.setValue('https://ov.test')
    await inputs.find(input => input.attributes('type') === 'password')!.setValue('admin-key')
    await inputs.find(input => input.attributes('type') === 'number')!.setValue('5000')
    await wrapper.get('[role="checkbox"]').trigger('click')
    await wrapper.get('form[data-openviking-settings-form]').trigger('submit')

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      enabled: true, endpoint: 'https://ov.test', apiKey: 'admin-key', timeoutMs: 5_000,
    })

    const existing = await mountSuspended(OpenVikingSettingsForm, {
      props: {
        settings: { enabled: true, endpoint: 'https://ov.test', hasApiKey: true, timeoutMs: 5_000, updatedAt: 1 },
        loading: false,
      },
    })
    await existing.get('form[data-openviking-settings-form]').trigger('submit')
    expect(existing.emitted('submit')?.[0]?.[0]).toEqual({
      enabled: true, endpoint: 'https://ov.test', timeoutMs: 5_000,
    })
  })

  it('系统中心保存启用设置后自动检测 ADMIN User 管理权限', async () => {
    const wrapper = await mountSuspended(SettingsPage, {
      route: '/settings',
      global: { stubs: { SystemBackupPanel: true, SystemCapabilityStatusPanel: true } },
    })
    await flushPromises()
    wrapper.vm.$nuxt.runWithContext(() => useToast().clear())
    const form = wrapper.get('form[data-openviking-settings-form]')
    const inputs = form.findAll('input')
    await inputs.find(input => input.attributes('type') !== 'password' && input.attributes('type') !== 'number' && input.attributes('type') !== 'checkbox')!.setValue('https://ov.test')
    await inputs.find(input => input.attributes('type') === 'password')!.setValue('admin-key')
    await inputs.find(input => input.attributes('type') === 'number')!.setValue('5000')
    await form.get('[role="checkbox"]').trigger('click')
    await form.trigger('submit')
    await flushPromises()
    await vi.waitFor(() => expect(permissionCheckCount).toBe(1))

    expect(savedSettings).toEqual({
      enabled: true, endpoint: 'https://ov.test', apiKey: 'admin-key', timeoutMs: 5_000,
    })
    await vi.waitFor(() => expect(wrapper.vm.$nuxt.runWithContext(() => useToast().toasts.value)
      .some(notification => notification.description?.toString().includes('ADMIN Key 具有 User 管理权限'))).toBe(true))
    expect(wrapper.text()).not.toContain('操作完成')

    wrapper.vm.$nuxt.runWithContext(() => useToast().clear())
    await wrapper.findAll('button').find(button => button.text() === '检测服务')!.trigger('click')
    await vi.waitFor(() => expect(permissionCheckCount).toBe(2))
    await vi.waitFor(() => expect(wrapper.vm.$nuxt.runWithContext(() => useToast().toasts.value)
      .some(notification => notification.title === 'OpenViking 检测通过')).toBe(true))
  })
})
