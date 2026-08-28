/** 为应用层提供不可预测的 UUID。 */
export interface IdentifierGenerator {
  /**
   * 生成一个 UUID 标识。
   * @returns 新的 UUID 字符串。
   */
  create(): string
}
