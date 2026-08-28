import { randomUUID } from 'node:crypto'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'

/** 使用 Node.js 安全随机源生成 UUID。 */
export class SystemIdentifierGenerator implements IdentifierGenerator {
  /**
   * 生成一个随机 UUID v4。
   * @returns 新 UUID。
   */
  create(): string {
    return randomUUID()
  }
}
