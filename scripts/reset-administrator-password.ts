import { resolve } from 'node:path'
import { stdin, stdout } from 'node:process'
import { administratorPasswordSchema } from '../shared/schemas/authentication'
import { AdministratorMaintenanceApplicationService } from '../server/application/authentication/AdministratorMaintenanceApplicationService'
import { ScryptPasswordHasher } from '../server/infrastructure/authentication/ScryptPasswordHasher'
import { DrizzleAdministratorRepository } from '../server/infrastructure/database/DrizzleAdministratorRepository'
import { SqliteDatabase } from '../server/infrastructure/database/SqliteDatabase'
import { SystemClock } from '../server/infrastructure/system/SystemClock'

/**
 * 交互式读取并重置唯一管理员密码。
 * @returns 密码重置完成时结束。
 */
async function main(): Promise<void> {
  const password = await readHiddenLine('新管理员密码：')
  const confirmation = await readHiddenLine('再次输入密码：')
  if (password !== confirmation) {
    throw new Error('两次输入的密码不一致')
  }

  const validatedPassword = administratorPasswordSchema.parse(password)
  const database = new SqliteDatabase({
    dataDirectory: process.env.NUXT_DATA_DIRECTORY ?? './data',
    migrationsDirectory: resolve(process.cwd(), 'drizzle'),
  })

  try {
    const service = new AdministratorMaintenanceApplicationService({
      administratorRepository: new DrizzleAdministratorRepository(database.db),
      passwordHasher: new ScryptPasswordHasher(),
      clock: new SystemClock(),
    })
    const administrator = await service.resetPassword(validatedPassword)
    console.log(`管理员 ${administrator.username} 的密码已重置，所有旧会话均已失效。`)
  }
  finally {
    database.close()
  }
}

/**
 * 从 TTY 读取不回显的单行密码。
 * @param prompt 写入终端的提示文本。
 * @returns 用户按回车后得到的原始字符串。
 */
function readHiddenLine(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('密码重置必须在交互式本机终端执行'))
  }

  return new Promise<string>((resolveInput, rejectInput) => {
    let value = ''
    const previousRawMode = stdin.isRaw
    stdout.write(prompt)
    stdin.setEncoding('utf8')
    stdin.setRawMode(true)
    stdin.resume()

    /**
     * 恢复终端状态并移除当前输入监听器。
     * @returns 无返回值。
     */
    function cleanup(): void {
      stdin.off('data', handleInput)
      stdin.setRawMode(Boolean(previousRawMode))
      stdin.pause()
    }

    /**
     * 处理原始终端字符，支持回车、退格和 Ctrl+C。
     * @param chunk 当前终端输入片段。
     * @returns 无返回值。
     */
    function handleInput(chunk: string | Buffer): void {
      const text = chunk.toString()
      if (text === '\r' || text === '\n') {
        cleanup()
        stdout.write('\n')
        resolveInput(value)
        return
      }
      if (text === '\u0003') {
        cleanup()
        stdout.write('\n')
        rejectInput(new Error('用户取消了密码重置'))
        return
      }
      if (text === '\u007f' || text === '\b') {
        value = Array.from(value).slice(0, -1).join('')
        return
      }
      value += text.replace(/[\u0000-\u001F\u007F]/gu, '')
    }

    stdin.on('data', handleInput)
  })
}

/**
 * 记录不包含密码的命令行错误并设置失败退出码。
 * @param error 未处理的命令行错误。
 * @returns 无返回值。
 */
function handleFatalError(error: unknown): void {
  console.error(error instanceof Error ? error.message : '密码重置发生未知错误')
  process.exitCode = 1
}

void main().catch(handleFatalError)
