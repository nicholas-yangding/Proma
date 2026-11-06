#!/usr/bin/env node
/**
 * verify-proma 的零依赖 CDP 驱动客户端（Node >= 21 或 Bun，依赖全局 fetch + WebSocket）。
 *
 * 通道说明：本应用主进程下 Chromium 内建 `--remote-debugging-port` 的 HTTP/WS 端点不响应
 * （最小 Electron 对照实验正常，根因在应用主进程，未深究）。因此走 Node inspector：
 * 应用需以 `--inspect=<port>` 启动，本脚本连主进程 inspector，在主进程上下文定位主窗口
 * webContents，经 `webContents.debugger` 驱动渲染进程。无需修改产品代码。
 *
 * 用法：
 *   cdp.mjs targets <port>                          列出全部 BrowserWindow 的 URL
 *   cdp.mjs eval <port> <js表达式>                  在主窗口页面执行 JS，输出结果 JSON
 *   cdp.mjs click <port> <css选择器>                等待元素出现并点击
 *   cdp.mjs clickText <port> <按钮可见文案>          按可见文本匹配 button/[role=button] 并点击
 *   cdp.mjs type <port> <css选择器> <文本>           向输入框写入文本（兼容 React 受控输入）
 *   cdp.mjs screenshot <port> <输出.png>            主窗口截图
 *
 * 主窗口选择：URL 含 127.0.0.1:5173 且不含 "?window=" 的窗口
 * （quick-task / detached-preview 等辅助窗口也挂在 5173，需排除）。
 * 连接失败、找不到元素等均以非 0 退出码报错。
 */

const WAIT_TIMEOUT_MS = 15_000

function fail(message) {
  console.error(`[cdp] ${message}`)
  process.exit(1)
}

/** 页面内执行的表达式模板：通过主进程转发到主窗口 renderer */
function forwardToRenderer(pageExpression) {
  return `(async () => {
    const { BrowserWindow } = process.mainModule.require('electron');
    const wins = BrowserWindow.getAllWindows();
    const win = wins.find(w => {
      const u = w.webContents.getURL();
      return u.includes('127.0.0.1:5173') && !u.includes('?window=');
    });
    if (!win) throw new Error('未找到主窗口。现有窗口: ' + wins.map(w => w.webContents.getURL()).join(' | '));
    const wc = win.webContents;
    try { wc.debugger.attach('1.3') } catch { /* 已 attach */ }
    const r = await wc.debugger.sendCommand('Runtime.evaluate', {
      expression: ${JSON.stringify(pageExpression)},
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error('页面内执行出错: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result?.value;
  })()`
}

async function main() {
  const [command, portArg, ...rest] = process.argv.slice(2)
  const port = Number(portArg)
  if (!command || !Number.isInteger(port) || port <= 0) {
    fail(`参数不完整。用法见文件头注释。收到: ${process.argv.slice(2).join(' ')}`)
  }

  // Node inspector discovery：/json/list 找 type==='node' 的 webSocketDebuggerUrl
  let wsUrl
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) fail(`inspector HTTP ${res.status}，端口 ${port} 上不是 Node inspector 端点`)
    const list = await res.json()
    const nodeTarget = list.find((t) => t.type === 'node')
    if (!nodeTarget) fail(`端口 ${port} 上没有 node inspector target`)
    wsUrl = nodeTarget.webSocketDebuggerUrl
  } catch (err) {
    if (err.message?.startsWith('inspector') || err.message?.startsWith('端口')) fail(err.message)
    fail(`无法连接 http://127.0.0.1:${port}/json/list（应用是否以 --inspect=${port} 启动？）：${err.message}`)
  }

  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), 10_000)
    ws.onopen = () => { clearTimeout(timer); resolve() }
    ws.onerror = () => { clearTimeout(timer); reject(new Error(`WebSocket 连接失败: ${wsUrl}`)) }
  })
  let nextId = 1
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    }
  }
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  /** 在主进程上下文 evaluate（返回值经 inspector 回传） */
  const evalInMain = async (expression) => {
    const result = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) {
      throw new Error(`主进程执行出错: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    }
    return result.result?.value
  }

  try {
    if (command === 'targets') {
      const summary = await evalInMain(`(async () => {
        const { BrowserWindow } = process.mainModule.require('electron');
        return BrowserWindow.getAllWindows().map(w => w.getTitle() + '  ' + w.webContents.getURL());
      })()`)
      for (const line of summary ?? []) console.log(line)
      return
    }

    if (command === 'screenshot') {
      const [outPath] = rest
      if (!outPath) fail('screenshot 需要输出文件路径')
      const written = await evalInMain(`(async () => {
        const { BrowserWindow } = process.mainModule.require('electron');
        const { writeFileSync } = process.mainModule.require('node:fs');
        const wins = BrowserWindow.getAllWindows();
        const win = wins.find(w => {
          const u = w.webContents.getURL();
          return u.includes('127.0.0.1:5173') && !u.includes('?window=');
        });
        if (!win) throw new Error('未找到主窗口。现有窗口: ' + wins.map(w => w.webContents.getURL()).join(' | '));
        const wc = win.webContents;
        try { wc.debugger.attach('1.3') } catch {}
        const shot = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
        writeFileSync(${JSON.stringify(outPath)}, Buffer.from(shot.data, 'base64'));
        return 'written ' + ${JSON.stringify(outPath)};
      })()`)
      console.log(written)
      return
    }

    if (command === 'eval' || command === 'click' || command === 'clickText' || command === 'type') {
      const argMap = { eval: 'JS 表达式', click: '选择器', clickText: '按钮文案', type: '选择器' }
      const [first, second] = rest
      if (!first) fail(`${command} 需要${argMap[command]}参数`)

      let pageExpression
      if (command === 'eval') {
        pageExpression = first
      } else if (command === 'click') {
        pageExpression = `(async () => {
          const deadline = Date.now() + ${WAIT_TIMEOUT_MS};
          const sel = ${JSON.stringify(first)};
          let el;
          while (Date.now() < deadline) {
            el = document.querySelector(sel);
            if (el) break;
            await new Promise(r => setTimeout(r, 200));
          }
          if (!el) throw new Error('未找到元素 ' + sel + '；当前可见文本: ' + document.body.innerText.slice(0,300));
          el.scrollIntoView({block:'center'});
          el.click();
          return 'clicked: ' + (el.innerText || el.tagName).slice(0,40);
        })()`
      } else if (command === 'clickText') {
        pageExpression = `(async () => {
          const deadline = Date.now() + ${WAIT_TIMEOUT_MS};
          const wanted = ${JSON.stringify(first)};
          while (Date.now() < deadline) {
            const els = [...document.querySelectorAll('button, [role="button"], a[href]')];
            const el = els.find(e => (e.innerText || '').trim().includes(wanted));
            if (el) { el.scrollIntoView({block:'center'}); el.click(); return 'clicked: ' + el.innerText.trim().slice(0,40); }
            await new Promise(r => setTimeout(r, 200));
          }
          throw new Error('未找到文案含 ' + JSON.stringify(wanted) + ' 的按钮；当前可见文本: ' + document.body.innerText.slice(0,300));
        })()`
      } else {
        if (second === undefined) fail('type 需要 <选择器> <文本> 两个参数')
        pageExpression = `(async () => {
          const sel = ${JSON.stringify(first)};
          const text = ${JSON.stringify(second)};
          const deadline = Date.now() + ${WAIT_TIMEOUT_MS};
          let el;
          while (Date.now() < deadline) {
            el = document.querySelector(sel);
            if (el) break;
            await new Promise(r => setTimeout(r, 200));
          }
          if (!el) throw new Error('未找到元素 ' + sel);
          el.focus();
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return 'typed into ' + sel;
        })()`
      }
      console.log(JSON.stringify(await evalInMain(forwardToRenderer(pageExpression)), null, 2) ?? 'undefined')
      return
    }

    fail(`未知子命令: ${command}`)
  } finally {
    ws.close()
  }
}

main().catch((err) => fail(err.message))
