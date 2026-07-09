# 🍃 澜山 — 学习时长统计工具

Windows 桌面学习伴侣，后台默默记录学习时长，打开就是漂亮的统计面板。

## ✨ 功能

- 📊 **仪表盘** — 三科进度条、科目环形图、7 天趋势折线图
- 🔥 **热力图** — 按科目达标数着色，月度视图
- 🏆 **成就系统** — 38 个成就（含隐藏），自动解锁 + Toast 弹窗
- 🖱 **托盘快捷切换** — 右键切换当前科目，图标跟随变色
- 🌗 **浅色/深色主题**
- 🔒 **数据完全本地** — SQLite 存储，不上传任何服务器

## 🚀 快速开始

```bash
npm install
npm run dev
```

> 前提：需要安装并运行 [ActivityWatch](https://activitywatch.net/)（`localhost:5600`）

## 📦 打包

```bash
npm run pack
```

`release/澜山.exe` 即绿色免安装版。

## 🛠 技术栈

- Electron + React 19 + TypeScript
- TailwindCSS 4 + Recharts
- SQLite（sql.js）
- ActivityWatch REST API
