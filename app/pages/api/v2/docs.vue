<script setup lang="ts">
type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

interface OpenApiSchema {
  $ref?: string
  type?: string | string[]
  format?: string
  description?: string
  default?: unknown
  enum?: unknown[]
  minimum?: number
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  items?: OpenApiSchema
  oneOf?: OpenApiSchema[]
}

interface OpenApiParameter {
  name: string
  in: 'path' | 'query' | 'header'
  required?: boolean
  description: string
  schema: OpenApiSchema
  example?: unknown
}

interface OpenApiMedia {
  schema: OpenApiSchema
  examples?: Record<string, { value: unknown }>
}

interface OpenApiResponse {
  $ref?: string
  description?: string
  content?: Record<string, OpenApiMedia>
}

interface OpenApiOperation {
  tags: string[]
  operationId: string
  summary: string
  description: string
  'x-required-scope': string
  parameters: OpenApiParameter[]
  requestBody?: {
    required?: boolean
    content: Record<string, OpenApiMedia>
  }
  responses: Record<string, OpenApiResponse>
}

interface OpenApiDocument {
  openapi: string
  info: { title: string, version: string, description: string }
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>
  components: {
    schemas: Record<string, OpenApiSchema>
    responses: Record<string, OpenApiResponse>
  }
}

interface OperationDescriptor {
  key: string
  method: HttpMethod
  path: string
  operation: OpenApiOperation
}

interface OperationState {
  parameters: Record<string, string>
  formFields: Record<string, string>
  body: string
  file: File | null
  pending: boolean
  error: string
  responseStatus: string
  responseBody: string
}

definePageMeta({ layout: false })
useHead({ title: '人样公共 API v2' })

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete']
const bearerKey = ref('')
const operationStates = reactive<Record<string, OperationState>>({})
const { data: contract, error: contractError } = await useFetch<OpenApiDocument>('/api/v2/openapi.json', {
  key: 'public-api-openapi-v2',
})

const operations = computed<OperationDescriptor[]>(() => {
  if (!contract.value) return []
  return Object.entries(contract.value.paths).flatMap(([path, pathItem]) => HTTP_METHODS.flatMap((method) => {
    const operation = pathItem[method]
    return operation ? [{ key: `${method}:${path}`, method, path, operation }] : []
  }))
})

/**
 * 返回操作对应的稳定试调状态，并在首次访问时从 OpenAPI 默认值生成输入。
 * @param descriptor 当前公共 API 操作描述。
 * @returns 仅存在于当前文档页面内存中的输入与响应状态。
 * @remarks Bearer Key 不进入该状态，也不会写入持久化存储。
 */
function stateFor(descriptor: OperationDescriptor): OperationState {
  const existing = operationStates[descriptor.key]
  if (existing) return existing

  const parameters = Object.fromEntries(descriptor.operation.parameters.map(parameter => [
    parameter.name,
    parameter.example === undefined ? formatDefault(parameter.schema.default) : formatDefault(parameter.example),
  ]))
  const media = requestMedia(descriptor.operation)
  const resolvedSchema = media ? resolveSchema(media.schema) : undefined
  const formFields = Object.fromEntries(Object.entries(resolvedSchema?.properties ?? {})
    .filter(([, schema]) => schema.format !== 'binary')
    .map(([name, schema]) => [name, formatDefault(exampleForSchema(schema))]))
  const body = media?.type === 'application/json'
    ? JSON.stringify(exampleForSchema(media.schema), null, 2)
    : ''

  const created: OperationState = {
    parameters,
    formFields,
    body,
    file: null,
    pending: false,
    error: '',
    responseStatus: '',
    responseBody: '',
  }
  operationStates[descriptor.key] = created
  return created
}

/**
 * 将 OpenAPI 默认值转换为原生输入框可绑定的字符串。
 * @param value 契约中的默认值或示例值。
 * @returns 空值对应空字符串，复杂值对应 JSON，其余值对应普通文本。
 */
function formatDefault(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * 解析本契约内部的 Schema 引用。
 * @param schema 待解析的内联 Schema 或本地引用。
 * @returns 引用目标；目标不存在时保留原 Schema，避免文档页崩溃。
 */
function resolveSchema(schema: OpenApiSchema): OpenApiSchema {
  const prefix = '#/components/schemas/'
  if (!schema.$ref?.startsWith(prefix) || !contract.value) return schema
  return contract.value.components.schemas[schema.$ref.slice(prefix.length)] ?? schema
}

/**
 * 解析本契约内部的响应引用。
 * @param response 操作声明的内联响应或本地引用。
 * @returns 可展示说明、结构和示例的实际响应定义。
 */
function resolveResponse(response: OpenApiResponse): OpenApiResponse {
  const prefix = '#/components/responses/'
  if (!response.$ref?.startsWith(prefix) || !contract.value) return response
  return contract.value.components.responses[response.$ref.slice(prefix.length)] ?? response
}

/**
 * 根据 Schema 生成可编辑的最小请求示例。
 * @param inputSchema 当前字段或请求体的 Schema。
 * @returns 与字段类型匹配的示例值；数组默认生成空数组。
 */
function exampleForSchema(inputSchema: OpenApiSchema): unknown {
  const schema = resolveSchema(inputSchema)
  if (schema.default !== undefined) return schema.default
  if (schema.enum?.length) return schema.enum[0]
  const type = Array.isArray(schema.type) ? schema.type.find(item => item !== 'null') : schema.type
  if (type === 'object' || schema.properties) {
    return Object.fromEntries(Object.entries(schema.properties ?? {})
      .filter(([, property]) => resolveSchema(property).format !== 'binary')
      .map(([name, property]) => [name, exampleForSchema(property)]))
  }
  if (type === 'array') return []
  if (type === 'boolean') return false
  if (type === 'integer' || type === 'number') return schema.minimum ?? 0
  if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000001'
  return ''
}

/**
 * 读取操作唯一的请求媒体类型及其 Schema。
 * @param operation 当前公共 API 操作。
 * @returns 请求媒体定义；无请求体时返回 undefined。
 */
function requestMedia(operation: OpenApiOperation): ({ type: string } & OpenApiMedia) | undefined {
  const entry = Object.entries(operation.requestBody?.content ?? {})[0]
  return entry ? { type: entry[0], ...entry[1] } : undefined
}

/**
 * 返回请求 Schema 的顶层字段，用于展示字段类型、必填状态和说明。
 * @param operation 当前公共 API 操作。
 * @returns 保持契约声明顺序的字段列表。
 */
function requestFields(operation: OpenApiOperation): Array<{ name: string, schema: OpenApiSchema, required: boolean }> {
  const media = requestMedia(operation)
  if (!media) return []
  const schema = resolveSchema(media.schema)
  return Object.entries(schema.properties ?? {}).map(([name, property]) => ({
    name,
    schema: resolveSchema(property),
    required: schema.required?.includes(name) ?? false,
  }))
}

/**
 * 生成人类可读的字段类型，补充枚举和格式信息。
 * @param inputSchema 字段 Schema。
 * @returns 用于文档表格的简短类型说明。
 */
function schemaType(inputSchema: OpenApiSchema): string {
  const schema = resolveSchema(inputSchema)
  const type = Array.isArray(schema.type) ? schema.type.join(' | ') : (schema.type ?? 'any')
  if (schema.enum?.length) return `${type} (${schema.enum.join(' | ')})`
  return schema.format ? `${type} / ${schema.format}` : type
}

/**
 * 提取响应的第一个 JSON 示例。
 * @param response 当前状态码的响应定义。
 * @returns 格式化后的示例；未声明示例时返回响应 Schema。
 */
function responseExample(response: OpenApiResponse): string {
  const resolved = resolveResponse(response)
  const media = resolved.content?.['application/json']
  const example = media ? Object.values(media.examples ?? {})[0]?.value : undefined
  return JSON.stringify(example ?? media?.schema ?? {}, null, 2)
}

/**
 * 展开响应 Schema 中的本地组件引用，便于直接查看完整字段。
 * @param inputSchema 当前内联 Schema 或本地引用。
 * @param visited 已展开的引用名，用于防止循环结构。
 * @returns 保留类型、约束和字段的无循环 Schema。
 */
function expandSchema(inputSchema: OpenApiSchema, visited: ReadonlySet<string> = new Set()): OpenApiSchema {
  const prefix = '#/components/schemas/'
  if (inputSchema.$ref?.startsWith(prefix) && contract.value) {
    const name = inputSchema.$ref.slice(prefix.length)
    if (visited.has(name)) return { $ref: inputSchema.$ref }
    const target = contract.value.components.schemas[name]
    return target ? expandSchema(target, new Set([...visited, name])) : inputSchema
  }
  return {
    ...inputSchema,
    ...(inputSchema.properties
      ? { properties: Object.fromEntries(Object.entries(inputSchema.properties).map(([name, schema]) => [name, expandSchema(schema, visited)])) }
      : {}),
    ...(inputSchema.items ? { items: expandSchema(inputSchema.items, visited) } : {}),
    ...(inputSchema.oneOf ? { oneOf: inputSchema.oneOf.map(schema => expandSchema(schema, visited)) } : {}),
  }
}

/**
 * 格式化当前状态码的完整响应字段 Schema。
 * @param response 当前状态码的响应定义。
 * @returns 已展开组件引用的格式化 JSON Schema。
 */
function responseSchemaText(response: OpenApiResponse): string {
  const schema = resolveResponse(response).content?.['application/json']?.schema
  return JSON.stringify(schema ? expandSchema(schema) : {}, null, 2)
}

/**
 * 把文件输入事件安全转换为当前操作的单个上传文件。
 * @param descriptor 当前公共 API 操作描述。
 * @param event 原生文件输入 change 事件。
 * @returns 无返回值；选择为空时清除既有文件。
 */
function selectFile(descriptor: OperationDescriptor, event: Event): void {
  const input = event.target
  stateFor(descriptor).file = input instanceof HTMLInputElement ? (input.files?.[0] ?? null) : null
}

/**
 * 把文档中的动态值编码为可安全复制的 POSIX Shell 单参数。
 * @param value 路径、请求头或请求体文本。
 * @returns 使用单引号包围且已处理内部单引号的 Shell 参数。
 * @remarks 该函数只生成示例文本，页面不会执行命令。
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

/**
 * 根据用户输入构造请求地址、请求头和请求体。
 * @param descriptor 当前公共 API 操作描述。
 * @returns 可直接交给 Fetch API 的请求数据。
 * @throws 必填路径参数为空或 JSON 请求体无效时抛出可读错误。
 */
function buildRequest(descriptor: OperationDescriptor): { url: string, headers: Headers, body?: BodyInit } {
  const state = stateFor(descriptor)
  let path = descriptor.path
  for (const parameter of descriptor.operation.parameters.filter(item => item.in === 'path')) {
    const value = state.parameters[parameter.name]?.trim() ?? ''
    if (parameter.required && !value) throw new Error(`请填写路径参数 ${parameter.name}`)
    path = path.replace(`{${parameter.name}}`, encodeURIComponent(value))
  }

  const url = new URL(path, window.location.origin)
  for (const parameter of descriptor.operation.parameters.filter(item => item.in === 'query')) {
    const value = state.parameters[parameter.name]?.trim() ?? ''
    if (value) url.searchParams.set(parameter.name, value)
  }

  const headers = new Headers()
  if (bearerKey.value.trim()) headers.set('Authorization', `Bearer ${bearerKey.value.trim()}`)
  for (const parameter of descriptor.operation.parameters.filter(item => item.in === 'header')) {
    const value = state.parameters[parameter.name]?.trim() ?? ''
    if (parameter.required && !value) throw new Error(`请填写请求头 ${parameter.name}`)
    if (value) headers.set(parameter.name, value)
  }

  const media = requestMedia(descriptor.operation)
  if (!media) return { url: url.toString(), headers }
  if (media.type === 'multipart/form-data') {
    const form = new FormData()
    for (const [name, value] of Object.entries(state.formFields)) {
      if (value) form.set(name, value)
    }
    if (state.file) form.set('file', state.file)
    return { url: url.toString(), headers, body: form }
  }

  JSON.parse(state.body)
  headers.set('Content-Type', 'application/json')
  return { url: url.toString(), headers, body: state.body }
}

/**
 * 生成不会暴露当前明文 Key 的 cURL 请求示例。
 * @param descriptor 当前公共 API 操作描述。
 * @returns 可复制并按需替换占位值的命令文本。
 */
function curlExample(descriptor: OperationDescriptor): string {
  const state = stateFor(descriptor)
  const path = descriptor.path.replace(/\{([^}]+)\}/g, (_match, name: string) => state.parameters[name]?.trim() || `<${name}>`)
  const query = descriptor.operation.parameters
    .filter(item => item.in === 'query' && state.parameters[item.name]?.trim())
    .map(item => `${encodeURIComponent(item.name)}=${encodeURIComponent(state.parameters[item.name] ?? '')}`)
  const lines = [
    `curl -X ${descriptor.method.toUpperCase()} ${shellQuote(`${path}${query.length ? `?${query.join('&')}` : ''}`)}`,
    `  -H ${shellQuote('Authorization: Bearer <api_key>')}`,
  ]
  for (const parameter of descriptor.operation.parameters.filter(item => item.in === 'header')) {
    lines.push(`  -H ${shellQuote(`${parameter.name}: ${state.parameters[parameter.name] || `<${parameter.name}>`}`)}`)
  }
  const media = requestMedia(descriptor.operation)
  if (media?.type === 'application/json') {
    lines.push(`  -H ${shellQuote('Content-Type: application/json')}`, `  --data ${shellQuote(state.body)}`)
  } else if (media?.type === 'multipart/form-data') {
    for (const [name, value] of Object.entries(state.formFields)) lines.push(`  -F ${shellQuote(`${name}=${value}`)}`)
    lines.push(`  -F ${shellQuote('file=@<file_path>')}`)
  }
  return lines.join(' \\\n')
}

/**
 * 使用浏览器 Fetch API 发起当前操作，并完整展示 HTTP 状态和响应正文。
 * @param descriptor 当前公共 API 操作描述。
 * @returns 请求结束后完成；网络错误和输入错误写入对应操作状态。
 */
async function executeRequest(descriptor: OperationDescriptor): Promise<void> {
  const state = stateFor(descriptor)
  state.pending = true
  state.error = ''
  state.responseStatus = ''
  state.responseBody = ''
  try {
    const request = buildRequest(descriptor)
    const response = await fetch(request.url, {
      method: descriptor.method.toUpperCase(),
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      credentials: 'same-origin',
    })
    const text = await response.text()
    state.responseStatus = `${response.status} ${response.statusText}`.trim()
    try {
      state.responseBody = JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      state.responseBody = text
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : '请求失败'
  } finally {
    state.pending = false
  }
}
</script>

<template>
  <main class="api-docs">
    <header class="api-docs__hero">
      <p class="api-docs__eyebrow">OPENAPI {{ contract?.openapi ?? '3.1.0' }}</p>
      <h1>{{ contract?.info.title ?? '人样公共 API' }} <span>v2</span></h1>
      <p>{{ contract?.info.description }}</p>
      <div class="api-docs__links">
        <a href="/api/v2/openapi.json" target="_blank" rel="noreferrer">查看 OpenAPI JSON</a>
        <a href="#operations">浏览全部接口</a>
      </div>
    </header>

    <section class="api-docs__auth" aria-labelledby="authentication-title">
      <div>
        <p class="api-docs__section-label">AUTHENTICATION</p>
        <h2 id="authentication-title">Bearer API Key</h2>
        <p>通过 <code>Authorization: Bearer &lt;api_key&gt;</code> 传递。Key 仅保留在当前页面内存中。</p>
      </div>
      <label>
        <span>API Key</span>
        <input v-model="bearerKey" type="password" autocomplete="off" placeholder="ry_v2_…" data-testid="api-key-input">
      </label>
    </section>

    <p v-if="contractError" class="api-docs__fatal" role="alert">无法读取 OpenAPI 契约：{{ contractError.message }}</p>

    <section id="operations" class="api-docs__operations" aria-label="公共 API 接口">
      <details v-for="descriptor in operations" :key="descriptor.key" class="api-operation">
        <summary>
          <span class="api-operation__method" :data-method="descriptor.method">{{ descriptor.method.toUpperCase() }}</span>
          <code>{{ descriptor.path }}</code>
          <strong>{{ descriptor.operation.summary }}</strong>
          <span class="api-operation__scope">{{ descriptor.operation['x-required-scope'] }}</span>
        </summary>

        <div class="api-operation__body">
          <p>{{ descriptor.operation.description }}</p>

          <h3 v-if="descriptor.operation.parameters.length">路径、查询与请求头</h3>
          <div v-for="parameter in descriptor.operation.parameters" :key="parameter.name" class="api-field">
            <label :for="`${descriptor.key}-${parameter.name}`">
              <code>{{ parameter.name }}</code>
              <span>{{ parameter.in }} · {{ schemaType(parameter.schema) }}<template v-if="parameter.required"> · 必填</template></span>
            </label>
            <p>{{ parameter.description }}</p>
            <select
              v-if="parameter.schema.enum"
              :id="`${descriptor.key}-${parameter.name}`"
              v-model="stateFor(descriptor).parameters[parameter.name]"
            >
              <option value="">不传递</option>
              <option v-for="option in parameter.schema.enum" :key="String(option)" :value="String(option)">{{ option }}</option>
            </select>
            <input
              v-else
              :id="`${descriptor.key}-${parameter.name}`"
              v-model="stateFor(descriptor).parameters[parameter.name]"
              type="text"
              :required="parameter.required"
              :placeholder="parameter.required ? '必填' : '可选'"
            >
          </div>

          <template v-if="requestMedia(descriptor.operation)">
            <h3>请求体 <small>{{ requestMedia(descriptor.operation)?.type }}</small></h3>
            <div class="api-schema-table">
              <div v-for="field in requestFields(descriptor.operation)" :key="field.name">
                <code>{{ field.name }}</code>
                <span>{{ schemaType(field.schema) }}<template v-if="field.required"> · 必填</template></span>
                <p>{{ field.schema.description || '—' }}</p>
              </div>
            </div>

            <textarea
              v-if="requestMedia(descriptor.operation)?.type === 'application/json'"
              v-model="stateFor(descriptor).body"
              rows="12"
              spellcheck="false"
              aria-label="JSON 请求体"
            />
            <div v-else class="api-form-fields">
              <label v-for="field in requestFields(descriptor.operation)" :key="field.name">
                <span>{{ field.name }}<template v-if="field.required"> *</template></span>
                <input
                  v-if="field.schema.format === 'binary'"
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  @change="selectFile(descriptor, $event)"
                >
                <input v-else v-model="stateFor(descriptor).formFields[field.name]" type="text" :required="field.required">
              </label>
            </div>
          </template>

          <h3>请求示例</h3>
          <pre>{{ curlExample(descriptor) }}</pre>

          <div class="api-operation__execute">
            <button type="button" :disabled="stateFor(descriptor).pending" @click="executeRequest(descriptor)">
              {{ stateFor(descriptor).pending ? '请求中…' : '发送请求' }}
            </button>
            <span v-if="stateFor(descriptor).responseStatus">HTTP {{ stateFor(descriptor).responseStatus }}</span>
          </div>
          <p v-if="stateFor(descriptor).error" class="api-operation__error" role="alert">{{ stateFor(descriptor).error }}</p>
          <pre v-if="stateFor(descriptor).responseBody" data-testid="try-response">{{ stateFor(descriptor).responseBody }}</pre>

          <h3>响应结构、示例与错误码</h3>
          <details v-for="(response, status) in descriptor.operation.responses" :key="status" class="api-response">
            <summary><strong>{{ status }}</strong> {{ resolveResponse(response).description }}</summary>
            <p>响应字段</p>
            <pre>{{ responseSchemaText(response) }}</pre>
            <p>响应示例</p>
            <pre>{{ responseExample(response) }}</pre>
          </details>
        </div>
      </details>
    </section>
  </main>
</template>

<style scoped>
.api-docs {
  min-height: 100vh;
  background:
    radial-gradient(circle at 85% 0%, rgb(43 111 92 / 22%), transparent 32rem),
    #0c1117;
  color: #d9e2ec;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}

.api-docs__hero,
.api-docs__auth,
.api-docs__operations,
.api-docs__fatal {
  width: min(1120px, calc(100% - 32px));
  margin-inline: auto;
}

.api-docs__hero {
  padding: 72px 0 42px;
}

.api-docs__eyebrow,
.api-docs__section-label {
  color: #61d6b3;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .16em;
}

h1 {
  margin: 10px 0 18px;
  color: #f7fafc;
  font-size: clamp(40px, 7vw, 72px);
  letter-spacing: -.055em;
  line-height: .98;
}

h1 span { color: #61d6b3; }
.api-docs__hero > p:not(.api-docs__eyebrow) { max-width: 760px; color: #9fb0c0; font-size: 18px; line-height: 1.7; }
.api-docs__links { display: flex; gap: 12px; margin-top: 28px; }
.api-docs__links a { border: 1px solid #31404d; border-radius: 8px; padding: 10px 14px; color: #c6d2dc; text-decoration: none; }
.api-docs__links a:first-child { border-color: #61d6b3; color: #61d6b3; }

.api-docs__auth {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 460px);
  gap: 40px;
  align-items: end;
  margin-bottom: 40px;
  border: 1px solid #26333e;
  border-radius: 14px;
  background: #111921;
  padding: 24px;
}

.api-docs__auth h2 { margin: 4px 0 8px; color: #fff; }
.api-docs__auth p { margin: 0; color: #8fa2b2; }
.api-docs__auth label span, .api-form-fields label span { display: block; margin-bottom: 8px; color: #b8c5cf; font-size: 13px; font-weight: 700; }

input,
select,
textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #344553;
  border-radius: 7px;
  background: #0b1117;
  padding: 10px 12px;
  color: #edf3f7;
  font: inherit;
}

textarea,
pre,
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
textarea { resize: vertical; line-height: 1.55; }
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid #61d6b3; outline-offset: 2px; }

.api-docs__operations { padding-bottom: 80px; }
.api-operation { margin-bottom: 10px; border: 1px solid #26333e; border-radius: 10px; background: #10171e; overflow: clip; }
.api-operation > summary { display: grid; grid-template-columns: 72px minmax(260px, 1fr) minmax(180px, 1fr) auto; gap: 16px; align-items: center; padding: 16px; cursor: pointer; list-style: none; }
.api-operation > summary::-webkit-details-marker { display: none; }
.api-operation > summary > code { color: #ecf2f6; font-size: 13px; overflow-wrap: anywhere; }
.api-operation > summary > strong { font-size: 14px; }
.api-operation__method { border-radius: 5px; padding: 5px 8px; background: #20313c; color: #9bd8ff; font: 700 12px ui-monospace, monospace; text-align: center; }
.api-operation__method[data-method="post"] { background: #17382f; color: #78e2bd; }
.api-operation__method[data-method="put"], .api-operation__method[data-method="patch"] { background: #3b3017; color: #f5cd70; }
.api-operation__method[data-method="delete"] { background: #3c2025; color: #ff9ca8; }
.api-operation__scope { border: 1px solid #344553; border-radius: 999px; padding: 4px 9px; color: #9aabb8; font: 12px ui-monospace, monospace; }
.api-operation__body { border-top: 1px solid #26333e; padding: 22px; }
.api-operation__body > p { color: #9fb0c0; }
.api-operation__body h3 { margin: 28px 0 12px; color: #f2f7fa; font-size: 15px; }
.api-operation__body h3 small { color: #7f94a4; font-weight: 400; }

.api-field { display: grid; grid-template-columns: 240px minmax(200px, 1fr) minmax(220px, 1fr); gap: 14px; align-items: center; border-top: 1px solid #22303a; padding: 12px 0; }
.api-field label span, .api-schema-table span { display: block; margin-top: 4px; color: #7f94a4; font-size: 12px; }
.api-field p, .api-schema-table p { margin: 0; color: #93a5b3; font-size: 13px; }
.api-schema-table > div { display: grid; grid-template-columns: 200px 240px 1fr; gap: 14px; border-top: 1px solid #22303a; padding: 10px 0; }
.api-form-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 16px; }

pre { max-height: 420px; overflow: auto; border: 1px solid #25333e; border-radius: 7px; background: #090e13; padding: 14px; color: #b8e8d7; font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.api-operation__execute { display: flex; align-items: center; gap: 14px; margin-top: 16px; }
.api-operation__execute button { border: 0; border-radius: 7px; background: #61d6b3; padding: 10px 16px; color: #07130f; font-weight: 800; cursor: pointer; }
.api-operation__execute button:disabled { cursor: wait; opacity: .65; }
.api-operation__execute span { color: #b5c5d0; font: 13px ui-monospace, monospace; }
.api-operation__error, .api-docs__fatal { color: #ff9ca8 !important; }
.api-response { border-top: 1px solid #22303a; }
.api-response > summary { padding: 11px 4px; color: #aebdc8; cursor: pointer; }
.api-response > summary strong { display: inline-block; width: 42px; color: #61d6b3; }

@media (max-width: 760px) {
  .api-docs__hero { padding-top: 42px; }
  .api-docs__auth { grid-template-columns: 1fr; gap: 20px; }
  .api-operation > summary { grid-template-columns: 64px 1fr; }
  .api-operation > summary > strong { grid-column: 2; }
  .api-operation__scope { display: none; }
  .api-field, .api-schema-table > div { grid-template-columns: 1fr; gap: 7px; }
  .api-form-fields { grid-template-columns: 1fr; }
}
</style>
