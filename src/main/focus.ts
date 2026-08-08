import { app, BrowserWindow, Notification, globalShortcut } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { getSetting, setSetting } from './database'
import { runPS, ALT_KEY_UNLOCK_SCRIPT, TASKBAR_HIDE_SCRIPT, TASKBAR_SHOW_SCRIPT } from './ps'
import {
  createFocusOverlays, showFocusOverlays, destroyFocusOverlays, isFocusOverlayHwnd, ensureOverlaysFullscreen,
  raiseHwndAboveOverlay, raiseBrowserWindow, unraiseHwnd,
} from './overlay'

// ─── 类型 ───

/** 白名单条目：进程名（如 chrome.exe）+ 可选路径/显示名/窗口标题关键词 */
export interface FocusApp {
  name: string
  path?: string
  title?: string
  /** 窗口标题关键词：设置后仅当前台窗口标题包含该关键词时才放行（窗口级锁定） */
  titleMatch?: string
  /** 锁窗口时记录的网址：点击图标时直接用浏览器导航到该地址（精确跳转，不依赖标题匹配） */
  url?: string
  /** 仅显示模式：点击图标只把浏览器/窗口调出来（切到匹配窗口），不导航新开页面 */
  switchOnly?: boolean
}

/** 专注状态（renderer 查询用） */
export interface FocusState {
  active: boolean
  endAt: number
  durationMin: number
  remainingSec: number
  whitelist: FocusApp[]
}

/** 专注倒计时推送（主进程 → renderer） */
export interface FocusTick {
  active: boolean
  endAt: number
  durationMin: number
  remainingSec: number
}

/** 主窗口访问钩子（由 index.ts 注入，避免循环依赖） */
export interface FocusHooks {
  getMainWindow: () => BrowserWindow | null
  /** 严格模式学习时段内是否锁定（禁止结束专注）；由 index.ts 注入，避免与 schedule.ts 循环依赖 */
  isScheduleLocked?: () => boolean
}

// ─── 状态 ───

interface FocusSession {
  active: boolean
  endAt: number
  durationMin: number
  whitelist: FocusApp[]
  /**
   * 宽限期（30s）：点击图标后显示【主界面】时给该进程短暂整体放行——
   * 哔哩哔哩这类没有网址直达的应用，用户需要在主界面里手动搜索/找内容。
   * 浏览器（URL 直达）不需要宽限，3s 观察缓冲足够。
   * videoWasOpen：设置宽限时匹配窗口是否已打开——已打开 = 用户主动要用主界面，宽限不被自动清除。
   */
  grace: { name: string; until: number; videoWasOpen: boolean } | null
}

interface ForegroundApp {
  pid: number
  name: string
  hwndHex: string
  title: string
}

let session: FocusSession = { active: false, endAt: 0, durationMin: 0, whitelist: [], grace: null }
let hooks: FocusHooks = { getMainWindow: () => null }
let fgWatcher: ChildProcess | null = null
let fgBuffer = ''
let lastForeground: ForegroundApp | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
let safetyTimer: ReturnType<typeof setInterval> | null = null
let guardTimer: ReturnType<typeof setInterval> | null = null
let scanTimer: ReturnType<typeof setInterval> | null = null
/** 全窗口扫描进行中（防止上一轮未完成时重复扫描） */
let scanning = false
/** 会话期间被抬升到专注桌面之上的窗口句柄（结束时统一取消置顶恢复现场） */
const raisedHwnds = new Set<string>()
/** 上次抬升过的前台窗口（避免对同一窗口重复抬升） */
let lastRaisedHwnd: string | null = null

/**
 * 窗口观察缓冲：浏览器加载页面/切换标签时标题短暂不匹配（如"新标签页"→"高考物理"），
 * 给 3s 观察期再判定，避免"一闪一闪"。仅对白名单窗口级条目进程生效，进程级不受影响。
 */
const WINDOW_BUFFER_MS = 3000
const windowSeen = new Map<string, { title: string; at: number }>()

/** 窗口是否处于观察期（首次出现或标题刚变化 1.5s 内） */
function inWindowBuffer(hwndHex: string, title: string): boolean {
  const prev = windowSeen.get(hwndHex)
  const now = Date.now()
  if (!prev || prev.title !== title) {
    windowSeen.set(hwndHex, { title, at: now })
    return true
  }
  return now - prev.at < WINDOW_BUFFER_MS
}

/**
 * 多窗口应用名单：这类进程的窗口/标签标题有加载过渡（如"新标签页"→目标页），
 * 需要 3s 观察缓冲；单窗口进程标题稳定，不需要缓冲（打开后立即判定）。
 */
const MULTI_WINDOW_NAMES = ['chrome', 'msedge', 'firefox', 'opera', 'brave', 'edge', 'bilibili', '哔哩哔哩']

function isMultiWindowApp(procName: string): boolean {
  const base = procName.toLowerCase().replace(/\.exe$/, '')
  return MULTI_WINDOW_NAMES.some(n => base.includes(n))
}

/**
 * 是否允许"关闭/强杀"不匹配窗口的进程。
 * 用户要求：只有哔哩哔哩客户端可以杀（其窗口级锁定依赖关闭不匹配的视频窗口）；
 * 浏览器等其他应用一律只覆盖不杀——强杀浏览器会丢失全部标签页/数据。
 */
function isKillable(procName: string): boolean {
  const base = procName.toLowerCase().replace(/\.exe$/, '')
  return base.includes('哔哩哔哩') || base.includes('bilibili')
}

/** 本应用自身进程名（开发态 electron.exe / 打包态 澜山.exe） */
const SELF_NAME = (process.execPath.split(/[\\/]/).pop() || '').toLowerCase()
/** 图标缓存目录 */
const ICON_DIR = join(app.getPath('home'), '澜山数据', 'cache', 'icons')

// ─── PowerShell 脚本 ───

/** 常驻前台监控：每 500ms 输出一行 `pid|进程名|窗口句柄hex|窗口标题` */
const FG_WATCH_SCRIPT = `
$OutputEncoding=[System.Text.Encoding]::UTF8
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$src='using System;using System.Runtime.InteropServices;using System.Text;public static class FG{[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd,out uint pid);[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);}'
Add-Type -TypeDefinition $src
while($true){
  try{
    $h=[FG]::GetForegroundWindow()
    $p=0
    [void][FG]::GetWindowThreadProcessId($h,[ref]$p)
    $proc=Get-Process -Id $p -ErrorAction SilentlyContinue
    if($proc -and $h -ne [IntPtr]::Zero){
      $hw=('{0:X}' -f $h.ToInt64())
      $sb=New-Object System.Text.StringBuilder 512
      [void][FG]::GetWindowText($h,$sb,512)
      [Console]::Out.WriteLine(("{0}|{1}|{2}|{3}" -f $proc.Id,$proc.ProcessName,$hw,$sb.ToString()))
    }else{
      [Console]::Out.WriteLine('0|-|-|-')
    }
  }catch{
    [Console]::Out.WriteLine('-|-|-|-')
  }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 500
}`

/** 查询某进程的全部可见窗口：hwndhex|pid|是否最小化|宽|高|标题 每行一个。
 *  枚举用 C# 原生委托实现——PS 5.1 的 scriptblock 委托对 EnumWindows 回调不生效
 *  （回调永远不被调用，枚举恒为空，曾导致"有窗口却判定无窗口"→ 误 spawn 双实例黑屏）。
 *  最小化窗口（IsIconic）尺寸会变成任务栏图标大小（如 158x26），必须放行——
 *  否则最小化在任务栏的程序会被误判"无窗口"→ 被杀掉重启（用户反馈"每次点都强制重启"）。
 *  仅过滤正常状态下宽高比极端的辅助窗口（桌面歌词/迷你条等，宽高比 >3:1 或 <1:3）。 */
interface ProcWin { hwndHex: string; pid: number; minimized: boolean; width: number; height: number; title: string }

async function getProcessWindows(procName: string): Promise<ProcWin[]> {
  const esc = procName.replace(/'/g, "''")
  const script = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;public static class GW{[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb,IntPtr l);[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);[StructLayout(LayoutKind.Sequential)]public struct RECT{public int L,T,Rt,B;}public delegate bool EnumWindowsProc(IntPtr h,IntPtr l);public static string List(string procName){var pids=new System.Collections.Generic.HashSet<uint>();foreach(var p in System.Diagnostics.Process.GetProcessesByName(procName)){pids.Add((uint)p.Id);}if(pids.Count==0)return "";var sb=new StringBuilder();EnumWindows(delegate(IntPtr h,IntPtr l){uint pid;GetWindowThreadProcessId(h,out pid);if(pids.Contains(pid)&&IsWindowVisible(h)){var t=new StringBuilder(512);GetWindowText(h,t,512);if(t.Length>0){RECT r;GetWindowRect(h,out r);sb.Append(h.ToInt64().ToString("X")).Append("|").Append(pid).Append("|").Append(IsIconic(h)?"MIN":"NORM").Append("|").Append(r.Rt-r.L).Append("|").Append(r.B-r.T).Append("|").AppendLine(t.ToString());}}return true;},IntPtr.Zero);return sb.ToString();}}'
[GW]::List('${esc}')`
  const out = await runPS(script)
  const wins: ProcWin[] = []
  for (const line of out.split('\n')) {
    const parts = line.split('|')
    if (parts.length < 6) continue
    const hwndHex = parts[0]
    const pid = parseInt(parts[1], 10)
    const minimized = parts[2] === 'MIN'
    const width = parseInt(parts[3], 10)
    const height = parseInt(parts[4], 10)
    if (isNaN(pid) || isNaN(width) || isNaN(height)) continue
    // 最小化窗口（任务栏状态）尺寸是图标大小，必须放行；只有正常窗口才做辅助窗口过滤
    if (!minimized) {
      if (width < 50 || height < 50) continue
      if (width / height > 3 || height / width > 3) continue
    }
    wins.push({ hwndHex, pid, minimized, width, height, title: parts.slice(5).join('|').replace(/\r$/, '') })
  }
  return wins
}

/** 标题是否匹配条目的窗口级关键词（无关键词 = 恒真） */
function titleMatches(entry: FocusApp, title: string): boolean {
  if (!entry.titleMatch) return true
  return title.toLowerCase().includes(entry.titleMatch.toLowerCase())
}

// ─── 白名单 ───

function getStoredWhitelist(): FocusApp[] {
  try {
    const v = JSON.parse(getSetting('focus_whitelist') || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** 白名单为空时自动填入澜山自身（首次进入专注页时生效） */
function ensureDefaultWhitelist(): FocusApp[] {
  let list = getStoredWhitelist()
  if (list.length === 0) {
    list = [{ name: SELF_NAME, title: '澜山' }]
    setSetting('focus_whitelist', JSON.stringify(list))
    console.log('[focus] 白名单为空，已自动加入澜山自身')
  }
  return list
}

/** 保存白名单（去重、清理空名）。同一进程允许多个条目（不同 titleMatch = 多个学科窗口） */
export function setFocusWhitelist(entries: FocusApp[]): void {  const seen = new Set<string>()
  const clean: FocusApp[] = []
  for (const a of entries) {
    const name = (a.name || '').trim()
    if (!name) continue
    // 去重键 = 进程名 + 标题关键词（同一进程不同关键词可并存）
    const key = name.toLowerCase() + '|' + (a.titleMatch || '').trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    clean.push({
      name,
      path: a.path?.trim() || undefined,
      title: a.title?.trim() || undefined,
      titleMatch: a.titleMatch?.trim() || undefined,
      url: a.url?.trim() || undefined,
      switchOnly: a.switchOnly,
    })
  }
  setSetting('focus_whitelist', JSON.stringify(clean))
  // 专注会话进行中：同步到当前会话（专注桌面上删除/添加白名单立即生效）
  if (session.active) {
    session.whitelist = clean
  }
}

/** 白名单条目的隐藏 key（与渲染层一致：进程名|关键词） */
function entryKey(a: FocusApp): string {
  return a.name.toLowerCase() + '|' + (a.titleMatch || '').toLowerCase()
}

/** 读取被隐藏的条目 key 列表（主界面"隐藏"= 专注桌面不显示，白名单锁定规则保留） */
export function getFocusHidden(): string[] {
  try {
    const v = JSON.parse(getSetting('focus_hidden') || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** 设置隐藏列表（持久化；专注会话中同步给 overlay 过滤用） */
export function setFocusHidden(keys: string[]): void {
  setSetting('focus_hidden', JSON.stringify([...new Set(keys)]))
}

/** 读取专注桌面图标的自定义顺序（条目标识 key 列表，未列出的排在后面） */
export function getFocusOrder(): string[] {
  try {
    const v = JSON.parse(getSetting('focus_order') || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** 保存专注桌面图标顺序（拖拽排序后持久化） */
export function setFocusOrder(keys: string[]): void {
  setSetting('focus_order', JSON.stringify(keys))
}

/** 专注桌面氛围色（诗词/扫描光带），默认白偏绿 */
export function getFocusColor(): string {
  return getSetting('focus_poem_color') || '#ecfdf5'
}

/** 自定义专注桌面氛围色（诗词文字 + 扫描光带） */
export function setFocusColor(color: string): void {
  setSetting('focus_poem_color', color)
}

// ─── 前台监控 ───

function parseForegroundLine(line: string): ForegroundApp | null {
  const parts = line.split('|')
  if (parts.length < 4 || parts[0] === '0' || parts[0] === '-') return null
  const pid = parseInt(parts[0], 10)
  if (isNaN(pid)) return null
  return { pid, name: parts[1].toLowerCase(), hwndHex: parts[2], title: parts.slice(3).join('|') }
}

function startForegroundWatcher(): void {
  if (fgWatcher) return
  console.log('[focus] 前台监控启动')
  fgWatcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', FG_WATCH_SCRIPT], { windowsHide: true })
  fgWatcher.stdout?.on('data', (chunk: Buffer) => {
    fgBuffer += chunk.toString('utf8')
    let nl: number
    while ((nl = fgBuffer.indexOf('\n')) >= 0) {
      const line = fgBuffer.slice(0, nl).replace(/\r$/, '').trim()
      fgBuffer = fgBuffer.slice(nl + 1)
      if (!line) continue
      lastForeground = parseForegroundLine(line)
      patrolDecide()
    }
  })
  fgWatcher.stderr?.on('data', (chunk: Buffer) => {
    console.error('[focus] 前台监控 stderr:', chunk.toString('utf8').slice(0, 500))
  })
  fgWatcher.on('exit', (code) => {
    console.warn('[focus] 前台监控进程退出 code=', code, '，1s 后重启')
    fgWatcher = null
    if (session.active) {
      setTimeout(() => { if (session.active) startForegroundWatcher() }, 1000)
    }
  })
  fgWatcher.on('error', (err) => {
    console.error('[focus] 前台监控启动失败:', err)
    fgWatcher = null
  })
}

function stopForegroundWatcher(): void {
  if (fgWatcher) {
    fgWatcher.kill()
    fgWatcher = null
  }
  fgBuffer = ''
  lastForeground = null
  lastRaisedHwnd = null
}

// ─── 巡逻决策（z-order 抬升机制） ───

/**
 * 核心机制：专注桌面【永远置顶显示，从不隐藏】。
 * - 前台是白名单软件 → 把它的窗口抬升（HWND_TOPMOST）到专注桌面之上 → 正常使用
 * - 前台是非白名单 → 专注桌面抢回前台盖住一切
 * 不存在隐藏/弹出竞态，新开的软件窗口也能在出现后 500ms 内被自动抬升。
 */
function patrolDecide(): void {
  if (!session.active) return
  const fg = lastForeground
  if (!fg) {
    showFocusOverlays()
    return
  }
  const name = fg.name
  const selfBase = SELF_NAME.replace(/\.exe$/i, '')
  if (name === SELF_NAME || name === selfBase) {
    // 自己的窗口：专注桌面自己无需处理；主窗口则放行并抬升
    const hwnd = parseInt(fg.hwndHex, 16)
    if (!isNaN(hwnd) && isFocusOverlayHwnd(hwnd)) return
    void raiseForeground(fg.hwndHex)
    return
  }
  // 前台进程名不带 .exe，白名单存的是带 .exe 的名字，两种都匹配。
  // 放行判定：
  //  - 宽限期（点击图标显示主界面后 30s，B站等手动找内容的应用）→ 该进程整体放行
  //  - 点击专注桌面图标打开的窗口（raisedHwnds）→ 直接放行（打开后不覆盖）
  //  - 多窗口应用（浏览器/B站）窗口标题刚变化 → 3s 观察缓冲（页面/视频加载过渡）
  //  - 白名单条目标题匹配 → 放行
  const inGrace = session.grace !== null &&
    (session.grace.name === name || session.grace.name === name + '.exe') &&
    Date.now() < session.grace.until
  // 观察缓冲只给不可杀进程（浏览器等页面加载过渡）；哔哩哔哩不匹配窗口立即判定（用户要求直接杀）
  const buffering = !isKillable(name) && isMultiWindowApp(name) && inWindowBuffer(fg.hwndHex, fg.title)
  const allowed = inGrace || raisedHwnds.has(fg.hwndHex) || buffering || session.whitelist.some(a => {
    const an = a.name.toLowerCase()
    if (an !== name && an !== name + '.exe') return false
    return titleMatches(a, fg.title)
  })
  if (allowed) {
    if (fg.hwndHex !== lastRaisedHwnd) console.log('[focus] 放行', name)
    void raiseForeground(fg.hwndHex)
    return
  }
  // 不匹配：只有「白名单内且带窗口级关键词」的进程才做关闭/覆盖判定（见 handleMismatch）；
  // 其他进程（如 QQ、系统通知）一律直接覆盖，绝不关闭/杀进程。
  const hasWindowEntry = session.whitelist.some(a => {
    const an = a.name.toLowerCase()
    return (an === name || an === name + '.exe') && !!a.titleMatch
  })
  if (hasWindowEntry) {
    void handleMismatch(fg)
  } else {
    console.log('[focus] 覆盖', name)
    showFocusOverlays()
  }
}

/**
 * 处理不匹配的前台窗口：
 * 主界面窗口（标题包含进程名）→ 只覆盖，不杀（主界面保留，可再点图标使用）；
 * 不匹配的视频窗口 → 哔哩哔哩（isKillable）先覆盖再尝试关闭；浏览器等其他应用只覆盖不杀。
 */
async function handleMismatch(fg: ForegroundApp): Promise<void> {
  const procBase = fg.name.replace(/\.exe$/i, '')
  const fgIsMain = fg.title.toLowerCase().includes(procBase.toLowerCase())
  if (fgIsMain) {
    // 主界面 → 只覆盖（主界面永远不杀）
    console.log('[focus] 主界面宽限期结束，覆盖', fg.name)
    showFocusOverlays()
    return
  }
  // 只有哔哩哔哩（isKillable）才关闭不匹配窗口；浏览器等其他应用只覆盖不杀（防止强杀丢数据）
  if (isKillable(fg.name)) {
    console.log('[focus] 覆盖并关闭不匹配窗口', fg.name, fg.title)
    showFocusOverlays()
    await closeMismatchedWindow(fg.name, procBase, { hwndHex: fg.hwndHex, pid: fg.pid, title: fg.title })
  } else {
    console.log('[focus] 覆盖不匹配窗口（不关闭）', fg.name, fg.title)
    showFocusOverlays()
  }
}

/**
 * 全窗口扫描（不只检测前台）：哔哩哔哩等可杀进程（isKillable）的不匹配视频窗口直接关闭；
 * 浏览器等其他应用的不匹配窗口只记录不关闭（只覆盖，防强杀丢数据）。
 * 每 1 秒执行一次——不匹配窗口"出现即杀"（仅限可杀进程），不依赖它变成前台。
 * 同一进程的多个条目只枚举一次（省 PS 调用）。
 * 点击专注桌面打开的窗口（raisedHwnds）不杀；3s 观察缓冲只给多窗口应用（标题加载过渡）。
 */
async function scanMismatchedWindows(): Promise<void> {
  const seen = new Set<string>()
  for (const entry of session.whitelist) {
    if (!entry.titleMatch) continue
    const procName = entry.name.toLowerCase().replace(/\.exe$/, '').replace(/'/g, "''")
    if (seen.has(procName)) continue
    seen.add(procName)
    const procBase = entry.name.toLowerCase().replace(/\.exe$/, '')
    // 该进程的全部窗口级条目（关键词）
    const entries = session.whitelist.filter(e =>
      e.titleMatch && e.name.toLowerCase().replace(/\.exe$/, '') === procBase
    )
    const windows = await getProcessWindows(procName)
    let hasMatching = false
    for (const w of windows) {
      const isMatch = entries.some(e => titleMatches(e, w.title))
      const isMain = w.title.toLowerCase().includes(procBase)
      // 诊断日志：专注中排查"不匹配视频不杀"问题（标题/match/main）
      console.log('[focus][scan]', entry.name, '| 标题:', w.title, '| match:', isMatch, '| main:', isMain, '| killable:', isKillable(entry.name))
      if (isMatch) {
        hasMatching = true
      } else if (isMain && isKillable(entry.name)) {
        // 主界面（哔哩哔哩）：出现即 30 秒计时，到点自动最小化（不杀；最小化后专注桌面自然显示）
        const now = Date.now()
        const prev = windowSeen.get(w.hwndHex)
        if (!prev || prev.title !== w.title) {
          windowSeen.set(w.hwndHex, { title: w.title, at: now })
        } else if (now - prev.at >= 30_000) {
          console.log('[focus] 主界面出现 30 秒，自动最小化:', w.title)
          await minimizeWindowByHwnd(w.hwndHex)
          windowSeen.set(w.hwndHex, { title: w.title, at: now }) // 重置（重新出现再计时）
        }
      } else if (!isMain && w.pid > 0 && isKillable(entry.name)) {
        // 哔哩哔哩等可杀进程：主界面/匹配之外的不匹配窗口直接关闭（无缓冲、无宽限、无点击标记）
        console.log('[focus] 扫描发现不匹配窗口，关闭', entry.name, w.title)
        await closeMismatchedWindow(procName, procBase, w)
      }
    }
    // 匹配窗口已打开 → 主界面使命完成：清除宽限，主界面立即被巡逻覆盖（防止从主界面乱逛）。
    // 但点条目时匹配窗口就已打开（videoWasOpen）说明用户主动要用主界面 → 宽限保留 30 秒。
    if (hasMatching && session.grace && session.grace.name === entry.name.toLowerCase() && !session.grace.videoWasOpen) {
      session.grace = null
      console.log('[focus] 匹配视频已打开，主界面宽限结束（自动覆盖）')
    }
  }
}

/**
 * 关闭不匹配的视频窗口（用户要求：不匹配的只能被杀死，不能只是覆盖）：
 * 1) WM_CLOSE 优雅关闭（标签式）
 * 2) 500ms 后窗口还在 → DestroyWindow 直接销毁窗口。
 *    注意：不能 Stop-Process 杀进程——B 站视频窗口与主界面可能同属一个渲染进程，
 *    杀进程会连带主界面一起退出（用户反馈：连续开视频时整个 B 站被删）。
 */
async function closeMismatchedWindow(
  procName: string,
  procBase: string,
  win: { hwndHex: string; pid: number; title: string }
): Promise<void> {
  // 1) WM_CLOSE
  await closeWindowByHwnd(win.hwndHex)
  await new Promise(r => setTimeout(r, 500))
  const windows = await getProcessWindows(procName)
  const stillThere = windows.some(w => w.hwndHex === win.hwndHex)
  if (!stillThere) {
    console.log('[focus] 已关闭不匹配窗口:', win.title)
    return
  }
  // 2) WM_CLOSE 无效 → 直接销毁窗口（不杀进程，保住主界面/客户端）
  console.log('[focus] WM_CLOSE 无效，销毁窗口:', win.title)
  await destroyWindowByHwnd(win.hwndHex)
}

/** 直接销毁窗口（绕过 WM_CLOSE 拦截；只销毁该窗口，不影响同进程其他窗口） */
async function destroyWindowByHwnd(hwndHex: string): Promise<void> {
  if (!hwndHex || hwndHex === '0') return
  const hwnd = parseInt(hwndHex, 16)
  if (isNaN(hwnd)) return
  const script = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class DW{[DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);}'
$h=[IntPtr]::new(${hwnd})
[void][DW]::DestroyWindow($h)`
  await runPS(script)
}

/** 最小化窗口（ShowWindow SW_MINIMIZE） */
async function minimizeWindowByHwnd(hwndHex: string): Promise<void> {
  if (!hwndHex || hwndHex === '0') return
  const hwnd = parseInt(hwndHex, 16)
  if (isNaN(hwnd)) return
  const script = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class MN{[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);}'
$h=[IntPtr]::new(${hwnd})
[void][MN]::ShowWindow($h,6)`
  await runPS(script)
}

/** 给指定窗口发送 WM_CLOSE（优雅关闭，应用可自行保存/拦截） */
async function closeWindowByHwnd(hwndHex: string): Promise<void> {  if (!hwndHex || hwndHex === '0') return
  const hwnd = parseInt(hwndHex, 16)
  if (isNaN(hwnd)) return
  const script = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class CL{[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);}'
$h=[IntPtr]::new(${hwnd})
[void][CL]::PostMessage($h,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)`
  await runPS(script)
}

/** 抬升前台窗口到专注桌面之上（同一窗口只抬一次） */
async function raiseForeground(hwndHex: string): Promise<void> {
  if (!hwndHex || hwndHex === lastRaisedHwnd) return
  await raiseHwndAboveOverlay(hwndHex)
  lastRaisedHwnd = hwndHex
  raisedHwnds.add(hwndHex)
}

// ─── 倒计时 ───

function broadcastTick(): void {
  const data: FocusTick = {
    active: session.active,
    endAt: session.endAt,
    durationMin: session.durationMin,
    remainingSec: session.active ? Math.max(0, Math.ceil((session.endAt - Date.now()) / 1000)) : 0,
  }
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('focus-tick', data)
  }
}

function tick(): void {
  if (!session.active) return
  if (Date.now() >= session.endAt) {
    finishSession()
    return
  }
  broadcastTick()
}

function startTimers(): void {
  if (!tickTimer) tickTimer = setInterval(tick, 1000)
  // 兜底巡逻：即使前台监控丢行，也每 2s 重新断言一次；同时兜底检查会话到期
  if (!safetyTimer) safetyTimer = setInterval(() => {
    if (session.active && Date.now() >= session.endAt) {
      finishSession()
      return
    }
    patrolDecide()
  }, 2000)
  // 专注桌面尺寸慢周期兜底（10 秒一次，原生 setBounds 开销可忽略）：
  // 借鉴壁纸引擎——窗口尺寸由外部持续保证，不依赖全屏状态，底部永远不露桌面
  if (!guardTimer) guardTimer = setInterval(() => {
    if (session.active) ensureOverlaysFullscreen()
  }, 10_000)
  // 全窗口扫描：每 1 秒检查白名单进程的所有窗口，关闭不匹配的视频窗口（出现即杀）
  if (!scanTimer) scanTimer = setInterval(() => {
    if (session.active && !scanning) {
      scanning = true
      void scanMismatchedWindows().finally(() => { scanning = false })
    }
  }, 1000)
}

/** 注册逃生快捷键（renderer 卡死时也能结束专注，主进程级，不依赖页面） */
function registerEscapeShortcut(): void {
  try {
    globalShortcut.register('CommandOrControl+Shift+F10', () => {
      // 严格模式学习时段内锁定：禁止提前结束专注（时段结束自动解锁）
      if (hooks.isScheduleLocked?.()) {
        console.log('[focus] 严格模式学习时段内，逃生快捷键暂不可用')
        return
      }
      console.log('[focus] 逃生快捷键触发，结束专注')
      stopFocusSession()
    })
  } catch (err) {
    console.error('[focus] 逃生快捷键注册失败:', err)
  }
}

function unregisterEscapeShortcut(): void {
  try {
    globalShortcut.unregister('CommandOrControl+Shift+F10')
  } catch { /* 忽略 */ }
}

function stopTimers(): void {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
  if (safetyTimer) { clearInterval(safetyTimer); safetyTimer = null }
  if (guardTimer) { clearInterval(guardTimer); guardTimer = null }
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null }
  scanning = false
}

// ─── 会话控制 ───

/** 开始专注：隐藏主窗口，弹出专注桌面，启动前台巡逻。
 *  endAt 可选：日程模式传入精确结束时间戳（到点由倒计时自然结束）；常规调用按分钟数计算 */
export async function startFocusSession(durationMin: number, endAt?: number): Promise<boolean> {
  if (session.active) return false
  const now = Date.now()
  const fallbackEnd = now + Math.min(Math.max(Math.round(durationMin), 1), 600) * 60_000
  const end = endAt && endAt > now ? endAt : fallbackEnd
  const minutes = Math.min(Math.max(Math.round((end - now) / 60_000), 1), 600)
  session = {
    active: true,
    endAt: end,
    durationMin: minutes,
    whitelist: ensureDefaultWhitelist(),
    grace: null,
  }
  setSetting('focus_session_end', new Date(session.endAt).toISOString())
  setSetting('focus_session_duration', String(minutes))
  setSetting('focus_session_whitelist', JSON.stringify(session.whitelist))
  setSetting('focus_clean_exit', '')  // 新会话开始，重置正常退出标记

  hooks.getMainWindow()?.hide()
  // 隐藏任务栏（专注期间任务栏被盖不住，直接隐藏）+ 记录状态便于崩溃后恢复。
  // 必须先等任务栏隐藏/工作区更新完成再弹桌面，否则全屏窗口高度按旧工作区计算，底部露出任务栏区域。
  try { setSetting('focus_taskbar_hidden', '1') } catch { /* 忽略 */ }
  try {
    await runPS(TASKBAR_HIDE_SCRIPT)
  } catch (err) {
    console.error('[focus] 任务栏隐藏失败:', err)
  }
  try {
    showFocusOverlays()
  } catch (err) {
    console.error('[focus] 专注桌面创建失败（本次专注无锁屏）:', err)
  }
  startForegroundWatcher()
  startTimers()
  registerEscapeShortcut()
  broadcastTick()
  console.log('[focus] 专注开始:', minutes, '分钟 | 白名单:', session.whitelist.map(a => a.name).join(', '))
  return true
}

/** 结束专注（用户主动）：先拆锁（最优先），再清理。任何后续异常都不影响解锁 */
export function stopFocusSession(): void {
  const wasActive = session.active
  session = { active: false, endAt: 0, durationMin: 0, whitelist: [], grace: null }
  // 1) 第一时间销毁专注桌面窗口（拆锁）——即使后面出错用户也出得来
  destroyFocusOverlays()
  // 2) 停掉巡逻与倒计时
  stopTimers()
  stopForegroundWatcher()
  unregisterEscapeShortcut()
  // 3) 恢复被抬升窗口的现场（取消置顶）+ 恢复任务栏
  for (const hwnd of raisedHwnds) void unraiseHwnd(hwnd)
  raisedHwnds.clear()
  windowSeen.clear()
  void runPS(TASKBAR_SHOW_SCRIPT)
  try { setSetting('focus_taskbar_hidden', '') } catch { /* 忽略 */ }
  // 4) 清理持久化
  try {
    setSetting('focus_session_end', '')
    setSetting('focus_session_duration', '')
    setSetting('focus_session_whitelist', '')
  } catch (err) {
    console.error('[focus] 清理会话设置失败:', err)
  }
  // 5) 恢复主窗口
  if (wasActive) {
    const main = hooks.getMainWindow()
    if (main) {
      main.show()
      void runPS(ALT_KEY_UNLOCK_SCRIPT).then(() => { if (!main.isDestroyed()) main.focus() })
    }
    try { broadcastTick() } catch { /* 忽略 */ }
    console.log('[focus] 专注结束')
  }
}

/** 倒计时自然结束：通知 + 解锁 */
function finishSession(): void {
  const minutes = session.durationMin
  stopFocusSession()
  try {
    new Notification({ title: '🍅 专注完成', body: `本次专注 ${minutes} 分钟，可以休息一下啦~` }).show()
  } catch { /* 通知失败不影响解锁 */ }
}

/** 应用启动时恢复未完成的专注会话（正常退出后重启恢复锁屏；崩溃后重启不恢复、清理现场） */
export async function initFocus(): Promise<void> {
  const endStr = getSetting('focus_session_end')
  const cleanExit = getSetting('focus_clean_exit')
  if (!endStr) {
    // 无会话但任务栏隐藏标记残留（上次崩溃）→ 恢复任务栏
    if (getSetting('focus_taskbar_hidden') === '1') {
      void runPS(TASKBAR_SHOW_SCRIPT)
      setSetting('focus_taskbar_hidden', '')
    }
    if (cleanExit) setSetting('focus_clean_exit', '')
    return
  }
  // 崩溃/异常退出检测：上次不是正常退出（无 clean_exit 标记）→ 不恢复锁屏，清理现场并恢复任务栏
  if (cleanExit !== '1') {
    console.log('[focus] 检测到上次异常退出，本次不恢复锁屏')
    setSetting('focus_session_end', '')
    setSetting('focus_session_duration', '')
    setSetting('focus_session_whitelist', '')
    setSetting('focus_clean_exit', '')
    if (getSetting('focus_taskbar_hidden') === '1') {
      void runPS(TASKBAR_SHOW_SCRIPT)
      setSetting('focus_taskbar_hidden', '')
    }
    return
  }
  setSetting('focus_clean_exit', '')
  const endAt = new Date(endStr).getTime()
  if (isNaN(endAt) || endAt <= Date.now()) {
    // 过期残留，清理（含任务栏隐藏标记——崩溃后重启的兜底恢复）
    setSetting('focus_session_end', '')
    setSetting('focus_session_duration', '')
    setSetting('focus_session_whitelist', '')
    if (getSetting('focus_taskbar_hidden') === '1') {
      void runPS(TASKBAR_SHOW_SCRIPT)
      setSetting('focus_taskbar_hidden', '')
    }
    return
  }
  const duration = parseInt(getSetting('focus_session_duration') || '0', 10)
  let wl: FocusApp[] = []
  try {
    wl = JSON.parse(getSetting('focus_session_whitelist') || '[]')
  } catch { /* 忽略 */ }
  if (!Array.isArray(wl) || wl.length === 0) wl = ensureDefaultWhitelist()
  session = {
    active: true,
    endAt,
    durationMin: duration || Math.round((endAt - Date.now()) / 60_000),
    whitelist: wl,
    grace: null,
  }
  hooks.getMainWindow()?.hide()
  // 恢复会话同样隐藏任务栏（先完成再弹桌面，避免底部露任务栏区域）
  try { setSetting('focus_taskbar_hidden', '1') } catch { /* 忽略 */ }
  try {
    await runPS(TASKBAR_HIDE_SCRIPT)
  } catch (err) {
    console.error('[focus] 任务栏隐藏失败:', err)
  }
  try {
    showFocusOverlays()
  } catch (err) {
    console.error('[focus] 专注桌面创建失败（本次恢复无锁屏）:', err)
  }
  startForegroundWatcher()
  startTimers()
  registerEscapeShortcut()
  broadcastTick()
  console.log('[focus] 恢复未完成专注，剩余约', Math.round((endAt - Date.now()) / 60_000), '分钟')
}

/** 应用退出前清理（保留持久化会话 + 打"正常退出"标记，下次启动由 initFocus 恢复） */
export function shutdownFocus(): void {
  stopTimers()
  stopForegroundWatcher()
  unregisterEscapeShortcut()
  destroyFocusOverlays()
  // 正常退出标记：崩溃/强杀时不会执行到这里，initFocus 据此区分"正常恢复锁屏"与"崩溃后清理"
  try { setSetting('focus_clean_exit', '1') } catch { /* 忽略 */ }
  // 退出时恢复任务栏（即使会话还在，退出后也不该锁着任务栏）
  void runPS(TASKBAR_SHOW_SCRIPT)
  try { setSetting('focus_taskbar_hidden', '') } catch { /* 忽略 */ }
}

/** 注入主窗口访问钩子 */
export function setFocusHooks(h: FocusHooks): void {
  hooks = h
}

export function getFocusState(): FocusState {
  const wl = ensureDefaultWhitelist()
  return {
    active: session.active,
    endAt: session.endAt,
    durationMin: session.durationMin,
    remainingSec: session.active ? Math.max(0, Math.ceil((session.endAt - Date.now()) / 1000)) : 0,
    whitelist: wl,
  }
}

/** 专注桌面「任务栏最小化」按钮数据：白名单中「窗口最小化在任务栏」的程序。
 *  这类程序点启动栏图标可直接弹回（ShowWindow 恢复），不需要重启。 */
export async function getBackgroundApps(): Promise<FocusApp[]> {
  const list = session.active ? session.whitelist : ensureDefaultWhitelist()
  const seen = new Set<string>()
  const result: FocusApp[] = []
  for (const a of list) {
    const key = a.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const procName = key.replace(/\.exe$/, '').replace(/'/g, "''")
    if (await hasMinimizedWindow(procName)) {
      result.push(a)
    }
  }
  return result
}

/** 进程是否存在最小化在任务栏的窗口（IsIconic）。
 *  只统计最小化：正常显示的窗口不算。
 *  注意：最小化窗口的 GetWindowRect 返回的是任务栏图标大小（如 158x26），不能按尺寸过滤，
 *  只按"有标题"过滤（跳过 IME 等无标题辅助窗）。 */
async function hasMinimizedWindow(procName: string): Promise<boolean> {
  const esc = procName.replace(/'/g, "''")
  const script = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;public static class PS2{[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb,IntPtr l);[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);public delegate bool EnumWindowsProc(IntPtr h,IntPtr l);public static string List(string procName){var pids=new System.Collections.Generic.HashSet<uint>();foreach(var p in System.Diagnostics.Process.GetProcessesByName(procName)){pids.Add((uint)p.Id);}if(pids.Count==0)return "";var sb=new StringBuilder();EnumWindows(delegate(IntPtr h,IntPtr l){uint pid;GetWindowThreadProcessId(h,out pid);if(pids.Contains(pid)&&IsIconic(h)){var t=new StringBuilder(512);GetWindowText(h,t,512);if(t.Length>0){sb.AppendLine(t.ToString());}}return true;},IntPtr.Zero);return sb.ToString();}}'
[PS2]::List('${esc}')`
  const out = await runPS(script)
  return out.trim().length > 0
}

/** 恢复任务栏与工作区（退出应用前等待完成，避免进程退出太快来不及恢复） */
export async function restoreTaskbarNow(): Promise<void> {
  await runPS(TASKBAR_SHOW_SCRIPT)
}// ─── 应用信息 ───

/**
 * 列出当前用户会话的全部进程（含无窗口的后台程序）+ 每进程的窗口。
 * 返回扁平数组：有窗口的进程每窗口一行（title 有值），无窗口进程一行（title 为空）。
 */

/** getRunningApps 结果缓存：枚举窗口是 PowerShell 重操作，
 *  渲染端轮询时 6 秒内的重复请求直接返回缓存，避免频繁启动 PS 进程 */
let runningAppsCache: { data: FocusApp[]; at: number } | null = null
const RUNNING_APPS_CACHE_MS = 6000

export async function getRunningApps(): Promise<FocusApp[]> {
  const now = Date.now()
  if (runningAppsCache && now - runningAppsCache.at < RUNNING_APPS_CACHE_MS) {
    return runningAppsCache.data
  }
  const apps = await collectRunningApps()
  runningAppsCache = { data: apps, at: Date.now() }
  return apps
}

async function collectRunningApps(): Promise<FocusApp[]> {
  // C# 原生委托实现枚举（PS 5.1 scriptblock 委托对 EnumWindows 回调不生效，枚举恒为空）
  const script = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;public static class RA{[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb,IntPtr l);[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);public delegate bool EnumWindowsProc(IntPtr h,IntPtr l);public static string Run(){var winMap=new System.Collections.Generic.Dictionary<int,System.Collections.Generic.List<string>>();EnumWindows(delegate(IntPtr h,IntPtr l){uint pid;GetWindowThreadProcessId(h,out pid);if(IsWindowVisible(h)){var t=new StringBuilder(512);GetWindowText(h,t,512);if(t.Length>0){if(!winMap.ContainsKey((int)pid))winMap[(int)pid]=new System.Collections.Generic.List<string>();winMap[(int)pid].Add(t.ToString());}}return true;},IntPtr.Zero);var sb=new StringBuilder();foreach(var p in System.Diagnostics.Process.GetProcesses()){if(p.SessionId==0)continue;System.Collections.Generic.List<string> titles;if(winMap.TryGetValue(p.Id,out titles)){string path="";try{path=p.MainModule.FileName;}catch{}foreach(var t in titles){sb.Append(p.ProcessName).Append("|").Append(path).Append("|").AppendLine(t);}}}return sb.ToString();}}'
[RA]::Run()`
  const out = await runPS(script)
  const apps: FocusApp[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    // 行格式：进程名|路径|窗口标题（路径不含 |，标题可能含）
    const nameEnd = line.indexOf('|')
    if (nameEnd <= 0) continue
    const pathEnd = line.indexOf('|', nameEnd + 1)
    if (pathEnd <= 0) continue
    const name = line.slice(0, nameEnd).trim()
    const path = line.slice(nameEnd + 1, pathEnd).trim()
    const title = line.slice(pathEnd + 1).replace(/\r$/, '').trim()
    if (!name) continue
    apps.push({ name: name + '.exe', path: path || undefined, title: title || undefined })
  }
  if (apps.length > 0) {
    // 按 进程名+标题 排序
    return apps.sort((a, b) => a.name.localeCompare(b.name) || (a.title || '').localeCompare(b.title || ''))
  }
  // 兜底：枚举失败时回退到进程级（主窗口标题），保证列表不空
  const fallbackScript = `Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { "{0}|{1}" -f $_.ProcessName, $_.MainWindowTitle }`
  const fallbackOut = await runPS(fallbackScript)
  const fbApps: FocusApp[] = []
  for (const line of fallbackOut.split('\n')) {
    if (!line.trim()) continue
    const bar = line.indexOf('|')
    if (bar <= 0) continue
    const name = line.slice(0, bar).trim()
    const title = line.slice(bar + 1).trim()
    if (!name) continue
    fbApps.push({ name: name + '.exe', title: title || undefined })
  }
  return fbApps.sort((a, b) => a.name.localeCompare(b.name))
}

/** 通过注册表 App Paths 解析未运行软件的路径 */
export async function resolveAppPath(name: string): Promise<string> {
  const raw = name.trim()
  if (!raw) return ''
  const exe = raw.toLowerCase().endsWith('.exe') ? raw : raw + '.exe'
  const esc = exe.replace(/'/g, "''")
  const script = `$p=Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${esc}' -ErrorAction SilentlyContinue
if(-not $p){$p=Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${esc}' -ErrorAction SilentlyContinue}
if($p -and $p.'(default)' -and (Test-Path -LiteralPath $p.'(default)')){[Console]::Out.WriteLine($p.'(default)')}else{[Console]::Out.WriteLine('')}`
  return runPS(script)
}

/**
 * 提取 exe 图标为 PNG 并缓存，返回 data URL（失败返回空串）。
 * 用 SHDefExtractIcon 直接指定 256px 提取高清图标——默认 ExtractAssociatedIcon 只有 32×32，
 * 放大显示会模糊。提取失败回退到旧方法。
 */
export async function getAppIcon(name: string, path: string): Promise<string> {
  // 澜山自身条目（无 path，如自动加入的 electron.exe/澜山.exe）：用当前 exe 提取图标
  if (!path) {
    const key = name.toLowerCase()
    const selfBase = SELF_NAME.replace(/\.exe$/i, '')
    if (key === SELF_NAME || key === selfBase || key === 'electron' || key === 'electron.exe') {
      path = process.execPath
    } else {
      return ''
    }
  }
  const safeName = name.toLowerCase().replace(/[^a-z0-9._-]/g, '_')
  const cacheFile = join(ICON_DIR, safeName + '_256.png')
  if (existsSync(cacheFile)) return toDataUrl(cacheFile)
  try {
    mkdirSync(ICON_DIR, { recursive: true })
  } catch {
    return ''
  }
  const esc = path.replace(/'/g, "''")
  const script = `Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class DEI{[DllImport("shell32.dll")] public static extern int SHDefExtractIcon(string pszIconFile, int iIndex, uint uFlags, out IntPtr phiconLarge, out IntPtr phiconSmall, uint nIconSize);}'
$ok=$false
try{
  $large=[IntPtr]::Zero
  $small=[IntPtr]::Zero
  $hr=[DEI]::SHDefExtractIcon('${esc}',0,0,[ref]$large,[ref]$small,256)
  if($hr -eq 0 -and $large -ne [IntPtr]::Zero){
    $bmp=[System.Drawing.Icon]::FromHandle($large).ToBitmap()
    if($bmp.Width -ge 64){
      $bmp.Save('${cacheFile.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png)
      $ok=$true
    }
  }
}catch{}
if(-not $ok){
  try{
    $icon=[System.Drawing.Icon]::ExtractAssociatedIcon('${esc}')
    if($icon){$icon.ToBitmap().Save('${cacheFile.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png);$ok=$true}
  }catch{}
}
if($ok){'OK'}else{'FAIL'}`
  const out = await runPS(script)
  if (out === 'OK' && existsSync(cacheFile)) return toDataUrl(cacheFile)
  return ''
}

function toDataUrl(file: string): string {
  return 'data:image/png;base64,' + readFileSync(file).toString('base64')
}

/**
 * 读取指定窗口（浏览器地址栏）的当前网址。
 * 用 Windows UI Automation 找地址栏控件（优先 Chrome/Edge 的 Omnibox，兜底 Edit 控件 + ValuePattern），
 * 取首个 http(s)/浏览器内页开头的值。Chrome / Edge / Firefox 均支持；非浏览器（无地址栏）返回空串。
 */
async function readWindowUrl(hwndHex: string): Promise<string> {
  if (!hwndHex || hwndHex === '0') return ''
  const hwnd = parseInt(hwndHex, 16)
  if (isNaN(hwnd)) return ''
  const script = `Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$h=[IntPtr]::new(${hwnd})
$out=''
try{
  $root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
  if($root){
    $c1=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty,'Chrome_OmniboxView')
    $c2=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty,'Address and search bar')
    $c3=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)
    $u=New-Object System.Windows.Automation.OrCondition($c1,$c2)
    $all=New-Object System.Windows.Automation.OrCondition($u,$c3)
    $nodes=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$all)
    foreach($e in $nodes){
      try{
        $vp=$e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $v=$vp.Current.Value
        if($v -and ($v -match '^https?://' -or $v -match '^(chrome|edge|firefox)://')){
          $out=$v
          break
        }
      }catch{}
    }
  }
}catch{}
[Console]::Out.WriteLine($out)`
  return (await runPS(script)).trim()
}

/** 按 进程名+标题 找到窗口并读取其网址（锁窗口时记录，之后点图标可直接跳转）。获取失败返回空串 */
export async function getWindowUrl(app: FocusApp): Promise<string> {
  const procName = app.name.toLowerCase().replace(/\.exe$/, '').replace(/'/g, "''")
  const windows = await getProcessWindows(procName)
  const win = (app.title && windows.find(w => w.title === app.title)) || windows[0]
  if (!win) return ''
  return readWindowUrl(win.hwndHex)
}

// ─── 启动/切换白名单软件 ───

/** 进程是否存活（按进程名）——托盘/无窗口模式也返回 true */
async function processExists(procName: string): Promise<boolean> {
  const esc = procName.replace(/'/g, "''")
  const out = await runPS(`@(Get-Process -Name '${esc}' -ErrorAction SilentlyContinue).Count`)
  return parseInt(out.trim(), 10) > 0
}

/** 强制结束进程（按进程名）——点击启动栏时"无可见窗口即杀进程重启"，保证窗口必然弹出 */
async function killProcess(procName: string): Promise<void> {
  const esc = procName.replace(/'/g, "''")
  await runPS(`Get-Process -Name '${esc}' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue`)
}

/** 同一条目的启动在途锁：快速重复点击时复用同一次启动流程，
 *  防止并发 spawn 双实例（用户反馈：黑屏卡死窗口 + 本体窗口并存） */
const launching = new Map<string, Promise<void>>()

/** 启动或切到前台一个白名单软件；澜山自身则打开主窗口。
 *  按用户逻辑：窗口级条目点击 = 确保进程存在 → 显示主界面窗口 + 固定 30 秒宽限。 */
export function launchFocusApp(name: string, titleMatch?: string): Promise<void> {
  const lockKey = name.toLowerCase() + '|' + (titleMatch || '').toLowerCase()
  const inFlight = launching.get(lockKey)
  if (inFlight) return inFlight
  const p = doLaunchFocusApp(name, titleMatch).finally(() => launching.delete(lockKey))
  launching.set(lockKey, p)
  return p
}

/** 是否是澜山自身（electron.exe / 澜山.exe / electron）——自身不允许被杀/重启 */
function isSelfName(name: string): boolean {
  const key = name.toLowerCase()
  const selfBase = SELF_NAME.replace(/\.exe$/i, '')
  return key === SELF_NAME || key === selfBase || key === 'electron' || key === 'electron.exe'
}

/** 杀死白名单软件的进程（强制结束后台）。澜山自身拒绝执行（会把自己杀掉） */
export async function killFocusApp(name: string): Promise<void> {
  if (isSelfName(name)) return
  const procName = name.toLowerCase().replace(/\.exe$/, '').replace(/'/g, "''")
  console.log('[focus] 手动杀死进程:', name)
  await killProcess(procName)
}

/** 强制重启白名单软件：杀进程 + 等退出 + 重新启动（保证弹出新窗口）。澜山自身拒绝执行 */
export async function restartFocusApp(name: string, titleMatch?: string): Promise<void> {
  if (isSelfName(name)) return
  const key = name.toLowerCase()
  const list = session.active ? session.whitelist : ensureDefaultWhitelist()
  const entry = list.find(a => a.name.toLowerCase() === key && (a.titleMatch || '') === (titleMatch || ''))
    || list.find(a => a.name.toLowerCase() === key && !a.titleMatch)
  if (!entry) return
  const procName = entry.name.toLowerCase().replace(/\.exe$/, '').replace(/'/g, "''")
  await killProcess(procName)
  // 等进程完全退出（最多 5s），确保单实例应用能干净启动
  for (let i = 0; i < 10; i++) {
    if (!(await processExists(procName))) break
    await new Promise(r => setTimeout(r, 500))
  }
  let path = entry.path
  if (!path) path = await resolveAppPath(entry.name)
  if (!path) {
    console.warn('[focus] 找不到', entry.name, '的路径，无法重启')
    return
  }
  try {
    const child = spawn(path, [], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', (err) => console.error('[focus] 重启失败:', entry.name, err.message))
    child.unref()
    session.grace = { name: entry.name.toLowerCase(), until: Date.now() + 30_000, videoWasOpen: false }
    console.log('[focus] 强制重启:', entry.name)
    void waitForMainWindow(entry)
  } catch (err) {
    console.error('[focus] 重启失败:', entry.name, err)
  }
}

async function doLaunchFocusApp(name: string, titleMatch?: string): Promise<void> {
  const key = name.toLowerCase()
  const selfBase = SELF_NAME.replace(/\.exe$/i, '')
  // 白名单自动加入的"澜山"条目存的是开发态进程名 electron.exe，打包后进程名是 澜山.exe——
  // 三种都识别为澜山自身（打开主窗口），否则打包版点"澜山"图标走失败路径没反应
  if (key === SELF_NAME || key === selfBase || key === 'electron' || key === 'electron.exe') {
    const main = hooks.getMainWindow()
    if (main) {
      if (main.isMinimized()) main.restore()
      main.show()
      // 先解锁前台限制，确保主窗口真正拿到焦点（否则巡逻会去抬升其他窗口把它盖住）
      await runPS(ALT_KEY_UNLOCK_SCRIPT)
      if (main.isDestroyed()) return
      main.focus()
      await raiseBrowserWindow(main)
    }
    return
  }
  const list = session.active ? session.whitelist : ensureDefaultWhitelist()
  // 优先按「进程名 + 关键词」精确匹配条目；找不到时回退到该进程的应用级条目
  const entry = list.find(a => a.name.toLowerCase() === key && (a.titleMatch || '') === (titleMatch || ''))
    || list.find(a => a.name.toLowerCase() === key && !a.titleMatch)
  if (!entry) return
  const procName = entry.name.toLowerCase().replace(/\.exe$/, '').replace(/'/g, "''")
  // 0) 窗口级条目带网址：直接用浏览器导航到锁定时的页面（精确跳转，不依赖标题匹配窗口）。
  //    spawn(path, [url])：进程未运行则启动并打开网址；已运行则把网址交给现有实例开新标签。
  //    页面加载/标题变化的窗口期由 3s 观察缓冲兜底，不再给 30s 宽限（浏览器场景不需要）。
  //    switchOnly 条目（"显示回来"模式）：不导航、不新开页面，只切到匹配窗口/调出浏览器。
  if (entry.titleMatch && entry.url && !entry.switchOnly) {
    let path = entry.path
    if (!path) path = await resolveAppPath(entry.name)
    if (path) {
      try {
        const child = spawn(path, [entry.url], { detached: true, stdio: 'ignore', windowsHide: true })
        // spawn 失败是异步 error 事件（try/catch 抓不到）：失败时回退常规流程，不静默
        child.on('error', (err) => {
          console.error('[focus] 网址导航启动失败，走常规流程:', err.message)
          void launchFocusAppFallback(entry)
        })
        child.unref()
        console.log('[focus] 导航到', entry.name, entry.url)
        void waitForMainWindow(entry)
        return
      } catch (err) {
        console.error('[focus] 网址导航失败，走常规流程:', err)
      }
    }
  }
  // 常规流程（URL 导航失败时的回退）
  await launchFocusAppFallback(entry)
}

/** 常规流程：确保进程有可见窗口 → 切到匹配窗口/主界面 + 30 秒宽限。
 *  逻辑刻意保持简单（用户要求）：
 *  - 有可见窗口（含最小化，最小化窗口 IsWindowVisible=true）→ 直接切换
 *  - 无可见窗口（点了右上角 X 关闭、窗口已销毁）→ 杀掉进程重新启动，保证窗口必然弹出。
 *    恢复"隐藏的旧窗口"那套复杂机制已废弃——旧窗口状态不可靠（黑屏/卡死），重启最稳。 */
async function launchFocusAppFallback(entry: FocusApp): Promise<void> {
  const procName = entry.name.toLowerCase().replace(/\.exe$/, '').replace(/'/g, "''")
  const windows = await getProcessWindows(procName)
  if (windows.length > 0) {
    // 有可见窗口（最小化的窗口也在列）→ 切到匹配窗口/主界面
    await activateWindow(entry, windows)
    return
  }
  // 无可见窗口 → 杀进程 + 重启（单实例应用不会撞车，新实例必然弹窗）
  let path = entry.path
  if (!path) path = await resolveAppPath(entry.name)
  if (!path) {
    console.warn('[focus] 找不到', entry.name, '的路径，无法启动')
    return
  }
  if (await processExists(procName)) {
    console.log('[focus] 无可见窗口，杀掉进程后重启:', entry.name)
    await killProcess(procName)
    // 等进程完全退出（最多 5s），确保单实例应用能干净启动
    for (let i = 0; i < 10; i++) {
      if (!(await processExists(procName))) break
      await new Promise(r => setTimeout(r, 500))
    }
  }
  try {
    const child = spawn(path, [], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', (err) => console.error('[focus] 启动失败:', entry.name, err.message))
    child.unref()
    // 给宽限：客户端启动后用户在主界面手动找内容（浏览器走 URL 直达，不需要）
    session.grace = { name: entry.name.toLowerCase(), until: Date.now() + 30_000, videoWasOpen: false }
    console.log('[focus] 已启动', entry.name)
    void waitForMainWindow(entry)
  } catch (err) {
    console.error('[focus] 启动失败:', entry.name, err)
  }
}

/**
 * 有可见窗口时的前台切换 + 抬升 + 30 秒宽限。
 * 匹配窗口直接切；没有匹配窗口则切主界面（宽限期间不会被巡逻盖回）。
 */
async function activateWindow(
  entry: FocusApp,
  windows: { hwndHex: string; pid: number; title: string }[]
): Promise<void> {
  const procBase = entry.name.toLowerCase().replace(/\.exe$/, '')
  const matched = entry.titleMatch
    ? windows.find(w => titleMatches(entry, w.title))
    : undefined
  const main = matched || (entry.titleMatch
    ? windows.find(w => w.title.toLowerCase().includes(procBase)) || windows[0]
    : windows[0])
  await foregroundWindow(main)
  await raiseHwndAboveOverlay(main.hwndHex)
  raisedHwnds.add(main.hwndHex)
  lastRaisedHwnd = main.hwndHex
  windowSeen.delete(main.hwndHex)  // 重置主界面 30s 计时（点图标恢复后重新计时）
  if (entry.titleMatch) {
    // 给 30 秒宽限（主界面找内容）；匹配窗口已打开时宽限不被自动清除（用户主动要用主界面）
    const entries = session.whitelist.filter(e => e.titleMatch && e.name.toLowerCase() === entry.name.toLowerCase())
    const videoAlreadyOpen = windows.some(w => entries.some(e => titleMatches(e, w.title)))
    session.grace = { name: entry.name.toLowerCase(), until: Date.now() + 30_000, videoWasOpen: videoAlreadyOpen }
    console.log('[focus] 显示', entry.name, matched ? '（匹配窗口）' : '（主界面）', '，30 秒宽限期' + (videoAlreadyOpen ? '（视频已开，宽限保留）' : ''))
  } else if (matched) {
    console.log('[focus] 已切到匹配窗口:', matched.title)
  }
}

/**
 * 启动/导航后轮询等待窗口出现（最多 15s），出现即抬升并标记为"点击打开的窗口"（放行）。
 * 匹配窗口直接抬升；没有匹配窗口则抬升主界面窗口（宽限已在调用处设置）。
 * 调用前进程已被杀掉重启（干净启动），窗口必然正常出现，不需要恢复隐藏窗口的机制。
 */
async function waitForMainWindow(entry: FocusApp): Promise<void> {
  const procName = entry.name.toLowerCase().replace(/\.exe$/, '').replace(/'/g, "''")
  const procBase = entry.name.toLowerCase().replace(/\.exe$/, '')
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 300))
    const windows = await getProcessWindows(procName)
    if (windows.length === 0) continue
    // 窗口级条目优先匹配关键词窗口（浏览器启动后标题可能先不匹配，由 3s 观察缓冲兜底）
    const matched = entry.titleMatch
      ? windows.find(w => titleMatches(entry, w.title))
      : undefined
    const main = matched || (entry.titleMatch
      ? windows.find(w => w.title.toLowerCase().includes(procBase)) || windows[0]
      : windows[0])
    // 窗口刚创建时内容可能还没渲染（黑屏）：等 400ms 让应用完成初始化再抬升，
    // 避免把初始化中的窗口提前置顶/抢焦点导致黑屏卡死（用户反馈"黑窗口+本体窗口"）
    await new Promise(r => setTimeout(r, 400))
    await raiseHwndAboveOverlay(main.hwndHex)
    raisedHwnds.add(main.hwndHex)
    lastRaisedHwnd = main.hwndHex
    windowSeen.delete(main.hwndHex)  // 重置主界面 30s 计时（点图标恢复后重新计时）
    console.log('[focus]', entry.name, '已启动' + (matched ? '，已切到匹配窗口' : '，已显示主界面'))
    return
  }
  console.warn('[focus]', entry.name, '启动后 15s 内未检测到窗口')
}

/** 把指定窗口切到前台（恢复最小化 + SetForegroundWindow） */
async function foregroundWindow(win: { hwndHex: string; title: string }): Promise<void> {
  const script = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class F2{[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd,int nCmdShow);}'
$h=[IntPtr]::new(${parseInt(win.hwndHex, 16)})
[void][F2]::ShowWindow($h,9)
[void][F2]::SetForegroundWindow($h)
'FG'`
  await runPS(script)
}
