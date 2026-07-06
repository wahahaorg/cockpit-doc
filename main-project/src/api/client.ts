// 统一 API client：注入 token、统一错误、401 跳登录、429 友好提示、超时。
// 不在组件里直接 fetch（工作规范）。所有接口经此层。
import { getToken, clearToken } from '../store/auth'

// base 默认空串 → 走 Vite dev proxy 的相对 /api（vite.config.ts）。生产可设 VITE_API_BASE。
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')

const DEFAULT_TIMEOUT = 20000

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

/** 触发全局登出（401）。App 监听此事件跳登录，避免在 client 里耦合 router。 */
function broadcastUnauthorized() {
  clearToken()
  window.dispatchEvent(new CustomEvent('cockpit:unauthorized'))
}

interface RequestOpts {
  method?: string
  body?: unknown
  // multipart 时传 FormData，不要设 Content-Type（浏览器自动带 boundary）
  formData?: FormData
  query?: Record<string, string | number | boolean | undefined | null>
  auth?: boolean // 默认 true
  timeout?: number
}

function buildQuery(query?: RequestOpts['query']): string {
  if (!query) return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? '?' + parts.join('&') : ''
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = 'GET', body, formData, query, auth = true, timeout = DEFAULT_TIMEOUT } = opts

  const headers: Record<string, string> = {}
  if (auth) {
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  let payload: BodyInit | undefined
  if (formData) {
    payload = formData
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  let resp: Response
  try {
    resp = await fetch(`${BASE}${path}${buildQuery(query)}`, {
      method,
      headers,
      body: payload,
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError('请求超时，请稍后重试', 0)
    }
    // 网络层失败（后端未启动等）—— 友好提示，不暴露堆栈
    throw new ApiError('无法连接服务，请确认后端已启动', 0)
  }
  clearTimeout(timer)

  if (resp.status === 401) {
    broadcastUnauthorized()
    throw new ApiError('登录已失效，请重新登录', 401)
  }
  if (resp.status === 429) {
    throw new ApiError('请求过于频繁，请稍后再试', 429)
  }

  let json: { success?: boolean; data?: T; message?: string; error?: { message?: string } } | null = null
  try {
    json = await resp.json()
  } catch {
    throw new ApiError('服务返回异常', resp.status)
  }

  if (!resp.ok || !json || json.success === false) {
    // 不向用户暴露后端堆栈，仅用其友好 message
    throw new ApiError(json?.error?.message || json?.message || '请求失败', resp.status)
  }
  return json.data as T
}

export const apiGet = <T>(path: string, query?: RequestOpts['query'], auth = true) =>
  request<T>(path, { method: 'GET', query, auth })

export const apiPost = <T>(path: string, body?: unknown, auth = true) =>
  request<T>(path, { method: 'POST', body, auth })

export const apiPatch = <T>(path: string, body?: unknown, auth = true) =>
  request<T>(path, { method: 'PATCH', body, auth })

export const apiUpload = <T>(path: string, formData: FormData) =>
  request<T>(path, { method: 'POST', formData, timeout: 60000 })

export async function apiSse(
  path: string,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { headers, signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('无法连接 AI 解释服务', 0)
  }
  if (!response.ok || !response.body) {
    throw new ApiError('AI 解释生成失败', response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() || ''
    for (const block of blocks) {
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('')
      if (data) onEvent(JSON.parse(data) as Record<string, unknown>)
    }
    if (done) break
  }
}
