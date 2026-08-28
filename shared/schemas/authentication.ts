import { z } from 'zod'

/** 管理员用户名的统一校验规则。 */
export const administratorUsernameSchema = z
  .string()
  .trim()
  .min(3, '用户名至少需要 3 个字符')
  .max(50, '用户名不能超过 50 个字符')
  .regex(/^[\p{L}\p{N}_-]+$/u, '用户名只能包含文字、数字、下划线和短横线')

/** 管理员密码的统一校验规则。 */
export const administratorPasswordSchema = z
  .string()
  .min(12, '密码至少需要 12 个字符')
  .max(128, '密码不能超过 128 个字符')

/** 首次创建管理员时使用的请求结构。 */
export const setupAdministratorInputSchema = z
  .object({
    username: administratorUsernameSchema,
    password: administratorPasswordSchema,
    passwordConfirmation: z.string(),
  })
  .strict()
  .refine(input => input.password === input.passwordConfirmation, {
    message: '两次输入的密码不一致',
    path: ['passwordConfirmation'],
  })

/** 管理员登录时使用的请求结构。 */
export const loginInputSchema = z
  .object({
    username: administratorUsernameSchema,
    password: z.string().min(1, '请输入密码').max(128, '密码不能超过 128 个字符'),
  })
  .strict()

/** 首次创建管理员请求的已校验类型。 */
export type SetupAdministratorInput = z.output<typeof setupAdministratorInputSchema>

/** 管理员登录请求的已校验类型。 */
export type LoginInput = z.output<typeof loginInputSchema>
