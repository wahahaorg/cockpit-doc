// 管理费用阈值径向仪表（红黄绿灯 doughnut）。使用率超 100% 时弧封顶到满圈并用红色。
// 高保真稿 design/index.html #gg 复刻（cutout 76% / circumference 270 / rotation 225）。
import { useEffect, useRef } from 'react'
import { ChartJS, HEX } from '../../lib/charts'
import type { Chart } from 'chart.js'

interface Props {
  /** 使用率百分比（可 >100） */
  pct: number
  /** 红黄绿灯 */
  light: 'green' | 'amber' | 'red'
}

const COLOR = { green: HEX.green, amber: HEX.amber, red: HEX.red }

export function Gauge({ pct, light }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    chartRef.current?.destroy()

    const filled = Math.min(Math.max(pct, 0), 100)
    const rest = 100 - filled

    chartRef.current = new ChartJS(canvas, {
      type: 'doughnut',
      data: {
        datasets: [
          {
            data: [filled, rest],
            backgroundColor: [COLOR[light], HEX.trackDim],
            borderWidth: 0,
            circumference: 270,
            rotation: 225,
          },
        ],
      },
      options: {
        responsive: false,
        cutout: '76%',
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    })
    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [pct, light])

  return (
    <canvas
      ref={ref}
      width={220}
      height={178}
      role="img"
      aria-label={`管理费用阈值使用率 ${pct}%`}
    />
  )
}
