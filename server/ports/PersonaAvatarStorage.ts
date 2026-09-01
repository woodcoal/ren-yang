/** 已校验并保持原始尺寸的人物头像文件。 */
export interface PersonaAvatarFile {
  /** 最终头像或裁剪前原图的文件字节。 */
  bytes: Uint8Array
  /** 从文件魔数识别的可信媒体类型。 */
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
}

/** 人物头像可读取的最终结果或二次裁剪前原图。 */
export type PersonaAvatarVariant = 'result' | 'original'

/** 模型二次裁剪前待保存的原图。 */
export interface PersonaAvatarOriginalInput {
  /** 裁剪前图片字节。 */
  bytes: Uint8Array
  /** 图片模型声明的媒体类型，仅用于交叉校验。 */
  declaredMediaType: string | null
}

/** 人物头像本地存储端口。 */
export interface PersonaAvatarStorage {
  /**
   * 判断人物是否已有头像。
   * @param personaId 人物 UUID。
   * @param variant 最终头像或二次裁剪前原图。
   * @returns 指定头像文件存在时返回 true。
   */
  hasAvatar(personaId: string, variant?: PersonaAvatarVariant): Promise<boolean>

  /**
   * 校验并替换人物头像及可选裁剪前原图。
   * @param personaId 人物 UUID。
   * @param bytes 上传或模型生成的图片字节。
   * @param declaredMediaType 调用方声明的媒体类型，仅用于交叉校验。
   * @param original 模型发生二次裁剪时返回的裁剪前原图；省略时清除旧原图。
   * @returns 保存后的可信头像文件。
   */
  saveAvatar(
    personaId: string,
    bytes: Uint8Array,
    declaredMediaType: string | null,
    original?: PersonaAvatarOriginalInput,
  ): Promise<PersonaAvatarFile>

  /**
   * 读取人物头像并重新校验文件类型。
   * @param personaId 人物 UUID。
   * @param variant 最终头像或二次裁剪前原图。
   * @returns 指定变体的可信头像字节与媒体类型。
   */
  readAvatar(personaId: string, variant?: PersonaAvatarVariant): Promise<PersonaAvatarFile>

  /**
   * 删除人物的头像目录。
   * @param personaId 人物 UUID。
   * @returns 删除完成时结束。
   */
  deleteAvatar(personaId: string): Promise<void>
}
