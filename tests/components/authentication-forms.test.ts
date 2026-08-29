import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import LoginForm from '../../app/components/authentication/LoginForm.vue'
import SetupForm from '../../app/components/authentication/SetupForm.vue'

describe('认证表单', () => {
  it('登录表单只在 Schema 校验通过后上送结构化输入', async () => {
    const wrapper = await mountSuspended(LoginForm, {
      props: { loading: false, errorMessage: null },
    })

    await wrapper.get('input[autocomplete="username"]').setValue('admin')
    await wrapper.get('input[autocomplete="current-password"]').setValue('correct-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('submit')).toEqual([[
      { username: 'admin', password: 'correct-password' },
    ]])
  })

  it('首次设置密码不一致时阻止提交并展示字段错误', async () => {
    const wrapper = await mountSuspended(SetupForm, {
      props: { loading: false, errorMessage: null },
    })

    await wrapper.get('input[autocomplete="username"]').setValue('admin')
    const passwordInputs = wrapper.findAll('input[autocomplete="new-password"]')
    await passwordInputs[0]!.setValue('correct-password')
    await passwordInputs[1]!.setValue('different-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('两次输入的密码不一致')
  })

  it('首次设置接受恰好 8 个字符的管理员密码', async () => {
    const wrapper = await mountSuspended(SetupForm, {
      props: { loading: false, errorMessage: null },
    })

    await wrapper.get('input[autocomplete="username"]').setValue('admin')
    const passwordInputs = wrapper.findAll('input[autocomplete="new-password"]')
    await passwordInputs[0]!.setValue('password')
    await passwordInputs[1]!.setValue('password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('submit')).toEqual([[
      { username: 'admin', password: 'password', passwordConfirmation: 'password' },
    ]])
  })

  it('服务端错误消息以警告角色展示', async () => {
    const wrapper = await mountSuspended(LoginForm, {
      props: { loading: false, errorMessage: '用户名或密码错误' },
    })

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toBe('用户名或密码错误')
  })
})
