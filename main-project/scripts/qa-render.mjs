// 自检脚本：用 headless Chrome（CDP，无额外依赖）驱动四个页面，截图 + 收集 console 报错。
// 用法：node scripts/qa-render.mjs <baseUrl> <passcode>
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = process.argv[2] || 'http://localhost:5173'
const PASSCODE = process.argv[3] || 'cockpit-demo-2026'
const OUT = '/tmp/cockpit-qa'
mkdirSync(OUT, { recursive: true })

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--remote-allow-origins=*',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--user-data-dir=/tmp/cockpit-qa-profile',
  '--window-size=1440,1600',
  'about:blank',
])
chrome.stderr.on('data', () => {})

let nextId = 1
function send(ws, method, params = {}, sessionId) {
  const id = nextId++
  const msg = { id, method, params }
  if (sessionId) msg.sessionId = id && sessionId
  return new Promise((resolve, reject) => {
    const handler = (ev) => {
      const data = JSON.parse(ev.data)
      if (data.id === id) {
        ws.removeEventListener('message', handler)
        if (data.error) reject(new Error(method + ': ' + data.error.message))
        else resolve(data.result)
      }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify(msg))
  })
}

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      const j = await r.json()
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('Chrome CDP not ready')
}

const consoleErrors = []

async function main() {
  const wsUrl = await getWsUrl()
  const browser = await new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => res(ws)
    ws.onerror = (e) => rej(new Error('ws err'))
  })

  // create page target + attach (flat session)
  const { targetId } = await send(browser, 'Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send(browser, 'Target.attachToTarget', { targetId, flatten: true })

  // helper: send with sessionId on flat protocol
  function sendS(method, params = {}) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      const handler = (ev) => {
        const data = JSON.parse(ev.data)
        if (data.id === id) {
          browser.removeEventListener('message', handler)
          if (data.error) reject(new Error(method + ': ' + data.error.message))
          else resolve(data.result)
        }
      }
      browser.addEventListener('message', handler)
      browser.send(JSON.stringify({ id, method, params, sessionId }))
    })
  }

  // collect console errors + exceptions
  browser.addEventListener('message', (ev) => {
    const data = JSON.parse(ev.data)
    if (data.sessionId !== sessionId) return
    if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
      consoleErrors.push('[console.error] ' + data.params.args.map((a) => a.value || a.description || '').join(' '))
    }
    if (data.method === 'Runtime.exceptionThrown') {
      const d = data.params.exceptionDetails
      consoleErrors.push('[exception] ' + (d.exception?.description || d.text))
    }
    if (data.method === 'Log.entryAdded' && data.params.entry.level === 'error') {
      // 过滤 favicon 等无害网络 404
      const t = data.params.entry.text || ''
      if (!/favicon/i.test(t)) consoleErrors.push('[log.error] ' + t)
    }
  })

  await sendS('Page.enable')
  await sendS('Runtime.enable')
  await sendS('Log.enable')
  await sendS('Network.enable')

  async function nav(url) {
    await sendS('Page.navigate', { url })
    await sleep(1500)
  }
  async function evalJs(expr) {
    const r = await sendS('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  }
  async function shot(name) {
    const { data } = await sendS('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: true })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(data, 'base64'))
  }

  // 1) Login page
  await nav(`${BASE}/login`)
  await shot('1-login')
  const loginTitle = await evalJs(`document.querySelector('.login-card h2')?.textContent || ''`)

  // perform login via UI
  await evalJs(`(() => {
    const inp = document.querySelector('#passcode');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(inp, ${JSON.stringify(PASSCODE)});
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    return inp.value;
  })()`)
  await sleep(200)
  await evalJs(`document.querySelector('.btn-primary')?.click()`)
  await sleep(2500)

  // 2) Dashboard
  const dashUrl = await evalJs('location.pathname')
  await sleep(1500)
  await shot('2-dashboard')
  const gapText = await evalJs(`document.querySelector('.gap-num')?.textContent || ''`)
  const hasForecastCanvas = await evalJs(`!!document.querySelector('.chart-box canvas')`)
  const gaugePct = await evalJs(`document.querySelector('.gauge-center .pct')?.textContent || ''`)
  const downgraded = await evalJs(`!!document.querySelector('.degraded')`)
  const gaCheckLight = await evalJs(`document.querySelector('.check .light')?.textContent?.trim() || ''`)
  const chartPixels = await evalJs(`(() => {
    const c = document.querySelector('.chart-box canvas');
    if(!c) return 0;
    return c.width * c.height;
  })()`)

  // 3) Review
  await nav(`${BASE}/review`)
  await sleep(1500)
  await shot('3-review')
  const rowCount = await evalJs(`document.querySelectorAll('table tbody tr').length`)
  const hasConfBar = await evalJs(`!!document.querySelector('.conf .bar i')`)
  const reviewTotal = await evalJs(`document.querySelector('.panel .calc-tag')?.textContent || ''`)

  // 4) Config
  await nav(`${BASE}/config`)
  await sleep(1500)
  await shot('4-config')
  const cfgCount = await evalJs(`document.querySelectorAll('.cfg-item').length`)
  const placeholderTags = await evalJs(`document.querySelectorAll('.cfg-item .place-tag').length`)

  console.log(JSON.stringify({
    loginTitle,
    dashUrl,
    gapText,
    hasForecastCanvas,
    chartPixels,
    gaugePct,
    downgraded,
    gaCheckLight,
    reviewRowCount: rowCount,
    reviewTotal,
    hasConfBar,
    cfgCount,
    placeholderTags,
    consoleErrors,
  }, null, 2))

  await sendS('Target.closeTarget', { targetId }).catch(() => {})
  browser.close()
  chrome.kill()
}

main()
  .then(() => { setTimeout(() => process.exit(0), 300) })
  .catch((e) => { console.error('QA FAILED:', e.message); console.error('consoleErrors:', consoleErrors); chrome.kill(); process.exit(1) })
