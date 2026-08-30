import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import SourceSearchPage from '../../app/pages/sources/search.vue'

const sourceId = '00000000-0000-4000-8000-000000000091'

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint('/api/v1/sources/search', () => ({
  data: [{
    id: '00000000-0000-4000-8000-000000000092',
    sourceId,
    sourceName: '北港航行规则',
    ordinal: 0,
    heading: '风帆船靠岸',
    content: '北港只允许登记过的风帆船靠岸，其他风帆船需要等待审核。',
    contentHash: 'a'.repeat(64),
  }],
}))

describe('资料段落独立搜索页', () => {
  it('展示所属资料并安全高亮关键词的全部字面命中', async () => {
    const wrapper = await mountSuspended(SourceSearchPage, { route: '/sources/search?query=风帆船' })
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('资料段落搜索')
    expect(wrapper.get(`a[href="/sources/${sourceId}"]`).text()).toBe('北港航行规则')
    expect(wrapper.findAll('mark').map(mark => mark.text())).toEqual(['风帆船', '风帆船', '风帆船'])
    expect(wrapper.text()).toContain('找到 1 个段落')
    expect(wrapper.text()).toContain('不是筛选资料库项目')
  })
})
