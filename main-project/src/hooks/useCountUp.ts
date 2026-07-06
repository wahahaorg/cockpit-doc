// Hero 数字 count-up（DESIGN §6：~900ms easeOut）。输入为字符串金额，内部解析为目标整数。
// 仅用于展示动画，最终落到 千分位 格式（en-US locale）。
import { useEffect, useRef, useState } from 'react'

export function useCountUp(target: number, durationMs = 950): number {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced || !Number.isFinite(target)) {
      setValue(target)
      return
    }
    const t0 = performance.now()
    const step = (t: number) => {
      let p = Math.min((t - t0) / durationMs, 1)
      p = 1 - Math.pow(1 - p, 3) // easeOutCubic
      setValue(Math.round(target * p))
      if (p < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [target, durationMs])

  return value
}
