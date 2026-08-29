# OpenViking 资料删除同步

## 问题

此前 OpenViking 增量同步只覆盖资料创建、文件导入和正文更新。本地资料删除会级联删除 `context_sync_records`，但不会请求删除 `viking://resources/ren-yang/{sourceId}.md`。旧远端资源只能等管理员执行全量重建时清理。

## 决策

保持 SQLite 为唯一业务事实源，不让资料删除 HTTP 请求等待 OpenViking 网络：

1. OpenViking 启用时，本地资料成功删除后仍创建 `sync_context_source` 持久任务。
2. Worker 执行任务时查询 SQLite 最新事实。
3. 资料存在则执行原有写入或更新；资料不存在则删除对应稳定远端 URI。
4. 远端返回 404 视为幂等成功；超时、网络或异常响应交由现有 Worker 最多重试三次。
5. OpenViking 关闭时不创建远端任务，本地资料删除仍独立完成。

没有新增任务类型、数据表或迁移。控制器仍只调用内容应用服务；内容服务只通过同步任务队列端口排队；上下文同步应用服务只通过 `OpenVikingPort` 删除远端资源。

## 实现

- `OpenVikingPort.deleteSource` 定义单资料远端删除能力。
- `OpenVikingHttpContextProvider` 使用受控稳定 URI 调用 `DELETE /api/v1/fs`，参数固定为 `recursive=false&wait=true`。
- `ContentApplicationService.deleteSource` 在 SQLite 删除成功后排队。
- `ContextSynchronizationApplicationService.synchronizeSource` 根据资料是否存在选择同步或删除。

解除人物或世界与资料的关联不会删除远端资料，因为资料仍是独立可复用对象；只有永久删除资料才触发远端删除。

## 验证

- HTTP 适配器单元测试覆盖稳定 URI、非递归等待删除和 404 幂等成功。
- SQLite、内容服务、持久任务、Worker 与内存 OpenViking 的集成测试覆盖“本地先删除、远端失败后重新排队并最终删除”的完整流程。
- OpenViking 关闭时不创建同步任务的既有测试继续保留。
