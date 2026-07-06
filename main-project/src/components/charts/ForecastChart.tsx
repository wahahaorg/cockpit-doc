// 回款滚动预测：青柱（每月预计回流）+ 金线（累计现金位置，负转正变绿）+ 转正月份虚线标注。
// 高保真稿 design/index.html #fc + turnPlugin 复刻。
import { useEffect, useRef } from 'react'
import { ChartJS, HEX } from '../../lib/charts'
import type { Chart } from 'chart.js'

interface Props {
  labels: string[] // 月份标签 如 "1月"
  inflowWan: number[] // 每月预计回流（万元）
  cumulativeWan: number[] // 累计现金位置（万元）
  turnPositiveIndex: number | null // 转正月份在数组中的下标，null 表示无
}

export function ForecastChart({ labels, inflowWan, cumulativeWan, turnPositiveIndex }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    chartRef.current?.destroy()

    // 转正竖线插件（局部，挂在本图实例，不污染全局）
    const turnPlugin = {
      id: 'turnPositive',
      afterDatasetsDraw(c: Chart) {
        if (turnPositiveIndex == null || turnPositiveIndex < 0) return
        const x = c.scales.x.getPixelForValue(turnPositiveIndex)
        const { top, bottom } = c.chartArea
        const ctx = c.ctx
        ctx.save()
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = 'rgba(53,214,154,.6)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(x, top)
        ctx.lineTo(x, bottom)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = HEX.green
        ctx.font = "600 11px 'Chakra Petch'"
        const label = `▲ 转正 · ${labels[turnPositiveIndex] ?? ''}`
        // 避免文字超出右边界
        const textW = ctx.measureText(label).width
        const drawX = x + 6 + textW > c.chartArea.right ? x - 6 - textW : x + 6
        ctx.fillText(label, drawX, top + 14)
        ctx.restore()
      },
    }

    chartRef.current = new ChartJS(canvas, {
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: '每月预计回流',
            data: inflowWan,
            backgroundColor: HEX.cyanFill,
            borderColor: HEX.cyan,
            borderWidth: 1,
            borderRadius: 3,
            yAxisID: 'y',
            order: 2,
            barPercentage: 0.6,
          },
          {
            type: 'line',
            label: '累计现金位置',
            data: cumulativeWan,
            borderColor: HEX.gold,
            borderWidth: 2.5,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
            yAxisID: 'y1',
            order: 1,
            // 负→正段变绿（与高保真稿一致）
            segment: {
              borderColor: (ctx) => ((ctx.p1.parsed.y ?? 0) >= 0 ? HEX.green : HEX.gold),
            },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: HEX.panel,
            borderColor: 'rgba(54,224,224,.3)',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (item) => `${item.dataset.label}: ${item.formattedValue}万`,
            },
          },
        },
        scales: {
          x: { grid: { color: HEX.grid }, ticks: { maxRotation: 0 } },
          y: {
            position: 'left',
            grid: { color: HEX.grid },
            ticks: { callback: (v) => v + '万' },
          },
          y1: {
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: {
              color: HEX.gold,
              callback: (v) => {
                const n = Number(v)
                return (n < 0 ? '-' : '') + '¥' + Math.abs(n) + '万'
              },
            },
          },
        },
      },
      plugins: [turnPlugin],
    })

    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [labels, inflowWan, cumulativeWan, turnPositiveIndex])

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="回款滚动预测：每月预计回流柱状与累计现金位置曲线"
    />
  )
}
