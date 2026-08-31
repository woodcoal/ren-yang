import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import type { SecretCipher } from '../../ports/SecretCipher'

/** 密文格式版本。 */
const FORMAT_VERSION = 'v1'
/** AES-GCM 推荐的 96 位随机向量长度。 */
const IV_BYTES = 12

/** 使用 AES-256-GCM 加密可取回敏感文本，并通过 HKDF 与其他用途隔离密钥。 */
export class AesGcmSecretCipher implements SecretCipher {
  /** AES-256 使用的 32 字节派生密钥。 */
  private readonly key: Buffer

  /**
   * 创建凭据加密器。
   * @param keyMaterial 仓库外注入且长度不少于 32 字符的服务端密钥材料。
   */
  constructor(keyMaterial: string) {
    if (keyMaterial.length < 32) throw new Error('凭据加密密钥材料不能少于 32 个字符')
    // 保留既有 HKDF info，确保升级后仍能解密已经保存的人物凭据。
    this.key = Buffer.from(hkdfSync('sha256', keyMaterial, '人样', '人物第三方账号凭据-v1', 32))
  }

  /**
   * 使用随机向量和业务上下文加密敏感文本。
   * @param plaintext 需要保存的密码原文。
   * @param context 当前人物的稳定业务上下文。
   * @returns 使用点分隔的版本化 Base64URL 密文。
   */
  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(context, 'utf8'))
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return [FORMAT_VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
  }

  /**
   * 校验版本、业务上下文和认证标签后解密敏感文本。
   * @param ciphertext 版本化 Base64URL 密文。
   * @param context 加密时绑定的人物业务上下文。
   * @returns 原始密码。
   */
  decrypt(ciphertext: string, context: string): string {
    const [version, ivValue, tagValue, encryptedValue, extra] = ciphertext.split('.')
    if (version !== FORMAT_VERSION || !ivValue || !tagValue || encryptedValue === undefined || extra !== undefined) {
      throw new Error('凭据密文格式无效')
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'))
    decipher.setAAD(Buffer.from(context, 'utf8'))
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  }
}
