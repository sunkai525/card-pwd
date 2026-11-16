import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Context, MiddlewareHandler } from 'hono'
import type { Bindings } from './types'
import { constantTimeEqual } from './utils'

type AppEnv = { Bindings: Bindings }
export const ADMIN_COOKIE = 'card_pwd_admin'

export function tokenMatches(c: Context<AppEnv>, token: string | undefined | null): boolean {
  const expected = c.env.ADMIN_TOKEN
  if (!expected || !token) return false
  return constantTimeEqual(token, expected)
}

export function bearerToken(c: Context<AppEnv>): string {
  const header = c.req.header('Authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

/** 管理 API 鉴权中间件 */
export const apiAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!tokenMatches(c, bearerToken(c))) {
    return c.json({ error: 'UNAUTHORIZED', message: '需要有效的管理 Token' }, 401)
  }
  await next()
}

/** 管理页面鉴权中间件：未登录跳转登录页 */
export const pageAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!tokenMatches(c, getCookie(c, ADMIN_COOKIE))) {
    return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`)
  }
  await next()
}

export function setAdminCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
}

export function clearAdminCookie(c: Context<AppEnv>): void {
  deleteCookie(c, ADMIN_COOKIE, { path: '/' })
}
