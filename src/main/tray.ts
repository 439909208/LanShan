import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron'
import { Subject, CORE_SUBJECTS, setTraySubject, getTraySubject } from './database'
import { getSubjectColor } from './classifier'

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null

// For generating colored tray icons without native canvas, use nativeImage directly
// We'll create simple colored icons using raw RGB data

const TRAY_ICON_SIZE = 32

/**
 * Generate a colored tray icon (16x16 or 32x32) as a NativeImage.
 * We use a minimal approach: create a small colored circle as PNG data.
 */
function createColoredIcon(color: string): nativeImage {
  // Parse hex color
  const hex = color.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)

  // Create a 32x32 RGBA buffer (simple circle icon)
  const size = TRAY_ICON_SIZE
  const buffer = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - 1

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const idx = (y * size + x) * 4

      if (dist <= radius) {
        // Leaf shape approximation: a simple circle
        buffer[idx] = r
        buffer[idx + 1] = g
        buffer[idx + 2] = b
        buffer[idx + 3] = 255
      } else {
        buffer[idx] = 0
        buffer[idx + 1] = 0
        buffer[idx + 2] = 0
        buffer[idx + 3] = 0
      }
    }
  }

  return nativeImage.createFromBuffer(buffer, { width: size, height: size })
    .resize({ width: 16, height: 16 })
}

/**
 * Create the system tray with its menu.
 */
export function createTray(win: BrowserWindow): Tray {
  mainWindow = win

  const icon = createColoredIcon('#10b981') // Default green leaf
  tray = new Tray(icon)
  tray.setToolTip('澜山 — 学习伴侣')

  updateTrayMenu()
  updateTrayIcon()

  // Double-click to open window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  return tray
}

/**
 * Update the tray menu based on current subject state.
 */
function updateTrayMenu(): void {
  if (!tray) return

  const currentSubject = getTraySubject()

  const menuItems: Electron.MenuItemConstructorOptions[] = []

  // Subject switching items
  for (const subject of CORE_SUBJECTS) {
    menuItems.push({
      label: currentSubject === subject ? `✓ ${subject}` : `${subject}`,
      click: () => {
        setTraySubject(subject)
        updateTrayMenu()
        updateTrayIcon()
      },
    })
  }

  // "Unset" option
  menuItems.push({
    label: currentSubject === null ? '✓ ❓ 不指定' : '❓ 不指定',
    click: () => {
      setTraySubject(null)
      updateTrayMenu()
      updateTrayIcon()
    },
  })

  menuItems.push({ type: 'separator' })

  menuItems.push({
    label: '打开澜山',
    click: () => {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      }
    },
  })

  menuItems.push({ type: 'separator' })

  menuItems.push({
    label: '关于',
    click: () => {
      if (mainWindow) {
        mainWindow.webContents.send('show-about')
      }
    },
  })

  menuItems.push({
    label: '退出',
    click: () => {
      app.quit()
    },
  })

  const contextMenu = Menu.buildFromTemplate(menuItems)
  tray.setContextMenu(contextMenu)
}

/**
 * Update the tray icon color based on current subject.
 */
function updateTrayIcon(): void {
  if (!tray) return

  const currentSubject = getTraySubject()
  let color: string

  if (currentSubject) {
    color = getSubjectColor(currentSubject)
  } else {
    color = '#10b981' // Default green
  }

  const icon = createColoredIcon(color)
  tray.setImage(icon)
  
  const tooltip = currentSubject
    ? `澜山 — 当前科目：${currentSubject}`
    : '澜山 — 学习伴侣'
  tray.setToolTip(tooltip)
}

/**
 * Update the tray state (call after subject changes from settings / other places).
 */
export function refreshTray(): void {
  updateTrayMenu()
  updateTrayIcon()
}

/**
 * Get the tray instance for use in main process.
 */
export function getTray(): Tray | null {
  return tray
}
