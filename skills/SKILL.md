---
name: ren-yang
description: 通过人样公共 API v2 管理人物、世界、资料与灵魂，并执行批量兴趣判断和图文生成。适用于编写集成脚本、调用接口、排查公共 API 请求或设计自动化流程；不用于后台专用 API v1。
---

# 人样

通过公开、可审计且支持幂等的 `/api/v2` 契约操作人样系统。运行时 OpenAPI 是接口字段、状态码和响应结构的最终事实源。

## 开始前

1. 读取 [references/contract.md](references/contract.md)，确认认证、权限、幂等、响应和错误规则。
2. 从 `REN_YANG_API_BASE_URL` 读取服务根地址，从 `REN_YANG_API_KEY` 读取完整 API Key；不得输出、保存或转述 Key。
3. 请求 `GET /api/v2/openapi.json` 核对当前契约。实现与本 Skill 不一致时，以 OpenAPI 为准，并指出差异。
4. 根据任务读取一份业务参考：
   - 人物、世界、资料、灵魂：读取 [references/resources.md](references/resources.md)。
   - 兴趣判断、图文生成、运行结果：读取 [references/generation.md](references/generation.md)。

## 执行规则

- 只调用用户明确授权的读取或写入操作；查询请求不隐含创建、更新、发布、重试、取消或删除权限。
- 只使用 `/api/v2`；API Key 管理属于管理员 `/api/v1`，公共 Key 不能创建或管理其他 Key。
- 每个写请求使用一个稳定 `Idempotency-Key`。网络超时或响应丢失时，原方法、路径和请求体必须复用原 Key；请求体变化时必须换新 Key。
- 删除人物、世界或资料前先调用对应 `deletion-impact`，确认阻塞关系和影响后再删除。
- 灵魂修改遵循“读取工作区 → 基于当前版本保存草稿 → 发布草稿”，不得直接覆盖已发布版本。
- 兴趣判断优先把同一人物的一至二十条文本放在一个批次中；单项失败只重试该 `itemId`。
- `/api/v2` 的人物路径参数、`personaId` 和人物类型 `targetId` 可使用人物 UUID、用户名或邮箱；优先使用稳定用户名，响应中的人物标识仍保存为 UUID。
- `202` 只表示任务已接受。按参考文件中的终态轮询对应查询接口，不把 `queued`、`running`、`planning` 或 `awaiting_confirmation` 当作成功。
- 保留并报告响应中的 `X-Request-Id`、资源 ID、运行 ID、批次 ID、最终状态和稳定错误码；不得把完整模型提示、凭据或人物私密资料写入日志。

## 调用方式

普通 JSON 请求优先使用 [scripts/api-request.mjs](scripts/api-request.mjs)：

```bash
export REN_YANG_API_BASE_URL="http://127.0.0.1:3100"
export REN_YANG_API_KEY="<REDACTED>"
node scripts/api-request.mjs GET /api/v2/personas?page=1\&pageSize=20
```

写请求还必须在环境变量中提供幂等键：

```bash
export REN_YANG_IDEMPOTENCY_KEY="$(uuidgen)"
node scripts/api-request.mjs POST /api/v2/interest-batches '{"personaId":"<用户名、邮箱或 UUID>","additionalPrompt":"","items":[{"itemId":"item-1","text":"待判断内容"}]}'
```

文件上传使用 `multipart/form-data`，按 [references/resources.md](references/resources.md) 的命令执行。不要把 Key 直接写进命令历史或脚本源码。

## 结果交付

简要说明实际调用的接口、幂等键是否复用、HTTP 状态、`requestId`、核心资源 ID 和最终业务状态。失败时给出服务端 `error.code`、脱敏消息及可执行的下一步，不用猜测替代服务端事实。
