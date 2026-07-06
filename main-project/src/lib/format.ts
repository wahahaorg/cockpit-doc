// 金额格式化 —— 后端金额一律为字符串（DESIGN §7 / API_DOC 前端对接注意 1）。
// 严禁 parseFloat：用 decimal.js 保精度。展示 = 千分位 + ¥。
import Decimal from 'decimal.js'

/** 安全构造 Decimal，非法输入回退为 0（不崩溃）。 */
function toDec(value: string | number | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0)
  try {
    return new Decimal(value)
  } catch {
    return new Decimal(0)
  }
}

/** 千分位整数部分（保留两位小数则四舍五入到 0 位用于展示大额）。 */
function group(d: Decimal, decimals = 0): string {
  const fixed = d.toFixed(decimals)
  const neg = fixed.startsWith('-')
  const abs = neg ? fixed.slice(1) : fixed
  const [intPart, decPart] = abs.split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const body = decPart ? `${grouped}.${decPart}` : grouped
  return (neg ? '-' : '') + body
}

/** ¥ + 千分位，默认 0 位小数（驾驶舱大额展示）。 */
export function money(value: string | number | null | undefined, decimals = 0): string {
  return '¥' + group(toDec(value), decimals)
}

/** 纯千分位（无 ¥ 前缀），可指定小数位。 */
export function num(value: string | number | null | undefined, decimals = 0): string {
  return group(toDec(value), decimals)
}

/** 带符号金额（流入 +¥ / 流出 −¥）。direction 决定符号语义；amount 始终取绝对值展示。 */
export function signedMoney(
  amount: string | number | null | undefined,
  direction: 'inflow' | 'outflow' | 'neutral'
): string {
  const d = toDec(amount).abs()
  if (direction === 'inflow') return '+¥' + group(d, 0)
  if (direction === 'outflow') return '−¥' + group(d, 0)
  return '¥' + group(d, 0)
}

/** 万元格式化：12345678 → "1,234.57万"（整数不带小数，非整数最多 2 位、去尾零）。 */
function groupWan(value: string | number | null | undefined): string {
  const w = toDec(value).div(10000)
  const neg = w.isNegative()
  const s = w.abs().toFixed(2).replace(/\.?0+$/, '') // 去尾零："750" / "23.33" / "6.6"
  const [ip, dp] = s.split('.')
  const gip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (neg ? '-' : '') + (dp ? `${gip}.${dp}` : gip) + '万'
}

/** 按单位格式化金额：yuan → ¥千分位元；wan → ¥…万。 */
export function moneyU(
  value: string | number | null | undefined,
  unit: 'yuan' | 'wan',
  decimals = 0
): string {
  return unit === 'wan' ? '¥' + groupWan(value) : money(value, decimals)
}

/** 按单位格式化带符号金额（流入 +¥ / 流出 −¥）。 */
export function signedMoneyU(
  amount: string | number | null | undefined,
  direction: 'inflow' | 'outflow' | 'neutral',
  unit: 'yuan' | 'wan'
): string {
  if (unit !== 'wan') return signedMoney(amount, direction)
  const body = '¥' + groupWan(toDec(amount).abs().toString())
  if (direction === 'inflow') return '+' + body
  if (direction === 'outflow') return '−' + body
  return body
}

/** 字符串金额转 number（仅用于喂 Chart.js 绘图坐标，不用于任何业务计算/展示）。 */
export function toChartNumber(value: string | number | null | undefined): number {
  return toDec(value).toNumber()
}

/** 字符串金额 → 万元 number（图表坐标，仅绘图用）。 */
export function toWan(value: string | number | null | undefined): number {
  return toDec(value).div(10000).toNumber()
}

/** 置信度 0~1 → 百分比整数（如 0.91 → 91）。 */
export function confPct(c: number | null | undefined): number {
  if (c === null || c === undefined) return 0
  return Math.round(c * 100)
}

/** 比例字符串 0.02 → "2%"。 */
export function ratioPct(value: string | number | null | undefined, decimals = 0): string {
  return toDec(value).mul(100).toFixed(decimals) + '%'
}

/** 阈值使用率（used / threshold）→ 百分比整数，用于仪表。阈值为 0 时返回 0。 */
export function usageRate(used: string, threshold: string): number {
  const t = toDec(threshold)
  if (t.isZero()) return 0
  const r = toDec(used).div(t).mul(100)
  return Math.max(0, Math.round(r.toNumber()))
}

/** 由使用率与 band 配置判断红黄绿灯（与后端 ga-check 同口径，用于仪表本地着色）。 */
export function lightFromUsage(
  used: string,
  threshold: string,
  greenBand: string,
  yellowBand: string
): 'green' | 'amber' | 'red' {
  const t = toDec(threshold)
  if (t.isZero()) return 'red'
  const ratio = toDec(used).div(t)
  if (ratio.lte(toDec(greenBand))) return 'green'
  if (ratio.lte(toDec(yellowBand))) return 'amber'
  return 'red'
}
