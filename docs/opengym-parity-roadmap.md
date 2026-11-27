# Ironlog 借鉴 openGym 精华能力与力量体验跃升路线图（Goal 规格文档）

> 生成日期：2026-11-27
> 对标来源：openGym v1.4.4 实机全页走查 + Ironlog 现有代码库对照分析
> 目标：在不削弱 Ironlog 既有优势（饮食营养、睡眠报告、HRV/ACWR 恢复分析、Apple Watch 静默同步、桌面端多栏效率、勋章与分享海报）的前提下，系统性补齐 12 项来自 openGym 的高价值力量训练微交互、可视化、排期进阶与生态能力，分 3 批实施、每批补齐自动化测试并部署至 VPS 线上验收。

---

## 目标完成标准（Definition of Done）

1. **全量类型与构建通过**：`npm run typecheck`、`npm run typecheck:web-react`、`npm run check:web`、`npm run build` 均退出码 `0`。
2. **全量测试通过且新增回归测试**：`npm test` 100% 通过，且每个需求项均补充对应的纯函数/后端接口/前端逻辑自动化测试。
3. **严格向后兼容与数据安全**：
   - 所有新增 Zod 字段均为可选或带 `.default(...)`，已有用户 SQLite 记录、本地离线草稿与同步队列 100% 兼容。
   - 保留现有 Apple Watch `r12` 静默快捷指令闭环、VPS 私服 `ALLOW_REGISTRATION=false` 与 `TRUST_PROXY=false` 安全配置。
4. **分批提交与线上实测验收**：每完成一批立即提交推送至 `origin/main`，通过 `/usr/local/bin/ironlog-update` 部署至 VPS（`107.174.65.164:8080`），核验 `/health`、新接口与线上静态资源生效。

---

## 第 1 批（P0）：人体肌群可视化 + 健身房现场高频手感跃升

### 1.1 正背面 SVG 人体肌群图组件（`MuscleBodyMap`）一建四用
- **建设目标**：补齐 Ironlog 缺失的直观人体肌群可视化，一次实现、四处复用。
- **实施方案**：
  - 新建 `packages/web/src/components/MuscleBodyMap.tsx`，提供清晰、高辨识度的正/背面 SVG 人体轮廓与分区（映射 Ironlog 既有肌群体系 `chest` / `back` / `shoulders` / `arms` / `core` / `legs`，附带 `cardio` 全身脉冲徽标），支持：
    - 强度/组数热力着色（主肌群实色、辅助肌群半透明、按比例分级）；
    - 紧凑尺寸（卡片迷你剪影 `mini`）与交互模式（点击部位触发 `onSelectMuscle`）；
    - 浅色/深色主题自适配。
  - **四处复用落地**：
    1. **首页今日训练卡片 & 计划模板卡片**（`OverviewView.tsx`、`PlanView.tsx`）：展示该训练日覆盖肌群的迷你正背面剪影；
    2. **训练中实时「本次练到哪里」弹层**（`WorkoutEditorModal.tsx`）：顶部进度区新增肌群图按钮，点击查看本场各肌群「已完成组 / 计划组」进度与实时亮灯人体图；
    3. **动作库人体点选筛选**（`ExercisesView.tsx`）：提供可折叠正背面人体点击筛选条，点胸部/背部/腿部直接联动筛选动作；
    4. **肌群活跃度 / 力量保持度热力图**（`AnalyticsView.tsx` 肌群力量页签）：结合近 14 天训练记录，按距上次有效刺激天数计算各肌群保持度（`100%` 近期充分刺激 → 随天数衰减至 `50%` 提示补练），用正背面人体热力图展示。
- **验收标准**：四处视图均正确渲染且无 SVG 溢出/移动端挤压；新增纯函数单元测试覆盖「肌群组数统计」与「肌群保持度衰减计算」。

### 1.2 单动作独立 `kg / lb` 单位覆盖 + 单组备注
- **建设目标**：解决商用健身房常见“固定器械标磅（lb）、自由杠铃标公斤（kg）”及单组特殊情况（如“左肩微紧 / 暂停推”）记录痛点。
- **实施方案**：
  - 扩展 `packages/shared/src/index.ts`：
    - `plannedExerciseSchema` 与 `sessionExerciseSchema` 新增可选字段 `weightUnit: z.enum(["kg", "lb"]).optional()`（默认 `"kg"`）；
    - `setSchema` 新增可选字段 `note: z.string().max(200).optional()`。
  - 在 `packages/shared/src/logic.ts` 新增统一换算工具（`LB_TO_KG = 0.45359237`，`toKg(weight, unit)` / `fromKg(kg, unit)`），确保 `weightUnit === "lb"` 时：
    - 组行输入框按 `lb` 显示与加减步进（默认 `5 lb` 或用户自定义）；
    - 后端与共享层计算吨位、1RM、PR 与分析图表时自动折算为统一 `kg` 口径，避免 kg/lb 混算污染统计；
    - 切换动作单位时询问或提供「仅改显示单位 / 按换算值转换当前重量」清晰处理。
  - 在 `WorkoutEditorModal.tsx` 动作菜单增加 `单位：kg / lb` 切换，单组菜单增加「组备注」轻量内联输入，历史训练详情同步展示组备注与原始单位徽标。
- **验收标准**：新增 `kg/lb` 折算、1RM/吨位统一口径与组备注读写回归测试。

### 1.3 训练中一键「问 AI 教练」现场情景入口 + 临时合并另一个训练日
- **建设目标**：让 AI 教练真正服务于健身房举铁当下（器械被占、部位微痛、赶时间），并支持中途叠加其他训练日。
- **实施方案**：
  - 在 `WorkoutEditorModal.tsx` 每个动作的更多菜单加入「问 AI 教练」快捷动作，打开轻量情景抽屉，内置 4 个一键场景按钮：
    - **部位发紧 / 微痛**（求低关节压力替代与降重建议）
    - **器械被占**（求同肌群等价替代动作）
    - **时间不够**（求浓缩组数或超级组压缩方案）
    - **状态极佳**（求安全加量/加组建议）
  - 点击后自动拼装当前动作名称、计划组次、历史最佳与本场已完成情况，复用既有 AI 调整接口（`POST /api/web/ai/adjust` 或降级本地规则建议，无 AI Key 时同样给出可用的备选动作/减量建议，不白屏报错）。
  - 在 `WorkoutEditorModal.tsx` 顶栏菜单新增「合并其他训练日」：从当前激活计划与自定义模板中选择某训练日，将其动作追加到当前训练末尾（自动去重 ID 与预填历史参考）。
- **验收标准**：有/无 AI Key 场景下情景入口均有明确可用反馈；合并训练日不破坏既有已完成组，新增前端/共享逻辑单元测试。

### 1.4 首页周条单日「跳过 / 改休息 / 临时换模板」快操 + 轮换排期体验打通
- **建设目标**：把 Ironlog 底层已有的 `scheduledDay` 与 `plan.schedule === "rotation"` 能力做成首页触手可及的顺手交互。
- **实施方案**：
  - 在 `OverviewView.tsx` 顶部今日卡片上方增加「本周 7 天状态条」（周一～周日，区分已完成绿点 / 计划日灰点 / 休息虚线 / 今日高亮）。
  - 点击任意一天弹出「单日排期快操」底栏：
    - 一键 **设为休息 / 跳过这天**；
    - 一键 **临时换成其他训练日**（列出当前计划所有训练日与自定义模板）；
    - 若当天已有手动覆盖，支持 **恢复计划默认**。
    - 严格复用 `/api/web/schedule/:date` 并传递真实 `baseVersion`（绝不出现 409）。
  - 针对 `rotation`（轮换制）计划：在首页与 `PlanView.tsx` 明确展示「轮换队列进度（下一次顺延：〈训练日〉）」，并在计划新建/编辑弹窗优化「固定周 vs 轮换制」双模式切换说明与预览。
- **验收标准**：周条切换休息/换模板/恢复默认实时刷新首页与日历；轮换计划顺序计算新增单元测试。

---

## 第 2 批（P1）：训练布局、三重进阶与语音播报、多场馆器械配置

### 2.1 训练界面 3 种布局切换（`标准卡片 / 紧凑列表 / 专注单动作`）+ 已完成自动折叠
- **实施方案**：
  - 扩展 `workoutPrefsSchema`（`packages/shared/src/index.ts`）与 `packages/web/src/lib/workout-helpers.ts`：
    - `workoutLayout: z.enum(["card", "compact", "focus"]).default("card")`
    - `collapseCompletedExercises: z.boolean().default(false)`
  - 在 `WorkoutEditorModal.tsx` 顶栏训练选项与 `SettingsView.tsx` 提供实时切换：
    - **`card`（标准卡片）**：完整展示目标、上次记录、配片、组备注与动作操作；
    - **`compact`（紧凑列表）**：收紧行高与辅助信息，一屏多显组行，适合高密度快速录组；
    - **`focus`（专注模式）**：单屏聚焦当前动作与当前待做组，放大重量/次数步进与完成按钮，配合底部「上一个 / 下一个动作」切换条，手机单手零误触；
    - 开启 `collapseCompletedExercises` 后，某动作所有组勾选完成时自动折叠为一行摘要（可随时点开修改）。
- **验收标准**：3 种布局均支持完整录组、切换无缝不丢草稿；新增偏好读写与折叠状态单元测试。

### 2.2 三重进阶（Triple Progression）+ 训中内联进阶状态条 + 减载日标记
- **实施方案**：
  - 扩展 `packages/shared/src/index.ts`：
    - `plannedExerciseSchema.progression` 扩展为 `z.enum(["double", "triple", "linear", "greyskull", "manual"]).default("double")`；
    - 新增可选字段 `setsMax: z.number().int().min(1).max(20).optional()`（三重进阶目标组数上限）与 `deloadMissThreshold: z.number().int().min(2).max(5).optional()`（默认 `3`）；
    - `routineSchema` 新增可选字段 `isDeload: z.boolean().optional()`（减载训练日标记）。
  - 升级 `packages/shared/src/planning.ts`：
    - 实现 **三重进阶算法**：先涨次数直到所有工作组达 `repsMax` → 组数未达 `setsMax` 时维持重量与最低次数并 `+1 组` → 组数与次数双双封顶时 `+increment` 重量并重置回基础组数与 `repsMin`；
    - 统计最近连续未达标次数 `consecutiveMisses`，返回结构化状态文案（如 `线性进阶 · 上次次数未达标，维持 60kg（连续 2/3 次，再未达标建议减载）`）。
  - 在 `WorkoutEditorModal.tsx` 每个动作卡片顶部内联展示该进阶状态条，在 `PlanModals.tsx` 开放「三重进阶 / 组数上限 / 减载日」配置。
- **验收标准**：`planning.ts` 补齐三重进阶完整周期（涨次数→涨组数→涨重量重置）与连续未达标计数单元测试。

### 2.3 组间休息语音播报（Web Speech API）+ 等长静态动作倒计时
- **实施方案**：
  - 扩展 `workoutPrefsSchema` 新增 `voiceRestCues: z.boolean().default(false)`（默认关闭，用户可随时在设置页或训中开启，并提供试听按钮）。
  - 在 `packages/web/src/lib/haptics-audio.ts` 封装安全语音播报器 `speakCue(text)`（自动选择 `zh-CN` 语音，自动取消排队防重叠，在不支持 `window.speechSynthesis` 的浏览器/WebView 下静默跳过、继续走原有 Web Audio 提示音）。
  - 接入时机：
    - 组间休息剩余 `10` 秒播报「还剩 10 秒」；
    - 休息结束播报下一组目标（如「休息结束，下一组平板杠铃卧推，60 公斤 8 次」）；
    - 对 `mode === "timed"` 的等长动作（如平板支撑）在组行提供内联秒表倒计时，最后 `3、2、1、完成` 音效/语音读秒。
- **验收标准**：新增语音播报降级与触发时机单元测试；不影响现有静音与震动开关逻辑。

### 2.4 多场馆器械配置（Equipment Profiles）+ 杠铃片对数精确管理
- **实施方案**：
  - 在 `packages/shared/src/index.ts` 新增 `equipmentProfileSchema`（`id`, `name`, `equipment[]`, `barWeight`, `platePairs: Record<string, number>` 或 `enabledPlates[]` + `plateCounts`, `dumbbellMinKg`, `dumbbellMaxKg`, `dumbbellStepKg`），挂载到 `profileSchema`：`equipmentProfiles`（上限 6 套）与 `activeEquipmentProfileId`。
  - 在 `packages/web/src/lib/workout-helpers.ts` 升级 `plateBreakdown`，支持按当前场馆真实杠铃片对数限制配片（不会给出“健身房没有的 4 对 20kg 片”方案）。
  - 在 `SettingsView.tsx` 与 `WorkoutEditorModal.tsx` 顶部快捷条支持一键切换场馆配置（内置默认预置「商业健身房」「居家训练」），并在 `ExercisesView.tsx` 支持「仅看当前场馆可用器械」一键过滤。
- **验收标准**：切换场馆后配片方案、动作筛选与偏好实时联动；新增有限片数配片算法单元测试。

---

## 第 3 批（P2）：专业力量基准、进度照片、连胜冻结、生态导出与便捷认证

### 3.1 结构平衡分析（Poliquin / 力量举基准）+ 动作力量等级（Strength Standards）
- **实施方案**：
  - 新建 `packages/shared/src/strength-standards.ts` 纯函数模块：
    - **结构平衡分析**：基于用户主要复合动作估算 1RM（深蹲、硬拉、卧推、上斜卧推、推举、划船、引体/下拉），对照 **Poliquin 结构平衡比例** 与 **力量举三大项比例**，输出各动作实际比值、目标区间、偏弱/达标/偏强状态及可执行的补强建议；
    - **动作相对体重力量等级**：按用户最新体重与性别（缺省取通用基准）对核心动作评定 `入门 / 初级 / 进阶 / 熟练 / 精英` 档位及距离下一档位还差多少 kg。
  - 在 `AnalyticsView.tsx`「肌群力量」页签新增「结构平衡与力量等级」卡片，并在 `ExerciseModals.tsx` 动作详情页展示当前动作的力量等级徽标。
- **验收标准**：`strength-standards.ts` 覆盖边界值（缺体重/缺部分动作/男女基准）单元测试；前端优雅处理数据不足空状态。

### 3.2 进度照片（Progress Photos）+ 连胜冻结保护（Streak Freeze）+ 年度回顾
- **实施方案**：
  - **进度照片**：
    - `packages/server/src/db.ts` 新增 `progress_photos` 表（`id`, `user_id`, `date`, `pose` 正/侧/背/自由, `mime`, `image_data` 经前端 canvas 压缩至长边 `<= 1280px`、体积 `<= 600KB` 后入库或数据目录持久化, `note`, `created_at`）。
    - 新增 API：`GET/POST/DELETE /api/web/progress-photos` 与图片读取端点（严格校验 `user_id` 归属，防止越权访问）。
    - 在 `WeightView.tsx` 新增「体态照片」分区，支持上传、按姿势筛选、任选两天左右并排对比（Before / After）与删除二次确认。
  - **连胜冻结保护（Streak Freeze）**：
    - 在 `profileSchema` 新增 `streakFreezeWeeks: z.array(z.string()).max(52).optional()`（ISO 周标识 `YYYY-Www`），每月赠送 1 次冻结额度（或允许用户标注生病/出差周），在 `stats.ts` / `web-statistics.ts` 计算周连胜时将冻结周视为不断链，并在首页连胜卡片展示雪花冻结徽标与「使用冻结保护」入口。
  - **年度训练回顾（Year in Review）**：
    - 在 `AnalyticsView.tsx`「周期报表」页签新增「年度回顾」卡片弹窗（全年训练天数、总时长、总吨位、最常练动作 TOP 3、最佳 PR 突破、最长周连胜、饮食/睡眠达成亮点），支持复用现有海报引擎一键导出分享图。
- **验收标准**：进度照片鉴权/大小校验/CRUD 后端测试 + 连胜冻结跨周不断链单元测试。

### 3.3 训练结束 Webhook 推送 + 单次训练 `.fit` 导出 + 模块化功能精简开关
- **实施方案**：
  - **训练结束 Webhook**：
    - `profileSchema` 新增 `webhookConfig`（`enabled`, `url`, `secret`, `allowPrivateNetwork`），服务端新增 `POST /api/web/webhook/test` 测试推送，并在训练完成保存时异步非阻塞（5 秒超时、失败仅记录日志不阻塞保存）POST 标准 JSON 事件（`workout.completed` + `X-Ironlog-Signature` HMAC-SHA256 签名，适配 n8n / Home Assistant / ntfy）。默认禁止内网 SSRF 地址，除非用户显式勾选局域网回调（自托管友好）。
  - **单次训练 `.fit` 文件导出**：
    - 新建 `packages/shared/src/fit-export.ts` 纯 TypeScript Garmin FIT 协议编码器（File ID + Event + Session + Lap/Set 摘要 + CRC-16 校验），在 `WorkoutReportModal.tsx` 与历史训练详情提供「导出 .fit」一键下载按钮。
  - **模块化界面精简开关**：
    - `workoutPrefsSchema` 新增 `hiddenModules: z.array(z.enum(["diet", "sleep", "badges", "ai", "plateMath", "rir"])).default([])`，设置页提供「界面模块开关」，隐藏对应导航/卡片但不删除任何数据，随时可重新打开。
- **验收标准**：`.fit` 编码器文件头（`.FIT` 魔数）与 CRC-16 校验单元测试；Webhook 签名与 SSRF 防护后端测试。

### 3.4 一次性设备配对登录码 + Passkey（WebAuthn）通行密钥基础闭环
- **实施方案**：
  - **一次性 6 位设备配对码（HTTP/HTTPS 全环境 100% 可用）**：
    - `packages/server/src/db.ts` 新增 `web_pairing_codes` 表（`code_hash`, `user_id`, `expires_at`, `used_at`, `created_at`）。
    - 已登录设备在 `SettingsView.tsx` 点击「生成新设备配对码」→ 调用 `POST /api/web/auth/pairing-code` 获得 5 分钟有效的一次性 6 位数字码；新手机/电脑在 `AuthScreen.tsx` 切换「设备配对码登录」输入即签发标准会话 Cookie（用后即焚 + 严格限流防爆破）。
  - **Passkey（WebAuthn）通行密钥**：
    - `packages/server/src/db.ts` 新增 `web_passkeys` 表（`credential_id`, `user_id`, `public_key`, `counter`, `transports`, `label`, `created_at`, `last_used_at`）与短期 challenge 缓存。
    - 实现标准 WebAuthn 注册与登录端点（`/auth/web/passkey/register/options|verify`、`/auth/web/passkey/login/options|verify`，使用标准加密验签或轻量零隐患实现）。
    - 前端在 `window.isSecureContext && typeof PublicKeyCredential !== "undefined"` 时于设置页展示「绑定通行密钥（Face ID / Touch ID）」、登录页展示「用通行密钥登录」；在纯 HTTP IP 访问时清晰提示「通行密钥需 HTTPS 域名，当前可使用一次性配对码或密码登录」，体验零困惑。
- **验收标准**：配对码生成/兑换/过期/单次作废/限流后端测试 + Passkey challenge 生命周期与安全上下文降级测试。

---

## 执行与验证清单（每批执行模板）

每完成一批，必须按顺序完成全部验证后再进入下一批：

```powershell
npm run typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run typecheck:web-react; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run check:web; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm test; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

验证全部通过后：
1. `git add` & `git commit` 提交本批改动并推送 `origin/main`；
2. 通过 SSH 调用 `/usr/local/bin/ironlog-update` 部署到 VPS（`107.174.65.164:8080`）；
3. 核验 `http://107.174.65.164:8080/health`、`http://107.174.65.164:8080/app/` 及本批新增接口在线上正常响应。
