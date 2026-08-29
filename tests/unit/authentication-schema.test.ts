import { describe, expect, it } from 'vitest'
import { administratorPasswordSchema } from '../../shared/schemas/authentication'

describe('管理员密码规则', () => {
  it('接受恰好 8 个字符的密码并拒绝更短密码', () => {
    expect(administratorPasswordSchema.safeParse('password').success).toBe(true)
    expect(administratorPasswordSchema.safeParse('passwor').success).toBe(false)
  })
})
