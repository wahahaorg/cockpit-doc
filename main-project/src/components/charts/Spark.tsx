// hero 缺口走势 spark（近 N 月累计现金位置缺口走势）。
// 用 forecast 的 cumulativeCash（万元）作为走势，负值红色渐变填充。
import { useEffect, useRef } from 'react'
import { ChartJS, HEX } from '../../lib/charts'
import type { Chart } from 'chart.js'

interface Props {
  values: number[] // 万元数组（绘图坐标，非业务计算）
}

export function Spark({ values }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    chartRef.current?.destroy()

    chartRef.current = new ChartJS(canvas, {
      type: 'line',
      data: {
        labels: values.map((_, i) => String(i + 1)),
        datasets: [
          {
            data: values,
            borderColor: HEX.red,
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 0,
            fill: true,
            backgroundColor: (c) => {
              const ctx = c.chart.ctx
              const g = ctx.createLinearGradient(0, 0, 0, 42)
              g.addColorStop(0, 'rgba(255,84,112,.25)')
              g.addColorStop(1, 'rgba(255,84,112,0)')
              return g
            },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
      },
    })
    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [values])

  return <canvas ref={ref} role="img" aria-label="现金流缺口走势" />
}
