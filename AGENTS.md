# Repository Guidelines

## Project Overview

“人样”是单机本地运行的 AI 人物模拟、兴趣判断与结构化图文创作工作台。SQLite 是唯一业务事实源；OpenViking 仅是可重建的异步语义检索投影，故障时按既有能力降级到 FTS5。先阅读 `CONTEXT.md`，严格沿用其中“世界、人物、灵魂、成长、记忆、资料、证据、运行、产物”等领域术语。

当前范围是单 Node 进程、单实例、本地 SQLite。不要擅自加入 Docker、Serverless、Edge、多实例共享目录、PostgreSQL、协作/多用户、独立 Worker 或自动备份。

## Architecture & Data Flow

依赖方向固定为：`app` UI → `server/api`/`server/presentation` HTTP 边界 → `server/application` 用例编排 → `server/domain` 与 `server/ports` → `server/infrastructure` 适配器。`shared/schemas` 与 `shared/types` 是前后端唯一共享契约。

- `server/plugins/00-application-runtime.ts` 校验运行配置并启动运行时；`server/infrastructure/composition/ApplicationRuntime.ts` 是唯一组合根，负责构造 SQLite、仓储、外部适配器、应用服务和 Worker。
- HTTP 路由只读取请求、用 `shared/schemas/**` 的 Zod schema 校验、调用 `event.context.applicationServices`，再走 `server/presentation/http/controller.ts` 响应。路由不得直接访问 Drizzle 或自行 `new` 服务。
- 业务编排放在 `server/application/**`；无 I/O 不变量放在 `server/domain/**`；外部能力先在 `server/ports/**` 定义，再在 `server/infrastructure/**` 实现。
- UI 经 `useFetch`/`$fetch` 调用 API；跨组件状态用 composables 与 Nuxt `useState`。`app/middleware/authentication.global.ts` 集中处理登录态，避免页面重复鉴权。
- 生成、学习分析与人物蒸馏先写入持久任务，再由同进程 `server/worker/InternalWorker.ts` 按租约领取并处理。任务处理器不得直接更新任务状态；Worker 必须保持防重入和优雅停止语义。
- OpenViking 同步经 outbox/队列异步执行，禁止在请求内无界等待外部服务。

## Key Directories

- `app/pages/`：页面组合；通用 UI 放 `app/components/`，可复用状态与请求逻辑放 `app/composables/`。
- `server/api/v1/`：管理员 Cookie 会话 API；`server/api/v2/`：Bearer API Key 公共 API。
- `server/presentation/http/`：统一控制器、公共 API 鉴权、幂等和脱敏审计边界。
- `server/application/`：认证、内容、AI 配置、任务与上下文同步用例。
- `server/domain/`：领域模型和无 I/O 规则；`server/ports/`：仓储及外部能力接口；`server/infrastructure/`：Drizzle/SQLite、加密、文件、模型等实现。
- `server/worker/`：同进程后台任务轮询与生命周期。
- `shared/schemas/`、`shared/types/`：跨端 Zod 输入契约和公开类型；不要在前后端复制 DTO。
- `drizzle/`：数据库迁移；schema 位于 `server/infrastructure/database/schema.ts`。
- `tests/{unit,integration,components,architecture,e2e}/`：按测试层级分组。
- `scripts/`：迁移、备份、恢复校验、恢复和本机管理员密码重置。

## Development Commands

```bash
pnpm install --frozen-lockfile  # 冻结锁文件安装
pnpm dev                        # 开发服务，默认 127.0.0.1:3001
pnpm typecheck                  # 显式 Nuxt 类型检查
pnpm test                       # Vitest：单元、集成、组件、架构
pnpm test:e2e                   # Playwright Chromium 闭环；首次先 pnpm exec playwright install chromium
pnpm build                      # 使用 .env.build 生成 Nitro node-server
pnpm start                      # 启动 .output/server/index.mjs
pnpm check                      # typecheck + test + build
pnpm migrate                    # 执行 SQLite 迁移和健康检查
pnpm backup                     # 创建一致性备份
pnpm restore:validate -- <目录> # 只读验证指定备份
```

`pnpm restore -- <目录>` 必须在停机后执行；`pnpm admin:reset-password` 仅限本机交互式 TTY。数据目录由 `NUXT_DATA_DIRECTORY` 控制，默认 `./data`。

## Code Conventions & Common Patterns

- 使用 Vue 3 Composition API 与 `<script setup>`；TypeScript 必须满足 `strict`、`noUncheckedIndexedAccess` 与 `exactOptionalPropertyTypes`，不得用 `any`、非空断言或吞错绕过边界。
- 边界输入只接受 Zod 校验后的值。可预期失败抛出 `ApplicationError(code, message, status)`；控制器负责转换为稳定错误响应。不要向客户端返回原始异常、供应商响应、文件路径或密钥。
- v1 浏览器写请求保留 Origin/Sec-Fetch-Site 防护。管理员认证使用最小化密封 Cookie 会话与 `credentialVersion`；改密必须递增版本使旧会话失效。首次设置只允许 loopback。
- v2 写 API 必须经过 `server/presentation/http/publicController.ts` 的 API Key scope、幂等键和脱敏审计链路。身份解析遇到用户名/邮箱多匹配时返回冲突，不能随机选择。
- SQLite 是事务与持久化事实源。数据库结构变更必须新增 Drizzle 迁移，并验证空库、既有库升级和重复执行。
- 凭据只可保存为密文、摘要或环境变量；不得进入日志、响应、测试快照、`.env.build`、版本库或数据库明文。

## Important Files

- `README.md`：快速开始、命令与产品边界。
- `CONTEXT.md`：领域词汇和命名约束。
- `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`：脚本、依赖和 pnpm 约束。
- `nuxt.config.ts`、`.env.example`、`.env.build`：Nitro、端口与运行配置契约。
- `server/plugins/00-application-runtime.ts`、`server/infrastructure/composition/ApplicationRuntime.ts`：启动与依赖组合。
- `server/presentation/http/controller.ts`、`server/presentation/http/publicController.ts`：HTTP 错误与公共 API 安全边界。
- `drizzle.config.ts`、`server/infrastructure/database/schema.ts`：SQLite schema 与迁移配置。
- `vitest.config.ts`、`playwright.config.ts`：测试运行器边界。
- `docs/00-产品决策与范围.md`、`docs/02-系统架构与分层约束.md`、`docs/08-测试与验收方案.md`、`docs/09-部署备份与安全.md`、`docs/11-生产部署与运维.md`：修改对应领域前的事实源。

## Runtime/Tooling Preferences

- 使用 Node.js `>=24 <25` 与 pnpm `>=11 <12`（锁定包管理器为 pnpm `11.24.0`）；这是 ESM 单根工作区，不使用 npm、yarn 或 Bun。
- Nuxt `4` + Vue `3` + Nitro `node-server`；Nuxt UI 与 Tailwind CSS 用于界面。默认仅监听 `127.0.0.1:3001`，`HOST`/`PORT` 可覆盖。
- `pnpm build` 使用无密钥的 `.env.build`；`NUXT_SESSION_PASSWORD` 等运行时密钥必须在启动进程从仓库外注入，且至少符合 `.env.example` 的约束。
- `pnpm-workspace.yaml` 启用 `strictDepBuilds`，只允许既有原生依赖构建脚本；不得放宽白名单。
- 生产为单主机单 Node 进程，本服务只监听回环地址；外部访问必须通过同机 HTTPS 反向代理并配置可信浏览器来源。

## Testing & QA

- `pnpm test` 使用 Vitest：`tests/unit/**/*.test.ts`、`tests/integration/**/*.test.ts`、`tests/architecture/**/*.test.ts` 在 Node 环境运行；`tests/components/**/*.test.ts` 通过 Nuxt + happy-dom 运行。测试名使用 `*.test.ts`。
- 组件测试沿用 `mountSuspended`、`registerEndpoint`、Vue Test Utils 与 `vi` mock；集成测试使用临时 SQLite，并在 `afterEach` 关闭和清理资源。示例：`tests/integration/sqlite-database.test.ts`。
- 架构测试 `tests/architecture/layering.test.ts` 会检查层间依赖和 TypeScript 非空断言；修改分层前先运行它。
- `pnpm test:e2e` 使用 Playwright Chromium，E2E 文件为 `tests/e2e/*.spec.ts`，单 worker 运行；会启动确定性模型替身（4311）和构建后的应用（4310），并使用独占 `.playwright-data`。失败产物在 `test-results/playwright/` 和 `playwright-report/`。
- 局部逻辑或组件修改至少运行相关 Vitest 文件加 `pnpm typecheck`；跨层、接口、任务、存储或发布变更运行 `pnpm check`；核心浏览器闭环或生产启动改动运行 `pnpm test:e2e`。当前未配置覆盖率命令，不要虚构覆盖率门禁。
