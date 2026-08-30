/** 已校验并统一为 512×512 的人物头像文件。 */
export interface PersonaAvatarFile {
  /** 头像原始字节。 */
  bytes: Uint8Array
  /** 从文件魔数识别的可信媒体类型。 */
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
}

/** 人物头像本地存储端口。 */
export interface PersonaAvatarStorage {
  /**
   * 判断人物是否已有头像。
   * @param personaId 人物 UUID。
   * @returns 头像文件存在时返回 true。
   */
  hasAvatar(personaId: string): Promise<boolean>

  /**
   * 校验、缩放为 512×512 并原子替换人物头像。
   * @param personaId 人物 UUID。
   * @param bytes 上传或模型生成的图片字节。
   * @param declaredMediaType 调用方声明的媒体类型，仅用于交叉校验。
   * @returns 保存后的可信头像文件。
   */
  saveAvatar(personaId: string, bytes: Uint8Array, declaredMediaType: string | null): Promise<PersonaAvatarFile>

  /**
   * 读取人物头像并重新校验文件类型。
   * @param personaId 人物 UUID。
   * @returns 可信头像字节与媒体类型。
   */
  readAvatar(personaId: string): Promise<PersonaAvatarFile>

  /**
   * 删除人物的头像目录。
   * @param personaId 人物 UUID。
   * @returns 删除完成时结束。
   */
  deleteAvatar(personaId: string): Promise<void>
}
