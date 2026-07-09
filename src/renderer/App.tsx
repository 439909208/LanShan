import { useState, useEffect } from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Achievements from './pages/Achievements'
import Settings from './pages/Settings'
import ToastContainer from './components/Toast'

const navItems = [
  { path: '/', label: '概览', icon: '📊' },
  { path: '/settings', label: '设置', icon: '⚙️' },
]

function App(): React.ReactElement {
  const [theme, setTheme] = useState<'dark' | 'light'>('light')

  useEffect(() => {
    // Read theme from database on mount
    window.lanshan.getSettings().then((settings) => {
      const t = (settings.theme === 'dark' ? 'dark' : 'light') as 'dark' | 'light'
      setTheme(t)
    })
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
      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-6 py-3 select-none border-b transition-colors duration-200"
        style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2 mr-2">
          <span className="text-xl">🍃</span>
          <span
            className="text-base font-semibold tracking-wide transition-colors duration-200"
            style={{ color: 'var(--text-secondary)' }}
          >
            澜山
          </span>
        </div>
        <nav className="flex gap-1.5">
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
        <button
          onClick={() => window.lanshan.syncNow().then(() => location.reload())}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
        >
          🔄 刷新
        </button>
      </div>

      {/* Page content */}
      <main className="flex-1 overflow-y-auto px-6 py-5">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/achievements" element={<Achievements />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      <ToastContainer />
    </div>
  )
}

export default App
