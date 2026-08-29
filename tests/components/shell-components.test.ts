import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import BrandMark from '../../app/components/brand/BrandMark.vue'
import ThemeSelector from '../../app/components/shell/ThemeSelector.vue'

describe('后台品牌与主题组件', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('品牌标志同时提供正式名称、副标题和可缩放矢量图形', async () => {
    const wrapper = await mountSuspended(BrandMark)

    expect(wrapper.text()).toContain('人样')
    expect(wrapper.text()).toContain('让它有个人样')
    expect(wrapper.find('svg[viewBox="0 0 24 24"]').exists()).toBe(true)
  })

  it('主题选择使用可见名称并把偏好同步到根节点和本机存储', async () => {
    const wrapper = await mountSuspended(ThemeSelector)
    const select = wrapper.get('select[aria-label="界面主题"]')

    expect(select.findAll('option').map(option => option.text())).toEqual(['雾白', '暖砂', '海盐', '松岚'])
    await select.setValue('ocean')

    expect(document.documentElement.dataset.theme).toBe('ocean')
    expect(window.localStorage.getItem('renyang-theme')).toBe('ocean')
  })
})
