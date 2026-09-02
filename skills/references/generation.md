# 兴趣判断与图文生成

## 批量兴趣判断

一次主调用处理同一人物的一至二十条文本。`itemId` 由客户端提供，在批次内唯一且稳定；输出顺序与输入顺序一致。

```http
POST /api/v2/interest-batches
```

```json
{
  "personaId": "<人物用户名、邮箱或 UUID>",
  "additionalPrompt": "只根据长期兴趣判断，不考虑短期热点。",
  "items": [
    { "itemId": "news-001", "text": "第一条内容" },
    { "itemId": "news-002", "text": "第二条内容" }
  ]
}
```

`additionalPrompt` 最长 4000 字符，对整批生效，不修改人物长期设定。每条 `text` 最长 50000 字符。

创建返回 `202` 和 `batchId`。轮询：

```http
GET /api/v2/interest-batches/{batchId}
```

批次状态为 `queued`、`running`、`completed`；只有 `completed` 是批次终态。逐条读取：

- `itemId`、`runId`、`status`
- 三态 `decision`、`probability`、`confidence`
- `reason` 与可选 `error`

某条失败时只重试该条：

```http
POST /api/v2/interest-batches/{batchId}/items/{itemId}/retry
```

该操作返回 `202`，使用新幂等键，不重跑全批，也不携带旧模型回答。不要把多条文本拆成多个单项批次，除非它们属于不同人物或需要不同附加提示词。

## 直接图文生成

```http
POST /api/v2/generation-runs
```

```json
{
  "personaId": "<人物用户名、邮箱或 UUID>",
  "requirement": "以该人物的口吻写一篇专业文章，说明目标、论据和结论。",
  "outputFormat": "text",
  "imageCount": 0
}
```

- `requirement` 为 1–50000 字符。
- `outputFormat` 为 `text` 或 `html`。
- `imageCount` 为 0–4；大于 0 时系统先生成完整文章，再分析并生成准确数量的图片。
- `html` 结果按正文位置混排图片；`text` 结果把正文和图片资产分开返回。

创建返回 `202`，保存 `runId` 和 `taskId`。轮询：

```http
GET /api/v2/runs/{runId}
```

常见活动状态包括 `planning`、`awaiting_confirmation`、`queued`、`running`；终态包括 `succeeded`、`partial`、`failed`、`canceled`。以在线 OpenAPI 的 `RunSummary.status` 枚举为准。

## 运行管理与输出

| 方法与路径 | 权限 | 用途 |
| --- | --- | --- |
| `GET /api/v2/runs?personaId=&kind=&status=&limit=` | `generation:read` | 查询最近运行 |
| `GET /api/v2/runs/{runId}` | `generation:read` | 查询状态、证据、块和任务 |
| `POST /api/v2/runs/{runId}/cancel` | `generation:write` | 对活动运行请求协作式取消 |
| `POST /api/v2/runs/{runId}/retry` | `generation:write` | 整体重试失败或部分成功运行 |
| `POST /api/v2/runs/{runId}/render` | `generation:read` | 即时渲染指定格式 |
| `GET /api/v2/runs/{runId}/assets/{assetId}?variant=result|original` | `generation:read` | 读取结果图或保留的供应商原图 |
| `GET /api/v2/runs/{runId}/exports/{format}` | `generation:read` | 下载导出结果 |

创建批次、创建图文运行及 `GET /api/v2/runs?personaId=...` 筛选均可使用人物 UUID、用户名或邮箱；服务端解析后返回真实人物 UUID。

即时渲染正文：

```json
{
  "formats": ["html", "markdown", "txt"]
}
```

`formats` 允许 1–3 个不重复值。渲染是 POST 且要求 `Idempotency-Key`，但只需要 `generation:read`。

整体重试会创建新的执行任务；重试前读取运行详情，确认状态允许。单项兴趣失败使用兴趣条目重试接口，不使用运行整体重试。

## 轮询策略

1. 首次等待约 1 秒后查询。
2. 活动状态下采用有上限的退避，例如 1、2、4、8 秒，之后固定 10 秒。
3. 每次保存 `requestId` 和最新状态；遇到 `429` 尊重服务端限制。
4. 达到调用方明确的总等待时间后停止并返回当前 `runId` 或 `batchId`，不要把超时报告成任务失败。
5. 查询终态后再下载资产或导出文件。
