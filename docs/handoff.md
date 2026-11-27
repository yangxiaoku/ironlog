# 铁记项目交接

核对日期为 2026 年 11 月 20 日，香港时间。

铁记已完成个人使用版网页 App，正式服务已启动。可以直接注册、记录训练饮食和体重、查看月历与统计。当前通过 SSH 转发访问，公网 HTTPS、真实 AI 和 iPhone 自动上传仍待验收。

## 当前进度

| 模块 | 已完成内容 | 当前状态 |
| --- | --- | --- |
| 网页账号 | 用户名和密码注册、自动登录、刷新保持会话、退出、账号隔离。新密码为 10–128 个大小写英文字母或数字 | 已上线。旧账号可绑定网页登录，继续使用原有数据 |
| 训练与计划 | 从当前计划、已有模板或自由训练开始。记组、切换动作、沿用上次组数据、休息计时、训练体感、草稿恢复和训练复盘 | 网页主流程已完成 |
| 饮食、称重和月历 | 按餐记录营养、标记完整饮食日、查看体重趋势和目标、切换训练与饮食月历 | 网页主流程已完成 |
| 统计 | 7、30、90、365 天周期，以及训练容量、组数、动作进步、肌群、营养、体重和 Apple 健康摘要。后台可调整统计口径和卡片顺序 | 已上线，计算口径见[数据计算说明](calculations.md) |
| 动作库 | 正式目录含 5,650 条动作。支持中英文搜索、肌群和器械筛选、分页、教学步骤及已收录的姿势图 | 已上线，动作数量和带姿势图的动作数量分别统计 |
| Apple 健康 | 设备令牌、开始与结束事件、完整训练样本、重复上传合并、按开始日归档，并按开练时的计划版本匹配兼容训练 | 后端和网页已实现，并有模拟请求测试。iPhone 自动化链路待验收 |
| AI 与 MCP | 网页可将 AI 生成的训练计划保存为草稿。MCP 可查询上下文和动作、创建和修改计划、启用计划、记录训练 | 代码和测试已覆盖。生产模型参数尚未配齐，真实模型调用待联调 |

项目范围为网页、后端和 MCP。原小程序及专属资料归档在本机 `D:/Ironlog-archive/miniprogram-2026-11-19-185645`。

## 本地启动与代码入口

使用 Node.js 22 或更新版本，在 `D:/Ironlog` 执行以下命令。演示版通过内存数据库提供示例数据。

```powershell
npm ci
npm run build
npm run web:demo
```

演示地址为 `http://127.0.0.1:4177/app/`。需要验证真实注册时，使用 `npm run web` 启动普通服务，默认地址为 `http://127.0.0.1:8080/app/`。本地和正式服各自使用自己的 SQLite 数据库。正式服关闭 `ALLOW_DEV_LOGIN`。

| 路径 | 负责内容 |
| --- | --- |
| [web/src](../web/src) | 页面、训练编辑器、图表和浏览器缓存。构建产物输出到 `web/dist` |
| [packages/server/src](../packages/server/src) | Hono API、SQLite、会话、动作目录、Apple 健康、统计和 AI 服务 |
| [packages/shared/src](../packages/shared/src) | 数据模型、训练计算、计划推荐和能量估算 |
| [packages/mcp/src](../packages/mcp/src) | 通过标准输入输出运行的 MCP 服务 |
| [tests](../tests) | 接口、账号隔离、记录持久化、动作素材、统计和训练规则测试 |

本次在本地重新运行了 `npm run typecheck` 和 `npm test`。类型检查、构建与 78 项测试均通过。抽查的 6 个正式服构建产物与本地产物哈希一致。当前工作目录没有 Git 元数据，正式版本通过发布目录标识追踪。

## 正式服务与数据

| 项目 | 当前值 |
| --- | --- |
| systemd 服务 | `ironlog`，运行用户 `ironlog` |
| 服务地址 | `http://127.0.0.1:8080`，网页路径 `/app/` |
| 当前发布 | `/opt/ironlog/releases/20261119-112105.OJTyA3` |
| 上一发布 | `/opt/ironlog/releases/20261119-111654.ViSqKk` |
| 当前指针 | `/opt/ironlog/current` |
| 环境文件 | `/etc/ironlog/ironlog.env` |
| 数据库 | `/var/lib/ironlog/gym.db` |
| Node.js | `/opt/ironlog/runtime/node-v24.22.3-linux-x64/bin/node` |
| 已核对的发布前备份 | `/var/lib/ironlog/web-auth-backup.CDqUksih/gym.db`，SQLite `quick_check` 通过 |

现有 SSH 入口为 `103.236.92.193:22788`。用已有运维凭据连接，建立本机转发后打开 `http://127.0.0.1:4179/app/`。

```sh
ssh -N -p 22788 -L 127.0.0.1:4179:127.0.0.1:8080 root@103.236.92.193
```

在服务器上核对运行状态的命令如下。本次确认 `/health` 返回正常，`/app/` 返回 200，未登录访问 `/api/me` 返回 401。

```sh
systemctl is-active ironlog
readlink -f /opt/ironlog/current
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/api/catalogue/version
```

现行发布方式为独立版本目录。变更前必须先用 [SQLite 备份脚本](../scripts/backup.mjs) 对正式数据库做一致性备份并用 `PRAGMA quick_check` 验证可恢复。依赖在 Linux 对应运行环境安装或复用已核对的 Linux 依赖，再构建并验证。发布时切换 `current`、重启服务并检查网页、健康接口和登录。涉及数据库结构升级（例如 v6 → v7 给 `active_plans` 与 `plan_activations` 增加 `cycle_started_at` 列）时，**不可仅切换旧版代码指针回退**（旧版 v6 位置式插入会报列数不符）：如需回退至 v6，必须先停服、导出升级后新增记录或确认数据窗口、恢复升级前核验过的 v6 SQLite 备份，再切换回旧版指针启动。v7 起所有计划表迁移与写入语句均已改为显式列名以兼容后续扩展。

用户可在「统计后台 → 账号」导出个人数据。已有账号需要绑定网页凭据时，按 [README 的账号说明](../README.md#登录与已有数据) 在正式数据库上操作。直接注册会创建独立账号。

## 待验收

1. **公网 HTTPS 和移动端同步**。限制后端端口只对反向代理开放，设置 `TRUST_PROXY=true`。代理保留原始 `Host`，覆盖 `X-Forwarded-Proto` 和 `X-Forwarded-For`。在 iPhone 用快捷指令实测一场力量和一场有氧，核对归档、统计和计划匹配。 [iPhone 配置](iphone-health-shortcuts.md)
2. **真实 AI**。配置 `AI_BASE_URL`、`AI_MODEL` 和 `AI_API_KEY`，验证网页生成草稿到启用计划，再验证目标 MCP 客户端的调用。 [AI 和 MCP 配置](../README.md#ai-与-mcp)
3. **Docker 交付**。仓库保留 Dockerfile 和 Compose。当前正式服使用 systemd，容器构建、启动和数据卷恢复尚未实测。

网页端目前提供训练复盘和摘要复制。徽章馆与图片海报的资料留在旧版归档。
