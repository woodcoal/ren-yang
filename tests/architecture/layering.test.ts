import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import ts from 'typescript'

/**
 * 递归收集指定目录中的 TypeScript 源文件。
 * @param directory 要扫描的绝对目录。
 * @returns 排序后的 TypeScript 文件绝对路径。
 */
function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name)
      return entry.isDirectory() ? collectTypeScriptFiles(path) : extname(entry.name) === '.ts' ? [path] : []
    })
    .sort()
}

/**
 * 读取源文件并断言不存在禁止的依赖片段。
 * @param files 待检查文件。
 * @param forbiddenPatterns 禁止出现的正则表达式。
 * @returns 无返回值。
 */
function expectNoForbiddenDependencies(files: string[], forbiddenPatterns: RegExp[]): void {
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const pattern of forbiddenPatterns) {
      expect(source, `${file} 不得匹配 ${pattern}`).not.toMatch(pattern)
    }
  }
}

/**
 * 使用 TypeScript 语法树定位非空断言，避免正则把字符串中的感叹号误判为运算符。
 * @param source 待检查的 TypeScript 源码。
 * @param fileName 诊断使用的文件名。
 * @returns 每个非空断言的行列位置。
 */
function findNonNullAssertions(source: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const positions: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isNonNullExpression(node)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      positions.push(`${fileName}:${position.line + 1}:${position.character + 1}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return positions
}

describe('严格分层依赖', () => {
  it('控制器不直接依赖数据库、模型、OpenViking 或文件实现', () => {
    const files = collectTypeScriptFiles(resolve(process.cwd(), 'server/api'))
    expectNoForbiddenDependencies(files, [
      /infrastructure/,
      /drizzle-orm/,
      /better-sqlite3/,
      /OpenViking/i,
      /node:fs/,
    ])
  })

  it('Worker 只依赖应用服务和端口类型', () => {
    const files = collectTypeScriptFiles(resolve(process.cwd(), 'server/worker'))
    expectNoForbiddenDependencies(files, [
      /infrastructure/,
      /drizzle-orm/,
      /better-sqlite3/,
      /node:fs/,
    ])
  })

  it('应用层不依赖表现层或基础设施层', () => {
    const files = collectTypeScriptFiles(resolve(process.cwd(), 'server/application'))
    expectNoForbiddenDependencies(files, [
      /infrastructure/,
      /presentation/,
      /server\/api/,
      /drizzle-orm/,
      /better-sqlite3/,
      /\bh3\b/,
    ])
  })

  it('基础设施层不反向依赖应用层', () => {
    const files = collectTypeScriptFiles(resolve(process.cwd(), 'server/infrastructure'))
      .filter(file => !file.includes(`${resolve(process.cwd(), 'server/infrastructure/composition')}/`))
    expectNoForbiddenDependencies(files, [/(?:\.\.\/)+application\//])
  })

  it('生产 TypeScript 不使用掩盖不变量的非空断言', () => {
    const files = [
      ...collectTypeScriptFiles(resolve(process.cwd(), 'server')),
      ...collectTypeScriptFiles(resolve(process.cwd(), 'shared')),
    ]
    const assertions = files.flatMap((file) => findNonNullAssertions(readFileSync(file, 'utf8'), file))
    expect(assertions).toEqual([])
  })
})
