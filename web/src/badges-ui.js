import { esc, fmt, icon, dotMeter, empty } from "./ui.js";
import { matrix } from "./display.js";

const tierLabels = {
  standard: "基础",
  milestone: "里程碑",
  prestige: "荣耀",
};

function badgeCard(badge, pinnedSet) {
  const pct = Math.round(badge.progress * 100);
  const pinned = badge.unlocked && pinnedSet.has(badge.id);
  const statusText = badge.unlocked
    ? `${badge.unlockedAt ? badge.unlockedAt.slice(5).replace("-", "/") + " " : ""}已点亮`
    : `${fmt(badge.current)} / ${fmt(badge.target)} ${badge.unit}`;
  return `<button type="button" class="badge-card${badge.unlocked ? " is-unlocked" : " is-locked"}${pinned ? " is-pinned" : ""}" data-action="badge-detail" data-value="${esc(badge.id)}">
    <div class="badge-card-top">
      <span class="badge-tier">${tierLabels[badge.tier] ?? ""}</span>
      ${pinned ? '<span class="badge-pin-tag">已佩戴</span>' : '<i class="badge-dot" aria-hidden="true"></i>'}
    </div>
    <div class="badge-art"><img src="./badge-${esc(badge.id)}.png" width="128" height="128" loading="lazy" decoding="async" alt=""></div>
    <div class="badge-copy">
      <strong>${esc(badge.title)}</strong>
      <small>${esc(badge.subtitle)}</small>
    </div>
    <div class="badge-foot">
      ${dotMeter(badge.progress, 10)}
      <span>${esc(statusText)}${badge.unlocked ? "" : ` · ${pct}%`}</span>
    </div>
  </button>`;
}

export function filterVisibleBadges(summary, appleHealthConnected = true) {
  if (!summary || appleHealthConnected) return summary;
  const visibleBadges = (summary.badges ?? []).filter((b) => b.unlocked || !String(b.id ?? "").startsWith("apple-"));
  const cats = (summary.categories ?? []).map((cat) => {
    const items = visibleBadges.filter((b) => b.category === cat.key);
    return { ...cat, total: items.length, earned: items.filter((b) => b.unlocked).length };
  }).filter((cat) => cat.total > 0);
  return {
    ...summary,
    badges: visibleBadges,
    categories: cats,
    totalCount: visibleBadges.length,
    earnedCount: visibleBadges.filter((b) => b.unlocked).length,
  };
}

export function badgesOverviewStrip(rawSummary, pinnedIds = [], { appleHealthConnected = true } = {}) {
  const summary = filterVisibleBadges(rawSummary, appleHealthConnected);
  if (!summary?.badges?.length) return "";
  const unlocked = summary.badges.filter((item) => item.unlocked);
  const byId = new Map(unlocked.map((b) => [b.id, b]));
  const pinned = pinnedIds.map((id) => byId.get(id)).filter(Boolean);
  const pinnedSet = new Set(pinned.map((b) => b.id));
  const otherUnlocked = unlocked.filter((b) => !pinnedSet.has(b.id)).slice(-4).reverse();
  const orderedUnlocked = [...pinned, ...otherUnlocked];
  const chasing = summary.badges
    .filter((item) => !item.unlocked)
    .sort((a, b) => b.progress - a.progress);
  const featured = [
    ...orderedUnlocked.slice(0, 4),
    ...chasing.slice(0, Math.max(0, 6 - Math.min(4, orderedUnlocked.length))),
  ].slice(0, 6);

  return `<section class="panel badges-strip" aria-label="成就徽章摘要">
    <header class="panel-head">
      <div class="badges-strip-title"><h2>成就徽章</h2><span class="atlas-pill">${summary.earnedCount} / ${summary.totalCount}</span></div>
      <button type="button" class="quiet" data-action="route" data-value="badges">全部徽章 ${icon("chevron", 16)}</button>
    </header>
    <div class="badges-strip-grid">
      ${featured.map((badge) => {
        const isPinned = pinnedSet.has(badge.id);
        return `<button type="button" class="badge-mini${badge.unlocked ? " is-unlocked" : " is-locked"}${isPinned ? " is-pinned" : ""}" data-action="badge-detail" data-value="${esc(badge.id)}">
        ${isPinned ? '<span class="badge-mini-pin">佩戴</span>' : ""}
        <span class="badge-mini-art"><img src="./badge-${esc(badge.id)}.png" width="76" height="76" loading="lazy" decoding="async" alt=""></span>
        <strong>${esc(badge.title)}</strong>
        <small>${badge.unlocked ? "已点亮" : `${Math.round(badge.progress * 100)}%`}</small>
      </button>`;
      }).join("")}
    </div>
  </section>`;
}

function normalizeOpts(arg) {
  if (typeof arg === "string") return { category: arg, status: "all", query: "", pinnedIds: [], appleHealthConnected: true };
  return {
    category: arg?.category ?? "",
    status: arg?.status ?? "all",
    query: arg?.query ?? "",
    pinnedIds: Array.isArray(arg?.pinnedIds) ? arg.pinnedIds : [],
    appleHealthConnected: arg?.appleHealthConnected ?? true,
  };
}

/** @param {any} rawSummary @param {any} [options] */
export function renderBadgeSections(rawSummary, options = "") {
  const { category, status, query, pinnedIds, appleHealthConnected } = normalizeOpts(options);
  const summary = filterVisibleBadges(rawSummary, appleHealthConnected);
  const { categories, badges } = summary;
  const pinnedSet = new Set(pinnedIds);
  const q = query.trim().toLowerCase();
  const visibleCategories = category ? categories.filter((cat) => cat.key === category) : categories;

  const sections = visibleCategories.map((cat) => {
    let items = badges.filter((item) => item.category === cat.key);
    if (status === "unlocked") items = items.filter((item) => item.unlocked);
    else if (status === "chasing") {
      items = items.filter((item) => !item.unlocked).sort((a, b) => b.progress - a.progress);
    }
    if (q) {
      items = items.filter((item) =>
        [item.title, item.subtitle, item.rule, item.categoryLabel].some((txt) => String(txt ?? "").toLowerCase().includes(q)),
      );
    }
    if (!items.length) return "";
    return `<section class="badge-section" aria-label="${esc(cat.label)}">
      <header class="badge-section-head">
        <h2>${esc(cat.label)}</h2>
        <span>${items.length === cat.total ? `${cat.earned} / ${cat.total}` : `${items.length} 枚`}</span>
      </header>
      <div class="badge-grid">${items.map((item) => badgeCard(item, pinnedSet)).join("")}</div>
    </section>`;
  }).filter(Boolean).join("");

  return sections || empty("没有匹配的成就徽章", "试试切换筛选状态或更换关键词。");
}

/** @param {any} rawSummary @param {any} [options] */
export function renderBadgesView(rawSummary, options = "") {
  const opts = normalizeOpts(options);
  const summary = filterVisibleBadges(rawSummary, opts.appleHealthConnected);
  const { earnedCount, totalCount, categories } = summary;
  const ratio = totalCount ? earnedCount / totalCount : 0;

  const filterBar = `<div class="muscle-pills badge-filters" role="group" aria-label="徽章分类筛选">
    <button type="button" data-action="badge-category" data-value="" aria-pressed="${opts.category === ""}">全部 ${earnedCount}/${totalCount}</button>
    ${categories.map((cat) => `<button type="button" data-action="badge-category" data-value="${esc(cat.key)}" aria-pressed="${opts.category === cat.key}">${esc(cat.label)} ${cat.earned}/${cat.total}</button>`).join("")}
  </div>`;

  const subToolbar = `<div class="badge-subtoolbar">
    <div class="segments" role="group" aria-label="徽章状态筛选">
      <button type="button" data-action="badge-status" data-value="all" aria-pressed="${opts.status === "all"}">全部</button>
      <button type="button" data-action="badge-status" data-value="unlocked" aria-pressed="${opts.status === "unlocked"}">已点亮</button>
      <button type="button" data-action="badge-status" data-value="chasing" aria-pressed="${opts.status === "chasing"}">冲刺中</button>
    </div>
    <label class="search badge-search">${icon("search", 15)}<input id="badge-search" type="search" enterkeyhint="search" maxlength="60" value="${esc(opts.query)}" placeholder="搜索 105 枚徽章名称或条件…" aria-label="搜索徽章"></label>
  </div>`;

  const progressBand = `<section class="panel badge-overview-band">
    <div class="badge-band-main">
      <div><span class="badge-band-label">收集进度</span><strong>${matrix(String(earnedCount).padStart(2, "0"))} <small>/ ${totalCount} 枚</small></strong></div>
      <span class="badge-pct">${Math.round(ratio * 100)}%</span>
    </div>
    ${dotMeter(ratio, 24, `已获得 ${earnedCount} / ${totalCount} 枚成就徽章`)}
  </section>`;

  return `${progressBand}${filterBar}${subToolbar}<div class="badge-sections">${renderBadgeSections(summary, opts)}</div>`;
}

export function badgeDetailModal(badge, { pinned = false } = {}) {
  const pct = Math.round(badge.progress * 100);
  return `<div class="dialog-form badge-modal${badge.unlocked ? " is-unlocked" : " is-locked"}">
    <div class="badge-stage">
      <span class="crosshair tl" aria-hidden="true"></span><span class="crosshair br" aria-hidden="true"></span>
      <div class="badge-stage-ring"><img src="./badge-${esc(badge.id)}.png" width="210" height="210" alt="${esc(badge.title)}"></div>
      <span class="badge-stage-status"><i></i>${badge.unlocked ? `已解锁${badge.unlockedAt ? " · " + badge.unlockedAt.replace(/-/g, ".") : ""}` : "待解锁"}</span>
    </div>
    <div class="badge-modal-info">
      <div class="badge-modal-meta"><span>${esc(badge.categoryLabel)}</span><span>${tierLabels[badge.tier] ?? ""}</span></div>
      <h3>${esc(badge.title)}</h3>
      <p>${esc(badge.subtitle)}</p>
      <div class="badge-rule-box">
        <span>达成条件</span>
        <strong>${esc(badge.rule)}</strong>
        <div class="badge-modal-progress">
          ${dotMeter(badge.progress, 20)}
          <div><span>当前进度</span><b>${fmt(badge.current)} / ${fmt(badge.target)} ${esc(badge.unit)} · ${pct}%</b></div>
        </div>
      </div>
      ${badge.unlocked ? `<div class="badge-modal-actions">
        <button type="button" class="${pinned ? "secondary-button is-pinned" : "primary-button"}" data-action="toggle-pin-badge" data-value="${esc(badge.id)}">${icon("bookmark", 15)} ${pinned ? "取消首页佩戴" : "佩戴到首页展示（最多 3 枚）"}</button>
      </div>` : ""}
    </div>
  </div>`;
}
