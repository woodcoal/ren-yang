import { describe, expect, it } from 'vitest'
import { AesGcmSecretCipher } from '../../server/infrastructure/security/AesGcmSecretCipher'

describe('人物凭据认证加密', () => {
  it('同一人物可解密，随机密文不含原文且不能替换到其他人物', () => {
    const cipher = new AesGcmSecretCipher('unit-test-secret-material-32-characters')
    const first = cipher.encrypt('第三方密码', 'persona-credential:person-1')
    const second = cipher.encrypt('第三方密码', 'persona-credential:person-1')

    expect(first).not.toBe(second)
    expect(first).not.toContain('第三方密码')
    expect(cipher.decrypt(first, 'persona-credential:person-1')).toBe('第三方密码')
    expect(() => cipher.decrypt(first, 'persona-credential:person-2')).toThrow()
  })
})
