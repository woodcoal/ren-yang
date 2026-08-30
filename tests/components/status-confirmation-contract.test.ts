import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 详情页启用确认契约。 */
interface EnableConfirmationContract {
  /** 详情页源码路径。 */
  path: string
  /** 页面使用的业务对象名称。 */
  subject: string
  /** 确认启用方法名称。 */
  confirmHandler: string
}

/** 人物、世界与资料详情页必须共同遵守的启用确认契约。 */
const contracts: EnableConfirmationContract[] = [
  { path: 'app/pages/personas/[id].vue', subject: '人物', confirmHandler: 'confirmEnablePersona' },
  { path: 'app/pages/worlds/[id].vue', subject: '世界', confirmHandler: 'confirmEnableWorld' },
  { path: 'app/pages/sources/[id].vue', subject: '资料', confirmHandler: 'confirmEnableSource' },
]

describe('详情页启用二次确认契约', () => {
  it.each(contracts)('$subject 详情页通过确认弹窗执行启用', ({ path, subject, confirmHandler }) => {
    const pageSource = readFileSync(path, 'utf8')

    expect(pageSource).toContain(`title="确认启用${subject}"`)
    expect(pageSource).toContain(`@click="${confirmHandler}"`)
    expect(pageSource).toContain(`${confirmHandler}(): Promise<void>`)
  })
})
