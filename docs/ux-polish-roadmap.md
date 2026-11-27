# Ironlog 全站用户体验打磨与缺陷修复路线图（Goal 规格文档）

> 生成日期：2026-11-27
> 目标：以「每天在健身房用 iPhone + 桌面端记录训练、饮食、体重与复盘的真实用户」标准，系统性修复 15 项已核实的真实 Bug、数据安全隐患与高频交互痛点，做到每一批改完均有自动化测试覆盖并部署上线验证。

---

## 目标完成标准（Definition of Done）

1. **全量类型与构建通过**：`npm run typecheck`、`npm run typecheck:web-react`、`npm run check:web`、`npm run build` 均退出码 `0`。
2. **全量测试通过且新增回归测试**：`npm test` 100% 通过，且每个修复项均补充对应的后端/前端自动化测试。
3. **无静默回归**：保留现有 Apple Watch `r12` 静默快捷指令与「自动化参数 · 一键复制」面板，不破坏既有账号数据与 SQLite 兼容性。
4. **线上实测验收**：按批（或全量）提交推送至 `origin/main`，通过 `/usr/local/bin/ironlog-update` 部署至 VPS（`107.174.65.164:8080`），核验 `/health`、新接口与线上 JS/CSS 资源包生效。

---

## 第 1 批（P0）：止血修 Bug、防丢数据与私服安全闭环

### 1.1 同天二次「记围度」回填已有数据，防止静默清空
- **问题定位**：
  - `packages/web/src/views/WeightView.tsx`（`:148`, `:258`）始终传 `openMeasurementModal(null)`。
  - `packages/web/src/components/weight/MeasurementModal.tsx`（`:15-56`）未按所选 `date` 回填已有围度，提交空字段时传 `null`，触发 `packages/server/src/web-extras.ts`（`:309-315`）整行覆盖清空。
- **修复方案**：
  - `WeightView` 打开「记围度」时优先传入当日已有围度记录；`MeasurementModal` 在切换 `date` 时自动查找该日已有围度并回填（已有历史记录作为 placeholder 提示）；仅在用户明确清空某栏时才置空，避免误抹除早先字段。
- **验收标准**：同日先录腰围、再点「记围度」补录臂围保存后，腰围与备注均完整保留；补充单元/集成测试验证。

### 1.2 修复日历「设休息」在已手动排期日期必报 409 的 Bug
- **问题定位**：`packages/web/src/components/calendar/DayDossier.tsx`（`:253-264`）向 `PUT /api/web/schedule/:date` 写死了 `baseVersion: 0`，导致已有手动排期（`version >= 1`）必报 `409`。
- **修复方案**：在 `DayDossier` 读取并保存该日排期的真实 `version`（或先从 `/api/web/schedule/:date` 获取 `version`），提交时传入真实 `baseVersion`，与 `PlanModals.tsx` 保持一致。
- **验收标准**：对某天手动调整排期后再在日历详情点「设休息」，返回 200 成功生效；补充回归测试。

### 1.3 修复离线冷启动踢回登录页 &「清空冲突条目」误删正常队列
- **问题定位**：
  - `packages/web/src/store/useAuthStore.ts`（`:72-97`）：网络错误（非 401）时未保留本地上次登录会话，导致 `App.tsx` 渲染 `<AuthScreen />` 锁死离线草稿。
  - `packages/web/src/components/AppShell.tsx`（`:266-278`）：点击「清空冲突条目」误调用 `clearQueue()` 清空整条队列。
- **修复方案**：
  - 登录成功后在 `localStorage` 记录非敏感的最近登录元数据（`userId`、`username`、`appleHealthConnected`）；`boot()` 仅在明确 `401` 时清空登录态，遇网络异常时若本地存在上次会话则进入「离线只读/草稿可用」模式并弹出提示条，联网后自动静默校验。
  - 在 `packages/web/src/lib/offline-queue.ts` 新增 `clearFailedMutations(storage, userId)`，只移除 `Boolean(item.failure)` 的冲突条目，保留所有正常排队项。
- **验收标准**：新增测试覆盖「离线 `boot()` 保留用户态」及「清空冲突条目保留未失败队列项」。

### 1.4 修复首页「今日已完成 · 查看详情」遇到纯手表运动误开空白编辑器
- **问题定位**：`packages/web/src/views/OverviewView.tsx`（`:236-242`）在 `day.completed > 0` 但 `stats.recent` 无今日手动训练时，直接 `openWorkoutEditor()`。
- **修复方案**：若今日无手动训练但存在 `appleAgenda`（今日手表训练），点击「查看详情」直接打开最新一条 `AppleWorkoutDetailsModal`；并在今日已完成卡片旁提供清晰的二次操作或仅在确无记录时打开空白编辑器。
- **验收标准**：仅有今日 Apple Watch 训练时点击首页训练卡片打开手表训练详情而非空白编辑器。

### 1.5 修复数据分析「同步热量与蛋白到饮食目标」无确认强制切减脂缺口
- **问题定位**：`packages/web/src/views/AnalyticsView.tsx`（`:418-461`）点击后直接用 `recompCutTargetKcal`（`TDEE - 400`）覆盖目标热量并改写 `targetWeight`。
- **修复方案**：点击后弹出目标模式确认（**减脂缺口 / 维持 / 增肌盈余** 3 选 1，清晰预览将写入的热量、蛋白与是否更新目标体重），经用户确认后再提交 `PUT /api/web/profile`。
- **验收标准**：不再存在单点即静默覆盖热量与目标体重的行为；测试验证确认流与 3 档热量计算。

### 1.6 Apple 健康记录补齐「删除 / 取消进行中会话 / 编辑体感与备注」+ 锁死 VPS 私服安全
- **后端与前端**：
  - 新增 `DELETE /api/integrations/apple-health/workouts/:id`（校验 `user_id` 归属后删除误传记录）并在 `AppleWorkoutDetailsModal` 底部提供二次确认「删除此条记录」。
  - 新增 `DELETE /api/integrations/apple-health/active-session`（关闭当前用户所有未结束的 `apple_health_events`），在首页红色进行中横幅和设置页同步状态卡片加「取消」按钮。
  - 在 `AppleWorkoutDetailsModal` 内增加轻量内联编辑区，调用既有 `PUT /api/integrations/apple-health/workouts/:id/annotation` 补写/修改体感（`feeling`）、备注（`notes`）与手记距离（`distanceKm`）。
- **VPS 安全配置**：
  - 将 VPS `/opt/ironlog/.env` 显式设为 `ALLOW_REGISTRATION=false` 与 `TRUST_PROXY=false`（确认直连公网端口模式下不信任伪造 `X-Forwarded-For` 且禁止陌生人注册）。
- **验收标准**：后端新增删除、取消会话与标注编辑测试；线上核验 `/auth/web/register` 返回 `403`。

---

## 第 2 批（P1）：健身房训中核心体验大升级

### 2.1 真正实现「超级组」训中自动轮换与延迟休息
- **问题定位**：`packages/web/src/components/workout/WorkoutEditorModal.tsx`（`:891-956`）的 `toggleSetComplete` 完全忽略 `supersetGroup`。
- **修复方案**：
  - 勾选某动作第 `k` 组完成时，若该动作属于 `supersetGroup`：
    - 查找同组下一个仍有未完成组的搭档动作：若存在，**不立即启动组间休息**，在 `autoAdvanceExercise` 开启时自动切换（`setActiveExIdx`）到搭档动作并轻提示「超级组：已切换至〈搭档动作〉」。
    - 当本轮超级组最后一个搭档完成该轮组后，再启动完整的组间休息倒计时，并在休息结束或进入下一轮时切回本组首个未完成搭档。
- **验收标准**：新增超级组轮换纯函数单元测试 + 前端集成校验，验证单动作模式下 A1 → B1 → 休息 → A2 → B2 流畅闭环。

### 2.2 训中防误删保护 + 优化 iPhone 组行触控间距
- **问题定位**：`WorkoutEditorModal.tsx`（`:1634-1643`, `:2266-2272`, `:2476-2501`）、`WorkoutView.tsx`（`:204-216`）、`ironlog.css` 移动端列宽过窄，删除 `×` 紧贴勾选框。
- **修复方案**：
  - 「放弃未保存草稿」「丢弃本地草稿」「移除动作（含已完成组时）」均接入 `openConfirm` 二次确认。
  - 删除单组：对**已完成组**改为「删除后弹出 5 秒可点击的撤销提示（Undo）」或将其收纳到更安全的位置/加大与勾选框间距；优化 `<= 630px` 开启 RIR 时的组行布局，保证勾选按钮触控区 `>= 36px` 且与删除按钮明显分离。
- **验收标准**：所有高危破坏性操作均有确认或撤销路径；移动端组行无拥挤误触。

### 2.3 训练时长可编辑（修复历史补录与忘点结束）+ 漏勾组数提醒
- **问题定位**：`WorkoutEditorModal.tsx`（`:283`, `:1651-1689`, `:1828-1894`）无法手动调整时长；完练页仅在 `doneSets === 0` 时提示一键勾选。
- **修复方案**：
  - 在「结束训练确认页」与「历史编辑模式」均提供**可编辑训练时长（分钟）**输入框（历史补录场景默认给合理估算值或留空提示，避免记成 2 分钟），保存时同步校准 `timing.elapsedSeconds` 与 `startedAt / endedAt`。
  - 完练确认页当 `0 < doneSets < totalSets` 时，显示提示「还有 N 组未勾选」并提供「仅保存已完成组」与「一键勾选剩余组并结束」两个清晰选项。
- **验收标准**：补录历史训练或修改忘记结束的旧训练时长后，首页均次时长与复盘时长准确更新。

### 2.4 一键切换计划备选动作 + 智能替换动作 + 动作选择器连续多选
- **问题定位**：
  - `PlanModals.tsx`（`:1254-1274`）启动训练时丢失 `backupExerciseId`。
  - `WorkoutEditorModal.tsx`（`:820-839`）替换动作照搬旧重量/旧模式，不预填新动作历史参考。
  - `ExercisePickerModal.tsx`（`:99-105`, `:195-211`, `:254-256`）单选即关闭、硬截断 24 条、搜索无结果时无法直接新建自定义动作。
- **修复方案**：
  - 启动训练时保留 `backupExerciseId`（与备选快照名称），若某动作有备选，在动作卡片菜单提供「一键切换备选：〈备选名〉」。
  - 替换动作时根据新动作 `mode`（`weighted / bodyweight / assisted / timed`）自动重置不兼容字段并拉取新动作历史参考重量/次数进行预填。
  - `ExercisePickerModal` 新增「多选添加」模式（勾选多个动作底部一键「加入训练 (N)」）、支持「加载更多」突破 24 条截断，并在空搜索结果时提供「新建自定义动作」直达按钮。
- **验收标准**：自由训练一次弹窗可连加 4～5 个动作；器械被占可一键切备选并带出正确历史重量。

### 2.5 让收起的 `LiveWorkoutBar` 真正吸顶/吸底悬浮 + 增加跳过/暂停休息
- **问题定位**：`LiveWorkoutBar` 位于静态流内滚动即消失，且休息倒计时仅有 `+步进秒` 按钮。
- **修复方案**：
  - 将 `LiveWorkoutBar` 改为 `position: sticky`（桌面顶栏下方 / 移动端底部导航栏上方安全区），滚动任何页面均持续可见。
  - 在休息进行中时补齐「暂停/继续」与「跳过休息」快捷按钮，与编辑器内操作保持一致。
- **验收标准**：滚动长页面时悬浮计时条始终可见且不遮挡底部导航；跳过/暂停休息实时生效。

---

## 第 3 批（P2）：饮食、体重、计划与移动端细节全面打磨

### 3.1 饮食「保存并继续」连录 + 常用单品防误删 + 纯热量单品可存常用
- **问题定位**：`DietEditorModal.tsx`（`:225`, `:422-434`, `:655-702`）与 `OnboardingModal.tsx` 宣传不一致；纯热量（三大营养素为 0）无法存为常用单品；常用单品芯片 `×` 无确认。
- **修复方案**：
  - 新增「保存并继续」按钮，保存当前食物后保留当前日期与餐次并重置食物表单，连续录入整顿饭无需反复开关弹窗。
  - 只要 `calories > 0`（不限于 `P*4 + C*4 + F*9 > 0`）即允许勾选「存为常用单品」；删除常用单品增加轻确认或撤销提示；修复常用单品变更后派发 `PROFILE_VERSION_EVENT` 避免设置页保存报 409。
  - `WeightEditorModal` 补齐「前天」快捷日期按钮，与新手引导文案完全对齐。

### 3.2 饮水支持减量与跨端同步 +「全天已记录」支持取消
- **问题定位**：`DietView.tsx`（`:29-40`, `:454-484`）、`app.ts`（`:540-561`）、`web-analytics.ts`（`:702`）。
- **修复方案**：
  - 饮水区补上 `-250ml` 按钮与自定义输入，修复历史日期吐司仍写「今日饮水」的文案 Bug。
  - 将每日饮水目标纳入账号 `profile` 持久化并供 `web-analytics.ts` 读取，手机/电脑与数据分析口径统一。
  - 新增 `DELETE /api/web/nutrition-day?date=...` 并在 `DietView` 支持点击取消「全天已记录」标记。

### 3.3 计划草稿可编辑/删除 + 体重趋势多周期切换 + 智能秤两位小数保留
- **问题定位**：`PlanModals.tsx`（`:1087-1094`）、`WeightView.tsx`（`:82-108`）、`WeightEditorModal.tsx`（`:65-71`）。
- **修复方案**：
  - `PlanDraftModal` 增加「编辑草稿」（打开 `PlanBuilderModal` 载入草稿）与「删除草稿」（二次确认）。
  - `WeightView` 趋势图新增 `30天 / 90天 / 180天 / 全部` 周期切换；体重步进保留最多 2 位小数（兼容 0.05 kg 精度体脂秤）。

### 3.4 放宽密码规则兼容 iCloud 强密码 + 移动端导航/指令面板/分享与图表细节修复
- **密码体验**：
  - 放宽 `packages/server/src/web-auth.ts`、`AuthScreen.tsx`、`SettingsView.tsx` 密码规则为允许常见 ASCII 可打印字符（含 `-`、`!`、`@`、`#` 等，长度 `10-128`），完美兼容 iPhone iCloud Keychain 自动生成的强密码，并在登录/改密输入框加上「显示/隐藏密码」眼睛按钮。
- **导航与指令面板**：
  - 修复移动端在子页签（计划/动作库/体重）点击底部当前大类 Tab 时回到该大类根视图（训练记录/饮食记录）。
  - 修复 `CommandPaletteModal.tsx` 空搜索时截断 `数据分析 / 成就徽章 / 设置` 的 `slice(0, 18)` 问题，按 `aiReady` 隐藏未配置 AI 的指令，并让动作搜索覆盖自定义动作。
  - 修复 `ExercisesView.tsx`「我的可用器械」客户端过滤产生假空状态与肌群筛选胶囊无法二次点击取消的问题。
- **分享卡片与图表触控**：
  - `share-card.ts` 分享历史日期时标题自动显示该日期（而非写死「今日记录」），并给不支持原生分享的 iOS 浏览器补上「长按图片保存到相册」提示。
  - 优化 `AnalyticsView.tsx` 趋势图移动端触摸判定（扩大横向最近点吸附命中区）与 `SleepReportPanel` 在长周期下的摘要翻页体验；为客户端分析 CSV 导出补上公式注入转义。

---

## 执行建议（配合 `/goal`）

建议按 **第 1 批 → 第 2 批 → 第 3 批** 顺序逐批推进，每批完成后自动运行：
```powershell
npm run typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm run typecheck:web-react; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm run check:web; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm test
```
全绿后提交、推送、部署 VPS 并进行公网验收，再进入下一批。
