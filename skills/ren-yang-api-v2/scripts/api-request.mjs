#!/usr/bin/env node

/**
 * 读取并校验必需环境变量。
 * @param {string} name 环境变量名称。
 * @returns {string} 去除首尾空白后的非空值。
 * @throws {Error} 变量未配置或为空时抛出。
 */
function requireEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`缺少环境变量 ${name}`)
  return value
}

/**
 * 解析可选 JSON 请求正文并保持稳定 JSON 编码。
 * @param {string | undefined} raw 命令行传入的 JSON 字符串。
 * @returns {string | undefined} 可发送的 JSON 字符串；未提供时返回 undefined。
 * @throws {Error} 正文不是有效 JSON 时抛出。
 */
function parseBody(raw) {
  if (raw === undefined) return undefined
  try {
    return JSON.stringify(JSON.parse(raw))
  }
  catch {
    throw new Error('请求正文必须是有效 JSON')
  }
}

/**
 * 执行一次受范围限制的人样 API v2 请求。
 * @returns {Promise<void>} 输出脱敏响应后结束。
 * @throws {Error} 参数、环境或目标地址无效时抛出。
 */
async function main() {
  const [methodInput, pathInput, bodyInput] = process.argv.slice(2)
  if (!methodInput || !pathInput) {
    throw new Error('用法：node api-request.mjs <METHOD> </api/v2/path> [JSON_BODY]')
  }

  const method = methodInput.toUpperCase()
  const baseUrl = new URL(requireEnvironment('REN_YANG_API_BASE_URL'))
  const targetUrl = new URL(pathInput, baseUrl)
  if (targetUrl.origin !== baseUrl.origin || !targetUrl.pathname.startsWith('/api/v2/')) {
    throw new Error('只允许请求同一服务来源下的 /api/v2/ 路径')
  }

  const body = parseBody(bodyInput)
  const isRead = method === 'GET' || method === 'HEAD'
  const headers = {
    accept: 'application/json',
    authorization: `Bearer ${requireEnvironment('REN_YANG_API_KEY')}`,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(isRead ? {} : { 'idempotency-key': requireEnvironment('REN_YANG_IDEMPOTENCY_KEY') }),
  }
  const response = await fetch(targetUrl, { method, headers, ...(body === undefined ? {} : { body }) })
  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : null
  }
  catch {
    payload = { nonJsonResponse: text.slice(0, 2000) }
  }

  process.stdout.write(`${JSON.stringify({
    status: response.status,
    requestId: response.headers.get('x-request-id'),
    response: payload,
  }, null, 2)}\n`)
  if (!response.ok) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : '请求执行失败'}\n`)
  process.exitCode = 1
})
