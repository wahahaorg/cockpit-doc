// 金额单位切换：元 / 万元。本机持久化 + 事件广播，组件用 useUnit() 订阅后自动重渲染。
import { useEffect, useState } from 'react'

export type Unit = 'yuan' | 'wan'
const KEY = 'cockpit:unit'
const EVT = 'cockpit:unit-change'

export function getUnit(): Unit {
  try {
    return localStorage.getItem(KEY) === 'wan' ? 'wan' : 'yuan'
  } catch {
    return 'yuan'
  }
}

export function setUnit(u: Unit): void {
  try {
    localStorage.setItem(KEY, u)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: u }))
}

/** 订阅当前金额单位；切换时本组件自动重渲染。 */
export function useUnit(): Unit {
  const [u, setU] = useState<Unit>(getUnit)
  useEffect(() => {
    const h = (e: Event) => setU((e as CustomEvent).detail as Unit)
    window.addEventListener(EVT, h)
    return () => window.removeEventListener(EVT, h)
  }, [])
  return u
}
