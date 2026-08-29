import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

/** 本地结构化日志配置。 */
export interface LocalStructuredLoggerOptions {
  /** 应用数据目录。 */
  dataDirectory: string
  /** 当前活动日志最大字节数。 */
  maximumFileBytes: number
  /** 轮转日志保留天数。 */
  retentionDays: number
  /** 测试可替换的当前时间。 */
  now?: () => Date
}

/** 写入日志的基础字段，扩展字段会递归脱敏。 */
export interface StructuredLogEntry extends Record<string, unknown> {
  /** 日志级别。 */
  level: 'info' | 'warning' | 'error'
  /** 稳定事件名称。 */
  event: string
}

/** 敏感字段名；不论值类型均完全移除。 */
const SENSITIVE_KEY = /(authorization|cookie|password|secret|api.?key|token|prompt|content|output|body)/i
/** 当前活动日志固定文件名。 */
const ACTIVE_LOG_NAME = 'application.log'

/** 单进程串行写入、脱敏并轮转本地 JSON Lines 日志。 */
export class LocalStructuredLogger {
  /** 日志目录绝对路径。 */
  private readonly directory: string
  /** 当前活动日志绝对路径。 */
  private readonly activePath: string
  /** 串行化所有文件操作，防止并发请求破坏轮转。 */
  private queue: Promise<void> = Promise.resolve()
  /** 最近一次保留期清理时间。 */
  private lastPrunedAt = 0
  /** 当前时间提供器。 */
  private readonly now: () => Date

  /**
   * 创建本地安全日志器。
   * @param options 数据目录、轮转大小和保留期。
   */
  constructor(private readonly options: LocalStructuredLoggerOptions) {
    if (!Number.isSafeInteger(options.maximumFileBytes) || options.maximumFileBytes < 256) {
      throw new Error('日志文件最大字节数不能小于 256')
    }
    if (!Number.isSafeInteger(options.retentionDays) || options.retentionDays < 1) {
      throw new Error('日志保留天数不能小于 1')
    }
    const root = isAbsolute(options.dataDirectory) ? options.dataDirectory : resolve(process.cwd(), options.dataDirectory)
    this.directory = resolve(root, 'logs')
    this.activePath = resolve(this.directory, ACTIVE_LOG_NAME)
    this.now = options.now ?? (() => new Date())
  }

  /**
   * 排队写入单条已脱敏结构化日志；文件错误不会泄露原始事件。
   * @param entry 待记录事件。
   * @returns 当前事件实际写盘后结束。
   */
  async write(entry: StructuredLogEntry): Promise<void> {
    const operation = this.queue.then(async () => await this.append(entry))
    this.queue = operation.catch(() => {
      console.error('本地结构化日志写入失败')
    })
    await this.queue
  }

  /** @returns 等待已排队日志全部完成。 */
  async close(): Promise<void> {
    await this.queue
  }

  /**
   * 完成清理、轮转和追加写入。
   * @param entry 单条原始结构化事件。
   * @returns 文件写入完成时结束。
   */
  private async append(entry: StructuredLogEntry): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const current = this.now()
    await this.pruneIfDue(current)
    const sanitized = sanitizeValue({ timestamp: current.toISOString(), ...entry }, 0)
    const line = `${JSON.stringify(sanitized)}\n`
    const size = await fileSize(this.activePath)
    if (size > 0 && size + Buffer.byteLength(line) > this.options.maximumFileBytes) {
      const stamp = current.toISOString().replaceAll(/[:.]/g, '-')
      await rename(this.activePath, resolve(this.directory, `application-${stamp}-${randomUUID()}.log`))
    }
    await appendFile(this.activePath, line, { encoding: 'utf8', mode: 0o600 })
  }

  /**
   * 最多每小时删除一次超过保留期的轮转日志。
   * @param current 当前时间。
   * @returns 清理完成或本次无需清理时结束。
   */
  private async pruneIfDue(current: Date): Promise<void> {
    const timestamp = current.getTime()
    if (timestamp - this.lastPrunedAt < 60 * 60 * 1000) return
    this.lastPrunedAt = timestamp
    const cutoff = timestamp - this.options.retentionDays * 24 * 60 * 60 * 1000
    const entries = await readdir(this.directory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !/^application-.+\.log$/.test(entry.name)) continue
      const path = resolve(this.directory, entry.name)
      if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true })
    }
  }
}

/**
 * 递归清理结构化字段，不允许凭据、正文或超长诊断值进入日志。
 * @param value 任意日志字段值。
 * @param depth 当前递归深度。
 * @returns 可安全 JSON 序列化的脱敏值。
 */
function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 5) return '[已截断]'
  if (typeof value === 'string') return redactText(value).slice(0, 1_000)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeValue(item, depth + 1))
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      output[key] = SENSITIVE_KEY.test(key) ? '[已脱敏]' : sanitizeValue(item, depth + 1)
    }
    return output
  }
  return String(value)
}

/** @param value 普通诊断文本。 @returns 移除常见令牌和 URL 凭据后的文本。 */
function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [已脱敏]')
    .replace(/\b(sk|pk)-[a-z0-9_-]{8,}\b/gi, '$1-[已脱敏]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[已脱敏]@')
}

/** @param path 文件路径。 @returns 文件不存在时为 0，否则返回实际字节数。 */
async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  }
  catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0
    throw error
  }
}
