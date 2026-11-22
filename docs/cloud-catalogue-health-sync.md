# 铁记云端动作库与 Apple 健康同步

铁记后端继续使用 Hono、SQLite 和现有账号同步服务。后端保存动作教学与体能记录，网页按需读取。Apple 健康记录以独立的体能记录和计划打卡进入铁记。训练动作、组次、重量与 RIR 继续来自实际录入的数据。

## 1. 云端动作库

### 表结构

| 表 | 主键与主要字段 | 约束和索引 |
| --- | --- | --- |
| `catalogue_releases` | `version`，`upstream_revision`，`published_at`，`source_url`，`item_count` | 版本发布与目录写入在同一事务完成 |
| `catalogue_exercises` | `exercise_id`，`name_zh`，`name_en`，`category`，`equipment`，`primary_muscle`，`mode`，`volume_multiplier`，`description`，`instructions_json`，`content_revision`，`sort_key`，`updated_at`，`retired_at` | 复用 `exdb_2612`、`bench-press` 等原 ID。为 `(category, sort_key, exercise_id)`、`(equipment, sort_key, exercise_id)` 和 `(primary_muscle, sort_key, exercise_id)` 建索引 |
| `catalogue_exercise_muscles` | `(exercise_id, muscle)`，`role` | `role` 为 `primary` 或 `secondary`，索引 `(muscle, exercise_id)` |
| `catalogue_exercise_aliases` | `(exercise_id, locale, normalized_alias)`，`alias` | 支持旧名称、中文简称和英文变式。索引 `(locale, normalized_alias)` |
| `catalogue_exercise_media` | `media_id`，`exercise_id`，`kind`，`object_key`，`mime_type`，`byte_size`，`sha256`，`width`，`height`，`duration_ms`，`sort_order`，`license`，`attribution`，`source_url` | 类型为 `thumbnail`、`image`、`video`，索引 `(exercise_id, kind, sort_order)`。对象存储或服务器静态目录保存文件 |

直接从 openGym 规范源码目录（`catalogue/exercises/` 与 `catalogue/i18n/zh.json`）导入现有 5,650 条动作，同步动作简介 `description`、肌肉权重修正与步骤教学，保留 ID、模式、重量系数和来源。默认列表忽略已撤回条目，已保存的训练通过动作快照或 ID 查询历史条目。账号自定义动作与收藏继续留在现有账号隔离的 `records` 表。文字目录保留 openGym 数据许可与对应源码索引。现有双姿势图可随署名迁到云端。Gym visual 图片和动画接入前需要铁记自己的素材授权。[openGym 动作媒体授权](https://github.com/DuarteSantos8/openGym/blob/main/catalogue/media/NOTICE.md)

### API

| 方法和路径 | 请求 | 响应 |
| --- | --- | --- |
| `GET /api/catalogue/version` | 可带 `If-None-Match` | `version`、`publishedAt`、`total`。未变化返回 `304` |
| `GET /api/catalogue/exercises` | `q`、`category`、`equipment`、`muscle`、`cursor`、`limit`。默认 30 条，最多 100 条 | `version`、`items`、`nextCursor`。列表项只有 ID、名称、标签和缩略图信息 |
| `GET /api/catalogue/exercises/:id` | 支持 `If-None-Match` | 动作资料、图文步骤、器械、计量、主要与协同肌群和媒体元数据 |
| `POST /api/catalogue/exercises/lookup` | `{ "ids": [...] }`，最多 100 个 ID | 批量返回简要资料，让历史记录、计划和收藏补全名称与缩略图 |
| `GET /media/exercises/:objectKey` | 图片直接请求，视频可发 `Range` 请求 | 使用带内容哈希的资源路径，便于 HTTP 长缓存和按需播放 |

只读内置目录可以在登录前查询，账号收藏和自定义动作仍经过账号鉴权。新目录发布前校验 ID、影像引用及中文搜索样例。游标绑定目录版本、筛选签名和最后一条排序键。目录在翻页中更新时返回 `409 CATALOGUE_CHANGED`，客户端用新版本重取第一页。搜索先比较中文或英文的标准化名称和别名，精确命中优先，其后为前缀和包含查询。5,650 条数据可以先用索引筛选分类，再检索名称，短中文词也参与匹配。

### 网页按需加载

网页每次加载 24 条简要记录，用户可按肌群和器械筛选。浏览器按可视范围加载缩略图，打开动作详情时再读取教学和姿势图。分页游标失效后从第一页重新读取。网页和 API 同源，手机访问可通过 HTTPS 反向代理连接铁记服务。

## 2. iPhone 快捷指令与健康上传

配对 Apple Watch 后，在 iPhone 的「快捷指令 → 自动化」新建「Apple Watch 体能训练」，选择运动类型和「结束」，设置立即运行。首次手动执行子快捷指令，授予需要的健康读取和网络访问权限。Apple 支持训练开始或结束触发、筛选运动类型，以及无需每次确认的触发方式。[Apple 体能训练触发器](https://support.apple.com/en-ph/guide/shortcuts/apd932ff833f/ios) · [自动运行设置](https://support.apple.com/guide/shortcuts/add-automations-apdfbdbd7123/ios)

| 字段 | 快捷指令获取方式 | 服务端口径 |
| --- | --- | --- |
| `activityType` | 真机若能读取完整训练对象，取其运动类型。只有触发器时，为各类型分别建立自动化并传入固定类型值 | 按稳定代码映射。中文显示名可选，用于核对 |
| `startedAt`、`endedAt` | 优先使用完整训练对象的时间。原生动作仅提供样本时，按类型配对「开始」和「结束」自动化，保存本次触发时间和 `clientSessionId` | ISO 8601 带偏移。快捷指令触发时间标为估算 |
| `durationSeconds` | 优先使用训练对象的时长。只有起止触发时间时计算两者差值 | `durationKind` 区分 `workout_active`、`event_elapsed`。时长缺失时保留空值 |
| `activeEnergyKcal` | 优先使用训练关联的活动能量。也可按已知训练窗查询「活动能量」样本，限制为同一手表来源、去重后合计 | 单位为 kcal。时间窗口加总标为 `window_estimate`。能量为空显示未采集 |
| `heartRate.avgBpm/minBpm/maxBpm/sampleCount` | 优先取训练心率统计。只有样本时，查找训练时间窗内的心率样本，按同一来源去重后求样本均值、最小和最大值 | 以 BPM 存储。区分训练统计与窗口样本统计。没有样本保留空值 |
| `environment`、`distanceMeters`、`externalWorkoutId` | 训练对象或明确的单类型快捷指令提供时传入。户外跑和室内跑可分设触发器 | 可选。室内外未知记为 `unknown`。距离用米。UUID 可用时保留 |

Apple 的 HealthKit 对完整训练提供类型、起止时间、时长和关联统计接口。快捷指令的具体健康动作能否读取完整训练对象、时长和对应心率统计，应在目标 iPhone 的 iOS 版本上验收。原生动作只读到心率或能量样本时，可使用「按类型开始与结束」方案，或使用具备 HealthKit 读取权限并提供快捷指令动作的 iOS 小工具。训练记录和触发时刻的精度分别标注。[HealthKit 训练对象](https://developer.apple.com/documentation/healthkit/hkworkout?changes=_1) · [室内运动元数据](https://developer.apple.com/documentation/healthkit/hkmetadatakeyindoorworkout)

结束触发后给手表写入与同步留出时间，做少量有界重试，并按类型、时间范围和来源核对结果。设备锁定或权限受限会影响受保护的健康数据读取，保留最后一次成功同步时间，并提供解锁后手动补传或每日补传最近记录。重复上传使用同一记录身份。查不到本次记录时结束本次读取，保留已有记录。[HealthKit 锁屏读取限制](https://developer.apple.com/documentation/healthkit/hkerror/errordatabaseinaccessible)

### 上传接口

`POST /api/integrations/apple-health/workouts`

- 请求头 `Authorization: Bearer <专用上传令牌>`、`Content-Type: application/json`、`Idempotency-Key: <本次上传的稳定键>`。
- 快捷指令用「获取 URL 内容」，方法选 POST，请求体选 JSON。地址填写铁记的公网 HTTPS API 域名。[快捷指令 POST 与 JSON](https://support.apple.com/en-lamr/guide/shortcuts/apd58d46713f/ios)
- 同一请求返回相同结果。首次入库返回 `201`，重复请求返回 `200`，同一幂等键提交不同内容返回 `409`。晚到的统计补充用新的幂等键，保留原训练身份。

```json
{
  "schemaVersion": 1,
  "captureMethod": "workout",
  "externalWorkoutId": "9b572552-8879-4fa4-acd8-750a0a06102a",
  "clientSessionId": null,
  "activityType": "traditionalStrengthTraining",
  "environment": "indoor",
  "startedAt": "2026-11-18T18:02:10+08:00",
  "endedAt": "2026-11-18T18:48:44+08:00",
  "timeZone": "Asia/Hong_Kong",
  "durationSeconds": 2657,
  "durationKind": "workout_active",
  "activeEnergyKcal": 281.6,
  "energyKind": "workout",
  "heartRate": {
    "avgBpm": 121,
    "minBpm": 83,
    "maxBpm": 151,
    "sampleCount": null,
    "method": "workout_statistics"
  }
}
```

成功返回 `workoutId`、`ingestStatus`、`matchStatus` 和可选的 `planOccurrenceId`。服务端校验时区、起止时间、非负时长、结束时间范围、字段类型、单位和心率统计大小关系。活动时长上限为起止时间差，允许时间戳四舍五入误差。无采集数据用 `null`。批量补传可逐条 POST。

### 鉴权与去重

- 登录铁记后签发每台设备一个随机令牌，限定为 `health:workouts:write`。服务端只保存令牌哈希、所属用户、到期时间和撤销状态。由令牌确定账号，忽略请求体中的任何账号标识。上传令牌的作用域也要在通用 API 鉴权处隔离。
- 账号会话调用 `POST /api/integrations/apple-health/tokens` 签发令牌，明文只返回一次。通过 `DELETE /api/integrations/apple-health/tokens/:id` 撤销。共享的快捷指令模板只包含占位符。
- 全链路 HTTPS，在请求头携带令牌。限制单次请求大小及每台设备速率。日志只记录请求 ID、结果、耗时和所属账号的内部标识，避免记录令牌、完整请求体或心率数值。原始心率样本和运动路线默认留在手机上。用户可撤销令牌和删除已导入数据。
- 首选 `(user_id, provider, external_workout_id)` 去重。没有 Apple 训练 ID 时，使用固定的 `clientSessionId`，或对数据来源、规范化运动类型、开始和结束时间生成稳定指纹。无稳定身份的重复或相似时间窗进入核对。重试时避免随机生成新的事件 ID。上传令牌证明调用者获铁记授权，Apple 样本来源字段用于核对与去重。

## 3. 汇总与计划打卡

网页版通过 `GET /api/integrations/apple-health/agenda?from=YYYY-MM-DD&through=YYYY-MM-DD` 读取已上传活动和匹配结果。训练按开练时间归入铁记 UTC+08 日历。服务端使用开练前已经启用的计划版本、当天排程及活动类型推导计划完成状态。传统及功能性力量训练可完成抗阻计划，明确的有氧计划要求运动类型一致。休息日、交叉训练、混合计划及无法确认类型的活动按原样进入当天记录。

同日两条训练的时间至少覆盖较短训练的 80% 和较长训练的 55%，且活动类型兼容、双方均只有一个匹配候选时，健康指标关联到现有铁记记录。如铁记记录已录入明细，自动完成还需要它已属于该计划，或实际完成的动作与计划有交集。快捷指令和完整训练对象的起止各相差不超过两分钟并满足上述重叠规则时，统计采用完整训练对象，保留快捷指令能补齐的缺测字段与估算标签。匹配结果随已有记录或计划历史的修改重新计算。原始上传和手录组数、重量及训练状态均独立保存。[Apple HealthKit 运动类型](https://developer.apple.com/documentation/healthkit/hkworkoutactivitytype)

### 持久化与汇总设计

下表为物化汇总及可配置映射的方案。当前版本从原始训练和计划历史即时计算日程。

| 表 | 主要字段 |
| --- | --- |
| `health_ingest_tokens` | `token_hash`，`user_id`，`device_label`，`scope`，`expires_at`，`revoked_at` |
| `health_workouts` | `id`，`user_id`，`provider`，`external_workout_id`，`client_session_id`，`fingerprint`，`activity_type`，`environment`，`start_utc`，`end_utc`，`training_date`，`time_zone`，`duration_seconds`，`duration_kind`，`active_energy_kcal`，`energy_kind`，`avg_bpm`，`min_bpm`，`max_bpm`，`sample_count`，`hr_method`，`capture_method`，`received_at` |
| `health_ingest_receipts` | `(user_id, idempotency_key)`，`payload_hash`，`health_workout_id`，`result_json` |
| `health_daily_rollups` | `(user_id, training_date)`，`workout_count`，`total_active_seconds`，`estimated_elapsed_seconds`，`measured_active_kcal`，`estimated_active_kcal`，`min_bpm`，`max_bpm`，`heart_rate_coverage_count`，`updated_at` |
| `workout_type_mappings` | `id`，`user_id` 可空，`provider`，`activity_type`，`environment` 可空，`plan_intent`，`min_duration_seconds` 可空，`auto_checkin`，`priority`，`enabled` |
| `plan_occurrences` | `id`，`user_id`，`plan_id`，`plan_version`，`routine_id`，`training_date`，`slot_key`，`plan_intent`，`scheduled_start_utc` 可空，`snapshot_json`，`status`，`completed_at` |
| `health_plan_links` | `id`，`user_id`，`health_workout_id`，`occurrence_id` 可空，`manual_workout_id` 可空，`mapping_id`，`state`，`reason`，`updated_at` |

索引覆盖 `health_workouts(user_id, training_date, start_utc)` 和 `plan_occurrences(user_id, training_date, status)`。计划实例以账号、日期与排程槽位唯一标识。映射优先查用户自定义规则，其后查系统规则。绑定表用数据库唯一约束保证同一外部训练至多绑定一个计划实例、同一实例至多有一个生效的自动打卡。对尚未打卡的规则调整可重新尝试，已打卡实例保留实际使用的规则和计划快照。

用用户设置的 IANA 时区计算开练所在日期。跨午夜的训练整笔归入开始日，周按周一开始，月按当地自然月。按日重算受影响的数据，周报、月报在日汇总上查询。记录删除、去重合并和修正后重算对应日期。汇总接口为 `GET /api/health/summary?period=week&date=2026-11-18`，支持 `day|week|month`。

时长和活动能量按来源精度分列，活动能量与全天热量消耗分开显示。心率区间取已采集训练的最小与最大值，并显示覆盖了几次训练。期间平均心率仅在算法一致且有可比较的样本计数或采集覆盖时长时计算，否则保留每次训练自己的平均值。心率强度区间的停留时间需要有时间戳的样本和明确的区间定义，首版展示最低与最高心率。

### 默认映射

| Apple 类型 | 计划类别 | 自动绑定条件 |
| --- | --- | --- |
| `traditionalStrengthTraining`、`functionalStrengthTraining` | `resistance` 抗阻/器械 | 当天有唯一符合条件的抗阻计划实例 |
| `running` | `cardio` 有氧 | 跑步和通用有氧均可匹配。标明户外的计划需 `environment=outdoor` |
| `stairClimbing`、`stairs`、`elliptical`、`cycling` | `cardio` 有氧 | 通用有氧可匹配。限定踏步机的计划对应 `stairClimbing`，楼梯训练 `stairs` 独立保留 |
| `highIntensityIntervalTraining`、`crossTraining` | `mixed` 混合训练 | 仅自动匹配显式允许的混合计划 |
| 未知类型，或勾选「任意训练」且未读到类型 | 待确认 | 保留体能记录，等待用户选择 |

中英文名称只用于识别成稳定代码和显示。跑步的室内外由数据或明确触发器区分。系统映射可按账号覆盖。[Apple HealthKit 运动类型定义](https://developer.apple.com/documentation/healthkit/hkworkoutactivitytype?changes=_4&language=objc)

### 自动绑定算法

1. 在一个 SQLite 事务中校验并幂等写入体能记录。取训练开始时生效的计划版本，按该时点的计划历史和用户时区取得对应日期的实例。按周排程生成当天实际安排。轮转计划仅匹配已明确安排在当天的实例。
2. 根据 `activityType + environment` 解析规则。每个训练日新增可编辑的 `intent` 和可选 `allowedActivityTypes`、`minDurationSeconds`。旧计划可基于动作类型建议分类，用户确认后参与自动打卡。自动匹配时允许设置最短训练时长，默认初始建议为 10 分钟，允许用户按训练日调整。
3. 仅考虑当天未完成、允许该运动类型、满足时长门槛的计划。显式允许该类型优先于类别匹配。两个候选同优先级时，有明确时间窗且唯一命中者优先。候选仍不唯一则标记「待确认」。当天无匹配计划时只入体能统计。
4. 唯一候选且采集信息满足策略时，事务内建立绑定，把计划实例标为「已完成 · Apple 健康」，写入一条账号同步变更。只有快捷指令触发时刻的估算记录默认待确认，可由用户开启估算训练自动打卡。请求重试复用既有状态。并发上传通过实例锁或唯一约束防止重复占位。
5. 若当天已有手动训练打卡，类型一致且两条记录的交集达到合并时间窗的 80% 时，唯一命中的手动记录可补充外部能量与心率，沿用手动打卡状态。手动训练和手表描述同一次训练时，训练场次只计一次。活动能量和心率按来源去重。进行中的训练和逐组数据继续由用户录入。
6. 计划日历与训练首页通过现有账号同步协议读取打卡变更，显示「已完成」「待确认」或「仅记录体能」。账号接口 `GET /api/health/workouts` 支持日期和状态筛选，`PATCH /api/health/workouts/:id/plan-link` 用计划实例 ID 和当前绑定版本确认或改绑，传入空实例 ID 撤销打卡。撤销时保留外部体能记录，重算受影响的打卡状态和统计。

例如，18:02 的传统力量训练匹配当天唯一的「器械全身」，计划显示已打卡，动作表仍按已记录的组次显示。随后完成的踏步机训练会进入当天体能汇总，有单独的有氧计划时可完成有氧打卡。当天有两节抗阻计划且都没有可区分的时间窗时，力量记录保留，计划等待选择。

## 部署与核对

先确认网页可加载动作列表、姿势图和历史训练。部署公网 HTTPS 后，在「统计后台 → Apple 健康」签发设备令牌，再按[快捷指令说明](iphone-health-shortcuts.md)上传训练。核对场次去重、跨午夜归档和当天计划匹配。
