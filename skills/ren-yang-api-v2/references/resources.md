# 人物、世界、资料与灵魂

## 人物

| 方法与路径 | 权限 | 用途 |
| --- | --- | --- |
| `GET /api/v2/personas` | `persona:read` | 分页查询人物 |
| `POST /api/v2/personas` | `persona:write` | 创建人物并发布初始灵魂 |
| `GET /api/v2/personas/{personaId}` | `persona:read` | 查询详情、版本和关联资料 |
| `PATCH /api/v2/personas/{personaId}` | `persona:write` | 修改名称与世界关系 |
| `PATCH /api/v2/personas/{personaId}/status` | `persona:write` | 启用或停用 |
| `GET /api/v2/personas/{personaId}/deletion-impact` | `persona:read` | 删除前查询影响 |
| `DELETE /api/v2/personas/{personaId}` | `persona:write` | 按服务端引用规则受控删除 |
| `PUT /api/v2/personas/{personaId}/world` | `persona:write` | 关联唯一世界，正文为 `{"worldId":"<UUID>"}` |
| `DELETE /api/v2/personas/{personaId}/world` | `persona:write` | 解除世界关系 |

创建人物的核心正文：

```json
{
  "name": "人物名称",
  "worldId": null,
  "sourceIds": [],
  "snapshot": { "promptText": "完整人物灵魂提示词" },
  "changeSummary": "创建初始人物灵魂"
}
```

`name` 最长 100 字符，`sourceIds` 最多 100 项，`snapshot.promptText` 为 1–50000 字符。人物只能属于一个世界。

## 世界

| 方法与路径 | 权限 | 用途 |
| --- | --- | --- |
| `GET /api/v2/worlds` | `world:read` | 分页查询世界 |
| `POST /api/v2/worlds` | `world:write` | 创建世界并发布初始灵魂 |
| `GET /api/v2/worlds/{worldId}` | `world:read` | 查询详情、版本和关联资料 |
| `PATCH /api/v2/worlds/{worldId}` | `world:write` | 修改名称与摘要 |
| `PATCH /api/v2/worlds/{worldId}/status` | `world:write` | 启用或停用 |
| `GET /api/v2/worlds/{worldId}/deletion-impact` | `world:read` | 删除前查询影响 |
| `DELETE /api/v2/worlds/{worldId}` | `world:write` | 按服务端引用规则受控删除 |

创建世界的核心正文：

```json
{
  "name": "世界名称",
  "summary": "用于列表展示的简要说明",
  "snapshot": { "promptText": "完整世界灵魂提示词" },
  "changeSummary": "创建初始世界灵魂"
}
```

## 灵魂草稿与发布

人物和世界分别使用同构接口：

| 主体 | 查询工作区 | 保存草稿 | 发布草稿 |
| --- | --- | --- | --- |
| 人物 | `GET /api/v2/personas/{personaId}/soul` | `PUT /api/v2/personas/{personaId}/soul/draft` | `POST /api/v2/personas/{personaId}/soul/publish` |
| 世界 | `GET /api/v2/worlds/{worldId}/soul` | `PUT /api/v2/worlds/{worldId}/soul/draft` | `POST /api/v2/worlds/{worldId}/soul/publish` |

保存草稿前读取工作区，把当前已发布版本 ID 作为 `baseVersionId`；没有基线时才传 `null`：

```json
{
  "baseVersionId": "<当前版本 UUID>",
  "snapshot": { "promptText": "修改后的完整灵魂提示词" },
  "autoAnalyze": false
}
```

保存只更新草稿，发布后才影响新任务。`autoAnalyze=true` 可能调用真实模型，只有用户明确要求自动整理时才启用。

## 资料库

| 方法与路径 | 权限 | 用途 |
| --- | --- | --- |
| `GET /api/v2/sources` | `library:read` | 分页查询资料 |
| `POST /api/v2/sources` | `library:write` | 创建文本资料并建立初始关系 |
| `POST /api/v2/sources/files` | `library:write` | 上传 TXT 或 Markdown |
| `GET /api/v2/sources/{sourceId}` | `library:read` | 查询正文、分块和关系 |
| `PATCH /api/v2/sources/{sourceId}` | `library:write` | 修改名称、角色和正文 |
| `PATCH /api/v2/sources/{sourceId}/status` | `library:write` | 启用或停用 |
| `GET /api/v2/sources/{sourceId}/deletion-impact` | `library:read` | 删除前查询影响 |
| `DELETE /api/v2/sources/{sourceId}` | `library:write` | 受控删除资料 |
| `POST /api/v2/sources/{sourceId}/links` | `library:write` | 关联人物或世界 |
| `DELETE /api/v2/sources/{sourceId}/links/{linkId}` | `library:write` | 删除一条关系 |
| `PUT /api/v2/sources/{sourceId}/global` | `library:write` | 加入全局检索范围 |
| `DELETE /api/v2/sources/{sourceId}/global` | `library:write` | 移出全局检索范围 |

资料角色只能是 `canon_fact`、`reference`、`style_sample`。文本资料示例：

```json
{
  "name": "资料名称",
  "role": "reference",
  "content": "资料正文",
  "targets": [
    { "targetType": "persona", "targetId": "<人物 UUID>" }
  ]
}
```

建立单条关系时可增加 `priority`（0–10000，默认 100）：

```json
{
  "targetType": "world",
  "targetId": "<世界 UUID>",
  "priority": 100
}
```

文件上传示例：

```bash
curl --fail-with-body \
  -H "Authorization: Bearer ${REN_YANG_API_KEY}" \
  -H "Idempotency-Key: ${REN_YANG_IDEMPOTENCY_KEY}" \
  -F 'file=@/absolute/path/material.md;type=text/markdown' \
  -F 'name=资料名称' \
  -F 'role=reference' \
  -F 'targets=[{"targetType":"persona","targetId":"<人物 UUID>"}]' \
  "${REN_YANG_API_BASE_URL%/}/api/v2/sources/files"
```

只上传 `.txt` 或 `.md`，`targets` 是 JSON 数组字符串。不要把人物灵魂、成长提示词或记忆提示词误建成普通资料。
