# 铁记

铁记是自部署的训练、饮食和体重记录网页 App。后端使用 Hono 和 SQLite，支持 AI 训练计划、MCP 及 Apple 健康训练导入。

当前完成范围、正式服务和待验收项目见[铁记项目交接](docs/handoff.md)。

## 启动

需要 Node.js 22 或更新版本。项目根目录执行：

```powershell
npm ci
npm run build
npm run web:demo
```

在 `http://127.0.0.1:4177/app/` 打开演示版。默认监听本机并使用独立的 `data/demo.db`。已有网页登录时优先打开自己的账号。重新构建后，重启预览进程可同时载入新版前后端。

正式使用时，按需将 `.env.example` 复制为 `.env`，再运行 `npm run web` 并打开服务地址的 `/app/`。默认监听 `127.0.0.1:8080`，数据存放在 `data/gym.db`。生产环境关闭 `ALLOW_DEV_LOGIN`。公网访问和 iPhone 快捷指令使用同一个 HTTPS 地址。手机浏览器可将网页添加到主屏幕。

## 登录与已有数据

直接在网页创建用户名和密码。注册成功后自动登录，随后可用相同的用户名和密码登录其他设备。新密码支持大小写英文字母和数字，长度为 10–128 个字符。浏览器会话有效期为 30 天，退出会撤销当前会话。生产反向代理应保留原始 `Host` 并设置 `X-Forwarded-Proto: https`。

要继续使用已有账号的数据，在服务器使用与正式服务一致的 `DATABASE_PATH`，先执行 `npm run web:account -- --list` 核对用户 ID，再将选定的密码通过标准输入绑定到该账号。例如在 Bash 中执行：

```sh
read -r -p '用户 ID ' ironlogUserId
read -r -p '用户名 ' ironlogUsername
IFS= read -r -s ironlogPassword
printf '%s' "$ironlogPassword" | npm run web:account -- --bind "$ironlogUserId" "$ironlogUsername"
unset ironlogPassword
```

用绑定的凭据登录网页即可读取原来的记录。

## 训练、统计和健康同步

- 总览显示今日训练、饮食和体重。训练可逐组沿用历史记录，切换动作、计时并保存体感，完成后可查看训练复盘。
- 统计后台可调整 7 天、30 天、90 天或 365 天的默认周期、是否计入热身组，以及卡片顺序。估算 1RM 和个人纪录使用有效工作组。能量估算、体重趋势和完整饮食日见[数据计算口径](docs/calculations.md)。
- Apple 健康训练按开练日进入当天记录和月历，与同一次手录训练去重。为每部 iPhone 签发设备上传令牌的步骤见 [Apple 健康快捷指令](docs/iphone-health-shortcuts.md)。
- 浏览器缓存网页外壳，并按账号保存本机训练草稿。正式记录的读取、写入和跨设备同步需要连接后端。

## AI 与 MCP

在服务器的 `.env` 中设置 `AI_BASE_URL`、`AI_MODEL` 和 `AI_API_KEY`。AI 生成的计划作为草稿保存，核对后可启用。

在支持 MCP 的客户端配置以下服务。替换为实际的安装路径、服务地址和铁记账号令牌。服务管理员可以用 `npm run web:account -- --existing <用户ID>` 给已有账号签发独立的 API 令牌。

```json
{
  "mcpServers": {
    "ironlog": {
      "command": "node",
      "args": ["D:/Ironlog/packages/mcp/dist/index.js"],
      "env": {
        "IRONLOG_URL": "http://127.0.0.1:8080",
        "IRONLOG_TOKEN": "替换为访问令牌"
      }
    }
  }
}
```

MCP 支持查询训练上下文与动作、管理计划草稿、应用计划、记录训练和查看当日概览。

## 部署与备份

```sh
docker compose up -d --build
```

Compose 将 SQLite 持久化到宿主机的 `./data`。在容器内签发令牌时，在上文命令前使用 `docker compose exec ironlog`。网页中可在「统计后台 → 账号」导出自己的记录。新版 JSON 备份包含已同步的睡眠阶段和时段数据，可用于恢复作息报表。只包含睡眠汇总的旧备份仍可恢复汇总。部署者可通过 `node --env-file-if-exists=.env scripts/backup.mjs` 创建一致性 SQLite 备份。

## 项目结构

- `web/src` 网页源码，`web/assets` 网点插图、肌群遮罩及素材清单。
- `packages/server` 后端和[云端动作目录](docs/cloud-catalogue-health-sync.md)。
- `packages/shared` 训练数据模型与计算。
- `packages/mcp` MCP 服务。

运行 `npm run typecheck` 和 `npm test` 验证。重新生成肌群遮罩可执行 `node scripts/import-musclemap.mjs --local`，上游来源和许可保存在 `third_party/musclemap`。
