# AI 人物模拟与反馈迭代系统调研笔记

调研日期：2026-08-29
调研目标：确定一个可验证、可持续迭代的 AI 模拟人物系统的产品边界、技术路径与 MVP 架构。

2026-08-29 补充范围：模拟对象明确为小说等虚构人物；图与文按给定要求分别生成并混排；MVP 需包含人物、参数、运行历史和版本管理面板；补充评估本机 OpenViking 的复用范围及 .NET 技术栈适配性。

## 关键问题

1. 如何表示人物，使其既能预测内容兴趣，也能稳定生成指定风格的图文？
2. 如何把人工反馈转化为可审计、可回滚的人物模型更新，而不是直接污染提示词？
3. 哪些成熟开源项目、论文和官方能力可以复用，哪些部分必须自行实现？
4. 如何评测人物一致性、兴趣预测准确率、风格遵循度与反馈后的真实改进？
5. MVP 应保留哪些能力，哪些复杂训练或多智能体能力应推迟？
6. 管理面板如何管理人物、参数、图文块、版本和运行历史？
7. 本机 OpenViking 应承担哪些职责，哪些数据必须留在业务数据库？
8. .NET 是否适合作为主后端，还是应改用 TypeScript 或 Python？

## 发现

### 检索 1：Mem0 的长期记忆机制

- Mem0 的 `add` 可保存原始消息，也可执行信息推断，并支持按用户、人物、应用、会话和自定义元数据隔离；这说明“原始反馈事件”和“推断后人物事实”必须分开保存。
- `search` 支持自然语言检索、结构化过滤、相似度阈值和重排；可作为生成前提取相关经历或风格样例的参考，但不能替代权威人物档案。
- 开源实现删除向量时会在 SQLite 历史表写入 `DELETE` 墓碑；2026 年的新算法进一步采用只追加的记忆抽取，避免覆盖历史，并通过语义、关键词、实体和时间信号检索。这直接支持“反馈不可篡改、画像可重建、版本可回滚”的设计。
- 适用边界：Mem0 可作为情景记忆适配器或实现参考，不应直接承担人物画像版本、反馈审批和离线评测。

来源：

- Mem0 仓库 SDK 文档与实现，访问日期 2026-08-29：https://github.com/mem0ai/mem0
- Mem0 `memory/main.py`，访问日期 2026-08-29：https://github.com/mem0ai/mem0/blob/main/memory/main.py
- Mem0 v2→v3 迁移文档，访问日期 2026-08-29：https://github.com/mem0ai/mem0/blob/main/docs/migration/platform-v2-to-v3.mdx

### 检索 2：Letta 的有状态人物机制

- Letta 把始终进入上下文的核心信息建模为带标签、长度上限、只读标志和元数据的 memory block；应用可显式读取和更新。这适合借鉴为“当前生效人物快照”，但人物字段应使用结构化模式，不能只存一大段自由文本。
- archival memory 保存不直接进入上下文的长期材料，使用语义检索按需召回；适合作为人物经历、创作样例和历史反馈的检索层。
- 对话历史与人物核心状态分离，能避免把一次会话里的偶然措辞直接升级为稳定人格。
- Letta 提供 `created_by_id`、`last_updated_by_id` 等来源信息，但资料未显示它能替代本项目所需的完整人物版本、差异、审批和回滚链。因此只借鉴分层记忆，不直接把 agent 状态当领域真相。

来源：

- Letta 官方仓库 block、message、endpoint 文档，访问日期 2026-08-29：https://github.com/letta-ai/letta
- Letta block manager 文档，访问日期 2026-08-29：https://github.com/letta-ai/letta/blob/main/_autodocs/api-reference/block-manager.md
- Letta endpoints 文档，访问日期 2026-08-29：https://github.com/letta-ai/letta/blob/main/_autodocs/endpoints.md

### 检索 3：Promptfoo 的回归评测机制

- Promptfoo 可用固定变量驱动同一批测试，同时横向比较提示词或模型；适合验证人物版本更新前后的行为变化，而不是只凭单次主观感觉验收。
- 支持确定性断言、自定义评分和 LLM rubric；人物系统应优先使用确定性指标评估兴趣排序与格式约束，再用盲评或模型评分补充“风格像不像”这类主观指标。
- LLM rubric 可返回 `pass`、0~1 分数和原因，但评分模型本身会漂移。因此评分模型、rubric 和温度必须固定，关键版本仍需人工成对盲评。
- 可复用其评测执行层，但领域数据集、人物一致性指标、反事实测试和晋级门槛必须自行定义。

### 阶段摘要（第 1 轮）

1. 人物状态至少要分成：当前生效画像、长期证据/经历、原始交互与反馈事件，不能把三者混成一个提示词。
2. 所有反馈先形成只追加事件，再生成候选人物版本；只有通过固定评测和人工确认后才发布。
3. 记忆框架可降低存储与召回成本，评测框架可降低回归测试成本，但人物领域模型和反馈晋级规则才是产品核心。

来源：

- Promptfoo 官方仓库及 LLM rubric 文档，访问日期 2026-08-29：https://github.com/promptfoo/promptfoo
- Promptfoo LLM rubric 文档，访问日期 2026-08-29：https://github.com/promptfoo/promptfoo/blob/main/site/docs/configuration/expected-outputs/model-graded/llm-rubric.md

### 检索 4：Generative Agents 的记忆—反思—规划链

- 人物临时状态把身份分为 `innate`（永久核心特征）、`learned`（稳定特征）、`currently`（当前状态），说明长期人格与短期情境必须分层；但其字段仍是自由文本，不足以直接充当可审计人物模型。
- 关联记忆将事件与思考统一召回，综合新近性、语义相关性和重要性评分。仓库当前实现使用硬编码全局权重 `[0.5, 3, 2]`，代码注释也指出未来应学习权重；本项目不应原样复制，而应按兴趣预测任务通过验证集校准。
- 当新增记忆的重要性累计达到阈值时触发反思：生成焦点问题、检索证据、产生洞见，并把洞见及其证据关系重新写入记忆。这一“结论必须引用证据”的机制非常适合人物画像更新。
- 每个模拟时钟周期执行感知→检索→规划→反思。对于本项目，完整环境模拟、日程规划和多人物互动属于过度实现；保留“内容/任务输入→相关证据检索→判断或创作→记录结果→反馈反思”即可。
- 仓库最新提交停留在 2023-08-11，且实现以研究演示为目标；只能借鉴认知链，不能直接作为生产底座。

来源：

- Generative Agents 官方仓库，提交 `fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4`，访问日期 2026-08-29：https://github.com/joonspk-research/generative_agents
- 人物状态实现：https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/memory_structures/scratch.py
- 检索实现：https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/retrieve.py
- 反思实现：https://github.com/joonspk-research/generative_agents/blob/main/reverie/backend_server/persona/cognitive_modules/reflect.py

### 检索 5：PersonaGym 的人物一致性评测

- PersonaGym（论文 arXiv:2407.18416，仓库标注 EMNLP Findings 2025）把评测拆为五类：预期行动、毒性、语言习惯、人物一致性、行动理由。这证明“像一个人”不能压缩成单一相似度分数。
- 人物一致性任务同时测试已明确属性和未定义属性，并故意诱导模型捏造人物信息；本项目必须加入“未知时不擅自补全”的测试，否则反馈迭代会不断制造伪人格。
- 它先按人物选择相关情境，再生成挑战问题，能借鉴为“人物 × 内容领域 × 输出形式”的测试矩阵。
- 评分由两个固定模型在温度 0 下按 rubric 打分并取平均。可借鉴双评分器与固定参数，但 MVP 应额外保留人工盲评和确定性指标，避免同源模型自评偏差。
- 仓库的人物仍是单句描述，适合作为通用基准，不足以验证本项目的证据、版本、兴趣权重和风格样例机制。

来源：

- PersonaGym 官方仓库，访问日期 2026-08-29：https://github.com/vsamuel2003/PersonaGym
- 评测任务源码：https://github.com/vsamuel2003/PersonaGym/blob/master/code/eval_tasks.py
- 评测执行与双评分器源码：https://github.com/vsamuel2003/PersonaGym/blob/master/code/run.py
- 论文入口：https://arxiv.org/abs/2407.18416

### 检索 6：DPO 偏好训练的数据门槛

- Hugging Face TRL 的 DPOTrainer 明确要求偏好数据至少包含 `chosen` 与 `rejected`，推荐同时保留显式 `prompt`；这与“用户只写一句泛泛反馈”不同。
- 因此每次生成必须保存人物版本、任务输入、候选产物、用户选择/修改及原因，才能逐渐形成可训练的偏好对。
- 单条纠错更适合更新人物字段、规则或样例；只有同一风格下积累了覆盖不同主题和形式的稳定成对偏好，并且提示词/RAG 已到瓶颈时，才进入 DPO/LoRA 实验。
- 微调产生的是新的模型适配器版本，仍需通过人物回归集，不能覆盖人物档案或反馈事件。

### 阶段摘要（第 2 轮）

1. 评测必须拆维度：兴趣判断、人物一致性、语言习惯、内容事实、格式、视觉风格、安全，不能只有“满意/不满意”。
2. 反馈学习分三级：立即记录事件；生成候选画像版本；数据量足够后才训练模型适配器。三级不能混为一次自动提示词改写。
3. 研究项目普遍使用自由文本人物描述，生产系统必须补上结构化字段、证据引用、版本发布和回滚，这是本项目真正的工程差异化。

来源：

- Hugging Face TRL v1.0.0 DPO 数据格式文档，访问日期 2026-08-29：https://github.com/huggingface/trl/blob/v1.0.0/docs/source/dataset_formats.md
- Hugging Face TRL v1.0.0 DPOTrainer 文档，访问日期 2026-08-29：https://github.com/huggingface/trl/blob/v1.0.0/docs/source/dpo_trainer.md

### 检索 7：本机 OpenViking 部署状态

- 本机 `~/.openviking/ovcli.conf` 指向内网服务 `http://10.10.10.1:20000`，使用 API Key；`/api/v1/system/status` 返回 HTTP 200、状态 `ok`，且服务已经初始化。
- 当前机器没有独立 `ov` CLI 或本地 OpenViking 进程；Codex/OpenCode 通过插件内的 stdio→HTTP MCP 代理和 REST 接口访问内网服务。
- 服务公开 OpenAPI 3.1 文档：113 条路径、136 个操作，并包含检索、会话和快照接口。这意味着 .NET 可直接使用 `HttpClient`，也可从 `openapi.json` 生成客户端，不需要 Python 中间层。
- OpenViking MCP 在本次会话中被环境拒绝，但自动注入和 REST 状态接口正常；项目运行时应使用 REST，而不是把 Codex 插件的 MCP 代理当业务依赖。

来源：本机部署与只读状态接口，核验日期 2026-08-29。

### 检索 8：OpenViking 官方能力与复用边界

- 官方将上下文分为 `Resource`、`Memory`、`Skill`。虚构人物原著、人物小传、世界观、对白样例和格式规范属于用户主动维护的 `Resource`；经确认的长期反馈结论可同步为 `Memory`。
- `find` 是低延迟单查询检索，`search` 会结合会话执行意图分析与多查询规划。生成链已知道人物和资料目录，应优先使用限定 `target_uri` 的 `find`；复杂人物分析再使用 `search`。
- 会话提交会异步生成摘要、抽取记忆，并保存 `memory_diff.json`。该机制适合辅助沉淀反馈，但不能替代人物版本审批、运行状态、成本统计和业务查询。
- 官方 SDK 只有 Python、TypeScript、Go，当前没有 C#/.NET SDK；同时官方架构明确 HTTP 模式支持任意语言，Web Studio 自身也从服务端 `openapi.json` 生成客户端。
- OpenViking Studio 已覆盖资源、检索、会话和运行诊断，但不理解“虚构人物、人物版本、图文块、生成任务、反馈晋级”等业务对象，因此不能直接替代本项目管理面板，也不建议修改其源码承载业务。
- 官方仓库核验提交：`cd8580c6f8a50ec44593618b3102799ab0b553fd`，提交日期 2026-08-28。

来源：

- OpenViking 官方仓库：https://github.com/volcengine/OpenViking
- 架构说明：https://github.com/volcengine/OpenViking/blob/main/docs/en/concepts/01-architecture.md
- 上下文类型：https://github.com/volcengine/OpenViking/blob/main/docs/en/concepts/02-context-types.md
- 检索机制：https://github.com/volcengine/OpenViking/blob/main/docs/en/concepts/07-retrieval.md
- 会话与记忆差异：https://github.com/volcengine/OpenViking/blob/main/docs/en/concepts/08-session.md
- Web Studio：https://github.com/volcengine/OpenViking/blob/main/web-studio/README.md

### 检索 9：.NET 技术栈适配性

- 本机已安装 .NET SDK 10.0.101 和 ASP.NET Core 10 运行时，开发环境满足要求。
- 本项目的主要复杂度是人物版本、审批状态、生成任务、历史查询、失败恢复和权限管理，属于 ASP.NET Core 与关系数据库擅长的业务系统，而不是必须依赖 Python 的本地模型训练项目。
- 文本模型、图像模型和 OpenViking 均可通过 HTTP 调用；流式输出、取消、超时、重试、后台执行和结构化日志在 .NET 中没有能力缺口。
- .NET 的主要代价是 OpenViking 没有官方 SDK，以及部分前沿 AI 框架先提供 Python/TypeScript 版本。前者用小型强类型 HTTP 适配器解决；后者对当前“调用模型接口 + 业务编排”的范围不构成阻塞。
- 不建议一次生成完整的 136 操作 OpenViking 客户端并暴露给业务层。MVP 只实现资源写入/读取、`find`、会话消息、提交和任务查询等实际使用接口，以隔离上游变化。
- 结论：后端使用 .NET 10 合适；管理前端仍建议使用 TypeScript 技术栈。只有未来必须在进程内运行 Python 模型、训练管线或 Python 独占的图像算法时，才增加独立 Python 工作进程。

### 阶段摘要（第 3 轮）

1. Mem0 不再进入技术方案；本机 OpenViking承担人物资料、样例和已确认反馈的语义存储与检索。
2. PostgreSQL 仍是人物版本、参数、任务、图文块、反馈和历史记录的唯一业务事实源，OpenViking 是内部检索适配器。
3. 推荐技术组合为“.NET 10 模块化单体后端 + TypeScript 管理前端 + PostgreSQL + OpenViking + 对象存储”，不增加 Python 中间层。

## 来源列表

| 来源 | URL | 发布/更新日期 | 可信度 |
|---|---|---|---|
| Mem0 官方仓库 | https://github.com/mem0ai/mem0 | 持续更新，2026-08-29 访问 | 高 |
| Letta 官方仓库 | https://github.com/letta-ai/letta | 持续更新，2026-08-29 访问 | 高 |
| Promptfoo 官方仓库 | https://github.com/promptfoo/promptfoo | 持续更新，2026-08-29 访问 | 高 |
| Generative Agents 官方仓库 | https://github.com/joonspk-research/generative_agents | 2023-08-11 | 高 |
| PersonaGym 官方仓库与论文 | https://github.com/vsamuel2003/PersonaGym | 论文 2024，EMNLP Findings 2025 | 高 |
| Hugging Face TRL v1.0.0 | https://github.com/huggingface/trl | 2026-08-29 访问 | 高 |
| OpenViking 官方仓库 | https://github.com/volcengine/OpenViking | 2026-08-28 提交，2026-08-29 访问 | 高 |
| 本机 OpenViking 状态与 OpenAPI | http://10.10.10.1:20000 | 2026-08-29 核验 | 高 |

## 调研结论

### 产品定义

该项目应定义为“虚构人物模拟、图文创作与管理系统”，而不是聊天机器人或自动改 Prompt 工具。它接收虚构人物版本与任务要求，返回可解释的兴趣判断，或按给定块结构分别生成文字与图片并组装；反馈先成为不可变事件，再转化为候选人物版本，通过回归评测后发布。

MVP 允许管理多个独立人物，每次运行只选择一个人物版本。首期只支持一种最终载体（建议 HTML），但载体内部允许按任务动态定义文字块、图片块和顺序。多人物互动、多智能体协商和人物专属模型训练暂不进入 MVP。

### 核心闭环

```text
人物初始资料 ──> 人物版本 V1 ──> 兴趣判断 / 图文生成 ──> 运行记录
                      │                                  │
                      │                                  v
                      └──── 固定回归集 <── 候选版本 V2 <── 反馈事件
                                               │
                                      评测通过 + 人工确认
                                               │
                                               v
                                         发布 / 回滚
```

### 人物模型

人物不能只存一段描述。建议的最小结构如下：

| 区域 | 内容 | 更新规则 |
|---|---|---|
| 身份事实 | 经确认的背景、经历、关系 | 只接受直接证据或人工编辑 |
| 兴趣偏好 | 主题、立场、亲和度、置信度、时间范围 | 可由多次兴趣反馈逐步更新 |
| 价值与动机 | 决策时重视什么、反感什么 | 高稳定字段，修改需强证据 |
| 表达风格 | 用词、句长、语气、叙事结构、格式、禁用表达 | 由写作样例和定向反馈更新 |
| 视觉风格 | 色彩、构图、质感、信息密度、禁用元素、参考图 | 由图像样例和定向反馈更新 |
| 情景状态 | 当前目标、场景、短期情绪 | 运行结束后不自动固化为人格 |
| 约束 | 事实边界、安全、隐私、版权与披露要求 | 只能由管理员修改 |

每个可学习字段必须附带：`来源事件`、`证据片段`、`置信度`、`生效时间`、`适用场景`、`最后确认时间`。人物结论分为“已确认事实、稳定偏好、暂定假设”，禁止把模型推断伪装成事实。

### 兴趣模拟

输入内容先标准化为主题、立场、形式、长度、情绪、实用性、新颖度和可信度等特征；再从人物档案与历史证据中召回相关部分，输出结构化结果：

- 兴趣概率与置信度；
- 主题匹配、价值匹配、实用性、新颖度、形式偏好等分项；
- 支持与反对证据的 ID；
- “感兴趣 / 不感兴趣 / 信息不足”结论；
- 需要补问的问题。

MVP 使用固定提示词和结构化输出。积累真实标签后，再用逻辑回归或排序模型校准概率；不要让 LLM 的自述理由直接等同于预测准确率。

### 图文生成

生成链应拆为“内容计划→文案→视觉简报→图片→排版校验”，人物风格只影响各阶段的明确字段：

1. 内容计划固定事实、受众、目标和禁止项；
2. 文案引用人物表达规则与少量相似样例；
3. 视觉简报生成构图、色彩、主体、质感和负面约束；
4. 图片模型作为可替换适配器；
5. 最后校验尺寸、字数、必需字段、事实和安全要求。

图文不能作为一个不可拆分的大字符串。建议使用有序块文档：

```text
ArtifactDocument
├── TextBlock：标题、段落、引言、列表、说明文字
├── ImageBlock：图片要求、宽高比、分辨率、替代文本
├── TextBlock
└── ImageBlock
```

任务先生成 `DocumentSpec`，每个块包含类型、角色、要求、依赖和验收规则；文字块与图片块分别生成，最后由渲染器按顺序组装。失败或反馈只重生成目标块，保留其他已确认块。MVP 支持一种最终载体，但块数量和顺序可以由每次任务要求决定。

### 管理面板

管理面板是 MVP 的主要操作入口，建议按业务对象组织：

```text
仪表盘
├── 人物管理
│   ├── 基本资料 / 原著事实 / 世界观
│   ├── 兴趣、价值观、语言风格、视觉风格
│   ├── 资料与样例同步状态
│   ├── 版本差异、发布、冻结、回滚
│   └── 人物测试集与评测结果
├── 创作工作台
│   ├── 任务要求与块结构
│   ├── 文字块 / 图片块分别生成
│   ├── 单块重试、替换、锁定
│   └── 混排预览与导出
├── 格式模板
├── 参数方案
├── 运行历史
├── 反馈与候选修订
└── 系统设置
```

参数不应直接散落在页面表单。使用版本化 `ParameterProfile`，按“全局默认→人物默认→格式模板→本次运行”逐层覆盖；运行前展示每个最终参数的值和来源，并把完整解析结果保存为快照。普通页面只开放人物、检索、文字、图片和渲染参数；凭证、安全规则、最大成本和反馈晋级门槛属于受控系统设置。

运行历史必须能查看：原始任务、人物版本、格式模板版本、参数快照、模型与提示版本、OpenViking 检索证据、每个块的历次尝试、最终组装结果、耗时、成本、错误和反馈。重新生成形成新的 `BlockAttempt`，不能覆盖旧结果。

### 反馈学习

反馈表单至少记录目标维度，不能只有自由文本：

- 整体接受 / 拒绝；
- 兴趣判断是否正确；
- 哪个兴趣因素判断错误；
- 文案风格、内容事实、结构、视觉风格、格式分别评分；
- 用户直接修改后的版本；
- A/B 选择及原因；
- 此反馈是“一次场景例外”还是“长期人格变化”。

学习流程：解析反馈→生成带证据的字段差异→检测冲突和影响范围→形成候选人物版本→重放回归集→人工确认→发布。建议采用混合发布：低风险的样例与短期偏好可自动晋级；身份事实、价值观、禁用项和大幅权重变化必须人工确认。

### 深模块与接缝

| 模块 | 小接口 | 隐藏的实现复杂度 |
|---|---|---|
| 人物档案模块 | 创建候选版本、发布、回滚、读取生效版本 | 字段证据、冲突、差异、版本链 |
| 人物运行模块 | 评估兴趣、执行创作任务 | 证据检索、参数解析、块编排、模型调用、结构校验 |
| 图文文档模块 | 创建块规格、替换块、组装与导出 | 块依赖、尝试历史、布局、格式验证 |
| 反馈学习模块 | 记录反馈、提出修订 | 反馈归因、补丁生成、稳定性规则、训练样本沉淀 |
| 评测门禁模块 | 执行评测、判定是否晋级 | 固定数据集、多维指标、评分器、前后版本比较 |
| 运行历史模块 | 查询运行、重试失败块、统计成本 | 状态机、幂等、失败恢复、完整快照、审计 |

模型供应商、OpenViking、图片生成和对象存储放在内部接缝之后。OpenViking 适配器只暴露本项目实际需要的少量接口，不把其 136 个 HTTP 操作泄漏给业务模块。

### OpenViking 在本项目中的职责

| 数据 | 存放位置 | 原因 |
|---|---|---|
| 人物、版本、参数、任务、状态、成本、反馈 | PostgreSQL | 需要事务、约束、关联查询和业务审计 |
| 原著、人物小传、世界观、对白与图文样例 | OpenViking Resource | 需要解析、分层内容和语义检索 |
| 已确认的长期反馈结论 | OpenViking Memory 或反馈 Resource | 可参与后续检索，但必须来自已发布修订 |
| 原始上传、生成图片、导出文件 | 对象存储 | 二进制产物不应塞入业务表 |
| 单次运行实际使用的证据快照 | PostgreSQL / 对象存储 | 保证 OpenViking 内容变化后仍可复现 |

建议人物目录：`viking://resources/characters/{personaId}/canon/`、`examples/`、`published/`。人物版本仍保存在 PostgreSQL；发布版本时同步 `published/` 并保存 URI、内容哈希和同步状态。运行时对已知目录优先调用 `find`，不默认创建 OpenViking 会话，也不把未确认输出自动提交为记忆。

### 最小数据对象

- `Persona`：人物逻辑标识；
- `PersonaVersion`：不可变人物快照、状态与父版本；
- `CharacterSource`：原著、设定、对白、参考图和 OpenViking URI；
- `Evidence`：资料、样例、反馈或运行结果中的证据；
- `FormatTemplate`：允许的块类型、渲染载体和验证规则；
- `ParameterProfile`：分层参数及版本；
- `FeedbackEvent`：原始反馈，不可覆盖；
- `GenerationRun`：人物、模板、参数快照、模型、提示、证据、状态和成本；
- `ArtifactDocument`：一次运行的有序图文文档；
- `ArtifactBlock`：文字块或图片块的规格与当前选中结果；
- `BlockAttempt`：单块每次生成的输入、输出、错误与成本；
- `RevisionProposal`：候选差异、理由、证据与风险等级；
- `EvalCase` / `EvalRun`：固定测试及版本对比结果；

MVP 使用一个 ASP.NET Core 10 模块化单体、PostgreSQL、本机 OpenViking 和兼容 S3 的对象存储即可；OpenViking 已承担语义检索，不再引入 `pgvector`。耗时生成先用数据库任务表和后台执行器，出现明确吞吐瓶颈后再引入队列。

### 技术栈结论

| 方案 | 优点 | 主要代价 | 结论 |
|---|---|---|---|
| .NET 后端 + TypeScript 前端 | 业务状态、后台任务、历史查询可靠；管理前端生态成熟 | OpenViking 需自建小型 HTTP 适配器 | 推荐 |
| 全 TypeScript | 可直接使用官方 OpenViking SDK，前后端同语言 | 复杂业务状态和长任务仍需自行严谨设计 | 可选 |
| Python 后端 | AI 与本地模型生态最完整，官方 OpenViking SDK 成熟 | 管理系统、强类型领域状态和长期维护不占优势 | 仅在本地模型成为核心时选择 |
| .NET + Blazor | 单一语言，内部管理页面开发直接 | 富文本、拖放混排和前端组件选择相对受限 | 面板简单时可选 |

后端选 .NET 10 是合适的，不需要为了 OpenViking SDK 改用 Python。管理面板若需要富文本、拖放图文块和复杂预览，优先选择 Vue/Nuxt 或 React；若面板只做表单、表格和固定预览，可选择 Blazor。Python 只在后续训练、离线评测或本地图像算法确有需要时作为独立工作进程加入。

```text
TypeScript 管理前端
        │
        v
ASP.NET Core 10 模块化单体
   ├── PostgreSQL：业务事实、版本、任务、反馈、历史
   ├── OpenViking：人物资料、样例、已确认记忆的检索
   ├── 文本/图片模型：生成适配器
   └── 对象存储：原始文件、图片、导出产物
```

### 黑盒接口建议

- `POST /personas` / `POST /personas/{personaId}/versions`
- `POST /personas/{versionId}/interest-assessments`
- `POST /generation-runs`
- `POST /generation-runs/{runId}/blocks/{blockId}/attempts`
- `POST /generation-runs/{runId}/assemble`
- `POST /generation-runs/{runId}/feedback`
- `POST /revision-proposals/{proposalId}/evaluate`
- `POST /revision-proposals/{proposalId}/publish`
- `POST /personas/{personaId}/rollback`

所有运行返回 `runId`、`personaVersionId`、`modelVersion` 和 `promptVersion`，否则无法复现反馈前后的差异。

### 验收指标

| 能力 | MVP 指标 |
|---|---|
| 兴趣预测 | 成对偏好准确率、Precision@K / NDCG、Brier 分数、置信度校准 |
| 人物一致性 | 已知属性遵循、未知属性不捏造、反事实诱导稳定性 |
| 文案风格 | 格式硬校验、禁用表达、人工 A/B 盲选率、样例风格 rubric |
| 图像风格 | 构图/色彩/元素约束通过率、人工 A/B 盲选率 |
| 反馈迭代 | 目标用例提升、非目标用例不退化、候选差异可解释且可回滚 |
| 运行质量 | 失败率、延迟、模型成本、相同版本的可复现性 |

发布门禁不能只看平均分：安全、事实和格式为硬门槛；兴趣与风格看目标集提升，同时限制保留集退化。

### MVP 开发顺序

1. 定义人物、版本、资料、参数和运行状态机；验证：生效版本、参数来源和运行快照可追溯。
2. 建立管理面板骨架与人物资料同步；验证：可管理多个人物并确认 OpenViking 同步状态。
3. 完成兴趣判断垂直链；验证：固定样本输出结构化分数、置信度和证据。
4. 完成 `DocumentSpec`、文字块、图片块和 HTML 组装；验证：单块可重试且不覆盖历史。
5. 完成反馈到候选差异；验证：反馈不会直接修改生效人物。
6. 完成固定回归集和发布门禁；验证：V1/V2 可重复对比，失败版本不可发布。
7. 积累 A/B 偏好对；验证：数据包含 prompt、chosen、rejected、人物版本和反馈原因，再决定是否微调。

### 明确不做

- 不做开放世界、多人物自治社会模拟；
- 不做每次反馈后自动改系统提示词并立即上线；
- 不做人物专属全量模型训练；
- 不把全部对话永久塞进上下文；
- 不用单一向量相似度判断兴趣；
- 不允许无证据的人格推断覆盖已确认事实；
- 不在 MVP 同时支持 HTML、Word、PDF、长图等多种最终载体；
- 不修改 OpenViking Studio 承载本项目业务面板；
- 不生成并依赖完整 OpenViking 客户端。

### 风险与治理

- 原著、角色设定、对白和参考图必须记录来源与使用授权，尤其是仍受版权保护的小说人物；
- 对外内容应标识为 AI 模拟生成，避免被理解为原作者正式续作；
- 用户上传的原著或未公开设定可能包含高敏感内容，应加密、隔离租户并记录访问审计；
- 检索资料属于不可信输入，必须防止原文中的指令覆盖系统与人物约束；
- 视觉样例需记录版权与授权，避免直接模仿在世创作者的独特风格；
- 自动人格漂移必须有最大变更幅度、冲突检测、版本回滚和人工冻结开关。

### 关键事实

1. 成熟记忆框架普遍区分当前核心状态与长期可检索记忆，且新实现趋向只追加历史；人物系统应采用不可变反馈事件和可发布快照。（来源：Mem0、Letta）
2. Generative Agents 的有效机制是分层人物状态、相关证据召回和带证据反思，而完整环境与日程模拟并非本项目必需。（来源：Generative Agents 官方仓库）
3. PersonaGym 将人物评测拆成五种行为维度，并专门测试未定义属性捏造；单一“相似度”无法证明人物一致性。（来源：PersonaGym）
4. DPO 需要 chosen/rejected 偏好对；零散自然语言反馈不能直接等同于可训练数据。（来源：Hugging Face TRL）
5. OpenViking 已覆盖资源解析、语义检索、会话记忆抽取和变更差异，但不承担人物业务版本与运行历史。（来源：OpenViking 官方仓库与本机接口）
6. OpenViking 没有官方 .NET SDK，但提供完整 OpenAPI 3.1 与 HTTP 接口，因此不影响 ASP.NET Core 作为主后端。（来源：OpenViking 官方仓库与本机 OpenAPI）

### 来源可信度说明

上表所列均为官方仓库、官方文档或论文入口，可信度高。WebSearch 聚合提供方在本次调研中返回 HTTP 502，DeepWiki MCP 被环境拒绝，arXiv 页面直连被重置；相关结论改由 Context7 中的官方仓库文档、GitHub 官方 API 和临时克隆的官方仓库源码交叉核验。

### 待确认问题

- 首个最终载体是 HTML、Markdown、Word、PDF 还是长图？建议先选 HTML。
- 图文块由用户逐块明确指定，还是由系统先根据自然语言要求生成可编辑的 `DocumentSpec`？
- 初始人物资料来自完整原著、人物小传、对白摘录、已有同人样例，还是这些资料的组合？
- 人物版本采用全人工发布、全自动发布，还是推荐的混合发布？
- 图像模型使用云端接口还是本地部署？这些选择会改变隐私、成本和部署方案。
- 管理前端选择 TypeScript（Vue/Nuxt 或 React）还是 Blazor？

### 写作建议

- 若继续形成产品需求文档，应先锁定首个最终载体、块规格生成方式和反馈发布策略，再写用户故事与验收用例。
- 技术设计文档应以人物状态机、参数覆盖规则、图文块模型和运行历史为主，不从模型框架选型开始。
