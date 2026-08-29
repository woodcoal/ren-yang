import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalStructuredLogger } from '../../server/infrastructure/logging/LocalStructuredLogger'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-logging-test-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('本地结构化日志', () => {
  it('递归脱敏凭据、正文、Bearer 令牌和 URL 用户信息', async () => {
    const logger = createLogger(4_096)
    await logger.write({
      level: 'error',
      event: 'test_error',
      authorization: 'Bearer should-never-appear',
      nested: { apiKey: 'sk-secret-value', content: '完整提示正文' },
      diagnostic: '调用 Bearer leaked-token 失败：https://user:pass@example.test/path',
    })
    await logger.close()

    const content = readAllLogs()
    expect(content).not.toContain('should-never-appear')
    expect(content).not.toContain('sk-secret-value')
    expect(content).not.toContain('完整提示正文')
    expect(content).not.toContain('leaked-token')
    expect(content).not.toContain('user:pass')
    expect(content).toContain('[已脱敏]')
  })

  it('超过活动文件大小后轮转且所有 JSON Lines 均可解析', async () => {
    const logger = createLogger(256)
    for (let index = 0; index < 6; index += 1) {
      await logger.write({ level: 'info', event: 'http_request_completed', requestId: String(index), path: `/api/v1/test/${index}` })
    }
    await logger.close()

    const names = readdirSync(resolve(directory, 'logs')).filter(name => name.endsWith('.log'))
    expect(names.length).toBeGreaterThan(1)
    for (const line of readAllLogs().trim().split('\n')) expect(() => JSON.parse(line)).not.toThrow()
  })
})

/** @param maximumFileBytes 当前活动日志大小上限。 @returns 使用测试目录和固定时间的日志器。 */
function createLogger(maximumFileBytes: number): LocalStructuredLogger {
  return new LocalStructuredLogger({
    dataDirectory: directory,
    maximumFileBytes,
    retentionDays: 14,
    now: () => new Date('2026-08-29T08:00:00.000Z'),
  })
}

/** @returns 合并读取测试创建的全部日志。 */
function readAllLogs(): string {
  return readdirSync(resolve(directory, 'logs'))
    .filter(name => name.endsWith('.log'))
    .sort()
    .map(name => readFileSync(resolve(directory, 'logs', name), 'utf8'))
    .join('')
}
