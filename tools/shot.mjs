// Screenshot preview/panel.html with whatever Chromium is installed.
//
// tools/preview.mjs renders the panel to HTML; this hands that file to a real
// browser engine so the result can be looked at instead of guessed. No
// dependency: headless Chrome/Edge already understands --screenshot.
import { existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

const browser = CANDIDATES.find((path) => existsSync(path))
if (browser === undefined) {
  console.error('找不到 Chrome/Edge。装一个，或者手动打开 preview/panel.html 看效果。')
  process.exit(1)
}

const html = resolve('preview/panel.html')
if (!existsSync(html)) {
  console.error('preview/panel.html 还不存在 —— 先跑 node tools/preview.mjs')
  process.exit(1)
}

mkdirSync('preview', { recursive: true })
const out = resolve('preview/panel.png')
const args = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=1880,1250',
  '--screenshot=' + out,
  'file:///' + html.replace(/\\/g, '/'),
]
const result = spawnSync(browser, args, { stdio: 'inherit' })
if (result.status !== 0) {
  console.error('浏览器截图失败，退出码 ' + result.status)
  process.exit(result.status === null ? 1 : result.status)
}
console.log('截图写到 preview/panel.png（五页并排，每页 344px 宽）')
