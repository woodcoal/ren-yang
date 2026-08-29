import { describe, expect, it } from 'vitest'
import { validateRealModelAcceptanceEnvironment } from '../../scripts/real-model-acceptance-support'

describe('真实模型验收前置检查', () => {
  it('返回不包含密钥的文本与图片模型摘要', () => {
    const result = validateRealModelAcceptanceEnvironment({
      NUXT_SESSION_PASSWORD: 's'.repeat(32),
      NUXT_TEXT_MODEL_ENDPOINT: 'https://text.example.test/v1/chat/completions',
      NUXT_TEXT_MODEL_API_KEY: 'text-secret',
      NUXT_TEXT_MODEL_MODEL: 'text-model',
      NUXT_IMAGE_MODEL_ENDPOINT: 'https://image.example.test/v1/images/generations',
      NUXT_IMAGE_MODEL_API_KEY: 'image-secret',
      NUXT_IMAGE_MODEL_MODEL: 'image-model',
    })

    expect(result).toEqual({
      textModel: { model: 'text-model', endpointOrigin: 'https://text.example.test' },
      imageModel: { model: 'image-model', endpointOrigin: 'https://image.example.test' },
    })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('缺少密钥时只报告变量名', () => {
    expect(() => validateRealModelAcceptanceEnvironment({
      NUXT_SESSION_PASSWORD: 's'.repeat(32),
      NUXT_TEXT_MODEL_ENDPOINT: 'https://text.example.test/v1/chat/completions',
    })).toThrow('NUXT_TEXT_MODEL_API_KEY 未配置')
  })

  it('拒绝过短的会话密钥', () => {
    expect(() => validateRealModelAcceptanceEnvironment({
      NUXT_SESSION_PASSWORD: 'too-short',
    })).toThrow('NUXT_SESSION_PASSWORD 长度不能少于 32 个字符')
  })

  it('拒绝非 HTTP 协议的模型接口', () => {
    expect(() => validateRealModelAcceptanceEnvironment({
      NUXT_SESSION_PASSWORD: 's'.repeat(32),
      NUXT_TEXT_MODEL_ENDPOINT: 'file:///tmp/model',
      NUXT_TEXT_MODEL_API_KEY: 'text-secret',
      NUXT_TEXT_MODEL_MODEL: 'text-model',
      NUXT_IMAGE_MODEL_ENDPOINT: 'https://image.example.test/v1/images/generations',
      NUXT_IMAGE_MODEL_API_KEY: 'image-secret',
      NUXT_IMAGE_MODEL_MODEL: 'image-model',
    })).toThrow('文本模型配置无效')
  })
})
