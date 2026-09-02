import { describe, expect, it } from 'vitest'
import { readPublicPersonaId } from '../../server/presentation/http/publicJson'

describe('公共响应资源标识读取', () => {
  it('从人物详情、灵魂记录和删除结果读取真实人物 UUID', () => {
    expect(readPublicPersonaId({ persona: { id: 'persona-details-id' } })).toBe('persona-details-id')
    expect(readPublicPersonaId({ id: 'soul-version-id', subjectId: 'persona-soul-id' })).toBe('persona-soul-id')
    expect(readPublicPersonaId({ id: 'persona-delete-id', deleted: true })).toBe('persona-delete-id')
    expect(readPublicPersonaId({ id: 1 })).toBeNull()
  })
})
