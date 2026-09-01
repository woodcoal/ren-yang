import { createHash } from 'node:crypto'

/** 构造文本模型缓存亲和键所需的稳定非敏感事实。 */
export interface AiCacheAffinityKeyInput {
  /** 已渲染且不包含本次变化内容的完整系统提示词。 */
  systemPrompt: string
  /** 固定算法编码。 */
  algorithmCode: string
  /** 不可变提示词版本 UUID。 */
  promptVersionId: string
  /** 不可变模型部署 UUID。 */
  modelDeploymentId: string
  /** 不包含变化文本的模型参数与输出契约。 */
  fixedParameters: Readonly<Record<string, unknown>>
}

/** 进程内按缓存亲和键串行、异键并行的文本模型调度器。 */
export class AiCacheAffinityScheduler {
  /** 每个活跃亲和键最后一个等待完成的调用。 */
  private readonly tails = new Map<string, Promise<void>>()

  /** @returns 当前仍有执行中或等待中调用的亲和键数量。 */
  get activeKeyCount(): number {
    return this.tails.size
  }

  /**
   * 同键按提交顺序执行操作，并在成功或失败后释放下一个调用。
   * @param key 由稳定非敏感快照字段生成的亲和键。
   * @param operation 实际文本模型调用；原始返回值和异常保持不变。
   * @returns 实际操作的返回值。
   * @remarks 该队列仅存在于当前进程，不改变持久任务、租约、幂等或重试语义。
   */
  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const predecessor = this.tails.get(key) ?? Promise.resolve()
    let release = () => {}
    const completion = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = predecessor.then(() => completion)
    this.tails.set(key, tail)
    await predecessor
    try {
      return await operation()
    }
    finally {
      release()
      // 只有当前调用仍是队尾时才清理，避免删除已经排在后面的同键调用。
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}

/**
 * 对固定缓存前缀事实做稳定序列化并生成 SHA-256 亲和键。
 * @param input 实际系统提示词、算法、提示词版本、模型部署和固定参数。
 * @returns 不包含原始提示词、用户文本、运行标识或凭据的亲和键。
 */
export function buildAiCacheAffinityKey(input: AiCacheAffinityKeyInput): string {
  const systemPromptHash = sha256(input.systemPrompt)
  const fixedParametersHash = sha256(stableSerialize(input.fixedParameters))
  return sha256(stableSerialize({
    systemPromptHash,
    algorithmCode: input.algorithmCode,
    promptVersionId: input.promptVersionId,
    modelDeploymentId: input.modelDeploymentId,
    fixedParametersHash,
  }))
}

/**
 * 按对象键名排序生成确定性 JSON，确保配置对象字段顺序不影响亲和键。
 * @param value 仅含 JSON 基础值、数组和普通对象的固定配置。
 * @returns 字段顺序稳定的 JSON 字符串。
 */
function stableSerialize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('缓存亲和键参数必须是有限数值')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(item => stableSerialize(item)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter((entry) => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(',')}}`
  }
  throw new TypeError('缓存亲和键参数只能包含 JSON 数据')
}

/**
 * 生成不可逆的十六进制 SHA-256 摘要。
 * @param value 已稳定序列化的非敏感固定事实。
 * @returns 64 位十六进制摘要。
 */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
