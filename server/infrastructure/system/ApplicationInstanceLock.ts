import { randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/** 防止多个应用进程共享同一 SQLite 数据目录，并为停机恢复提供判据。 */
export class ApplicationInstanceLock {
  /** 应用数据目录绝对路径。 */
  private readonly dataDirectory: string
  /** 锁文件绝对路径。 */
  private readonly path: string
  /** 当前实例是否持有锁。 */
  private held = false

  /** @param dataDirectory 应用数据目录。 */
  constructor(dataDirectory: string) {
    const root = isAbsolute(dataDirectory) ? dataDirectory : resolve(process.cwd(), dataDirectory)
    mkdirSync(root, { recursive: true })
    this.dataDirectory = root
    this.path = resolve(root, '.application.lock')
    this.acquire()
  }

  /** @returns 释放当前进程持有的锁；重复调用安全。 */
  release(): void {
    if (!this.held) return
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
          if (ApplicationInstanceLock.isActive(this.dataDirectory)) {
            throw new Error('该数据目录已有运行中的人样进程')
          }
          rmSync(this.path, { force: true })
          continue
        }
        this.held = true
        return
      }
      finally {
        rmSync(candidate, { force: true })
      }
    }
    throw new Error('无法取得应用数据目录实例锁')
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
