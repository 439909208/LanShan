import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { runPS, ALT_KEY_UNLOCK_SCRIPT } from './ps'

const isDev = !app.isPackaged

let overlayWindows: BrowserWindow[] = []

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
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      // 真全屏（覆盖任务栏）：全屏窗口才会触发 Windows 自动隐藏任务栏。
      // 注意不能设 resizable:false——Windows 上不可缩放窗口的全屏可能不生效。
      fullscreen: true,
      show: false,
      skipTaskbar: true,
      title: '澜山 · 专注桌面',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    // 兜底：创建选项没生效时再补一次（在窗口显示前调用，显示后由 Electron 保持全屏）
    try {
      win.setFullScreen(true)
    } catch (err) {
      console.error('[focus] 全屏设置失败:', err)
    }
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
  // SWP_NOSIZE(1) | SWP_NOMOVE(2) | SWP_NOACTIVATE(0x10)
  return `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class Z{[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,int hAfter,int x,int y,int cx,int cy,uint f);}'
$h=[IntPtr]::new(${hwnd})
[void][Z]::SetWindowPos($h,[IntPtr]::new(-1),0,0,0,0,0x0013)`
}

function SET_NOTOP_SCRIPT(hwnd: number): string {
  return `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class Z{[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,int hAfter,int x,int y,int cx,int cy,uint f);}'
$h=[IntPtr]::new(${hwnd})
[void][Z]::SetWindowPos($h,[IntPtr]::new(-2),0,0,0,0,0x0013)`
}
