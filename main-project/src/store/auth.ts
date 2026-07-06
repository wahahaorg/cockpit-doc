// 会话 token 存取。
// 合规说明（DESIGN §7 / 全局红线）：理想方案是 httpOnly cookie；但本后端按契约
// 返回 JWT 由前端持有（Bearer），内网单人 demo 场景下用 sessionStorage（关页即失，
// 比 localStorage 暴露面更小），且只存 token 本身，不存口令原文。读取全程 try/catch。

const KEY = 'cockpit_token'

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    sessionStorage.setItem(KEY, token)
  } catch {
    // 存储不可用时静默：本会话内仍可用内存态由调用方持有
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
}

export function isLoggedIn(): boolean {
  return !!getToken()
}
