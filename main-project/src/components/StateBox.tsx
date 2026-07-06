// loading / error / empty 三态统一组件（工作规范：三态都要处理）。

interface Props {
  ico?: string
  msg: string
  sub?: string
  onRetry?: () => void
}

export function Loading({ msg = '加载中…' }: { msg?: string }) {
  return (
    <div className="state-box">
      <div className="spinner" />
      <div className="msg">{msg}</div>
    </div>
  )
}

export function ErrorState({ msg, sub, onRetry }: Props) {
  return (
    <div className="state-box">
      <div className="ico" style={{ color: 'var(--red)' }}>
        ⚠
      </div>
      <div className="msg">{msg}</div>
      {sub && <div className="sub">{sub}</div>}
      {onRetry && (
        <button className="retry-btn" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  )
}

export function Empty({ ico = '∅', msg, sub }: Props) {
  return (
    <div className="state-box">
      <div className="ico">{ico}</div>
      <div className="msg">{msg}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}
