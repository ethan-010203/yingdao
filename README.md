# 影刀流程迁移工具

这个仓库同时保存桌面端和 Web 端两个独立项目。

| 目录 | 用途 | 技术栈 |
| --- | --- | --- |
| [`desktop/`](desktop/) | 原桌面客户端 | Tauri 2、React、TypeScript、Rust |
| [`web/`](web/) | 云端迁移管理平台 | React、TypeScript、Axum、SQLite |

## 桌面端

桌面端支持影刀账号管理、本地及云端流程迁移和 Windows 安装包构建。开发和打包说明见 [`desktop/README.md`](desktop/README.md)。

## Web 端

Web 端由 Axum 同时提供 API 和前端静态文件，通过 Cloudflare Tunnel 对外提供 HTTPS 服务。开发、部署和资源边界说明见 [`web/README.md`](web/README.md)。

## 安全说明

仓库不包含生产数据库、账号加密密钥、环境变量、服务器密码或 Cloudflare Tunnel Token。运行时数据必须保存在仓库目录之外，并单独备份数据库与账号密钥。
