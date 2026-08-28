import type { H3Event } from 'h3'
import type { NitroApp } from 'nitropack/types'
import { ApplicationRuntime } from '../infrastructure/composition/ApplicationRuntime'

/**
 * 初始化唯一应用运行时，并在请求和关闭钩子中管理其生命周期。
 * @param nitroApp 当前 Nitro 应用实例。
 * @returns 插件初始化完成时结束。
 */
async function initializeApplicationRuntime(nitroApp: NitroApp): Promise<void> {
  const config = useRuntimeConfig()
  validateSessionPassword(config.session.password)

  const runtime = new ApplicationRuntime({
    dataDirectory: config.dataDirectory,
    migrationsDirectory: './drizzle',
    textModel: {
      endpoint: config.textModel.endpoint,
      apiKey: config.textModel.apiKey,
      model: config.textModel.model,
    },
  })
  await runtime.start()

  /**
   * 为每个请求附加只包含应用服务的上下文。
   * @param event 当前 H3 请求事件。
   * @returns 无返回值。
   */
  function attachRequestServices(event: H3Event): void {
    event.context.applicationServices = runtime.createRequestServices(event)
  }

  /**
   * 在 Nitro 退出时停止 Worker 并关闭数据库。
   * @returns 无返回值。
   */
  async function closeApplicationRuntime(): Promise<void> {
    await runtime.close()
  }

  nitroApp.hooks.hook('request', attachRequestServices)
  nitroApp.hooks.hook('close', closeApplicationRuntime)
}

/**
 * 检查会话密封密钥是否满足 nuxt-auth-utils 的最低长度要求。
 * @param password 运行时配置中的会话密钥。
 * @returns 无返回值。
 * @throws Error 密钥缺失或不足 32 个字符时抛出。
 */
function validateSessionPassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 32) {
    throw new Error('NUXT_SESSION_PASSWORD 必须在仓库外配置，且长度至少为 32 个字符')
  }
}

export default defineNitroPlugin(initializeApplicationRuntime)
