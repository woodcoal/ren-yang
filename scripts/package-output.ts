import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { zipSync } from 'fflate'

/** 构建产物目录。 */
const outputDirectory = resolve(process.cwd(), '.output')
/** 根目录最终部署压缩包。 */
const archivePath = resolve(process.cwd(), 'out.zip')

/**
 * 递归读取生产输出目录，并整理为 ZIP 的相对文件路径与字节内容。
 * @param directory 当前递归目录。
 * @param files 已收集的 ZIP 文件映射。
 * @returns 全部普通文件读取完成时结束。
 */
async function collectOutputFiles(directory: string, files: Record<string, Uint8Array>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      await collectOutputFiles(path, files)
      continue
    }
    if (!entry.isFile()) continue
    const relativePath = relative(outputDirectory, path).split(sep).join('/')
    files[relativePath] = await readFile(path)
  }
}

/**
 * 将现有 `.output` 中的全部普通文件写入根目录 `out.zip`。
 * @returns 压缩包写入完成时结束。
 */
async function packageOutput(): Promise<void> {
  const outputStats = await stat(outputDirectory).catch(() => null)
  if (!outputStats?.isDirectory()) throw new Error('未找到 .output 构建目录，请先执行 pnpm build')
  const files: Record<string, Uint8Array> = {}
  await collectOutputFiles(outputDirectory, files)
  await rm(archivePath, { force: true })
  await writeFile(archivePath, zipSync(files, { level: 9 }))
  console.log(`已将 ${Object.keys(files).length} 个 .output 文件压缩为 out.zip`)
}

await packageOutput()
