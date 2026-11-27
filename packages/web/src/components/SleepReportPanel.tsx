import { useState } from "react";
import type { SleepReport, SleepReportDay } from "@ironlog/shared";
import { shortDate } from "../lib/date";
import { openDeviceSetupModal } from "../lib/record-openers";
import { Icon } from "./Icon";
import { formatSleepMinutes } from "./apple/AppleHealthModals";
import { downloadClientFile } from "./settings/DataModals";
import "./sleep-report.css";

const PAGE_SIZE = 7;
const clock = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function clockLabel(iso: string) {
  return clock.format(new Date(iso));
}

function daySummary(day: SleepReportDay) {
  return day.minutes == null ? "无睡眠记录" : formatSleepMinutes(day.minutes);
}

function exportSleepReport(report: SleepReport) {
  const rows = report.series.map(({ date, minutes, source, window, stages }) => [
    date, minutes, source === "intervals" ? "去重时段" : source === "mixed" ? "时段+时长汇总" : source === "summary" ? "同步汇总" : "",
    window?.startAt, window?.endAt, stages?.core, stages?.deep, stages?.rem,
  ].map((value) => value ?? "").join(","));
  downloadClientFile(
    "\uFEFF" + [
      "日期（UTC+8）,睡眠总分钟,时长来源,主睡眠开始（UTC）,主睡眠结束（UTC）,核心睡眠分钟,深睡分钟,REM分钟",
      ...rows,
    ].join("\r\n"),
    "text/csv;charset=utf-8",
    `铁记-睡眠报表-${report.current.through}.csv`,
  );
}

export function SleepReportPanel({ report }: { report: SleepReport }) {
  const { current, previous, series, timing, averageChangeMinutes, referenceMinutes } = report;
  const [pageSize, setPageSize] = useState<7 | 14>(PAGE_SIZE);
  const [page, setPage] = useState(() => {
    const latest = series.map(({ minutes }) => minutes != null).lastIndexOf(true);
    return latest < 0 ? 0 : Math.floor((series.length - 1 - latest) / PAGE_SIZE);
  });
  const [selectedDate, setSelectedDate] = useState<string>();
  const totalPages = Math.max(1, Math.ceil(series.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const endIndex = series.length - safePage * pageSize;
  const visibleDays = series.slice(Math.max(0, endIndex - pageSize), endIndex);
  const day = visibleDays.find(({ date }) => date === selectedDate)
    ?? visibleDays.filter(({ minutes }) => minutes != null).at(-1)
    ?? visibleDays.at(-1);
  const axisMax = Math.max(10, Math.ceil(Math.max(...series.map(({ minutes }) => minutes ?? 0)) / 60)) * 60;
  const ticks = [0, 4 * 60, referenceMinutes, axisMax];
  const fromLabel = shortDate(visibleDays[0]?.date ?? "");
  const throughLabel = shortDate(visibleDays.at(-1)?.date ?? "");
  const referenceHours = referenceMinutes / 60;
  const sameYear = current.from.slice(0, 4) === current.through.slice(0, 4);

  return (
    <section className="panel sleep-report" aria-labelledby="sleep-report-heading">
      <header className="sleep-report-head">
        <div>
          <h2 id="sleep-report-heading">睡眠报表</h2>
          <p>
            <time dateTime={current.from}>{sameYear ? shortDate(current.from) : current.from}</time>
            {" 至 "}
            <time dateTime={current.through}>{sameYear ? shortDate(current.through) : current.through}</time>
            <span className="sleep-report-source"> · Apple 健康</span>
          </p>
        </div>
        {current.recordedDays > 0 ? (
          <button type="button" className="secondary-button" onClick={() => exportSleepReport(report)}>
            <Icon name="download" size={15} /> 导出 CSV
          </button>
        ) : null}
      </header>

      <dl className="sleep-report-summary">
        <div>
          <dt>平均睡眠</dt>
          <dd>{formatSleepMinutes(current.averageMinutes)}</dd>
          <small>
            {averageChangeMinutes == null ? "按有记录的日期计算"
              : averageChangeMinutes === 0 ? "与上期持平"
                : `比上期${averageChangeMinutes > 0 ? "多" : "少"} ${Math.abs(averageChangeMinutes)} 分钟`}
          </small>
        </div>
        <div>
          <dt>记录覆盖</dt>
          <dd>{current.recordedDays}<small> / {current.days} 天</small></dd>
          <small>上期 {previous.recordedDays} / {previous.days} 天</small>
        </div>
        <div>
          <dt>达到 {referenceHours} 小时</dt>
          <dd>{current.recordedDays ? current.referenceDays : "—"}<small>{current.recordedDays ? ` / ${current.recordedDays} 天` : ""}</small></dd>
          <small>成人时长参考</small>
        </div>
        <div>
          <dt>睡眠中点波动</dt>
          <dd>{timing.medianShiftMinutes ?? "—"}{timing.medianShiftMinutes != null ? <small> 分钟</small> : null}</dd>
          <small>{timing.medianShiftMinutes == null
            ? `${timing.adjacentPairs} 对相邻记录 · 至少需 3 对`
            : `${timing.adjacentPairs} 对相邻夜晚的中位变化`}</small>
        </div>
      </dl>

      {current.recordedDays === 0 ? (
        <div className="sleep-report-empty">
          <strong>这段时间暂无睡眠数据</strong>
          <p>试试其他日期，或用每日健康同步快捷指令上传 Apple 健康里的睡眠记录。</p>
          <button type="button" className="secondary-button" onClick={() => openDeviceSetupModal()}>设置健康同步</button>
        </div>
      ) : (
        <div className="sleep-report-body">
          <section className="sleep-trend" aria-label="逐日睡眠时长">
            <div className="sleep-trend-head">
              <h3>逐日睡眠时长</h3>
              <div className="sleep-week-controls">
                {series.length > 14 ? (
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => {
                      setPageSize((s) => (s === 7 ? 14 : 7));
                      setPage(0);
                    }}
                  >
                    {pageSize}天/页
                  </button>
                ) : null}
                <button type="button" className="quiet" aria-label="查看前一周"
                  disabled={endIndex <= pageSize} onClick={() => setPage(safePage + 1)}>‹</button>
                <span aria-live="polite">
                  {fromLabel} – {throughLabel}
                  {totalPages > 1 ? ` (${totalPages - safePage}/${totalPages})` : ""}
                </span>
                <button type="button" className="quiet" aria-label="查看后一周"
                  disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>›</button>
                {safePage > 0 ? (
                  <button type="button" className="quiet" onClick={() => setPage(0)}>
                    最新
                  </button>
                ) : null}
              </div>
            </div>
            <div className="sleep-chart">
              <div className="sleep-chart-plot">
                <div className="sleep-chart-guide" aria-hidden="true">
                  {ticks.map((minutes) => (
                    <div key={minutes} className={minutes === referenceMinutes ? "is-reference" : undefined}
                      style={{ bottom: `${(minutes / axisMax) * 100}%` }}><span>{minutes / 60} 时</span></div>
                  ))}
                </div>
                <div className="sleep-chart-columns">
                  {visibleDays.map((item) => (
                    <button key={item.date} type="button" className={`sleep-chart-day${item.minutes == null ? " is-missing" : ""}`}
                      aria-pressed={item.date === day?.date} aria-label={`${item.date}，${daySummary(item)}`}
                      onClick={() => setSelectedDate(item.date)}>
                      <span className="sleep-chart-bar" aria-hidden="true"
                        style={item.minutes == null ? undefined : { height: `${(item.minutes / axisMax) * 100}%` }} />
                      <span className="sleep-chart-label" aria-hidden="true">{shortDate(item.date)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="sleep-chart-caption"><span>虚线为 {referenceHours} 小时参考</span><span>短横线为无记录</span></p>
          </section>

          {day ? (
            <section className="sleep-day-detail" aria-label="所选日期睡眠明细" aria-live="polite">
              <div className="sleep-detail-head"><h3>{shortDate(day.date)} 明细</h3>
                <strong>{daySummary(day)}</strong></div>
              <dl>
                <div><dt>主睡眠区间</dt>
                  <dd>{day.window ? `${clockLabel(day.window.startAt)} – ${clockLabel(day.window.endAt)}` : "暂无可靠起止时间"}</dd>
                </div>
                {day.source ? (
                  <div>
                    <dt>时长来源</dt>
                    <dd>
                      {day.source === "intervals"
                        ? "去重后的睡眠时段"
                        : day.source === "mixed"
                          ? "时段去重 + 无时间戳分期合并"
                          : "已同步的睡眠汇总"}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {day.stages ? (
                <>
                  <p>设备估算分期</p>
                  <dl className="sleep-stage-list">
                    <div>
                      <dt>核心{day.untimedStages?.includes("core") ? " (仅时长)" : ""}</dt>
                      <dd>{formatSleepMinutes(day.stages.core)}</dd>
                    </div>
                    <div>
                      <dt>深睡{day.untimedStages?.includes("deep") ? " (仅时长)" : ""}</dt>
                      <dd>{formatSleepMinutes(day.stages.deep)}</dd>
                    </div>
                    <div>
                      <dt>REM{day.untimedStages?.includes("rem") ? " (仅时长)" : ""}</dt>
                      <dd>{formatSleepMinutes(day.stages.rem)}</dd>
                    </div>
                  </dl>
                </>
              ) : null}
            </section>
          ) : null}
        </div>
      )}

      <details className="sleep-report-method">
        <summary>统计口径与参考</summary>
        <ul>
          <li>按睡眠结束所在日期归档（UTC+8），起止时间按设备本地时区显示，总时长可能包括小睡。缺测日不计入平均，上期与本期各覆盖至少一半日期才比较。</li>
          <li>作息使用当日最长的睡眠区间，须有至少 3 小时实际睡眠。把起止时间的中点按 24 小时取最短差，显示相邻日期差值的中位数。至少需要 3 对相邻日期。</li>
          <li>7 小时线来自一般成人的时长共识。穿戴设备分期用于观察个人趋势。 <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4434546/" target="_blank" rel="noreferrer">睡眠时长共识</a> · <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC5940440/" target="_blank" rel="noreferrer">穿戴设备立场声明</a></li>
        </ul>
      </details>
    </section>
  );
}
