/** 资料写入、更新或删除完成后创建 OpenViking 增量同步任务的应用端口。 */
export interface ContextSyncTaskQueue {
  /**
   * 为一项 SQLite 资料创建持久同步任务；资料执行时已不存在则同步删除远端资源。
   * @param sourceId 资料 UUID。
   * @param taskId 新任务 UUID。
   * @param timestamp 创建时间，UTC Unix 毫秒。
   * @returns 无返回值。
   */
  enqueueSourceSynchronization(sourceId: string, taskId: string, timestamp: number): Promise<void>
}
