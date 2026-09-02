import { describe, expect, it } from 'vitest'
import {
  administratorPasswordSchema,
  changeAdministratorPasswordInputSchema,
} from '../../shared/schemas/authentication'

describe('管理员密码规则', () => {
  it('接受恰好 8 个字符的密码并拒绝更短密码', () => {
    expect(administratorPasswordSchema.safeParse('password').success).toBe(true)
    expect(administratorPasswordSchema.safeParse('passwor').success).toBe(false)
  })

  it('修改密码时校验新密码规则和两次输入一致', () => {
    expect(changeAdministratorPasswordInputSchema.safeParse({
      currentPassword: 'current-password',
      newPassword: 'new-password',
      newPasswordConfirmation: 'new-password',
    }).success).toBe(true)
    expect(changeAdministratorPasswordInputSchema.safeParse({
      currentPassword: 'current-password',
      newPassword: 'new-password',
      newPasswordConfirmation: 'different-password',
    }).success).toBe(false)
  })
})
