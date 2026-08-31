/** 资料写入、更新或删除完成后创建 OpenViking 增量同步任务的应用端口。 */
export interface ContextSyncTaskQueue {
  /**
   * 创建一次 OpenViking User 对账任务；同一时刻只保留一个待处理任务。
   * @param taskId 新任务 UUID。
   * @param timestamp 创建时间，UTC Unix 毫秒。
   * @returns 无返回值。
   */
  enqueueUserReconciliation(taskId: string, timestamp: number): Promise<void>
  /**
   * 为一项 SQLite 资料创建持久同步任务；资料执行时已不存在则同步删除远端资源。
   * @param sourceId 资料 UUID。
   * @param taskId 新任务 UUID。
   * @param timestamp 创建时间，UTC Unix 毫秒。
   * @param entityType 普通资料或人物反馈资料。
   * @param notBefore 最早领取时间；省略时立即可运行。
   * @returns 无返回值。
   */
  enqueueSourceSynchronization(
    sourceId: string,
    taskId: string,
    timestamp: number,
    entityType?: 'source_material' | 'persona_feedback_source',
    notBefore?: number,
  ): Promise<void>
  /**
   * 为一项 SQLite 交流创建持久 Session 同步任务。
   * @param sourceType 生成运行或反馈。
   * @param sourceId 本地事实 UUID。
   * @param taskId 新任务 UUID。
   * @param timestamp 创建时间。
   * @returns 无返回值。
   */
  enqueueSessionSynchronization(sourceType: 'run' | 'feedback', sourceId: string, taskId: string, timestamp: number): Promise<void>
}
