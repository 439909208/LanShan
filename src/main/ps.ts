import { execFile } from 'child_process'

/**
 * PowerShell 调用全局并发队列：任何时刻最多 2 个并发。
 * 防止会话结束时瞬间 spawn 几十个 powershell 进程拖死系统（曾导致主进程卡死）。
 */
let runningPS = 0
const psQueue: { script: string; resolve: (v: string) => void }[] = []

function runPSInner(script: string): Promise<string> {
  // PowerShell 5.1 输出到管道默认用 GBK，Node 按 UTF-8 解码会乱码（中文标题/路径）。
  // 统一强制 UTF-8 输出。
  const utf8Script =
    '$OutputEncoding=[System.Text.Encoding]::UTF8\n' +
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\n' +
    script
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', utf8Script],
      { timeout: 10_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : stdout.trim())
    )
  })
}

/** 运行一段 PowerShell 脚本并返回 stdout（失败返回空串）。零原生依赖。 */
export function runPS(script: string): Promise<string> {
  return new Promise((resolve) => {
    psQueue.push({ script, resolve })
    pump()
  })
}

function pump(): void {
  while (runningPS < 2 && psQueue.length > 0) {
    const job = psQueue.shift()!
    runningPS++
    runPSInner(job.script).then((out) => {
      job.resolve(out)
      runningPS--
      pump()
    })
  }
}

/**
 * 模拟按下再松开 Alt 键：让本进程获得"允许抢占前台"资格，
 * 解决 Windows 前台锁导致的 setFocus 失效问题。
 */
export const ALT_KEY_UNLOCK_SCRIPT = `
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class KB{[DllImport("user32.dll")] public static extern void keybd_event(byte bVk,byte bScan,uint dwFlags,UIntPtr dwExtraInfo);}'
[void][KB]::keybd_event(0x12,0,0,[UIntPtr]::Zero)
[void][KB]::keybd_event(0x12,0,2,[UIntPtr]::Zero)`

/**
 * 隐藏任务栏 + 把系统工作区设为全屏（专注会话期间用）。
 * 只隐藏任务栏不够：Windows 不刷新工作区，窗口最大化仍只到旧高度、底部残留任务栏区域。
 * 必须用 SPI_SETWORKAREA 把工作区同步设为全屏，白名单软件最大化才会铺满屏幕。
 */
export const TASKBAR_HIDE_SCRIPT = `
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class TBH{[DllImport("user32.dll")] public static extern IntPtr FindWindow(string c,string w);[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a,uint p,ref R r,uint f);[DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);[StructLayout(LayoutKind.Sequential)] public struct R{public int L,T,RT,B;}}'
$h=[TBH]::FindWindow('Shell_TrayWnd',$null)
if($h -ne [IntPtr]::Zero){[void][TBH]::ShowWindow($h,0)}
$r=New-Object TBH+R
$r.L=0
$r.T=0
$r.RT=[TBH]::GetSystemMetrics(0)
$r.B=[TBH]::GetSystemMetrics(1)
[void][TBH]::SystemParametersInfo(0x002F,0,[ref]$r,0)`

/**
 * 恢复任务栏 + 恢复工作区（专注会话结束/应用退出时）。
 */
export const TASKBAR_SHOW_SCRIPT = `
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class TBS{[DllImport("user32.dll")] public static extern IntPtr FindWindow(string c,string w);[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);[DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a,uint p,ref R r,uint f);[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out R r);[DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);[StructLayout(LayoutKind.Sequential)] public struct R{public int L,T,RT,B;}}'
$h=[TBS]::FindWindow('Shell_TrayWnd',$null)
if($h -ne [IntPtr]::Zero){
  [void][TBS]::ShowWindow($h,5)
  $tr=New-Object TBS+R
  [void][TBS]::GetWindowRect($h,[ref]$tr)
  $r=New-Object TBS+R
  $r.L=0
  $r.T=0
  $r.RT=[TBS]::GetSystemMetrics(0)
  $r.B=([TBS]::GetSystemMetrics(1)-($tr.B-$tr.T))
  [void][TBS]::SystemParametersInfo(0x002F,0,[ref]$r,0)
}`
