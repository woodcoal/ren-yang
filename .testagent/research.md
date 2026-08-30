# 灵魂单文本模型测试研究

## 验收清单

- 人物和世界灵魂只保存一段 `promptText`，不再保存章节和运行摘要。
- 灵魂新建或修改使用一个大文本输入框。
- 未勾选自动分析时，原文除首尾空白外不被改写并保存为草稿。
- 勾选自动分析时，模型把输入整理为标准化纯文本，结果保存为草稿且不会自动发布。
- 草稿、发布、历史版本和提示词 Token 预算继续有效。
- 现有数据库的 `runtime_summary` 无损迁移为 `prompt_text`，当前任务行为不变。
- 人物和世界快捷创建仍可由模型生成名称及单文本灵魂草稿。
- 生成、分析、上下文快照和列表摘要全部读取 `promptText`。

## 目标清单

- 共享契约：`shared/types/content.ts`、`shared/schemas/content.ts`。
- 领域与应用：`SoulRules.ts`、`SoulApplicationService.ts`、`ContentApplicationService.ts`、`GenerationApplicationService.ts`、`AnalysisApplicationService.ts`。
- 模型提示：`PromptBuilder.ts`，新增灵魂文本整理提示。
- 持久化：`schema.ts`、`SqliteContentRepository.ts`、Drizzle 迁移。
- 接口：人物和世界灵魂整理接口。
- 前端：`SoulWorkspace.vue`，删除章节编辑器调用并改为弹窗。
- 测试：内容管理集成、生成运行、提示词构建、灵魂组件和数据库迁移。

## 现有约定

- Vitest；领域规则采用单元测试，数据库/API 流程采用集成测试，Vue 交互使用 Nuxt Test Utils。
- SQLite 是唯一业务事实源，迁移必须保留已有数据并通过外键完整性检查。
- 页面只调用应用服务，控制器不得越过服务层访问数据库。
- 用户原有未提交修改位于 `app/pages/worlds/[id].vue` 和 `nuxt.config.ts`，不得覆盖或提交。
