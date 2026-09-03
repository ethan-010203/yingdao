# 影刀网页迁移工具

影刀云端流程迁移控制台。React 前端和 Axum API 由同一个服务提供，通过 Cloudflare Tunnel 暴露 HTTPS 域名，应用本身只监听服务器回环地址。

## 已实现功能

- 管理员登录与 12 小时服务端会话
- 多个影刀账号的增删改查和在线验证
- 按账号查看、搜索和分页管理云端流程，并可批量移入影刀回收站
- 迁移时可搜索源账号和目标账号，命名模板支持名称与时间变量
- 迁移记录展示源账号、流程明细、目标账号和执行结果
- AES-256-GCM 加密保存影刀密码，密钥与 SQLite 分离
- 服务端流程搜索、分页和单次最多 10 个流程选择
- 源账号到目标账号的后台迁移队列
- 下载、重打包、上传、创建和校验阶段进度
- 持久化迁移记录和失败项重试
- 磁盘流式下载、上传和 ZIP 原始压缩数据复制
- 成功或失败时清理任务临时文件，启动时清理遗留目录

## 目录

```text
backend/    Rust + Axum API、SQLite、任务执行器和迁移引擎
frontend/   React + TypeScript + Vite 管理控制台
deploy/     systemd 服务配置
tools/      独立的服务器迁移验证脚本
```

## 本地开发

要求 Rust 1.85+、Node.js 20+ 和 pnpm 10+。

```bash
cd frontend
pnpm install
pnpm build

cd ..
cargo test --manifest-path backend/Cargo.toml
cargo run --manifest-path backend/Cargo.toml
```

本地默认监听 `127.0.0.1:18080`。开发时也可运行 `pnpm dev`，Vite 会把 `/api` 转发至 Axum。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `YINGDAO_BIND_ADDR` | `127.0.0.1:18080` | Axum 监听地址 |
| `YINGDAO_STATIC_DIR` | `frontend/dist` | 前端静态文件目录 |
| `YINGDAO_DATABASE_PATH` | `backend/data/yingdao-web.sqlite3` | SQLite 数据库 |
| `YINGDAO_ACCOUNT_KEY_PATH` | `backend/data/account.key` | 影刀密码加密密钥 |
| `YINGDAO_TEMP_DIR` | `backend/data/tmp` | 迁移临时目录 |
| `YINGDAO_COOKIE_SECURE` | `false` | HTTPS 生产环境设为 `true` |
| `YINGDAO_BOOTSTRAP_ADMIN_USERNAME` | 无 | 空数据库首次创建管理员 |
| `YINGDAO_BOOTSTRAP_ADMIN_PASSWORD_HASH` | 无 | 首个管理员的 Argon2id 哈希 |
| `RUST_LOG` | `yingdao_web=info` | 日志级别 |

账号加密密钥不存在时会以 `0600` 权限生成。生产环境应备份数据库和密钥；缺少原密钥时，数据库中的影刀密码无法恢复。

## 资源边界

- 单个流程下载包上限：50 MB
- `package.json` 上限：32 MB
- ZIP 解压后总大小上限：300 MB
- ZIP 条目数上限：10,000
- 单个迁移任务上限：10 个流程
- 后台迁移并发：1
- systemd 内存硬限制：1 GB

流程包写入任务专属磁盘目录，上传也从文件流读取；不会把整个 `.bot` 压缩包放进内存。处理结束后任务目录自动删除，服务启动时还会清理异常退出遗留的临时目录。

## 生产部署边界

- systemd 服务：`yingdao-web`
- 安装目录：`/opt/yingdao-web`
- 数据目录：`/var/lib/yingdao-web`
- 监听地址：`127.0.0.1:18080`
- 公网入口：`https://yingdao.ethan010203.online`

Cloudflare Tunnel 连接回环地址，不需要开放服务器的 18080 端口。数据库、账号密钥、环境变量和旧接口抓包均不应发布到服务器静态目录或公开仓库。
