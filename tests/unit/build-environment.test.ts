import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('生产构建环境隔离', () => {
  it('只读取不含运行配置的专用构建环境文件', () => {
    // 同时约束构建命令与环境文件内容，避免后续改动重新把真实密钥带入 Nuxt 构建过程。
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: { build: string }
    }
    const buildEnvironment = readFileSync(resolve(process.cwd(), '.env.build'), 'utf8')
    const nuxtConfig = readFileSync(resolve(process.cwd(), 'nuxt.config.ts'), 'utf8')

    expect(packageJson.scripts.build).toBe('nuxt build --dotenv .env.build')
    expect(buildEnvironment).not.toMatch(/^\s*(?:NUXT_|HOST\s*=|PORT\s*=|NODE_ENV\s*=)/mu)
    expect(nuxtConfig).not.toContain('process.env.NUXT_SESSION_PASSWORD')
  })
})
