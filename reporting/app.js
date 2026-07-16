/**
 * KORODUR Space Health Dashboard v2
 * Loads daily JSON snapshots and renders KPIs, the trend chart with weekly
 * done bars, KPI sparklines, a date timeline, owner split, priorities,
 * area cards and the project table.
 */

// In dev: symlink src/data -> ../data; in production (GitHub Pages): data/ is at root
const SNAPSHOTS_DIR = 'data/snapshots/';

const MONTHS_DE = [
  'Januar','Februar','M\u00e4rz','April','Mai','Juni',
  'Juli','August','September','Oktober','November','Dezember'
];

// ─── State ───────────────────────────────────────────
let currentSnapshot = null;
let previousSnapshot = null;
let availableSnapshots = [];   // newest-first (index.json order)
let timeseries = [];           // ascending by date — drives chart + sparklines

// ─── Init ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await discoverSnapshots();
  await loadTimeseries();
  if (availableSnapshots.length > 0) {
    await loadSnapshot(availableSnapshots[0]);
  } else {
    showEmpty();
  }
});

// ─── Timeseries (compact per-day totals) ─────────────
async function loadTimeseries() {
  try {
    const res = await fetch(SNAPSHOTS_DIR + 'timeseries.json');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        timeseries = data.filter(r => r && r.date).sort((a, b) => a.date.localeCompare(b.date));
      }
    }
  } catch { /* chart/sparklines simply stay hidden */ }
}

// ─── Snapshot Discovery ──────────────────────────────
async function discoverSnapshots() {
  try {
    const res = await fetch(SNAPSHOTS_DIR + 'index.json');
    if (res.ok) {
      availableSnapshots = await res.json();
    }
  } catch {
    const now = new Date();
    const candidates = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const tmp = new Date(d.getTime());
      tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
      const jan4 = new Date(tmp.getFullYear(), 0, 4);
      const week = 1 + Math.round(((tmp - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
      const isoYear = tmp.getFullYear();
      const key = `${isoYear}-W${String(week).padStart(2, '0')}`;
      if (!candidates.includes(key)) candidates.push(key);
    }
    for (const key of candidates) {
      try {
        const r = await fetch(SNAPSHOTS_DIR + key + '.json');
        if (r.ok) availableSnapshots.push(key);
      } catch { /* skip */ }
    }
  }
  renderSidebar();
}

// ─── Load Snapshot ───────────────────────────────────
async function loadSnapshot(key) {
  const main = document.getElementById('main');
  main.innerHTML = `<div class="loading"><div class="loading__spinner"></div>Lade Snapshot...</div>`;

  try {
    const res = await fetch(SNAPSHOTS_DIR + key + '.json');
    if (!res.ok) throw new Error('Snapshot nicht gefunden');
    currentSnapshot = await res.json();

    // Load previous snapshot for trend comparison
    const idx = availableSnapshots.indexOf(key);
    previousSnapshot = null;
    if (idx >= 0 && idx < availableSnapshots.length - 1) {
      try {
        const prevKey = availableSnapshots[idx + 1];
        const prevRes = await fetch(SNAPSHOTS_DIR + prevKey + '.json');
        if (prevRes.ok) previousSnapshot = await prevRes.json();
      } catch { /* no previous available */ }
    }

    document.querySelectorAll('.sidebar__item').forEach(el => {
      el.classList.toggle('active', el.dataset.key === key);
    });

    renderDashboard(currentSnapshot, previousSnapshot);
    updateHeaderMeta(key);
  } catch (err) {
    main.innerHTML = `<div class="loading">Fehler beim Laden: ${err.message}</div>`;
  }
}

// ─── Render Sidebar ──────────────────────────────────
function renderSidebar() {
  const list = document.getElementById('snapshot-list');
  if (!list) return;

  if (availableSnapshots.length === 0) {
    list.innerHTML = '<li style="padding:20px;color:var(--muted);font-size:.85rem;">Keine Snapshots vorhanden</li>';
    return;
  }

  list.innerHTML = availableSnapshots.map((key, i) => {
    const labelText = formatSnapshotLabel(key);
    const badge = i === 0 ? 'Aktuell' : '';
    return `
      <li>
        <a class="sidebar__item ${i === 0 ? 'active' : ''}"
           data-key="${key}"
           onclick="loadSnapshot('${key}')">
          ${labelText}
          ${badge ? `<span class="sidebar__item-date">${badge}</span>` : ''}
        </a>
      </li>
    `;
  }).join('');
}

// ─── Format Helpers ──────────────────────────────────
function formatSnapshotLabel(key) {
  // Daily key: YYYY-MM-DD
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (dayMatch) {
    const [, y, m, d] = dayMatch;
    return `${parseInt(d, 10)}. ${MONTHS_DE[parseInt(m, 10) - 1]} ${y}`;
  }
  // Legacy weekly key (archive): YYYY-Www
  if (key.includes('-W')) {
    const [year, weekPart] = key.split('-W');
    return `KW ${parseInt(weekPart, 10)} ${year}`;
  }
  // Legacy monthly key (archive): YYYY-MM
  const [year, month] = key.split('-');
  return `${MONTHS_DE[parseInt(month, 10) - 1]} ${year}`;
}

// Short label for chart axes / sparklines (e.g. "17.06.")
function shortDayLabel(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  if (m) return `${m[3]}.${m[2]}.`;
  return dateStr || '';
}

function updateHeaderMeta(key) {
  const el = document.getElementById('header-meta');
  if (!el || !currentSnapshot) return;
  el.textContent = `Snapshot: ${formatSnapshotLabel(key)}`;
}

// ─── Timeline Slider ─────────────────────────────────
// availableSnapshots is newest-first; the slider runs oldest → newest.
function renderTimeline() {
  if (!currentSnapshot) return '';
  const asc = [...availableSnapshots].reverse();
  const currentKey = currentSnapshot._meta.snapshot_date;
  const idx = Math.max(0, asc.indexOf(currentKey));
  const n = asc.length;
  const single = n < 2;

  // One tick per snapshot, positioned to line up with the slider thumb travel
  // (thumb is 18px, so its centre runs from 9px to width-9px). Labels are
  // thinned to ~7 max so they never overlap; first + last always labelled.
  const labelEvery = Math.max(1, Math.ceil(n / 7));
  const ticks = asc.map((key, i) => {
    const frac = n > 1 ? i / (n - 1) : 0.5;
    const off = (9 - frac * 18).toFixed(1);
    const showLabel = i === 0 || i === n - 1 || i % labelEvery === 0;
    return `
      <button type="button" class="timeline__tick ${i === idx ? 'is-active' : ''}"
              data-i="${i}" style="left:calc(${(frac * 100).toFixed(2)}% + ${off}px)"
              onclick="scrubTimeline(${i})" title="${formatSnapshotLabel(key)}"
              aria-label="${formatSnapshotLabel(key)}">
        <span class="timeline__tick-dot"></span>
        ${showLabel ? `<span class="timeline__tick-label">${shortDayLabel(key)}</span>` : ''}
      </button>`;
  }).join('');

  return `
    <div class="timeline fade-in">
      <div class="timeline__head">
        <span class="timeline__label">Zeitverlauf</span>
        <span class="timeline__current" id="timeline-current">${formatSnapshotLabel(currentKey)}</span>
      </div>
      <div class="timeline__track">
        <input type="range" class="timeline__slider" id="timeline-slider"
               min="0" max="${Math.max(0, n - 1)}" step="1" value="${idx}"
               ${single ? 'disabled' : ''}
               oninput="previewTimeline(this.value)" onchange="scrubTimeline(this.value)"
               aria-label="Snapshot-Datum wählen">
        <div class="timeline__ticks">${ticks}</div>
      </div>
      <div class="timeline__hint">
        ${single
          ? 'Verlauf baut sich täglich auf'
          : `<span class="timeline__hint-icon">↔</span> Tag wählen — Punkt antippen oder Regler ziehen · ${n} Tage`}
      </div>
    </div>
  `;
}

// Live label update while dragging (no fetch, keeps the drag smooth)
function previewTimeline(val) {
  const asc = [...availableSnapshots].reverse();
  const i = parseInt(val, 10);
  const key = asc[i];
  const el = document.getElementById('timeline-current');
  if (el && key) el.textContent = formatSnapshotLabel(key);
  document.querySelectorAll('.timeline__tick').forEach(t =>
    t.classList.toggle('is-active', parseInt(t.dataset.i, 10) === i));
}

// Load the selected snapshot on release
function scrubTimeline(val) {
  const asc = [...availableSnapshots].reverse();
  const key = asc[parseInt(val, 10)];
  if (key) loadSnapshot(key);
}

// ─── Trend Chart (development over time) ─────────────
// Order mirrors the KPI tiles: Erledigt, In Arbeit, Blockiert, Offen, Gesamt.
const TREND_METRICS = [
  { key: 'done',        label: 'Erledigt',     color: 'var(--success)' },
  { key: 'in_progress', label: 'In Arbeit',    color: 'var(--secondary)' },
  { key: 'blocked',     label: 'Blockiert',    color: 'var(--warn)' },
  { key: 'open',        label: 'Offen',        color: '#9aa7b4' },
  { key: 'items',       label: 'Items gesamt', color: 'var(--primary)' },
];

function renderTrendChart(data) {
  const doneBars = renderDoneByWeek(data);
  const series = timeseries;
  if (!series || series.length < 2) {
    return `
      <div class="status-section fade-in">
        <h3 class="status-section__title">ENTWICKLUNG IM ZEITVERLAUF</h3>
        <p class="trend-empty">
          Die Verlaufskurve baut sich ab jetzt täglich auf. Ab dem zweiten
          Snapshot erscheinen hier die Linien für Erledigt, In Arbeit,
          Blockiert, Offen und Items gesamt.
        </p>
        ${doneBars}
      </div>
    `;
  }

  const W = 820, H = 300, padL = 34, padR = 18, padT = 16, padB = 30;
  const t0 = new Date(series[0].date).getTime();
  const tN = new Date(series[series.length - 1].date).getTime();
  const span = Math.max(1, tN - t0);
  const maxVal = Math.max(
    1,
    ...series.flatMap(r => TREND_METRICS.map(m => r[m.key] || 0))
  );
  const yMax = Math.ceil(maxVal * 1.1 / 5) * 5 || 5;

  const sx = d => padL + ((new Date(d).getTime() - t0) / span) * (W - padL - padR);
  const sy = v => padT + (1 - v / yMax) * (H - padT - padB);

  // horizontal grid lines (0, ¼, ½, ¾, max)
  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const v = Math.round(yMax * f);
    const y = sy(v);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="trend__grid"/>
            <text x="${padL - 6}" y="${y + 3}" class="trend__ytick">${v}</text>`;
  }).join('');

  const lines = TREND_METRICS.map(m => {
    const pts = series.map(r => `${sx(r.date).toFixed(1)},${sy(r[m.key] || 0).toFixed(1)}`).join(' ');
    const last = series[series.length - 1];
    const lx = sx(last.date), ly = sy(last[m.key] || 0);
    return `
      <polyline points="${pts}" fill="none" stroke-width="2.5"
                stroke-linejoin="round" stroke-linecap="round" style="stroke:${m.color}"/>
      <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.2" style="fill:${m.color}"/>
    `;
  }).join('');

  // x-axis date ticks: first, middle, last
  const tickIdx = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])];
  const xticks = tickIdx.map(i => {
    const r = series[i];
    return `<text x="${sx(r.date).toFixed(1)}" y="${H - 8}" class="trend__xtick"
                  text-anchor="${i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}">${shortDayLabel(r.date)}</text>`;
  }).join('');

  const legend = TREND_METRICS.map(m =>
    `<span class="trend-legend__item"><span class="trend-legend__dot" style="background:${m.color}"></span>${m.label}</span>`
  ).join('');

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">ENTWICKLUNG IM ZEITVERLAUF</h3>
      <svg class="trend-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
           aria-label="Verlauf der Kennzahlen über die Zeit">
        ${grid}
        ${lines}
        ${xticks}
      </svg>
      <div class="trend-legend">${legend}</div>
      ${doneBars}
    </div>
  `;
}

// ─── KPI Sparkline (tiny inline trend) ───────────────
function sparkline(metric, color) {
  const series = timeseries;
  if (!series || series.length < 2) return '';
  const vals = series.map(r => r[metric] || 0);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const W = 100, H = 26, pad = 3;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (H - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastX = pad + (W - 2 * pad);
  const lastY = pad + (1 - (vals[vals.length - 1] - min) / range) * (H - 2 * pad);
  return `
    <svg class="kpi-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${pts.join(' ')}" fill="none" stroke-width="1.6"
                stroke-linejoin="round" stroke-linecap="round" style="stroke:${color}"/>
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2" style="fill:${color}"/>
    </svg>
  `;
}

// ─── Delta Helper ────────────────────────────────────
function delta(current, previous) {
  if (previous == null) return null;
  return current - previous;
}

function deltaHtml(d, suffix) {
  if (d == null) return '';
  const sign = d > 0 ? '+' : '';
  const cls = d > 0 ? 'delta--up' : d < 0 ? 'delta--down' : 'delta--neutral';
  return `<span class="delta ${cls}">${sign}${d}${suffix || ''}</span>`;
}

// ─── Area display meta (emoji + strategic group) ─────
const AREA_META = {
  'Marketing':              { emoji: '📣', group: 'Marketing' },
  'CRM & Sales Ops':        { emoji: '📊', group: 'Marketing' },
  'Internationalisierung':  { emoji: '🌍', group: 'Strategie' },
  'Wissensaufbau':          { emoji: '📚', group: 'Strategie' },
  'AI & Infrastruktur':     { emoji: '🤖', group: 'Strategie' },
  'Strategie':              { emoji: '🎯', group: 'Strategie' },
  'Nicht zugeordnet':       { emoji: '❓', group: 'Triage' },
};
function areaMeta(name) {
  return AREA_META[name] || { emoji: '📁', group: 'Sonstige' };
}

const MONTHS_SHORT_DE = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${MONTHS_SHORT_DE[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

// ─── ISO calendar week helpers ───────────────────────
function weekLabel(key) {
  // key: YYYY-Www → "KW 25"
  const w = parseInt(key.split('-W')[1], 10);
  return `KW ${w}`;
}
// Monday of an ISO week (UTC) — week 1 is the week containing Jan 4th.
function isoWeekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Dow + (week - 1) * 7);
  return monday;
}
// Tooltip text for a week bar, e.g. "KW 25 · 16.06.–22.06.2026"
function weekRangeTitle(key) {
  const [y, w] = key.split('-W').map(Number);
  const mon = isoWeekMonday(y, w);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const dm = d => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.`;
  return `KW ${w} · ${dm(mon)}–${dm(sun)}${sun.getUTCFullYear()}`;
}

// ─── Render Dashboard ────────────────────────────────
function renderDashboard(data, prev) {
  const main = document.getElementById('main');
  const t = data.totals;
  const pt = prev ? prev.totals : null;
  const donePercent = t.items > 0 ? Math.round((t.done / t.items) * 100) : 0;

  main.innerHTML = `
    <div class="snapshot-header fade-in">
      <h1 class="snapshot-header__title">WORK COCKPIT — REPORTING</h1>
      <p class="snapshot-header__sub">
        ${data._meta.source || 'KORODUR Work Cockpit'} &mdash; ${formatSnapshotLabel(data._meta.snapshot_date)}
      </p>
    </div>

    ${renderTimeline()}

    <div class="kpi-row">
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Erledigt</div>
        <div class="kpi-card__value">${t.done}</div>
        <div class="kpi-card__detail">Status: Done ${deltaHtml(delta(t.done, pt?.done))}</div>
        ${sparkline('done', 'var(--success)')}
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">In Arbeit</div>
        <div class="kpi-card__value">${t.in_progress}</div>
        <div class="kpi-card__detail">In Progress + Review ${deltaHtml(delta(t.in_progress, pt?.in_progress))}</div>
        ${sparkline('in_progress', 'var(--secondary)')}
      </div>
      <div class="kpi-card fade-in ${t.blocked > 0 ? 'kpi-card--warn' : ''}">
        <div class="kpi-card__label">Blockiert</div>
        <div class="kpi-card__value ${t.blocked > 0 ? 'kpi-card__value--warn' : ''}">${t.blocked}</div>
        <div class="kpi-card__detail">Status: Blocked ${deltaHtml(delta(t.blocked, pt?.blocked))}</div>
        ${sparkline('blocked', 'var(--warn)')}
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Offen</div>
        <div class="kpi-card__value">${t.open}</div>
        <div class="kpi-card__detail">Backlog + Ready ${deltaHtml(delta(t.open, pt?.open))}</div>
        ${sparkline('open', 'var(--muted)')}
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Items gesamt</div>
        <div class="kpi-card__value kpi-card__value--accent">${t.items}</div>
        <div class="kpi-card__detail">${donePercent}% erledigt${(t.discarded || 0) > 0 ? ` · ${t.discarded} verworfen` : ''} ${deltaHtml(delta(t.items, pt?.items))}</div>
        ${sparkline('items', 'var(--primary)')}
      </div>
    </div>

    ${renderTrendChart(data)}

    <div class="split-row">
      ${renderOwnerSplit(data)}
      ${renderPriority(data)}
    </div>

    <h3 class="area-grid-title fade-in">BEREICHE</h3>
    <div class="area-grid">
      ${data.areas.filter(a => a.total > 0).map(a => renderAreaCard(a, prev)).join('')}
    </div>

    ${renderProjectsTable(data)}

    ${renderBlockedReasons(data)}

    <div class="footer">
      KORODUR Work Cockpit Reporting &mdash; Generiert am ${new Date(data._meta.generated_at).toLocaleDateString('de-DE')}
      &mdash; <a href="https://github.com/KORODUR-International/korodur-operating-model" target="_blank">GitHub</a>
    </div>
  `;
}

// ─── Owner Split (Human / Claude / Either) ───────────
function renderOwnerSplit(data) {
  const o = data.by_owner || {};
  const human = o.Human || 0, claude = o.Claude || 0, either = o.Either || 0, none = o.none || 0;
  const assigned = human + claude + either;
  if (assigned + none === 0) return '';
  const seg = (c, type, label) => {
    if (!c) return '';
    const pct = Math.max((c / assigned) * 100, 6);
    return `<div class="status-bar__segment status-bar__segment--${type}" style="width:${pct}%">${pct > 10 ? c : ''}</div>`;
  };

  return `
    <div class="status-section fade-in split-row__col">
      <h3 class="status-section__title">HUMAN / CLAUDE-SPLIT</h3>
      <div class="status-bar">
        ${seg(human, 'human', human)}
        ${seg(claude, 'claude', claude)}
        ${seg(either, 'either', either)}
      </div>
      <div class="status-legend">
        <span class="status-legend__item"><span class="status-legend__dot" style="background:var(--owner-human)"></span>Human: ${human}</span>
        <span class="status-legend__item"><span class="status-legend__dot" style="background:var(--owner-claude)"></span>Claude: ${claude}</span>
        <span class="status-legend__item"><span class="status-legend__dot" style="background:var(--owner-either)"></span>Either: ${either}</span>
        ${none ? `<span class="status-legend__item"><span class="status-legend__dot" style="background:var(--mid-gray)"></span>Ohne: ${none}</span>` : ''}
      </div>
    </div>
  `;
}

// ─── Done by Calendar Week (KW) ──────────────────────
// Sub-block inside the trend section ("Zeitverlauf").
// Falls back to the monthly view for legacy snapshots without done_by_week.
function renderDoneByWeek(data) {
  const dbw = data.done_by_week || {};
  let keys = Object.keys(dbw).sort();
  if (!keys.length) return renderDoneByMonth(data);
  keys = keys.slice(-8); // keep the chart readable as weeks accumulate
  const max = Math.max(...keys.map(k => dbw[k]));

  return `
    <div class="trend-sub">
      <h4 class="trend-sub__title">ERLEDIGT / KW</h4>
      <div class="month-chart">
        ${keys.map(k => `
          <div class="month-chart__col" title="${weekRangeTitle(k)}">
            <div class="month-chart__bar-wrap">
              <div class="month-chart__value">${dbw[k]}</div>
              <div class="month-chart__bar" style="height:${Math.max((dbw[k] / max) * 100, 6)}%"></div>
            </div>
            <div class="month-chart__label">${weekLabel(k)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ─── Done by Month ───────────────────────────────────
function renderDoneByMonth(data) {
  const dbm = data.done_by_month || {};
  const keys = Object.keys(dbm);
  if (!keys.length) return '';
  const max = Math.max(...keys.map(k => dbm[k]));

  return `
    <div class="trend-sub">
      <h4 class="trend-sub__title">ERLEDIGT / MONAT</h4>
      <div class="month-chart">
        ${keys.map(k => `
          <div class="month-chart__col">
            <div class="month-chart__bar-wrap">
              <div class="month-chart__value">${dbm[k]}</div>
              <div class="month-chart__bar" style="height:${Math.max((dbm[k] / max) * 100, 6)}%"></div>
            </div>
            <div class="month-chart__label">${monthLabel(k)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ─── Priority per status (status x priority bars) ────
// One horizontal bar per Bearbeitungsphase, segmented P0–P3 (+ Ohne),
// each row normalised to 100% — the tiles carry the absolute counts.
// Falls back to the old chip row for legacy snapshots without the field.
const PRIO_SEGMENTS = [
  { key: 'P0',   label: 'P0',   color: 'var(--danger)',    dark: true },
  { key: 'P1',   label: 'P1',   color: 'var(--warn)',      dark: true },
  { key: 'P2',   label: 'P2',   color: 'var(--secondary)', dark: true },
  { key: 'P3',   label: 'P3',   color: '#9aa7b4',          dark: true },
  { key: 'none', label: 'Ohne', color: 'var(--light-gray)', dark: false },
];
const PRIO_STATUS_ROWS = [
  { key: 'open',        label: 'Offen' },
  { key: 'in_progress', label: 'In Arbeit' },
  { key: 'blocked',     label: 'Blockiert' },
  { key: 'done',        label: 'Erledigt' },
];

function renderPriority(data) {
  const bsp = data.by_status_priority;
  if (!bsp) return renderPriorityChips(data);

  const rows = PRIO_STATUS_ROWS.map(row => {
    const dist = bsp[row.key] || {};
    const total = PRIO_SEGMENTS.reduce((s, seg) => s + (dist[seg.key] || 0), 0);
    const segs = total === 0
      ? '<div class="prio-bar__empty">keine Items</div>'
      : PRIO_SEGMENTS.map(seg => {
          const c = dist[seg.key] || 0;
          if (!c) return '';
          const pct = (c / total) * 100;
          return `<div class="prio-bar__seg ${seg.dark ? '' : 'prio-bar__seg--light'}"
                       style="flex-grow:${c};background:${seg.color}"
                       title="${row.label} · ${seg.label}: ${c}">${pct > 9 ? c : ''}</div>`;
        }).join('');
    return `
      <div class="prio-bar__label">${row.label}</div>
      <div class="prio-bar__count">${total}</div>
      <div class="prio-bar">${segs}</div>
    `;
  }).join('');

  const legend = PRIO_SEGMENTS.map(seg =>
    `<span class="status-legend__item"><span class="status-legend__dot" style="background:${seg.color}"></span>${seg.label}</span>`
  ).join('');

  return `
    <div class="status-section fade-in split-row__col">
      <h3 class="status-section__title">PRIORITÄT JE STATUS</h3>
      <div class="prio-grid">${rows}</div>
      <div class="status-legend">${legend}</div>
    </div>
  `;
}

// Legacy chip row (snapshots before by_status_priority existed)
function renderPriorityChips(data) {
  const p = data.by_priority || {};
  const order = ['P0', 'P1', 'P2', 'P3'];
  const total = order.reduce((s, k) => s + (p[k] || 0), 0) + (p.none || 0);
  if (!total) return '';

  return `
    <div class="status-section fade-in split-row__col">
      <h3 class="status-section__title">NACH PRIORITÄT</h3>
      <div class="prio-row">
        ${order.map(k => `
          <div class="prio-chip prio-chip--${k.toLowerCase()}">
            <span class="prio-chip__key">${k}</span>
            <span class="prio-chip__count">${p[k] || 0}</span>
          </div>
        `).join('')}
        ${p.none ? `<div class="prio-chip prio-chip--none"><span class="prio-chip__key">Ohne</span><span class="prio-chip__count">${p.none}</span></div>` : ''}
      </div>
    </div>
  `;
}

// ─── Area Card ───────────────────────────────────────
function renderAreaCard(area, prev) {
  const meta = areaMeta(area.name);
  const total = area.total || 1;
  const completionRate = Math.round((area.done / total) * 100);
  const donePct = (area.done / total) * 100;
  const progressPct = (area.in_progress / total) * 100;
  const blockedPct = (area.blocked / total) * 100;
  const openPct = (area.open / total) * 100;

  const prevArea = prev ? prev.areas.find(a => a.name === area.name) : null;
  const doneDelta = prevArea ? delta(area.done, prevArea.done) : null;
  const totalDelta = prevArea ? delta(area.total, prevArea.total) : null;

  const o = area.by_owner || {};

  return `
    <div class="area-card fade-in" data-area="${area.name}">
      <div class="area-card__header">
        <span class="area-card__emoji">${meta.emoji}</span>
        <span class="area-card__name">${area.name}</span>
        <span class="area-card__group-tag">${meta.group}</span>
      </div>
      <div class="area-card__stats">
        <div class="area-card__stat">
          <span class="area-card__stat-label">Items</span>
          <span class="area-card__stat-value">${area.total} ${deltaHtml(totalDelta)}</span>
        </div>
        <div class="area-card__stat">
          <span class="area-card__stat-label">Erledigungsquote</span>
          <span class="area-card__stat-value area-card__stat-value--rate ${completionRate >= 50 ? 'area-card__stat-value--good' : completionRate === 0 ? 'area-card__stat-value--warn' : ''}">${completionRate}%</span>
        </div>
        <div class="area-card__stat">
          <span class="area-card__stat-label">Blocked</span>
          <span class="area-card__stat-value ${area.blocked > 0 ? 'area-card__stat-value--warn' : ''}">${area.blocked}</span>
        </div>
        <div class="area-card__stat">
          <span class="area-card__stat-label">Claude/Either</span>
          <span class="area-card__stat-value">${(o.Claude || 0) + (o.Either || 0)}</span>
        </div>

        <div class="area-card__mini-bar">
          <div class="area-card__mini-bar-label">Status-Verteilung</div>
          <div class="mini-bar">
            <div class="mini-bar__seg mini-bar__seg--done" style="width:${donePct}%"></div>
            <div class="mini-bar__seg mini-bar__seg--progress" style="width:${progressPct}%"></div>
            <div class="mini-bar__seg mini-bar__seg--blocked" style="width:${blockedPct}%"></div>
            <div class="mini-bar__seg mini-bar__seg--open" style="width:${openPct}%"></div>
          </div>
          <div class="area-card__task-counts">
            <span class="area-card__task-count"><strong>${area.done}</strong> erledigt ${deltaHtml(doneDelta)}</span>
            <span class="area-card__task-count"><strong>${area.in_progress}</strong> aktiv</span>
            <span class="area-card__task-count"><strong>${area.open}</strong> offen</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── Projects Table (by repository) ──────────────────
function renderProjectsTable(data) {
  const projects = data.projects || [];
  if (!projects.length) return '';

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">NACH PROJEKT (REPOSITORY)</h3>
      <table class="proj-table">
        <thead>
          <tr><th>Repository</th><th>Items</th><th>Erledigt</th><th>In Arbeit</th><th>Offen</th><th>Blocked</th><th>Quote</th></tr>
        </thead>
        <tbody>
          ${projects.map(p => {
            const repoShort = p.name.includes('/') ? p.name.split('/')[1] : p.name;
            const rate = p.total ? Math.round((p.done / p.total) * 100) : 0;
            return `<tr>
              <td class="proj-table__name" title="${p.name}">${repoShort}</td>
              <td>${p.total}</td>
              <td>${p.done}</td>
              <td>${p.in_progress}</td>
              <td>${p.open}</td>
              <td class="${p.blocked > 0 ? 'proj-table__warn' : ''}">${p.blocked}</td>
              <td>${rate}%</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ─── Blocked reasons (below the projects table) ──────
// Shows Bereich + Grund per blocked item — never issue titles (public page,
// private repos). Missing Grund renders as a visible triage signal.
// Older snapshots without blocked_items simply skip the section.
function renderBlockedReasons(data) {
  const items = data.blocked_items;
  if (!Array.isArray(items) || items.length === 0) return '';

  const bullets = items.map(b => {
    const meta = areaMeta(b.bereich);
    const grund = b.grund
      ? escapeHtml(b.grund)
      : '<em class="blocked-list__open">Grund offen</em>';
    return `<li><span class="blocked-list__area">${meta.emoji} ${escapeHtml(b.bereich)}</span> — ${grund}</li>`;
  }).join('');

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">BLOCKIERT — GRÜNDE</h3>
      <ul class="blocked-list">${bullets}</ul>
    </div>
  `;
}

// Board text fields go through here before touching the DOM.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ─── Empty State ─────────────────────────────────────
function showEmpty() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="loading">
      Noch keine Snapshots vorhanden.<br>
      Starte den ersten Snapshot mit <code>python scripts/fetch_snapshot.py</code>
    </div>
  `;
}
