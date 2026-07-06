// 流水上传 + 分类复核页。
// 上传 Excel/CSV → 触发分类 → 列表（置信度彩条、低置信 amber 高亮、规则/AI 区分）、一键改标、失败清单可重跑。
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  importTransactions,
  runClassification,
  listClassification,
  relabel,
  health,
  ApiError,
} from '../api'
import type {
  ClassificationItem,
  ClassificationRunResp,
  ImportResp,
  Axis,
} from '../api/types'
import { TopBar } from '../components/TopBar'
import { Loading, ErrorState, Empty } from '../components/StateBox'
import { signedMoneyU, confPct } from '../lib/format'
import { useUnit } from '../store/unit'
import { HEX } from '../lib/charts'

type AxisFilter = 'all' | Axis
type ReviewFilter = 'all' | 'review'

const AXIS_LABEL: Record<Axis, string> = { income: '收', expense: '支', info: '信息流' }
const AXIS_CLASS: Record<Axis, string> = { income: 'inc', expense: 'exp', info: 'info' }

export function Review() {
  const [batchId, setBatchId] = useState<number | null>(1) // 默认看种子 batch=1
  const [items, setItems] = useState<ClassificationItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [downgraded, setDowngraded] = useState(false)
  const [llmEnabled, setLlmEnabled] = useState(false)

  const [axisFilter, setAxisFilter] = useState<AxisFilter>('all')
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')

  // 上传状态
  const [importInfo, setImportInfo] = useState<ImportResp | null>(null)
  const [runInfo, setRunInfo] = useState<ClassificationRunResp | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // 改标状态
  const [relabeling, setRelabeling] = useState<number | null>(null)

  const fetchList = useCallback(async () => {
    if (batchId == null) {
      setItems([])
      setTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setErr(null)
    try {
      const resp = await listClassification({
        batchId,
        axis: axisFilter === 'all' ? undefined : axisFilter,
        needReview: reviewFilter === 'review' ? true : undefined,
        pageSize: 200,
      })
      setItems(resp.items)
      setTotal(resp.total)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [batchId, axisFilter, reviewFilter])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  useEffect(() => {
    health()
      .then((h) => {
        setLlmEnabled(h.llmEnabled)
        setDowngraded(!h.llmEnabled)
      })
      .catch(() => {})
  }, [])

  async function handleFile(file: File) {
    setUploadErr('')
    setImportInfo(null)
    setRunInfo(null)
    setUploading(true)
    try {
      const imp = await importTransactions(file)
      setImportInfo(imp)
      // 触发分类
      const run = await runClassification(imp.importBatchId)
      setRunInfo(run)
      setDowngraded(run.downgraded)
      setBatchId(imp.importBatchId)
      setAxisFilter('all')
      setReviewFilter('all')
    } catch (e) {
      setUploadErr(e instanceof ApiError ? e.message : '上传失败')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void handleFile(f)
  }

  async function rerunFailed() {
    if (!runInfo || runInfo.failedTxnIds.length === 0) return
    setUploading(true)
    setUploadErr('')
    try {
      const run = await runClassification(runInfo.batchId, runInfo.failedTxnIds)
      setRunInfo(run)
      setDowngraded(run.downgraded)
      await fetchList()
    } catch (e) {
      setUploadErr(e instanceof ApiError ? e.message : '重跑失败')
    } finally {
      setUploading(false)
    }
  }

  async function doRelabel(item: ClassificationItem, newAxis: Axis) {
    if (newAxis === item.axis) return
    setRelabeling(item.id)
    try {
      const updated = await relabel(item.id, newAxis, '人工复核改标')
      setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)))
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '改标失败')
    } finally {
      setRelabeling(null)
    }
  }

  return (
    <>
      <TopBar downgraded={downgraded} periodLabel="流水复核" />
      <div className="scan" />

      <div className="wrap">
        {/* 上传区 */}
        <div className="panel" style={{ animationDelay: '.05s' }}>
          <div className="phead">
            <div className="t">
              <b />
              流水上传 · Excel / CSV
            </div>
            <div className="calc-tag">{llmEnabled ? 'AI 辅助分类' : '规则分类(AI 未启用)'}</div>
          </div>

          <div
            className={'upload-zone' + (drag ? ' drag' : '')}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click()
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
              }}
            />
            {uploading ? (
              <Loading msg="解析并分类中…" />
            ) : (
              <>
                <div className="big">点击或拖拽 Excel / CSV 流水文件到此</div>
                <div className="small">
                  支持 .xlsx / .csv · 表头自动识别中英文别名 · 解析失败行进失败清单不丢数据
                </div>
              </>
            )}
          </div>

          {uploadErr && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--red)' }}>{uploadErr}</div>
          )}

          {importInfo && (
            <div className="toolbar section-gap" style={{ marginBottom: 0 }}>
              <span className="pill cyan">批次 #{importInfo.importBatchId}</span>
              <span className="pill green">解析 {importInfo.parsedRows}/{importInfo.totalRows} 行</span>
              {importInfo.failedRows > 0 && (
                <span className="pill red">解析失败 {importInfo.failedRows} 行</span>
              )}
              {runInfo && (
                <>
                  <span className="pill green">规则 {runInfo.byRule}</span>
                  <span className="pill cyan">AI {runInfo.byLlm}</span>
                  {runInfo.needReview > 0 && (
                    <span className="pill amber">待人工 {runInfo.needReview}</span>
                  )}
                  {runInfo.downgraded && <span className="pill amber">规则降级模式</span>}
                </>
              )}
            </div>
          )}

          {/* 解析失败明细 */}
          {importInfo && importInfo.failedDetail.length > 0 && (
            <div className="section-gap" style={{ fontSize: 12, color: 'var(--dim)' }}>
              <div style={{ color: 'var(--amber)', marginBottom: 6 }}>解析失败行：</div>
              {importInfo.failedDetail.map((f) => (
                <div key={f.rowIndex}>
                  第 {f.rowIndex} 行 · {f.reason}
                </div>
              ))}
            </div>
          )}

          {/* 分类失败清单可重跑 */}
          {runInfo && runInfo.failedTxnIds.length > 0 && (
            <div className="toolbar section-gap" style={{ marginBottom: 0 }}>
              <span className="pill red">
                分类失败 {runInfo.failedTxnIds.length} 条（已标待人工，未丢数据）
              </span>
              <button className="retry-btn" onClick={rerunFailed} disabled={uploading}>
                重跑失败条目
              </button>
            </div>
          )}
        </div>

        {/* 分类复核表 */}
        <div className="panel section-gap" style={{ animationDelay: '.12s' }}>
          <div className="phead">
            <div className="t">
              <b />
              流水分类复核 · Transaction Review
              <span className="aitag">
                {llmEnabled ? 'AI 分类 · 置信度' : '规则分类 · 置信度'} · 低置信高亮 · 一键改标
              </span>
            </div>
            <div className="calc-tag">{total} 条</div>
          </div>

          {/* 过滤工具条 */}
          <div className="toolbar">
            <div className="seg">
              {(['all', 'income', 'expense', 'info'] as AxisFilter[]).map((a) => (
                <button
                  key={a}
                  className={axisFilter === a ? 'active' : ''}
                  onClick={() => setAxisFilter(a)}
                >
                  {a === 'all' ? '全部轴' : AXIS_LABEL[a]}
                </button>
              ))}
            </div>
            <div className="seg">
              {(['all', 'review'] as ReviewFilter[]).map((r) => (
                <button
                  key={r}
                  className={reviewFilter === r ? 'active' : ''}
                  onClick={() => setReviewFilter(r)}
                >
                  {r === 'all' ? '全部' : '待人工确认'}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <Loading msg="加载分类结果…" />
          ) : err ? (
            <ErrorState msg={err} onRetry={fetchList} />
          ) : items.length === 0 ? (
            <Empty msg="暂无分类记录" sub="上传一份流水文件开始，或调整筛选条件" />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>摘要</th>
                    <th>金额</th>
                    <th>三轴</th>
                    <th>来源</th>
                    <th>置信度</th>
                    <th>状态</th>
                    <th>改标</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <ReviewRow
                      key={it.id}
                      item={it}
                      busy={relabeling === it.id}
                      onRelabel={doRelabel}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="footnote">
            <span>
              <i style={{ background: 'var(--green)' }} />
              规则前置 · 不耗 token
            </span>
            <span>
              <i style={{ background: 'var(--cyan)' }} />
              AI 分类(通义){downgraded ? ' · 当前未启用' : ''}
            </span>
            <span>
              <i style={{ background: 'var(--amber)' }} />
              低于置信阈值 · 待人工
            </span>
            <span style={{ color: 'var(--dimmer)' }}>对方账户已脱敏 · 改标自动留痕</span>
          </div>
        </div>
      </div>
    </>
  )
}

function confColor(item: ClassificationItem): string {
  if (item.needReview) return HEX.amber
  if (item.source === 'llm') return HEX.cyan
  return HEX.green
}

function ReviewRow({
  item,
  busy,
  onRelabel,
}: {
  item: ClassificationItem
  busy: boolean
  onRelabel: (item: ClassificationItem, axis: Axis) => void
}) {
  const [open, setOpen] = useState(false)
  const unit = useUnit()
  const pct = confPct(item.confidence)
  const barColor = confColor(item)
  const srcLabel =
    item.source === 'llm'
      ? 'AI'
      : item.source === 'manual'
        ? '人工'
        : item.source === 'llm_failed'
          ? 'AI失败'
          : '规则'
  const isAi = item.source === 'llm' || item.source === 'llm_failed'

  return (
    <tr className={item.needReview ? 'review' : ''}>
      <td>
        <div>{item.summary || '—'}</div>
        <div style={{ fontSize: 11, color: 'var(--dimmer)', marginTop: 2 }}>
          {item.txnDate} · {item.counterpartyMasked}
        </div>
      </td>
      <td className={'amt ' + (item.direction === 'inflow' ? 'in' : 'out')}>
        {signedMoneyU(item.amount, item.direction, unit)}
      </td>
      <td>
        <span className={'axis ' + AXIS_CLASS[item.axis]}>{AXIS_LABEL[item.axis]}</span>
      </td>
      <td>
        <span className={'src' + (isAi ? ' ai' : '')}>{srcLabel}</span>
      </td>
      <td>
        <div className="conf">
          <div className="bar">
            <i style={{ width: `${pct}%`, background: barColor }} />
          </div>
          <span className="pct" style={{ color: item.needReview ? 'var(--amber)' : undefined }}>
            {item.confidence != null ? item.confidence.toFixed(2) : '—'}
          </span>
        </div>
      </td>
      <td>
        <span className={'state ' + (item.needReview ? 'rv' : 'ok')}>
          {item.needReview ? '待人工确认' : item.isBadCase ? '已改标' : '已分类'}
        </span>
      </td>
      <td>
        {open ? (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            {(['income', 'expense', 'info'] as Axis[]).map((a) => (
              <button
                key={a}
                className="relabel"
                disabled={busy}
                onClick={() => {
                  onRelabel(item, a)
                  setOpen(false)
                }}
              >
                {AXIS_LABEL[a]}
              </button>
            ))}
          </span>
        ) : (
          <button className="relabel" disabled={busy} onClick={() => setOpen(true)}>
            {busy ? '保存中…' : '改标'}
          </button>
        )}
      </td>
    </tr>
  )
}
