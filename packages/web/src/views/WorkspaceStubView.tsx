import { PageHeading, WorkspaceTabs } from "../components/WorkspaceTabs";
import { DESTINATIONS, type ViewId } from "../lib/routes";
import { useUiStore } from "../store/useUiStore";

type PendingView = Exclude<ViewId, "overview" | "workout" | "diet" | "weight">;

const PHASE_NOTES: Record<PendingView, { phase: string; scope: string }> = {
  plan: {
    phase: "阶段三",
    scope: "周期训练计划、每周排期、模板库与 1RM/配片计算器将在阶段三迁移。",
  },
  exercises: {
    phase: "阶段三",
    scope: "5,650+ 动作库、肌群/器械筛选与自定义动作将在阶段三迁移。",
  },
  calendar: {
    phase: "阶段三",
    scope: "月度训练热力图、排期点选与单日记录总览将在阶段三迁移。",
  },
  analytics: {
    phase: "阶段三",
    scope: "ACWR、肌群剂量、1RM 曲线与 Apple 健康指标报表将在阶段三迁移。",
  },
  badges: {
    phase: "阶段三",
    scope: "成就徽章墙与置顶陈列将在阶段三迁移。",
  },
  settings: {
    phase: "阶段三",
    scope: "统计面板排序、身体参数、Apple 快捷指令生成、备份导入导出与密码管理将在阶段三迁移。",
  },
};

export function WorkspaceStubView({ view }: { view: PendingView }) {
  const navigate = useUiStore((s) => s.navigate);
  const info = PHASE_NOTES[view];
  const title = DESTINATIONS[view];

  return (
    <>
      <WorkspaceTabs />
      <PageHeading title={title} sub={`${info.phase}迁移计划页面`} view={view} />
      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>
              {title}（{info.phase}待迁移）
            </h2>
            <p>{info.scope}</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => navigate("overview")}>
            返回首页
          </button>
        </header>
      </section>
    </>
  );
}
