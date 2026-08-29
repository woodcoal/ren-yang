import type { RouteLocationNormalized } from 'vue-router'
import type { ApiResponse, AuthenticationSessionResult, SetupStatusResult } from '#shared/types/api'

/** 不要求登录的页面。 */
const PUBLIC_PAGE_PATHS = new Set(['/login', '/setup'])

/**
 * 在页面导航前根据服务端事实决定登录或首次设置跳转。
 * @param to 即将进入的目标路由。
 * @returns 需要跳转时返回目标地址，否则不返回内容。
 */
async function enforceAuthentication(to: RouteLocationNormalized) {
  const requestFetch = useRequestFetch()

  if (PUBLIC_PAGE_PATHS.has(to.path)) {
    const setup = await requestFetch<ApiResponse<SetupStatusResult>>('/api/v1/setup/status')
    if (to.path === '/setup' && !setup.data.setupRequired) {
      return '/login'
    }
    if (to.path === '/login' && setup.data.setupRequired) {
      return '/setup'
    }
    return
  }

  const session = await requestFetch<ApiResponse<AuthenticationSessionResult>>('/api/v1/auth/session')
  if (session.data.authenticated) {
    return
  }

  const setup = await requestFetch<ApiResponse<SetupStatusResult>>('/api/v1/setup/status')
  return setup.data.setupRequired ? '/setup' : '/login'
}

export default defineNuxtRouteMiddleware(enforceAuthentication)
