# iPhone 体能训练自动上传

## Health Data Export

在 iPhone 授权 Health Data Export 读取「体能训练」，并选择 **Workouts**。手动导出时选 JSON 并存到「文件」，再到铁记「统计后台 → Apple 健康 → 导入训练 JSON」上传。文件和 Webhook 一次最多 16 MB、1,000 条训练。日期需要包含时区，可通过缩短日期范围控制文件大小。

使用 iPhone 可访问的 HTTPS 地址打开铁记后，在同一页面选**设置自动同步**，复制 Webhook 地址和新生成的设备令牌。在 iPhone 的 Health Data Export 自动导出中选择 Workouts 与 HTTPS Webhook，填入地址和 Bearer Token，然后测试连接。iOS 决定后台发送时间。[Health Data Export](https://apps.apple.com/us/app/health-data-export/id6758620223)

文件导入和 Webhook 复用 Apple 健康训练档案。重复记录按原始训练 ID 去重，缺少 ID 时用运动类型和起止时间。时长、活动能量、距离和心率按可识别的单位入库，路线和原始心率样本不入库。计划匹配使用已有规则。当前已用模拟文件和 Webhook 验证，实际 iPhone 导出格式待验收。

## Apple 快捷指令（全能合一联动 · 推荐）

现在推荐在铁记网页版 **「设置 → Apple 健康」** 点击 **「导出全能快捷指令（1 个文件）」**，只需签名并导入 **1 个** `铁记-通用-Apple健康全能联动.shortcut`，即可统筹以下 4 项功能：

1. **网页智能路由入参（`shortcuts://run-shortcut?name=...&input=text&text=<指令>`）**：
   - `strength`：记录开始事件（`POST /api/integrations/apple-health/events`）并自动跳转 Apple「健身」App；
   - `cardio`：直接打开 Apple「健身」App 开启有氧；
   - `end`：等待 5 秒同步 Apple 健康样本，自动查 `/events/active`（若未先打开始事件则按设定窗口兜底回传 `/workouts`），采集活动能量、心率与距离写入铁记；
   - `daily`：采集勾选的每日全量健康指标并上传至 `/api/integrations/apple-health/daily`。
2. **手机直接运行兜底菜单**：在 iPhone 上直接点击该快捷指令（无入参）时，会自动弹出 **4 合 1 中文操作菜单**（`开始传统力量` / `打开有氧健身` / `结束训练并同步心率热量` / `同步今日健康数据`）。
3. **每日全自动调度**：在 iPhone「快捷指令 → 自动化 → ＋」设每天 **23:30**「运行快捷指令」选此全能快捷指令即可；如有独立 Watch 触发需求，也可在导出弹窗底部「高级」区单独导出单项快捷指令。
4. **Watch 直开传统力量可选微调**：若希望在点击「开始传统力量」时跳过「健身」App 首页直接拉起手表传统力量体能训练，可在手机「快捷指令」App 中展开该全能快捷指令，将 `strength` 分支末尾的「打开 App（健身）」替换为 **「开始体能训练 → 传统力量训练」**。

在铁记网页版「设置 → Apple 健康」标签页中，已整合 **全能快捷指令导出、力量/有氧智能跳转模式切换、一键触发按钮（开始传统力量 / 打开有氧健身 / 回传刚结束训练 / 同步今日健康）、Health Data Export 与已绑定设备管理**。[Apple 体能训练触发器](https://support.apple.com/en-ph/guide/shortcuts/apd932ff833f/ios)

## 方式一：纯 iPhone 免 Mac 导入（通用脱敏模板 + 第三方在线签名，推荐）

iOS 15+ 要求导入的 `.shortcut` 文件必须经过签名。手头没有 Mac 时，推荐在铁记导出弹窗选择默认开启的 **「通用安全模板」**：生成的文件**不包含服务器地址和设备令牌**，而是通过 iOS 原生 `WFWorkflowImportQuestions` 在添加到手机时再弹窗询问填表，既能安全使用第三方签名工具，也不会泄露任何账号凭据。

常用第三方签名入口：

- **网页在线签名（免装工具）**：[Shortcuty Shortcut Signer](https://sign.shortcuty.app)（`https://sign.shortcuty.app`）——无需登录，直接上传铁记下载的 `铁记-通用-*.shortcut` 文件即可在线签名并下载，在 Safari 点开即可「添加快捷指令」。
- **手机端快捷指令工具**：[RoutineHub](https://routinehub.co)（`https://routinehub.co`）——在站内搜索安装 **Sign Shortcut File** 或 HubSign 相关签名工具，配合铁记的 **「复制 Base64」**（先通过「Base64 转文件」解码再签名）或已下载的 `.shortcut` 文件使用。

操作流程（网页弹窗内已改为 5 步渐进向导，完成每一步后再操作下一步）：

1. **第 1 步 · 绑定设备**：在「设置 / 统计后台 → Apple 健康 → 生成上传快捷指令」签发或复用设备令牌，确认公网服务器地址（如 `http://107.174.65.164:8080` 或 `https://你的域名`）。
2. **第 2 步 · 导出快捷指令**：保持 **「通用安全模板（推荐）」**，按需选健康指标 preset 后点 **「下载全能 .shortcut」**（或 **「复制 Base64」**，已优化为仅回看近 1 天数据）。
3. **第 3 步 · 签名并安装到 iPhone**：按向导任选网页签名（[Shortcuty](https://sign.shortcuty.app)）、手机 Base64 签名（[RoutineHub](https://routinehub.co)）或 Mac 终端一行命令签名，签完点 **「添加快捷指令」**。
4. **第 4 步 · 依次粘贴凭据**：iOS 弹窗询问时，直接点击向导第 4 步对应的 **「复制服务器地址」** 与 **「复制设备令牌（无需 Bearer）」** 粘贴即完成（⚠️ 切勿把预填直出文件提交给第三方网站）。
5. **第 5 步 · 开权限并测试**：在 iPhone **「健康 App → 头像 → 隐私 → App → 快捷指令」** 打开权限后，点向导第 5 步 **「拉起测试同步」→「检查是否收到数据」**，跑通一次即可；随后可按向导折叠栏设每日 **23:30** 全自动定时。

## 方式二：网页直接生成 + Mac 一行命令签名（适合 Mac 用户）

若手头有 Mac，可直接用「预填直出」或「通用安全模板」，在 Mac 上用系统自带的 `shortcuts sign` 一键完成本地签名，无需借助任何第三方工具：

1. 在「统计后台 → Apple 健康」点击 **「生成上传快捷指令」**，输入设备名称并确认公网服务器地址（如 `https://ironlog.example.com`）。
2. 在导出弹窗中按需下载：
   - **每日全量健康同步**（`铁记-每日全量健康同步.shortcut` → `POST /api/integrations/apple-health/daily`）：v3 回看最近 1 天（24 小时）并对累计指标启用按天分组（`Group by: Day`），避免样本过多卡顿。活动与饮食累积量按样本日期汇总，睡眠按连续睡眠段的结束日期归档，体征上传近 1 天内最新的样本与日期。缺少样本的指标留空。有新称重时，按采样日补充体重与体脂记录，保留手动称重。
   - **单场训练打卡**（`铁记-开始-*.shortcut` 与 `铁记-结束-*.shortcut` → `POST /api/integrations/apple-health/events`）：按运动类型导出开始与结束配对文件。
3. 在 Mac 打开「终端 (Terminal)」，复制弹窗中的一行签名命令并回车：
   - 命令会使用 `plutil -convert binary1` 转为二进制 plist，再通过 `shortcuts sign --mode anyone` 完成签名并输出到 `~/Downloads/ironlog-signed`。
4. 将签名后的 `.shortcut` 文件通过 **隔空投送 (AirDrop)** 发给 iPhone 并点「添加快捷指令」（注意：**每日全量健康同步包含 Apple「健康」样本读取动作，必须在 iPhone 上运行**；Mac 本身没有「健康」数据库，导出时默认使用简体中文健康类型名，也可切换为 English）。
5. 在 iPhone「快捷指令 → 自动化 → ＋」绑定自动运行：
   - **每日全量健康同步**：选「特定时间（建议每晚 23:30 睡前亮屏时段）」或「充电器连接时」→ 立即运行（避开深睡锁屏读取 HealthKit 受限）。
   - **开始 / 结束训练**：选「Apple Watch 体能训练 → 开始时 / 结束时 → 立即运行」→ 分别选择对应的两个快捷指令即可。

## 方式三：在 iPhone 上手动配置一组自动化

1. 复制铁记「Apple 健康 → Apple 快捷指令」显示的地址。打开 iPhone「快捷指令 → 自动化 → ＋ → Apple Watch 体能训练」，选择「传统力量训练」和「开始」，选「立即运行」。
2. 选择新建空白自动化。添加「当前日期」和「格式化日期」。格式选 ISO 8601。如果版本没有这个预设，可用自定义 `yyyy-MM-dd'T'HH:mm:ssZZZZZ`。输出应类似 `2026-11-18T18:00:00+08:00`。
3. 添加「获取 URL 内容」，粘贴刚复制的地址，方法选 `POST`。回到「Apple 健康」添加设备并复制上传令牌，在快捷指令的 Authorization 请求头填写 `Bearer <上传令牌>`。请求体选 JSON，按下表配置。先复制地址再生成令牌，方便把两个值依次粘贴到对应位置。[Apple 快捷指令请求格式](https://support.apple.com/en-lamr/guide/shortcuts/apd58d46713f/ios)
4. 新建第二个同类型自动化，选择「结束」和「立即运行」。复用同一设备令牌与上传地址，把请求体中的 `event` 改为 `end`。然后在手表开始并结束一次试跑，刷新网页后在训练记录里核对。两条自动化可调用两个很短的子快捷指令，避免重新录入授权值。

| JSON 字段 | 开始自动化 | 结束自动化 |
| --- | --- | --- |
| `schemaVersion` | 数字 `1` | 数字 `1` |
| `event` | 文字 `start` | 文字 `end` |
| `activityType` | `traditionalStrengthTraining` | `traditionalStrengthTraining` |
| `environment` | 可选 `indoor` | 可选 `indoor` |
| `occurredAt` | 格式化日期变量 | 格式化日期变量 |

其他运动使用各自的 Watch 触发类型和相同代码。例如功能性力量训练用 `functionalStrengthTraining`，跑步用 `running`，踏步机用 `stairClimbing`，骑行用 `cycling`。户外跑步可在请求体追加 `environment: "outdoor"`。开始和结束应使用同一个设备令牌及同一类型代码。结束时服务端保存一条体能训练，时长标为「约」。如果开始事件因为设备离线未送达，请求会明确返回「未找到同类训练的开始事件」。

## 读取完整 Apple 健康训练的设备

如果你的 iPhone 能从快捷指令动作或 HealthKit 辅助工具读取完整训练，可在「结束」自动化里直接上传真实样本。把 URL 路径换成 `/api/integrations/apple-health/workouts`，继续用同一个设备令牌，请求体结构见[设计文档](cloud-catalogue-health-sync.md)。保留 Apple 训练 ID 并用它去重。活动热量和心率只上传设备实际提供的数据。没有读取到的字段省略或填 `null`。每种运动选择一种上传方式，避免同一场训练同时产生触发记录和完整样本记录。[HealthKit 训练对象](https://developer.apple.com/documentation/healthkit/hkworkout?changes=_1)

自动化首次访问网络或健康样本时，应在解锁状态允许所需权限。锁屏读取健康数据可能受系统限制。上传失败后可以再次运行完整样本快捷指令，使用原训练 ID 和时间，铁记会去重。关闭某台设备的同步时，在铁记撤销对应令牌。[HealthKit 锁屏读取限制](https://developer.apple.com/documentation/healthkit/hkerror/errordatabaseinaccessible)


## 单条全自动直传与增强版结束事件（全运动类型）

网页导出窗口支持两种训练同步方式，并覆盖力量训练、跑步、骑行、步行、徒步、爬楼机、爬楼梯、椭圆机、划船机、游泳、HIIT、跳绳、混合有氧、瑜伽等全部运动类型：

1. **单条全自动直传（`铁记-结束直传-<运动类型>.shortcut`，推荐）**：仅需在 iPhone `快捷指令 → 自动化` 绑定「Apple Watch 体能训练 → 结束时 · 立即运行」。触发后自动等待 5 秒同步 Apple 健康样本，按预设窗口（默认 45 分钟，可选 20–90 分钟）汇总**活动能量（kcal）**、**平均/最低/最高心率与采样数**（跑步/步行/徒步/骑行/游泳额外采集对应距离），并直接调用 `POST /api/integrations/apple-health/workouts` 写入训练记录，无需配对「开始」自动化。
2. **开始 + 结束双条配对（`铁记-开始-...` + `铁记-结束-...`）**：保留精确计时与当日计划匹配；其中结束快捷指令会在等待 5 秒后自动请求 `GET /api/integrations/apple-health/events/active` 读取本次训练耗时 `elapsedMinutes`，再按该实际耗时窗口采集能量、心率与距离，连同 `event: "end"` 一并上报。
