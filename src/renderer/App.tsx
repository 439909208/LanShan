import { useState, useEffect } from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Seals from './pages/Seals'
import Settings from './pages/Settings'
import Focus from './pages/Focus'
import FocusOverlay from './pages/FocusOverlay'
import ToastContainer from './components/Toast'

const navItems = [
  { path: '/', label: '主页', icon: '🏠' },
  { path: '/focus', label: '专注', icon: '🍅' },
  { path: '/seals', label: '刻章', icon: '📜' },
  { path: '/settings', label: '设置', icon: '⚙️' },
]

function App(): React.ReactElement {
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  // 最大化状态（内置最大化按钮图标切换）
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    // Read theme from database on mount
    window.lanshan.getSettings().then((settings) => {
      const t = (settings.theme === 'dark' ? 'dark' : 'light') as 'dark' | 'light'
      setTheme(t)
    })
    // 最大化状态订阅（无边框窗口，内置窗口控制按钮）
    const offMax = window.lanshan.onMaximizeChange(setMaximized)
    // Listen for system prefers-color-scheme changes (optional)
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const handler = (e: MediaQueryListEvent) => {
      // Only auto-switch if user hasn't set a preference
      window.lanshan.getSettings().then((settings) => {
        if (!settings.theme) {
          setTheme(e.matches ? 'light' : 'dark')
        }
      })
    }
    mq.addEventListener('change', handler)
    // Listen for theme changes from Settings page
    const themeListener = (e: Event) => {
      setTheme((e as CustomEvent).detail as 'dark' | 'light')
    }
    window.addEventListener('theme-changed', themeListener)
    return () => {
      offMax()
      mq.removeEventListener('change', handler)
      window.removeEventListener('theme-changed', themeListener)
    }
  }, [])

  useEffect(() => {
    // Apply theme class to root element
    document.documentElement.classList.remove('dark', 'light')
    document.documentElement.classList.add(theme)
  }, [theme])

  return (
    <div
      className="h-full w-full flex flex-col transition-colors duration-200"
      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      {/* Top bar：无边框窗口的拖动区域（交互元素 no-drag）+ 内置窗口控制按钮 */}
      <div
        className="flex items-center gap-3 px-4 py-3 select-none border-b transition-colors duration-200"
        style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)', WebkitAppRegion: 'drag' as never }}
      >
        <div className="flex items-center gap-2 mr-2" style={{ WebkitAppRegion: 'no-drag' as never }}>
          <span className="text-xl">🍃</span>
          <span
            className="text-base font-semibold tracking-wide transition-colors duration-200"
            style={{ color: 'var(--text-secondary)' }}
          >
            澜山
          </span>
        </div>
        <nav className="flex gap-1.5" style={{ WebkitAppRegion: 'no-drag' as never }}>
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }: { isActive: boolean }) =>
                `px-4 py-2 rounded-xl text-base font-medium transition-all duration-200`
              }
              style={({ isActive }: { isActive: boolean }): React.CSSProperties => ({
                background: isActive ? 'var(--accent-bg)' : 'transparent',
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              })}
            >
              <span className="mr-1.5">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex-1" />
        {/* 刷新数据：重新同步 ActivityWatch 原始事件并重建统计（日常无需手动，同步服务自动进行） */}
        <button
          onClick={() => window.lanshan.syncNow().then(() => location.reload())}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border"
          style={{ background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'var(--border)', WebkitAppRegion: 'no-drag' as never }}
          title="刷新数据：重新同步 ActivityWatch 的原始学习事件 → 重新分类（物理/数学/英语/休闲）→ 重建今日与本周统计，然后刷新页面。
日常无需手动刷新：同步服务会自动运行；这里适合刚安装、或怀疑数据缺失时手动触发一次。"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M10 6a4 4 0 1 1-1.17-2.83" />
            <path d="M10 1.5v2.5H7.5" />
          </svg>
          刷新数据
        </button>
        {/* 内置窗口控制（无边框窗口替代系统三键，SVG 图标深浅主题都清晰） */}
        <div className="flex items-center ml-1" style={{ WebkitAppRegion: 'no-drag' as never }}>
          <button
            onClick={() => window.lanshan.minimizeWindow()}
            className="w-9 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--bg-card-hover)]"
            title="最小化"
            style={{ color: 'var(--text-secondary)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <line x1="1.5" y1="6" x2="10.5" y2="6" />
            </svg>
          </button>
          <button
            onClick={() => window.lanshan.maximizeWindow()}
            className="w-9 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--bg-card-hover)]"
            title={maximized ? '还原窗口' : '最大化'}
            style={{ color: 'var(--text-secondary)' }}
          >
            {maximized ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
                <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
                <path d="M8.5 3.5V2a.5.5 0 0 0-.5-.5H2a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h1.5" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
                <rect x="1.5" y="1.5" width="9" height="9" rx="1.2" />
              </svg>
            )}
          </button>
          <button
            onClick={() => window.lanshan.closeWindow()}
            className="w-9 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-red-500 hover:text-white"
            title="关闭（最小化到托盘，应用继续后台运行）"
            style={{ color: 'var(--text-secondary)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <line x1="2" y1="2" x2="10" y2="10" />
              <line x1="10" y1="2" x2="2" y2="10" />
            </svg>
          </button>
        </div>
      </div>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto px-6 py-5">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/seals" element={<Seals />} />
          <Route path="/focus" element={<Focus />} />
          <Route path="/focus-overlay" element={<FocusOverlay />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      <ToastContainer />
    </div>
  )
}

export default App
