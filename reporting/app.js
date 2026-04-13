/**
 * KORODUR Space Health Dashboard v2
 * Loads weekly JSON snapshots and renders KPIs, Trends, Executive Summary,
 * Project Pipeline and Area Cards.
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
let availableSnapshots = [];

// ─── Init ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await discoverSnapshots();
  if (availableSnapshots.length > 0) {
    await loadSnapshot(availableSnapshots[0]);
  } else {
    showEmpty();
  }
});

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
  if (key.includes('-W')) {
    const [year, weekPart] = key.split('-W');
    return `KW ${parseInt(weekPart, 10)} ${year}`;
  }
  const [year, month] = key.split('-');
  return `${MONTHS_DE[parseInt(month, 10) - 1]} ${year}`;
}

function updateHeaderMeta(key) {
  const el = document.getElementById('header-meta');
  if (!el || !currentSnapshot) return;
  el.textContent = `Snapshot: ${formatSnapshotLabel(key)}`;
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

// ─── Render Dashboard ────────────────────────────────
function renderDashboard(data, prev) {
  const main = document.getElementById('main');
  const t = data.totals;
  const pt = prev ? prev.totals : null;
  const tasksDonePercent = t.tasks > 0 ? Math.round((t.tasks_done / t.tasks) * 100) : 0;

  main.innerHTML = `
    <!-- Snapshot Title -->
    <div class="snapshot-header fade-in">
      <h1 class="snapshot-header__title">SPACE HEALTH DASHBOARD</h1>
      <p class="snapshot-header__sub">
        KORODUR Notion Workspace &mdash; ${data._meta.snapshot_date}
        ${data._meta.demo ? ' <span class="header__badge">DEMO-DATEN</span>' : ''}
      </p>
    </div>

    <!-- Executive Summary -->
    ${renderExecutiveSummary(data, prev)}

    <!-- KPI Row -->
    <div class="kpi-row">
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Areas</div>
        <div class="kpi-card__value kpi-card__value--accent">${t.areas}</div>
        <div class="kpi-card__detail">Verantwortungsbereiche ${deltaHtml(delta(t.areas, pt?.areas))}</div>
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Projekte</div>
        <div class="kpi-card__value">${t.projects}</div>
        <div class="kpi-card__detail">${data.projects_by_status.erledigt || 0} abgeschlossen ${deltaHtml(delta(t.projects, pt?.projects))}</div>
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Aufgaben</div>
        <div class="kpi-card__value">${t.tasks}</div>
        <div class="kpi-card__detail">${tasksDonePercent}% erledigt ${deltaHtml(delta(t.tasks_done, pt?.tasks_done))}</div>
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Datenbanken</div>
        <div class="kpi-card__value">${t.databases}</div>
        <div class="kpi-card__detail">Wissensbasis ${deltaHtml(delta(t.databases, pt?.databases))}</div>
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Prozesse</div>
        <div class="kpi-card__value">${t.processes}</div>
        <div class="kpi-card__detail">Dokumentiert ${deltaHtml(delta(t.processes, pt?.processes))}</div>
      </div>
    </div>

    <!-- Project Pipeline -->
    ${renderProjectPipeline(data)}

    <!-- Task Status -->
    ${renderTaskStatus(data, prev)}

    <!-- Areas: Marketing -->
    <h3 class="area-grid-title fade-in">MARKETING</h3>
    <div class="area-grid">
      ${data.areas.filter(a => a.group === 'Marketing').map(a => renderAreaCard(a, prev)).join('')}
    </div>

    <!-- Areas: Strategie -->
    <h3 class="area-grid-title fade-in">STRATEGIE</h3>
    <div class="area-grid">
      ${data.areas.filter(a => a.group === 'Strategie').map(a => renderAreaCard(a, prev)).join('')}
    </div>

    <!-- Footer -->
    <div class="footer">
      KORODUR Space Health Dashboard &mdash; Generiert am ${new Date(data._meta.generated_at).toLocaleDateString('de-DE')}
      &mdash; <a href="https://github.com/korodur/Korodur-Reporting" target="_blank">GitHub</a>
    </div>
  `;
}

// ─── Executive Summary ───────────────────────────────
function renderExecutiveSummary(data, prev) {
  const highlights = [];
  const t = data.totals;
  const pt = prev ? prev.totals : null;

  if (pt) {
    const newTasks = delta(t.tasks_done, pt.tasks_done);
    if (newTasks > 0) highlights.push(`<strong>${newTasks}</strong> Aufgaben seit letztem Snapshot erledigt`);

    const newProjects = delta(t.projects, pt.projects);
    if (newProjects > 0) highlights.push(`<strong>${newProjects}</strong> neue Projekte hinzugekommen`);
    if (newProjects < 0) highlights.push(`<strong>${Math.abs(newProjects)}</strong> Projekte konsolidiert`);

    const newDBs = delta(t.databases, pt.databases);
    if (newDBs > 0) highlights.push(`<strong>${newDBs}</strong> neue Datenbanken aufgebaut`);
  }

  // Best performing area (highest done count)
  const bestArea = [...data.areas].sort((a, b) => b.tasks.done - a.tasks.done)[0];
  if (bestArea && bestArea.tasks.done > 0) {
    highlights.push(`St\u00e4rkster Bereich: <strong>${bestArea.emoji} ${bestArea.name}</strong> (${bestArea.tasks.done} erledigte Aufgaben)`);
  }

  // Area needing attention (most open tasks, zero done)
  const attentionArea = data.areas
    .filter(a => a.tasks.done === 0 && a.tasks.open > 0)
    .sort((a, b) => b.tasks.open - a.tasks.open)[0];
  if (attentionArea) {
    highlights.push(`Aufmerksamkeit: <strong>${attentionArea.emoji} ${attentionArea.name}</strong> &mdash; ${attentionArea.tasks.open} offene Aufgaben, 0 erledigt`);
  }

  // Overall completion rate
  if (t.tasks > 0) {
    const rate = Math.round((t.tasks_done / t.tasks) * 100);
    highlights.push(`Gesamt-Erledigungsquote: <strong>${rate}%</strong>`);
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

// ─── Project Pipeline ────────────────────────────────
function renderProjectPipeline(data) {
  const s = data.projects_by_status;
  const total = data.totals.projects;
  if (!total) return '';

  const stages = [
    { key: 'idee',            label: 'Idee',            count: s.idee || 0 },
    { key: 'konzept',         label: 'Konzept',         count: s.konzept || 0 },
    { key: 'geplant',         label: 'Geplant',         count: s.geplant || 0 },
    { key: 'in_bearbeitung',  label: 'In Bearbeitung',  count: (s.in_bearbeitung || 0) + (s.laufend || 0) },
    { key: 'in_review',       label: 'Review',          count: s.in_review || 0 },
    { key: 'erledigt',        label: 'Erledigt',        count: s.erledigt || 0 },
  ];

  // Pending/Stopp as separate info
  const paused = (s.stopp || 0) + (s.pending || 0);

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">PROJEKT-PIPELINE</h3>
      <div class="pipeline">
        ${stages.map((stage, i) => `
          <div class="pipeline__stage pipeline__stage--${stage.key}">
            <div class="pipeline__count">${stage.count}</div>
            <div class="pipeline__label">${stage.label}</div>
            ${i < stages.length - 1 ? '<div class="pipeline__arrow"><svg width="20" height="20" viewBox="0 0 20 20"><path d="M7 4l6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' : ''}
          </div>
        `).join('')}
      </div>
      ${paused > 0 ? `<div class="pipeline__paused">${paused} Projekte pausiert (Stopp/Pending)</div>` : ''}
    </div>
  `;
}

// ─── Task Status Bar ─────────────────────────────────
function renderTaskStatus(data, prev) {
  const t = data.totals;
  const pt = prev ? prev.totals : null;
  const total = t.tasks;
  if (!total) return '';

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">AUFGABEN NACH STATUS</h3>
      <div class="status-bar">
        ${barSegment(t.tasks_open, total, 'todo', `${t.tasks_open} Offen`)}
        ${barSegment(t.tasks_in_progress, total, 'progress', `${t.tasks_in_progress} Aktiv`)}
        ${barSegment(t.tasks_done, total, 'done', `${t.tasks_done} Erledigt`)}
      </div>
      <div class="status-legend">
        <span class="status-legend__item"><span class="status-legend__dot" style="background:var(--mid-gray)"></span>Offen: ${t.tasks_open} ${deltaHtml(delta(t.tasks_open, pt?.tasks_open))}</span>
        <span class="status-legend__item"><span class="status-legend__dot" style="background:var(--secondary)"></span>In Arbeit: ${t.tasks_in_progress} ${deltaHtml(delta(t.tasks_in_progress, pt?.tasks_in_progress))}</span>
        <span class="status-legend__item"><span class="status-legend__dot" style="background:var(--success)"></span>Erledigt: ${t.tasks_done} ${deltaHtml(delta(t.tasks_done, pt?.tasks_done))}</span>
      </div>
    </div>
  `;
}

// ─── Status Bar Segment Helper ───────────────────────
function barSegment(count, total, type, label) {
  if (!count) return '';
  const pct = Math.max((count / total) * 100, 5);
  return `<div class="status-bar__segment status-bar__segment--${type}" style="width:${pct}%">${pct > 8 ? label : ''}</div>`;
}

// ─── Area Card ───────────────────────────────────────
function renderAreaCard(area, prev) {
  const p = area.projects;
  const t = area.tasks;
  const taskTotal = t.total || 1;
  const completionRate = Math.round((t.done / taskTotal) * 100);

  const openPct = (t.open / taskTotal) * 100;
  const progressPct = (t.in_progress / taskTotal) * 100;
  const donePct = (t.done / taskTotal) * 100;

  // Find previous area data for delta
  const prevArea = prev ? prev.areas.find(a => a.name === area.name) : null;
  const tasksDelta = prevArea ? delta(t.done, prevArea.tasks.done) : null;
  const projectsDelta = prevArea ? delta(p.total, prevArea.projects.total) : null;

  return `
    <div class="area-card fade-in" data-area="${area.name}">
      <div class="area-card__header">
        <span class="area-card__emoji">${area.emoji}</span>
        <span class="area-card__name">${area.name}</span>
        <span class="area-card__group-tag">${area.group}</span>
      </div>
      <div class="area-card__stats">
        <div class="area-card__stat">
          <span class="area-card__stat-label">Projekte</span>
          <span class="area-card__stat-value">${p.total} ${deltaHtml(projectsDelta)}</span>
        </div>
        <div class="area-card__stat">
          <span class="area-card__stat-label">Aufgaben</span>
          <span class="area-card__stat-value">${t.total}</span>
        </div>
        <div class="area-card__stat">
          <span class="area-card__stat-label">Erledigungsquote</span>
          <span class="area-card__stat-value area-card__stat-value--rate ${completionRate >= 50 ? 'area-card__stat-value--good' : completionRate === 0 ? 'area-card__stat-value--warn' : ''}">${completionRate}%</span>
        </div>
        <div class="area-card__stat">
          <span class="area-card__stat-label">Prozesse</span>
          <span class="area-card__stat-value">${area.processes}</span>
        </div>

        <div class="area-card__mini-bar">
          <div class="area-card__mini-bar-label">Aufgaben-Fortschritt</div>
          <div class="mini-bar">
            <div class="mini-bar__seg mini-bar__seg--done" style="width:${donePct}%"></div>
            <div class="mini-bar__seg mini-bar__seg--progress" style="width:${progressPct}%"></div>
            <div class="mini-bar__seg mini-bar__seg--open" style="width:${openPct}%"></div>
          </div>
          <div class="area-card__task-counts">
            <span class="area-card__task-count"><strong>${t.done}</strong> erledigt ${deltaHtml(tasksDelta)}</span>
            <span class="area-card__task-count"><strong>${t.in_progress}</strong> aktiv</span>
            <span class="area-card__task-count"><strong>${t.open}</strong> offen</span>
          </div>
        </div>
      </div>
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
