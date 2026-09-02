# 公共契约、认证与可靠性

## 事实源

- 在线契约：`GET /api/v2/openapi.json`，匿名可读。
- OpenAPI 版本：3.1；成功响应时间为 ISO 8601 UTC。
- 所有业务接口都位于 `/api/v2`，后台会话接口 `/api/v1` 不属于本 Skill。

调用前检查目标操作的 `x-required-scope`、请求 Schema、成功状态码和错误响应。不要从旧示例推断新字段。

`/api/v2` 中需要人物的 `personaId`、人物路径参数和 `targetType=persona` 的 `targetId` 均可填写 UUID、用户名或邮箱。用户名和邮箱忽略大小写与首尾空白，响应仍返回真实 UUID；`PERSONA_IDENTIFIER_AMBIGUOUS` 表示历史账号数据跨字段冲突，此时改用 UUID。

## 认证与权限

所有业务请求使用：

```http
Authorization: Bearer <完整 API Key>
```

权限固定为：

| 权限 | 能力 |
| --- | --- |
| `persona:read` / `persona:write` | 人物、人物世界关系、人物灵魂 |
| `world:read` / `world:write` | 世界、世界灵魂 |
| `library:read` / `library:write` | 资料正文、状态、关系和全局范围 |
| `generation:read` / `generation:write` | 兴趣批次、图文运行、结果、重试和取消 |

`401` 表示 Key 无效、过期或已吊销；`403` 表示 Key 有效但缺少目标操作的权限。不要通过重复请求规避权限错误。

## 响应封装

JSON 成功响应统一包含：

```json
{
  "data": {},
  "meta": {
    "requestId": "请求追踪标识",
    "idempotencyReplayed": false
  }
}
```

错误响应统一包含：

```json
{
  "error": {
    "code": "稳定错误码",
    "message": "可安全展示的中文消息",
    "requestId": "请求追踪标识",
    "details": {}
  }
}
```

同时记录响应头 `X-Request-Id`。排障时提供请求时间、方法、路径、HTTP 状态、稳定错误码和请求标识，不提供 Authorization、Cookie、完整正文或模型输出。

## 幂等

除纯读取外，OpenAPI 标记的写操作都要求：

```http
Idempotency-Key: <同一逻辑操作的稳定唯一值>
```

- 同一 Key、方法、路径和载荷只执行一次，成功结果可重放，`meta.idempotencyReplayed` 会反映重放事实。
- 同步优先兴趣与图文接口只创建一次持久资源；相同请求重放时重新等待并读取该资源当前状态，不会重复排队。
- 网络超时、连接中断或客户端未收到响应时，使用完全相同的请求复用原 Key。
- 修改路径、方法或载荷时生成新 Key；旧 Key 携带不同载荷会返回 `409`。
- 不要在自动重试循环中每次生成新 Key，否则可能重复创建资源或任务。

## 常见状态与处理

| HTTP | 含义 | 处理 |
| --- | --- | --- |
| `200` / `201` | 同步成功 | 使用 `data`，保存资源 ID 和请求标识 |
| `202` | 异步任务已接受 | 轮询批次或运行详情直到终态 |
| `401` | Key 无效、过期或吊销 | 停止并更换有效 Key |
| `403` | 权限不足 | 由管理员补充精确权限 |
| `404` | 资源不存在或不可见 | 核对 ID 与环境，不盲目创建替代资源 |
| `409` | 状态、版本、引用或幂等冲突 | 重新读取最新状态后决定，不覆盖服务端状态 |
| `413` | 请求或幂等响应超限 | 缩小输入或拆分业务批次 |
| `422` | 输入或业务校验失败 | 按 `error.details` 修正字段 |
| `429` | 限流 | 尊重服务端提示并指数退避，复用原幂等键 |

读取分页列表时显式传入 `page`、`pageSize`，需要时再添加 `query`、`status`、`sort`、`order`。不要假设服务端默认排序适合作为增量同步游标。
