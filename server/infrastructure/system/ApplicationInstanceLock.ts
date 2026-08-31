import { randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/** 数据目录实例锁的可选获取策略。 */
export interface ApplicationInstanceLockOptions {
  /** 是否允许开发热更新在同一 PID 内短暂持有多个运行时。 */
  allowSameProcessReentry?: boolean
}

/** 跨 Nitro 热更新模块实例共享的同进程锁引用计数。 */
const processLockReferences = getProcessLockReferences()

/** 防止多个应用进程共享同一 SQLite 数据目录，并为停机恢复提供判据。 */
export class ApplicationInstanceLock {
  /** 应用数据目录绝对路径。 */
  private readonly dataDirectory: string
  /** 锁文件绝对路径。 */
  private readonly path: string
  /** 当前实例是否持有锁。 */
  private held = false
  /** 是否允许同一进程内的开发热更新重入。 */
  private readonly allowSameProcessReentry: boolean

  /**
   * 获取应用数据目录实例锁。
   * @param dataDirectory 应用数据目录。
   * @param options 同一 PID 重入策略；生产和命令行默认严格禁止。
   */
  constructor(dataDirectory: string, options: ApplicationInstanceLockOptions = {}) {
    const root = isAbsolute(dataDirectory) ? dataDirectory : resolve(process.cwd(), dataDirectory)
    mkdirSync(root, { recursive: true })
    this.dataDirectory = root
    this.path = resolve(root, '.application.lock')
    this.allowSameProcessReentry = options.allowSameProcessReentry === true
    this.acquire()
  }

  /** @returns 释放当前进程持有的锁；重复调用安全。 */
  release(): void {
    if (!this.held) return
    if (this.allowSameProcessReentry) {
      const references = processLockReferences.get(this.path) ?? 1
      if (references > 1) {
        processLockReferences.set(this.path, references - 1)
        this.held = false
        return
      }
      processLockReferences.delete(this.path)
    }
    rmSync(this.path, { force: true })
    this.held = false
  }

  /** @param dataDirectory 数据目录。 @returns 是否存在仍存活的应用进程。 */
  static isActive(dataDirectory: string): boolean {
    const root = isAbsolute(dataDirectory) ? dataDirectory : resolve(process.cwd(), dataDirectory)
    const path = resolve(root, '.application.lock')
    let pid: number
    try {
      pid = Number(readFileSync(path, 'utf8').trim())
    }
    catch {
      return false
    }
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    }
    catch (error: unknown) {
      return isPermissionError(error)
    }
  }

  /** @returns 原子创建当前 PID 锁；仅清理确认已失效的旧锁。 */
  private acquire(): void {
    if (this.retainSameProcessLock()) return
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const candidate = resolve(this.dataDirectory, `.application-lock-${process.pid}-${randomUUID()}.tmp`)
      try {
        // 候选文件先完整写入，再以硬链接原子发布，避免其他进程观察到尚未写入 PID 的半成品锁。
        writeFileSync(candidate, String(process.pid), { flag: 'wx', mode: 0o600 })
        try {
          linkSync(candidate, this.path)
        }
        catch (error: unknown) {
          if (!isAlreadyExistsError(error)) throw error
          if (this.retainSameProcessLock()) return
          if (ApplicationInstanceLock.isActive(this.dataDirectory)) {
            throw new Error('该数据目录已有运行中的人样进程')
          }
          rmSync(this.path, { force: true })
          continue
        }
        this.held = true
        if (this.allowSameProcessReentry) processLockReferences.set(this.path, 1)
        return
      }
      finally {
        rmSync(candidate, { force: true })
      }
    }
    throw new Error('无法取得应用数据目录实例锁')
  }

  /**
   * 在开发热更新的新旧运行时属于同一 PID 时复用既有锁。
   * @returns 已增加进程内引用计数时为 true；不允许或不是当前 PID 时为 false。
   */
  private retainSameProcessLock(): boolean {
    if (!this.allowSameProcessReentry || readLockPid(this.path) !== process.pid) return false
    const references = processLockReferences.get(this.path) ?? 1
    processLockReferences.set(this.path, references + 1)
    this.held = true
    return true
  }
}

/**
 * 返回跨模块热更新仍保持同一引用的进程级锁计数表。
 * @returns 以锁文件绝对路径为键的引用计数。
 */
function getProcessLockReferences(): Map<string, number> {
  const key = '__renYangApplicationInstanceLockReferences__'
  const scope = globalThis as typeof globalThis & { [key]?: Map<string, number> }
  if (!scope[key]) scope[key] = new Map<string, number>()
  return scope[key]
}

/** @param path 锁文件绝对路径。 @returns 有效 PID；文件缺失或内容无效时返回 null。 */
function readLockPid(path: string): number | null {
  try {
    const pid = Number(readFileSync(path, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  }
  catch {
    return null
  }
}

/** @param error 未知文件系统异常。 @returns 是否为文件已存在。 */
function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

/** @param error 未知进程检测异常。 @returns 是否因权限不足而应视为进程存在。 */
function isPermissionError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EPERM'
}
