# 影刀账号管理工具

> 一个基于 Tauri v2 + React 的桌面应用，用于管理影刀 RPA 账号和流程迁移。

---

## ✨ 功能特性

- 🔐 **多账号管理** — 添加、编辑、删除多个影刀账号
- 📦 **本地流程迁移** — 扫描本地影刀流程，一键迁移到目标账号
- ☁️ **云端流程迁移** — 从云端拉取流程列表，跨账号迁移
- 🗑️ **批量删除** — 支持批量删除本地/云端流程
- 🌐 **多语言支持** — 中文/English 切换
- 🎨 **主题切换** — 浅色/深色/跟随系统
- 🔄 **自动更新** — 检测 GitHub Release 新版本，下载进度条，自动安装

---

## 🖥️ 环境准备

开始之前，请确保你的电脑已安装以下工具：

| 工具 | 版本要求 | 下载链接 |
|------|---------|---------|
| **Node.js** | ≥ 18 | [nodejs.org](https://nodejs.org/) |
| **Rust** | ≥ 1.70 | [rustup.rs](https://rustup.rs/) |
| **Visual Studio Build Tools** | 2019+ (含 C++ 桌面开发) | [visualstudio.microsoft.com](https://visualstudio.microsoft.com/visual-cpp-build-tools/) |

> [!TIP]
> 安装 Rust 时，`rustup` 会自动帮你安装 `cargo`（Rust 的包管理器）。

### 验证安装

打开终端，运行以下命令确认工具已正确安装：

```bash
node --version    # 应显示 v18.x.x 或更高
npm --version     # 应显示 9.x.x 或更高
rustc --version   # 应显示 rustc 1.70.x 或更高
cargo --version   # 应显示 cargo 1.70.x 或更高
```

---

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/ethan-010203/yingdao.git
cd yingdao/desktop
```

### 2. 安装依赖

```bash
npm install
```

> 首次运行时，Rust 依赖（crate）会在后台自动下载编译，可能需要几分钟。

### 3. 启动开发模式

```bash
npm run tauri dev
```

启动后会自动打开应用窗口。修改前端代码会自动热重载，修改 Rust 代码需要重新编译。

---

## 📦 打包构建

生成可安装的 `.exe` 安装包：

```bash
npm run tauri build
```

构建完成后，安装包位于：

```
src-tauri/target/release/bundle/nsis/
```

---

## 📁 项目结构

```
desktop/
├── src/                    # 前端代码 (React + TypeScript)
│   ├── App.tsx             # 主应用组件
│   ├── main.tsx            # 入口文件
│   ├── index.css           # 全局样式
│   ├── components/         # UI 组件
│   │   ├── SettingsPage.tsx   # 设置页面（含更新检测）
│   │   ├── LoginPage.tsx      # 登录页面
│   │   ├── layout/            # 布局组件（侧边栏等）
│   │   └── ui/                # 基础 UI 组件
│   ├── contexts/           # React Context（配置/认证）
│   └── lib/                # 工具库
│       ├── i18n.ts            # 国际化翻译
│       ├── utils.ts           # 工具函数
│       └── supabase.ts        # Supabase 客户端
├── src-tauri/              # 后端代码 (Rust)
│   ├── src/
│   │   ├── main.rs            # 程序入口
│   │   ├── lib.rs             # Tauri 插件注册
│   │   ├── commands.rs        # Tauri 命令（前端可调用）
│   │   ├── api/               # API 模块（登录认证）
│   │   └── flow/              # 流程模块（本地/云端/迁移）
│   ├── Cargo.toml          # Rust 依赖配置
│   ├── tauri.conf.json     # Tauri 配置文件
│   └── capabilities/       # 权限配置
├── package.json            # 前端依赖配置
├── vite.config.ts          # Vite 构建配置
└── tailwind.config.js      # TailwindCSS 配置
```

---

## 🔧 技术栈

| 层 | 技术 |
|----|----|
| 框架 | [Tauri v2](https://v2.tauri.app/) |
| 前端 | React 19 + TypeScript |
| 构建 | Vite 7 |
| 样式 | TailwindCSS 3 |
| 后端 | Rust (reqwest, tokio, serde) |
| 安装包 | NSIS (Windows) |

---

## ❓ 常见问题

### Q: 首次编译很慢怎么办？

首次运行 `npm run tauri dev` 需要编译所有 Rust 依赖，通常需要 3-10 分钟。之后的增量编译会快很多。

### Q: 提示缺少 Visual Studio Build Tools？

Tauri 在 Windows 上需要 C++ 编译工具。请安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选 **"使用 C++ 的桌面开发"** 工作负载。

### Q: 运行时白屏怎么办？

1. 检查终端是否有编译错误
2. 清除缓存：删除 `node_modules` 文件夹，重新 `npm install`
3. 清除 Rust 缓存：`cd src-tauri && cargo clean`

### Q: 如何发布新版本？

1. 修改 `tauri.conf.json` 和 `Cargo.toml` 中的 `version` 字段
2. 运行 `npm run tauri build` 打包
3. 在 GitHub Release 中创建新 tag（如 `v1.1.0`），上传 `.exe` 安装包
4. 已安装的用户打开应用时会自动检测到更新

---

## 📄 License

MIT © [Ethan](https://github.com/ethan-010203)
