import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { runPS, ALT_KEY_UNLOCK_SCRIPT } from './ps'

const isDev = !app.isPackaged

let overlayWindows: BrowserWindow[] = []

/** 窗口四周各溢出屏幕 2px：把系统边框/DWM 边缘线推出屏幕外，屏幕内完全干净 */
const EDGE = 2

/**
 * 创建覆盖所有显示器的全屏「专注桌面」窗口（无边框、永久置顶、跳过任务栏）。
 * 已存在时直接复用。
 */
export function createFocusOverlays(): BrowserWindow[] {
  if (overlayWindows.length > 0 && overlayWindows.some(w => !w.isDestroyed())) {
    overlayWindows = overlayWindows.filter(w => !w.isDestroyed())
    return overlayWindows
  }
  overlayWindows = screen.getAllDisplays().map((display) => {
    const win = new BrowserWindow({
      // 四周各溢出 2px：边缘线（系统边框/DWM 边缘/阴影残留）被推出屏幕外
      x: display.bounds.x - EDGE,
      y: display.bounds.y - EDGE,
      width: display.bounds.width + EDGE * 2,
      height: display.bounds.height + EDGE * 2,
      frame: false,
      // 不进入 fullscreen 状态——借鉴壁纸引擎机制：普通窗口 + 尺寸被持续断言，
      // 没有"全屏状态"可被 Windows 踢出，窗口永远物理覆盖整个屏幕
      show: false,
      skipTaskbar: true,
      title: '澜山 · 专注桌面',
      icon: join(__dirname, '../../resources/icon.png'),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    // 去掉窗口阴影（阴影会形成窗口边缘的视觉白线）
    win.setHasShadow(false)
    // 固定窗口：不可移动/缩放/最大化/最小化（防止拖动、贴边最大化导致变形）
    win.setMovable(false)
    win.setResizable(false)
    win.setMaximizable(false)
    win.setMinimizable(false)

    // 强制物理全屏（含 2px 溢出，原生 setBounds，零 PowerShell 开销）：
    // 任何原因导致尺寸/位置偏离 → 立即拉回所在显示器的物理全屏
    const forceBounds = (): void => {
      if (win.isDestroyed()) return
      const b = screen.getDisplayMatching(win.getBounds()).bounds
      const cur = win.getBounds()
      const target = { x: b.x - EDGE, y: b.y - EDGE, width: b.width + EDGE * 2, height: b.height + EDGE * 2 }
      if (cur.x !== target.x || cur.y !== target.y || cur.width !== target.width || cur.height !== target.height) {
        win.setBounds(target)
      }
    }
    win.on('resize', forceBounds)
    win.on('move', forceBounds)
    // 去掉系统边框样式（WS_CAPTION/WS_THICKFRAME/WS_BORDER/WS_DLGFRAME）：
    // 无边框窗口在 Windows 上仍残留 1px 系统边框（顶部最明显），去掉后边缘完全干净
    win.once('ready-to-show', () => {
      const buf = win.getNativeWindowHandle()
      if (buf.length >= 4) {
        const hwnd = buf.readUInt32LE(0)
        void runPS(`Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class SW{[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int i);[DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h,int i,int v);[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,int hAfter,int x,int y,int cx,int cy,uint f);}'
$h=[IntPtr]::new(${hwnd})
try{
  $s=[SW]::GetWindowLong($h,-16)
  $s=$s -band (-bnot (0x00C00000 -bor 0x00040000 -bor 0x00800000 -bor 0x00400000))
  [void][SW]::SetWindowLong($h,-16,$s)
  [void][SW]::SetWindowPos($h,[IntPtr]::Zero,0,0,0,0,0x0037)
}catch{}`)
      }
    })
    // 创建后立即断言几次（覆盖显示前后系统可能做的调整）
    win.once('ready-to-show', forceBounds)
    setTimeout(forceBounds, 300)
    setTimeout(forceBounds, 1000)
    // 禁止用户关闭（Alt+F4 等）——专注桌面只能通过「结束专注/退出应用」离开
    win.on('close', (e) => {
      e.preventDefault()
      win.setAlwaysOnTop(true, 'screen-saver')
    })
    if (isDev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#/focus-overlay')
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/focus-overlay' })
    }
    return win
  })
  return overlayWindows
}

/**
 * 显示所有专注桌面窗口并确保置顶。
 * 专注桌面在整个会话期间【永远置顶显示，从不隐藏】——
 * 白名单软件被抬升（HWND_TOPMOST）到它之上使用，非白名单窗口永远在它下面。
 */
export function showFocusOverlays(): void {
  const wins = createFocusOverlays()
  for (const w of wins) {
    if (w.isDestroyed()) continue
    w.show()
    w.setAlwaysOnTop(true, 'screen-saver')
  }
  void focusPrimaryOverlay()
}

/** 销毁所有专注桌面窗口（会话结束时调用，绕过 close 拦截） */
export function destroyFocusOverlays(): void {
  for (const w of overlayWindows) {
    if (!w.isDestroyed()) w.destroy()
  }
  overlayWindows = []
}

/**
 * 强制所有专注桌面保持物理全屏（慢周期兜底，10 秒一次，原生 setBounds 开销可忽略）。
 * 借鉴壁纸引擎：窗口尺寸由外部持续保证，不依赖任何"全屏状态"。带 2px 溢出。
 */
export function ensureOverlaysFullscreen(): void {
  for (const w of overlayWindows) {
    if (w.isDestroyed()) continue
    const b = screen.getDisplayMatching(w.getBounds()).bounds
    const cur = w.getBounds()
    const target = { x: b.x - EDGE, y: b.y - EDGE, width: b.width + EDGE * 2, height: b.height + EDGE * 2 }
    if (cur.x !== target.x || cur.y !== target.y || cur.width !== target.width || cur.height !== target.height) {
      w.setBounds(target)
    }
  }
}

/** 判断某个窗口句柄是否属于专注桌面窗口（用于前台巡逻避免误判自己） */
export function isFocusOverlayHwnd(hwnd: number): boolean {
  for (const w of overlayWindows) {
    if (w.isDestroyed()) continue
    const buf = w.getNativeWindowHandle()
    if (buf.length >= 4 && buf.readUInt32LE(0) === hwnd) return true
  }
  return false
}

/** 本应用自身进程名（无 .exe 后缀，如 electron / 澜山） */
const SELF_BASE = (app.getPath('exe').split(/[\\/]/).pop() || '').replace(/\.exe$/i, '')

/** 把第一个专注桌面窗口带到前台（配合 Alt 键解锁技巧） */
async function focusPrimaryOverlay(): Promise<void> {
  const primary = overlayWindows.find(w => !w.isDestroyed())
  if (!primary) return
  // 盖回动作是异步的（要先跑 PS 解锁），期间用户可能已经切到白名单软件/主窗口——
  // 动作执行前再查一次前台：若是本应用自己的窗口则说明无需抢（专注桌面或主窗口在顶）
  const fgName = await getForegroundProcessName()
  if (fgName === SELF_BASE) return
  await runPS(ALT_KEY_UNLOCK_SCRIPT)
  if (primary.isDestroyed()) return
  primary.focus()
  primary.moveTop()
}

/** 查询当前前台窗口所属进程名（无 .exe），失败返回空串 */
async function getForegroundProcessName(): Promise<string> {
  const script = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class FG2{[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd,out uint pid);}'
$h=[FG2]::GetForegroundWindow()
$p=0
[void][FG2]::GetWindowThreadProcessId($h,[ref]$p)
$proc=Get-Process -Id $p -ErrorAction SilentlyContinue
if($proc){[Console]::Out.WriteLine($proc.ProcessName)}`
  return runPS(script)
}

/** 把某个 Electron 窗口抬升到专注桌面之上（主窗口放行用） */
export async function raiseBrowserWindow(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return
  const buf = win.getNativeWindowHandle()
  if (buf.length >= 4) {
    await raiseHwndAboveOverlay(buf.readUInt32LE(0).toString(16).toUpperCase())
  }
}

/**
 * 把指定窗口抬升到所有窗口之上（HWND_TOPMOST），使其位于专注桌面之上。
 * @param hwndHex 窗口句柄十六进制字符串（如 '100B06'）
 */
export async function raiseHwndAboveOverlay(hwndHex: string): Promise<void> {
  if (!hwndHex || hwndHex === '0') return
  const hwnd = parseInt(hwndHex, 16)
  if (isNaN(hwnd)) return
  await runPS(SET_TOP_SCRIPT(hwnd))
}

/** 取消窗口置顶（HWND_NOTOPMOST），会话结束时恢复现场用 */
export async function unraiseHwnd(hwndHex: string): Promise<void> {
  if (!hwndHex || hwndHex === '0') return
  const hwnd = parseInt(hwndHex, 16)
  if (isNaN(hwnd)) return
  await runPS(SET_NOTOP_SCRIPT(hwnd))
}

function SET_TOP_SCRIPT(hwnd: number): string {
  // 只置顶不改尺寸（SWP_NOSIZE|SWP_NOMOVE|SWP_NOACTIVATE）：
  // 千万不能把窗口拉满物理屏幕——那会触发 Windows"全屏应用切换"检测，
  // 把底层无缝全屏的专注桌面踢出全屏（变矮、底部露出桌面）。
  // 白名单窗口保持原尺寸浮在专注桌面之上，专注桌面全屏兜底，永远不会露桌面。
  return `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class Z{[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,int hAfter,int x,int y,int cx,int cy,uint f);}'
$h=[IntPtr]::new(${hwnd})
[void][Z]::SetWindowPos($h,[IntPtr]::new(-1),0,0,0,0,0x0013)`
}

function SET_NOTOP_SCRIPT(hwnd: number): string {
  return `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class Z{[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,int hAfter,int x,int y,int cx,int cy,uint f);}'
$h=[IntPtr]::new(${hwnd})
[void][Z]::SetWindowPos($h,[IntPtr]::new(-2),0,0,0,0,0x0013)`
}
