// Chart.js 全局注册 + 暗色主题默认。
// canvas 无法解析 CSS 变量（DESIGN §8），故图表用硬编码 hex，与高保真稿一致。
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  BarController,
  LineController,
  DoughnutController,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  BarController,
  LineController,
  DoughnutController,
  ArcElement,
  Filler,
  Tooltip,
  Legend
)

// 与高保真稿一致的全局默认
ChartJS.defaults.color = '#5A6986'
ChartJS.defaults.font.family = "'JetBrains Mono', monospace"
ChartJS.defaults.font.size = 11

/** 高保真稿配色（hex 硬编码，对应 DESIGN §2 token）。 */
export const HEX = {
  cyan: '#0E8FA0',
  cyanFill: 'rgba(14,143,160,0.30)',
  gold: '#B5791A',
  green: '#0F9E6B',
  amber: '#C68406',
  red: '#D83A57',
  panel: '#1A2336',
  grid: 'rgba(20,40,80,0.08)',
  trackDim: 'rgba(20,40,80,0.12)',
} as const

export { ChartJS }
