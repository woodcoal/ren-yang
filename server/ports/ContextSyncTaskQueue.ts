/** 资料写入完成后创建 OpenViking 增量同步任务的应用端口。 */
export interface ContextSyncTaskQueue {
  /**
   * 为一项 SQLite 资料创建持久同步任务。
   * @param sourceId 资料 UUID。
   * @param taskId 新任务 UUID。
   * @param timestamp 创建时间，UTC Unix 毫秒。
   * @returns 无返回值。
   */
  enqueueSourceSynchronization(sourceId: string, taskId: string, timestamp: number): Promise<void>
}
