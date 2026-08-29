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
  let runtime: ApplicationRuntime | undefined
  try {
    validateSessionPassword(config.session.password)
    validatePositiveInteger(config.limits.requestBodyBytes, 'NUXT_LIMITS_REQUEST_BODY_BYTES')
    validateNonNegativeInteger(config.limits.minimumFreeDiskBytes, 'NUXT_LIMITS_MINIMUM_FREE_DISK_BYTES')
    validateMinimumInteger(config.logging.maximumFileBytes, 'NUXT_LOGGING_MAXIMUM_FILE_BYTES', 256)
    validateMinimumInteger(config.logging.retentionDays, 'NUXT_LOGGING_RETENTION_DAYS', 1)
    runtime = new ApplicationRuntime({
      dataDirectory: config.dataDirectory,
      migrationsDirectory: './drizzle',
      minimumFreeDiskBytes: Number(config.limits.minimumFreeDiskBytes),
      textModel: {
        endpoint: config.textModel.endpoint,
        apiKey: config.textModel.apiKey,
        model: config.textModel.model,
      },
      imageModel: {
        endpoint: config.imageModel.endpoint,
        apiKey: config.imageModel.apiKey,
        model: config.imageModel.model,
      },
      openViking: {
        enabled: config.openViking.enabled,
        endpoint: config.openViking.endpoint,
        apiKey: config.openViking.apiKey,
        timeoutMs: config.openViking.timeoutMs,
      },
    })
    await runtime.start()
  }
  catch (error: unknown) {
    if (runtime) await runtime.close()
    terminateFailedStartup()
  }

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

/** @returns 立即以非零状态终止已开始监听但初始化失败的 Nitro 进程。 */
function terminateFailedStartup(): never {
  // Nitro 先建立监听再异步运行插件；单纯抛错只会形成 unhandledRejection，必须主动终止进程。
  console.error('应用运行时初始化失败，进程已终止')
  process.exit(1)
}

/** @param value 未知配置值。 @param name 环境变量名。 @returns 校验为正安全整数后结束。 */
function validatePositiveInteger(value: unknown, name: string): void {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} 必须是正安全整数`)
}

/** @param value 未知配置值。 @param name 环境变量名。 @returns 校验为非负安全整数后结束。 */
function validateNonNegativeInteger(value: unknown, name: string): void {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} 必须是非负安全整数`)
}

/** @param value 未知配置值。 @param name 环境变量名。 @param minimum 允许的最小整数。 @returns 校验通过时结束。 */
function validateMinimumInteger(value: unknown, name: string, minimum: number): void {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${name} 不能小于 ${minimum}`)
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
