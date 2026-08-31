/**
 * 提供点击操作结果的统一通知入口，避免长页面顶部提示被忽略。
 * @returns 成功、失败与警告通知方法。
 */
export function useOperationNotifications() {
  const toast = useToast()

  /**
   * 展示一次操作成功结果。
   * @param description 操作完成后的具体结果。
   * @param title 通知标题，默认为“操作完成”。
   * @returns 无返回值。
   */
  function notifySuccess(description: string, title = '操作完成'): void {
    toast.add({ title, description, color: 'success', icon: 'i-lucide-circle-check' })
  }

  /**
   * 展示一次操作失败结果。
   * @param description 可直接呈现给用户的失败原因。
   * @param title 通知标题，默认为“操作失败”。
   * @returns 无返回值。
   */
  function notifyError(description: string, title = '操作失败'): void {
    toast.add({ title, description, color: 'error', icon: 'i-lucide-circle-x' })
  }

  /**
   * 展示操作已完成但结果需要注意的通知。
   * @param description 异常或部分成功的具体结果。
   * @param title 通知标题，默认为“操作需要注意”。
   * @returns 无返回值。
   */
  function notifyWarning(description: string, title = '操作需要注意'): void {
    toast.add({ title, description, color: 'warning', icon: 'i-lucide-triangle-alert' })
  }

  return { notifySuccess, notifyError, notifyWarning }
}
