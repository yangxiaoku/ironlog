import {
  openAiDietModal,
  openAiPlanModal,
  openAiReviewModal,
  openAiWorkoutModal,
} from "../../lib/record-openers";
import { Icon } from "../Icon";
import { AiModePill, type AiStatus } from "./AiModals";

export function AiSettingsCard({ status }: { status: AiStatus | null }) {
  const modeText = status?.mode === "demo" ? "演示引擎" : status?.ready ? "在线已就绪" : "未配置";
  const hostText = status?.mode === "demo" ? "本地演示模拟器" : status?.baseUrlHost || "未设置";

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>AI 训练与营养助手</h2>
          <p className="muted panel-order-hint">大模型密钥安全保存在后端环境变量中，前端仅传递必要脱敏摘要。</p>
        </div>
        <AiModePill status={status} />
      </div>

      <div className="settings-form">
        <div className="health-metrics apple-telemetry">
          <div>
            <span>运行状态</span>
            <strong>{modeText}</strong>
          </div>
          <div>
            <span>当前模型</span>
            <strong>{status?.model || "—"}</strong>
          </div>
          <div>
            <span>接口网关</span>
            <strong>{hostText}</strong>
          </div>
          <div>
            <span>支持能力</span>
            <strong>5 项模块</strong>
          </div>
        </div>

        <div className="ai-tool-grid">
          <button type="button" className="ai-tool-btn" onClick={() => openAiReviewModal()}>
            <Icon name="analytics" size={18} />
            <div>
              <strong>AI 周期训练复盘</strong>
              <small>诊断负荷比、肌群均衡与恢复建议</small>
            </div>
          </button>
          <button type="button" className="ai-tool-btn" onClick={() => openAiPlanModal()}>
            <Icon name="plan" size={18} />
            <div>
              <strong>AI 生成训练计划</strong>
              <small>生成分化周期草稿（入草稿箱审阅）</small>
            </div>
          </button>
          <button type="button" className="ai-tool-btn" onClick={() => openAiWorkoutModal()}>
            <Icon name="workout" size={18} />
            <div>
              <strong>AI 识别训练记录</strong>
              <small>自然语言描述整场训练与组数重量</small>
            </div>
          </button>
          <button type="button" className="ai-tool-btn" onClick={() => openAiDietModal()}>
            <Icon name="diet" size={18} />
            <div>
              <strong>AI 识别饮食热量</strong>
              <small>识别食物列表并拆分蛋白碳水脂肪</small>
            </div>
          </button>
        </div>

        {!status?.ready ? (
          <div className="ai-setup-box">
            <pre className="ai-code">
              {`AI_BASE_URL=https://api.openai.com/v1\nAI_MODEL=gpt-4o-mini\nAI_API_KEY=sk-你的模型密钥`}
            </pre>
          </div>
        ) : (
          <p className="muted ai-foot-note">
            训中打开「记训练」弹窗右下菜单即可随时唤起「AI 训中调整」，动态调整剩余未练组数与动作替换。
          </p>
        )}
      </div>
    </section>
  );
}
