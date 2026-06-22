/**
 * KORODUR Space Health Dashboard v2
 * Loads daily JSON snapshots and renders KPIs, the trend chart, KPI sparklines,
 * a date timeline, the Executive Summary, Project Pipeline and Area Cards.
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
  const single = asc.length < 2;

  return `
    <div class="timeline fade-in">
      <div class="timeline__head">
        <span class="timeline__label">Zeitverlauf</span>
        <span class="timeline__current" id="timeline-current">${formatSnapshotLabel(currentKey)}</span>
      </div>
      <input type="range" class="timeline__slider" id="timeline-slider"
             min="0" max="${Math.max(0, asc.length - 1)}" step="1" value="${idx}"
             ${single ? 'disabled' : ''}
             oninput="previewTimeline(this.value)" onchange="scrubTimeline(this.value)"
             aria-label="Snapshot-Datum wählen">
      <div class="timeline__ends">
        <span>${asc.length ? formatSnapshotLabel(asc[0]) : ''}</span>
        <span>${single ? 'Verlauf baut sich täglich auf' : `${asc.length} Tage`}</span>
        <span>${asc.length ? formatSnapshotLabel(asc[asc.length - 1]) : ''}</span>
      </div>
    </div>
  `;
}

// Live label update while dragging (no fetch, keeps the drag smooth)
function previewTimeline(val) {
  const asc = [...availableSnapshots].reverse();
  const key = asc[parseInt(val, 10)];
  const el = document.getElementById('timeline-current');
  if (el && key) el.textContent = formatSnapshotLabel(key);
}

// Load the selected snapshot on release
function scrubTimeline(val) {
  const asc = [...availableSnapshots].reverse();
  const key = asc[parseInt(val, 10)];
  if (key) loadSnapshot(key);
}

// ─── Trend Chart (development over time) ─────────────
const TREND_METRICS = [
  { key: 'items',       label: 'Items gesamt', color: 'var(--primary)' },
  { key: 'open',        label: 'Offen',        color: '#9aa7b4' },
  { key: 'in_progress', label: 'In Arbeit',    color: 'var(--secondary)' },
  { key: 'done',        label: 'Erledigt',     color: 'var(--success)' },
  { key: 'blocked',     label: 'Blocked',      color: 'var(--warn)' },
];

function renderTrendChart() {
  const series = timeseries;
  if (!series || series.length < 2) {
    return `
      <div class="status-section fade-in">
        <h3 class="status-section__title">ENTWICKLUNG IM ZEITVERLAUF</h3>
        <p class="trend-empty">
          Die Verlaufskurve baut sich ab jetzt täglich auf. Ab dem zweiten
          Snapshot erscheinen hier die Linien für Items, Offen, In Arbeit,
          Erledigt und Blocked.
        </p>
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

    ${renderExecutiveSummary(data, prev)}

    <div class="kpi-row">
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Items gesamt</div>
        <div class="kpi-card__value kpi-card__value--accent">${t.items}</div>
        <div class="kpi-card__detail">${donePercent}% erledigt ${deltaHtml(delta(t.items, pt?.items))}</div>
        ${sparkline('items', 'var(--primary)')}
      </div>
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
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Offen</div>
        <div class="kpi-card__value">${t.open}</div>
        <div class="kpi-card__detail">Backlog + Ready ${deltaHtml(delta(t.open, pt?.open))}</div>
        ${sparkline('open', 'var(--muted)')}
      </div>
      <div class="kpi-card fade-in ${t.blocked > 0 ? 'kpi-card--warn' : ''}">
        <div class="kpi-card__label">Blocked</div>
        <div class="kpi-card__value ${t.blocked > 0 ? 'kpi-card__value--warn' : ''}">${t.blocked}</div>
        <div class="kpi-card__detail">Blockiert ${deltaHtml(delta(t.blocked, pt?.blocked))}</div>
        ${sparkline('blocked', 'var(--warn)')}
      </div>
    </div>

    ${renderTrendChart()}

    ${renderStatusBar(data, prev)}

    <div class="split-row">
      ${renderOwnerSplit(data)}
      ${renderDoneByMonth(data)}
    </div>

    ${renderPriority(data)}

    <h3 class="area-grid-title fade-in">BEREICHE</h3>
    <div class="area-grid">
      ${data.areas.filter(a => a.total > 0).map(a => renderAreaCard(a, prev)).join('')}
    </div>

    ${renderProjectsTable(data)}

    <div class="footer">
      KORODUR Work Cockpit Reporting &mdash; Generiert am ${new Date(data._meta.generated_at).toLocaleDateString('de-DE')}
      &mdash; <a href="https://github.com/KORODUR-International/korodur-reporting" target="_blank">GitHub</a>
    </div>
  `;
}

// ─── Executive Summary ───────────────────────────────
function renderExecutiveSummary(data, prev) {
  const highlights = [];
  const t = data.totals;
  const pt = prev ? prev.totals : null;

  if (pt) {
    const newDone = delta(t.done, pt.done);
    if (newDone > 0) highlights.push(`<strong>${newDone}</strong> Items seit letztem Snapshot erledigt`);
    const newItems = delta(t.items, pt.items);
    if (newItems > 0) highlights.push(`<strong>${newItems}</strong> neue Items im Backlog`);
  }

  // Done this month
  const months = Object.keys(data.done_by_month || {});
  if (months.length) {
    const last = months[months.length - 1];
    highlights.push(`<strong>${data.done_by_month[last]}</strong> Items erledigt in ${monthLabel(last)}`);
  }

  // Strongest area by done
  const real = data.areas.filter(a => a.name !== 'Nicht zugeordnet' && a.total > 0);
  const bestArea = [...real].sort((a, b) => b.done - a.done)[0];
  if (bestArea && bestArea.done > 0) {
    highlights.push(`Stärkster Bereich: <strong>${areaMeta(bestArea.name).emoji} ${bestArea.name}</strong> (${bestArea.done} erledigt)`);
  }

  // Blocked warning
  if (t.blocked > 0) {
    highlights.push(`<strong>${t.blocked}</strong> Items blockiert — brauchen Entscheidung`);
  }

  // Discarded (closed as "not planned")
  if ((t.discarded || 0) > 0) {
    highlights.push(`<strong>${t.discarded}</strong> Items verworfen (als „not planned" geschlossen) — zählen nicht als erledigt`);
  }

  // Untriaged
  const untriaged = data.areas.find(a => a.name === 'Nicht zugeordnet');
  if (untriaged && untriaged.total > 0) {
    highlights.push(`<strong>${untriaged.total}</strong> Items noch nicht zugeordnet (Triage offen)`);
  }

  // Claude share
  const o = data.by_owner || {};
  const ownerTotal = (o.Human || 0) + (o.Claude || 0) + (o.Either || 0);
  if (ownerTotal > 0) {
    const claudePct = Math.round((((o.Claude || 0) + (o.Either || 0)) / ownerTotal) * 100);
    highlights.push(`<strong>${claudePct}%</strong> der zugewiesenen Items sind Claude-fähig (Claude/Either)`);
  }

  if (t.items > 0) {
    highlights.push(`Gesamt-Erledigungsquote: <strong>${Math.round((t.done / t.items) * 100)}%</strong>`);
  }

  if (highlights.length === 0) return '';

  return `
    <div class="executive-summary fade-in">
      <div class="executive-summary__icon">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M10 2L12.5 7.5L18 8.5L14 12.5L15 18L10 15.5L5 18L6 12.5L2 8.5L7.5 7.5L10 2Z" fill="currentColor"/>
        </svg>
      </div>
      <div class="executive-summary__content">
        <div class="executive-summary__title">Highlights</div>
        <ul class="executive-summary__list">
          ${highlights.map(h => `<li>${h}</li>`).join('')}
        </ul>
      </div>
    </div>
  `;
}

// ─── Status Bar (overall) ────────────────────────────
function renderStatusBar(data, prev) {
  const t = data.totals;
  const pt = prev ? prev.totals : null;
  const total = t.items;
  if (!total) return '';

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">ITEMS NACH STATUS</h3>
      <div class="status-bar">
        ${barSegment(t.open, total, 'todo', `${t.open} Offen`)}
        ${barSegment(t.in_progress, total, 'progress', `${t.in_progress} In Arbeit`)}
        ${barSegment(t.blocked, total, 'blocked', `${t.blocked} Blocked`)}
        ${barSegment(t.done, total, 'done', `${t.done} Erledigt`)}
        ${barSegment(t.discarded || 0, total, 'discarded', `${t.discarded} Verworfen`)}
      </div>
      <div class="status-legend">
        <span class="status-legend__item"><span class="status-legend__dot" style="background:var(--mid-gray)"></span>Offen: ${t.open} ${deltaHtml(delta(t.open, pt?.open))}</span>
        <span class="status-legend__item"><span class="status-legend__dot" style="background:var(--secondary)"></span>In Arbeit: ${t.in_progress} ${deltaHtml(delta(t.in_progress, pt?.in_progress))}</span>
        <span class="status-legend__item"><span class="status-legend__dot" style="background:var(--warn)"></span>Blocked: ${t.blocked} ${deltaHtml(delta(t.blocked, pt?.blocked))}</span>
        <span class="status-legend__item"><span class="status-legend__dot" style="background:var(--success)"></span>Erledigt: ${t.done} ${deltaHtml(delta(t.done, pt?.done))}</span>
        ${(t.discarded || 0) > 0 ? `<span class="status-legend__item"><span class="status-legend__dot" style="background:var(--danger)"></span>Verworfen: ${t.discarded} ${deltaHtml(delta(t.discarded, pt?.discarded))}</span>` : ''}
      </div>
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

// ─── Done by Month ───────────────────────────────────
function renderDoneByMonth(data) {
  const dbm = data.done_by_month || {};
  const keys = Object.keys(dbm);
  if (!keys.length) return '';
  const max = Math.max(...keys.map(k => dbm[k]));

  return `
    <div class="status-section fade-in split-row__col">
      <h3 class="status-section__title">ERLEDIGT / MONAT</h3>
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

// ─── Priority breakdown ──────────────────────────────
function renderPriority(data) {
  const p = data.by_priority || {};
  const order = ['P0', 'P1', 'P2', 'P3'];
  const total = order.reduce((s, k) => s + (p[k] || 0), 0) + (p.none || 0);
  if (!total) return '';

  return `
    <div class="status-section fade-in">
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

// ─── Status Bar Segment Helper ───────────────────────
function barSegment(count, total, type, label) {
  if (!count) return '';
  const pct = Math.max((count / total) * 100, 4);
  return `<div class="status-bar__segment status-bar__segment--${type}" style="width:${pct}%">${pct > 8 ? label : ''}</div>`;
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
