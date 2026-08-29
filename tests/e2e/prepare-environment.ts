import { rmSync } from 'node:fs'
import { basename, resolve } from 'node:path'

/**
 * 删除浏览器测试独占数据，确保每次从首次设置状态开始。
 * @returns 独占数据目录清理完成时无返回值。
 */
function prepareEnvironment(): void {
  const dataDirectory = resolve(process.cwd(), '.playwright-data')
  if (basename(dataDirectory) !== '.playwright-data') throw new Error('浏览器测试数据目录解析异常')
  rmSync(dataDirectory, { recursive: true, force: true })
}

prepareEnvironment()
