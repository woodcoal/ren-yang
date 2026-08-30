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

## 2026-08-30 列表快速创建与加载反馈增量

### 验收清单

- 人物和世界列表创建弹窗同时采集名称、灵魂提示词和可选 AI 整理标记。
- 未选择 AI 时，以用户名称和去除首尾空白后的原始提示词直接创建草稿，不调用模型。
- 选择 AI 时，先调用独立灵魂整理应用服务，成功后再创建对象；整理失败不得产生人物或世界。
- 灵魂详情修改成功后关闭弹窗；请求失败时保持弹窗与输入。
- 灵魂详情选择 AI 整理后显示最高层级全屏模糊加载框。
- 创建和灵魂整理加载图标使用独立公共 CSS 关键帧旋转，不依赖可能失效的工具类动画。

### 目标与现有测试配对

- `QuickCreateSubjectModal.vue`、人物/世界列表页继续由 `tests/components/subject-list-creation.test.ts` 和 `tests/components/content-forms.test.ts` 覆盖。
- `SoulWorkspace.vue` 继续由 `tests/components/content-forms.test.ts` 覆盖。
- `SoulApplicationService.ts` 已由 `tests/integration/content-management.test.ts` 覆盖；新增创建前独立整理行为复用该测试模型。
- 静态配对扫描识别上述服务与共享 Schema 已有测试引用；Vue SFC 因分析器只扫描 TypeScript，不作为未配对结论。该结果是静态标识配对，不代表行或分支覆盖率。
