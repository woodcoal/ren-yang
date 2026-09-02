import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

/** 本地协议替身监听端口，必须与 Playwright 配置一致。 */
const PORT = 4311

/**
 * 读取单次 HTTP 请求正文。
 * @param request Node HTTP 请求。
 * @returns 完整 UTF-8 正文。
 */
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * 根据分层系统提示返回确定的 OpenAI-compatible 模型内容。
 * @param body Chat Completions 请求正文。
 * @returns 学习提炼使用纯文本，其他结构化任务使用 JSON 文本。
 */
function createModelOutput(body: string): string {
  const payload = JSON.parse(body) as { messages?: Array<{ role?: string, content?: string }> }
  const systemPrompt = payload.messages?.find(message => message.role === 'system')?.content ?? ''
  const userPrompt = payload.messages?.find(message => message.role === 'user')?.content ?? ''
  const inputPayload = /<(?:不可信成长资料|不可信记忆资料)>([\s\S]*?)<\/(?:不可信成长资料|不可信记忆资料)>/u.exec(userPrompt)?.[1]
  const parsedInputs = inputPayload ? JSON.parse(inputPayload) as Array<{ id?: unknown }> : []
  const evidenceId = typeof parsedInputs[0]?.id === 'string' ? parsedInputs[0].id : undefined

  if (systemPrompt.includes('人物蒸馏资料分类器')) {
    const sourcesPayload = /<不可信资料输入>([\s\S]*?)<\/不可信资料输入>/u.exec(userPrompt)?.[1]
    const sources = sourcesPayload
      ? JSON.parse(sourcesPayload) as Array<{ id: string, inputType: string }>
      : []
    return JSON.stringify({
      sources: sources.filter(input => input.inputType === 'source_material').map(input => ({
        inputId: input.id,
        sourceRelation: 'third_party',
        coverageDimensions: ['external_views'],
        independentSourceKey: input.id,
      })),
    })
  }

  if (systemPrompt.includes('人物蒸馏认知提取器')) {
    const confirmedPayload = /<用户确认输入>([\s\S]*?)<\/用户确认输入>/u.exec(userPrompt)?.[1]
    const confirmedInputs = confirmedPayload
      ? JSON.parse(confirmedPayload) as Array<{ id: string, inputType: string, content: string }>
      : []
    const userStatement = confirmedInputs.find(input => input.inputType === 'user_statement')
    if (!userStatement) throw new Error('人物蒸馏测试输入缺少用户创建要求')
    return JSON.stringify({ claims: [{
      category: 'mental_model',
      statement: '严谨克制地观察学院课程、档案与古代文献。',
      applicability: '学院内容判断与表达',
      limitations: '资料不足时只按用户明确设定表达，不冒充真实人物经历。',
      basis: 'explicit',
      confidence: 1,
      evidence: [{ inputId: userStatement.id, relation: 'supporting', quote: userStatement.content }],
      conflicts: [],
    }] })
  }

  if (systemPrompt.includes('人物候选灵魂编译器')) {
    return JSON.stringify({
      name: '林默',
      snapshot: { promptText: '严谨克制的学院观察员，关注课程、档案与古代文献，表达冷静简洁。' },
    })
  }

  if (systemPrompt.includes('人物候选质量评测器')) {
    return JSON.stringify({
      evaluations: [
        'known_fact',
        'decision_tendency',
        'unknown_boundary',
        'expression',
        'counterfactual',
        'conflict_handling',
      ].map(evaluationType => ({
        evaluationType,
        status: 'passed',
        score: 1,
        summary: `${evaluationType} 通过`,
        failureReasons: [],
      })),
    })
  }

  // 两阶段成长算法先返回引用真实输入 UUID 的原子结论，再返回完整提示词正文。
  if (systemPrompt.includes('世界成长事实提取器')) {
    if (!evidenceId) throw new Error('世界成长测试输入缺少证据 UUID')
    return JSON.stringify({ facts: [{ statement: '维护浮岛交通与港口规则的一致性。', evidenceInputIds: [evidenceId], confidence: 0.95 }] })
  }

  if (systemPrompt.includes('世界成长提示词编译器')) {
    return '维护浮岛交通与港口规则的一致性，遇到资料冲突时明确适用条件。'
  }

  if (systemPrompt.includes('人物成长事实提取器')) {
    if (!evidenceId) throw new Error('人物成长测试输入缺少证据 UUID')
    return JSON.stringify({ facts: [{ statement: '表达时先给出结论并保持克制。', evidenceInputIds: [evidenceId], confidence: 0.95 }] })
  }

  if (systemPrompt.includes('人物成长提示词编译器')) {
    return '表达时先给出结论，再用可核验的依据说明判断，并保持克制。'
  }

  if (systemPrompt.includes('人物记忆证据提取器')) {
    if (!evidenceId) throw new Error('人物记忆测试输入缺少证据 UUID')
    return JSON.stringify({
      facts: [{
        statement: '曾完成学院课程介绍。',
        memoryType: 'experience',
        evidence: [{ inputId: evidenceId }],
        confidence: 0.95,
        conflicts: [],
      }],
    })
  }

  if (systemPrompt.includes('人物记忆提示词编译器')) {
    return '记住曾完成学院课程介绍；后续同类任务优先采用严谨、克制且便于导出的结构。'
  }

  // 三类学习提炼使用不同的确定文本，便于浏览器测试确认请求没有串到错误对象。
  if (systemPrompt.includes('世界成长提示词提炼器')) {
    return '维护浮岛交通与港口规则的一致性，遇到资料冲突时明确适用条件。'
  }

  if (systemPrompt.includes('人物成长提示词提炼器')) {
    return '表达时先给出结论，再用可核验的依据说明判断，并保持克制。'
  }

  if (systemPrompt.includes('人物记忆提示词提炼器')) {
    return '记住曾完成学院课程介绍；后续同类任务优先采用严谨、克制且便于导出的结构。'
  }

  // 同步公共接口仍复用正式批量兴趣算法，替身必须按输入 itemId 原顺序返回逐项契约。
  if (systemPrompt.includes('人物批量兴趣判定器')) {
    const itemsPayload = /<待判断文本列表>([\s\S]*?)<\/待判断文本列表>/u.exec(userPrompt)?.[1]
    const items = itemsPayload ? JSON.parse(itemsPayload) as Array<{ itemId: string, text: string }> : []
    return JSON.stringify({
      results: items.map(item => ({
        itemId: item.itemId,
        probability: 0.9,
        confidence: 0.85,
        decision: 'interested',
        factors: [{ dimension: 'topic', score: 0.9, explanation: `人物关注${item.text}` }],
        supportingEvidenceIds: [],
        opposingEvidenceIds: [],
        unknowns: [],
        reasoningSummary: '内容符合人物对学院课程与档案的长期兴趣。',
      })),
    })
  }

  if (systemPrompt.includes('人物风格文章生成器')) {
    return JSON.stringify({
      title: '学院观察',
      summary: '以人物口吻介绍学院课程。',
      paragraphs: ['这门课程值得以严谨、克制的方式介绍。'],
    })
  }

  if (systemPrompt.includes('文章配图分析器')) {
    return JSON.stringify({ images: [] })
  }

  throw new Error('端到端模型替身收到未覆盖的提示类型')
}

/**
 * 返回统一 JSON 响应。
 * @param response Node HTTP 响应。
 * @param statusCode HTTP 状态码。
 * @param payload 可序列化响应体。
 * @returns 响应结束时无返回值。
 */
function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

/**
 * 处理健康检查和 Chat Completions 协议请求。
 * @param request Node HTTP 请求。
 * @param response Node HTTP 响应。
 * @returns 对应响应发送完成时结束。
 */
async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { healthy: true })
    return
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    sendJson(response, 404, { error: 'not_found' })
    return
  }

  try {
    const content = createModelOutput(await readBody(request))
    sendJson(response, 200, {
      choices: [{ message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    })
  }
  catch {
    sendJson(response, 422, { error: 'unsupported_prompt' })
  }
}

const server = createServer(handleRequest)

/** @returns 收到进程终止信号后关闭监听。 */
function closeServer(): void {
  server.close()
}

process.once('SIGTERM', closeServer)
process.once('SIGINT', closeServer)
server.listen(PORT, '127.0.0.1')
