/** 可逆敏感文本加密端口。 */
export interface SecretCipher {
  /**
   * 加密一段敏感文本，并把业务上下文绑定进认证标签。
   * @param plaintext 需要加密且以后允许授权取回的原文。
   * @param context 防止密文被替换到其他对象的稳定业务上下文。
   * @returns 包含版本、随机向量、认证标签和密文的可持久化字符串。
   */
  encrypt(plaintext: string, context: string): string

  /**
   * 解密一段敏感文本，并校验其业务上下文和完整性。
   * @param ciphertext 由当前实现生成的版本化密文。
   * @param context 加密时使用的稳定业务上下文。
   * @returns 解密并通过认证的原文。
   */
  decrypt(ciphertext: string, context: string): string
}
