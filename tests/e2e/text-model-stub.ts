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
  const inputPayload = /<不可信成长资料>([\s\S]*?)<\/不可信成长资料>/u.exec(userPrompt)?.[1]
  const parsedInputs = inputPayload ? JSON.parse(inputPayload) as Array<{ id?: unknown }> : []
  const evidenceId = typeof parsedInputs[0]?.id === 'string' ? parsedInputs[0].id : undefined

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

  if (systemPrompt.includes('规划一份统一文档规格')) {
    return JSON.stringify({
      title: '学院观察',
      summary: '以人物口吻介绍学院课程。',
      purpose: '完成可导出的端到端验收文档',
      constraints: ['不虚构资料事实'],
      requestedFormats: ['html', 'markdown', 'txt'],
      blocks: [
        { key: 'title', type: 'text', role: 'heading', instruction: '写标题', acceptanceCriteria: ['标题简短'], dependsOn: [] },
        { key: 'body', type: 'text', role: 'paragraph', instruction: '写正文', acceptanceCriteria: ['符合人物风格'], dependsOn: ['title'] },
      ],
    })
  }

  if (systemPrompt.includes('生成一个纯文字块')) {
    return JSON.stringify({ text: userPrompt.includes('写标题') ? '学院观察' : '这门课程值得以严谨、克制的方式介绍。' })
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
