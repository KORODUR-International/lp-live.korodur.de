/**
 * KORODUR Work Cockpit Reporting v3
 * Umbau #181 nach dem in #149 gelockten Ziel-Layout (16.08.2026):
 * Kopfzahlen mit Delta-Chips (Vortag/Vorwoche), Phasen-Repo-Matrix,
 * Mini-Chart je Phase (KW-Endstand), Bereichs-Zeile und Owner-Split im
 * Fuss. Grundsatz: nur Zaehlungen, keine Issue-Titel, keine Freitexte.
 */

// In dev: symlink src/data -> ../data; in production (GitHub Pages): data/ is at root
const SNAPSHOTS_DIR = 'data/snapshots/';

const MONTHS_DE = [
  'Januar','Februar','März','April','Mai','Juni',
  'Juli','August','September','Oktober','November','Dezember'
];

// ─── State ───────────────────────────────────────────
let currentSnapshot = null;
let availableSnapshots = [];   // newest-first (index.json order)
let timeseries = [];           // ascending by date; drives head deltas + phase charts

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

// ─── Timeseries (compact per-day totals + phases) ────
async function loadTimeseries() {
  try {
    const res = await fetch(SNAPSHOTS_DIR + 'timeseries.json');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        timeseries = data.filter(r => r && r.date).sort((a, b) => a.date.localeCompare(b.date));
      }
    }
  } catch { /* deltas and phase charts simply stay hidden */ }
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
      const key = isoWeekKey(d.toISOString().slice(0, 10));
      if (key && !candidates.includes(key)) candidates.push(key);
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

    document.querySelectorAll('.sidebar__item').forEach(el => {
      el.classList.toggle('active', el.dataset.key === key);
    });

    renderDashboard(currentSnapshot);
    updateHeaderMeta(key);
    loadSegmentStrip();
  } catch (err) {
    main.innerHTML = `<div class="loading">Fehler beim Laden: ${err.message}</div>`;
  }
}

// ─── Sidebar: Snapshot-Archiv, nach KW gruppiert ─────
// Der Tages-Slider ist raus (#181): Default ist der neueste Stand, das
// Archiv bleibt als eingeklappte KW-Gruppen erreichbar.
function renderSidebar() {
  const list = document.getElementById('snapshot-list');
  if (!list) return;

  if (availableSnapshots.length === 0) {
    list.innerHTML = '<li style="padding:20px;color:var(--muted);font-size:.85rem;">Keine Snapshots vorhanden</li>';
    return;
  }

  const gruppen = [];
  for (const key of availableSnapshots) {           // newest-first
    const kw = isoWeekKey(key) || 'Archiv';
    if (!gruppen.length || gruppen[gruppen.length - 1].kw !== kw) {
      gruppen.push({ kw, keys: [] });
    }
    gruppen[gruppen.length - 1].keys.push(key);
  }

  list.innerHTML = gruppen.map((g, gi) => `
    <li>
      <details class="sidebar__group" ${gi === 0 ? 'open' : ''}>
        <summary class="sidebar__group-head" title="${g.kw.includes('-W') ? weekRangeTitle(g.kw) : g.kw}">
          ${g.kw.includes('-W') ? weekLabel(g.kw) + ' ' + g.kw.slice(0, 4) : g.kw}
          <span class="sidebar__group-count">${g.keys.length}</span>
        </summary>
        <ul class="sidebar__group-list">
          ${g.keys.map(key => `
            <li>
              <a class="sidebar__item ${key === availableSnapshots[0] ? 'active' : ''}"
                 data-key="${key}" onclick="loadSnapshot('${key}')">
                ${formatSnapshotLabel(key)}
                ${key === availableSnapshots[0] ? '<span class="sidebar__item-date">Aktuell</span>' : ''}
              </a>
            </li>`).join('')}
        </ul>
      </details>
    </li>`).join('');
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

// Short label for chips/tooltips (e.g. "17.06.")
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

// ─── ISO calendar week helpers ───────────────────────
// ISO week key for a date string, e.g. "2026-08-16" -> "2026-W33".
// Thursday trick: the ISO year/week of a date is that of its Thursday.
function isoWeekKey(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function weekLabel(key) {
  // key: YYYY-Www -> "KW 25"
  const w = parseInt(key.split('-W')[1], 10);
  return `KW ${w}`;
}

// Monday of an ISO week (UTC); week 1 is the week containing Jan 4th.
function isoWeekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Dow + (week - 1) * 7);
  return monday;
}

// Tooltip text for a week, e.g. "KW 25 · 16.06. bis 22.06.2026"
function weekRangeTitle(key) {
  const [y, w] = key.split('-W').map(Number);
  const mon = isoWeekMonday(y, w);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const dm = d => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.`;
  return `KW ${w} · ${dm(mon)} bis ${dm(sun)}${sun.getUTCFullYear()}`;
}

// ─── Area display meta (emoji) ───────────────────────
const AREA_META = {
  'Marketing':              { emoji: '📣' },
  'CRM & Sales Ops':        { emoji: '📊' },
  'Internationalisierung':  { emoji: '🌍' },
  'Wissensaufbau':          { emoji: '📚' },
  'AI & Infrastruktur':     { emoji: '🤖' },
  'Strategie':              { emoji: '🎯' },
  'Redaktion':              { emoji: '📝' },
  'Nicht zugeordnet':       { emoji: '❓' },
};
function areaMeta(name) {
  return AREA_META[name] || { emoji: '📁' };
}

const MONTHS_SHORT_DE = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${MONTHS_SHORT_DE[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

// ─── Kopfzahlen (Kernzahlen + Delta-Chips) ───────────
// Board-Phasen in Board-Reihenfolge, ohne Done: Grundlage fuer Matrix und
// Mini-Charts. On Hold gehoert bewusst NICHT in den Kopf (#149 Punkt 4).
const PHASEN = ['Backlog', 'Bereit', 'Beansprucht', 'In Progress', 'In Review', 'Blocked', 'On Hold'];

// Kernzahlen aus einer Phasenverteilung + Bestandssummen. `null` heisst:
// diese Phase gab es zum Zeitpunkt der Quelle nicht (Statusmodell-Bruch),
// die Kachel bzw. der Chip entfaellt dann, statt 0 vorzutaeuschen.
function kopfWerte(bs, totals) {
  bs = bs || {};
  const val = k => (k in bs ? bs[k] : null);
  const inArbeit = ('In Progress' in bs || 'Beansprucht' in bs)
    ? (bs['In Progress'] || 0) + (bs['Beansprucht'] || 0)
    : null;
  return {
    blockiert: val('Blocked'),
    inReview: val('In Review'),
    bereit: val('Bereit'),
    inArbeit,
    aktiv: totals && totals.items != null
      ? totals.items - (totals.done || 0) - (totals.discarded || 0)
      : null,
  };
}

// Referenzzeilen fuer die Delta-Chips: der vorige Snapshot-Tag und der
// letzte Stand mindestens 7 Tage vor dem angezeigten Datum. Fehlen Tage
// (Snapshot-Luecken), wird die Referenz aelter, nie juenger; der Tooltip
// nennt das echte Referenzdatum.
function deltaRefs(dateStr) {
  const idx = timeseries.findIndex(r => r.date === dateStr);
  const vortag = idx > 0 ? timeseries[idx - 1] : null;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d)) return { vortag, vorwoche: null };
  d.setUTCDate(d.getUTCDate() - 7);
  const grenze = d.toISOString().slice(0, 10);
  let vorwoche = null;
  for (const r of timeseries) {
    if (r.date <= grenze) vorwoche = r; else break;
  }
  return { vortag, vorwoche };
}

function chipHtml(diff, art, refDatum, invert) {
  if (diff == null) return '';
  const sign = diff > 0 ? '+' : '';
  const gut = invert ? diff < 0 : diff > 0;
  const cls = diff === 0 ? 'delta--neutral' : (gut ? 'delta--up' : 'delta--down');
  const was = art === 'T' ? 'Vortag' : 'Vorwoche';
  return `<span class="delta ${cls}" title="gegen ${was} (${shortDayLabel(refDatum)})">${sign}${diff} ${art}</span>`;
}

function renderKopf(data) {
  const t = data.totals || {};
  const cur = kopfWerte(data.by_status, t);
  const datum = data._meta && data._meta.snapshot_date;
  const { vortag, vorwoche } = deltaRefs(datum || '');
  const refT = vortag ? kopfWerte(vortag.by_status, vortag) : null;
  const refW = vorwoche ? kopfWerte(vorwoche.by_status, vorwoche) : null;

  const chips = (key, invert) => {
    if (cur[key] == null) return '';
    const a = refT && refT[key] != null ? chipHtml(cur[key] - refT[key], 'T', vortag.date, invert) : '';
    const b = refW && refW[key] != null ? chipHtml(cur[key] - refW[key], 'W', vorwoche.date, invert) : '';
    return a + b;
  };

  // Erledigt in der KW des angezeigten Standes, Delta gegen die Vorwoche.
  const kw = isoWeekKey(datum);
  let erledigt = null, erledigtChip = '', kwNr = '';
  if (kw && data.done_by_week) {
    erledigt = data.done_by_week[kw] || 0;
    kwNr = String(parseInt(kw.split('-W')[1], 10));
    const dV = new Date(datum + 'T00:00:00Z');
    dV.setUTCDate(dV.getUTCDate() - 7);
    const vorDatum = dV.toISOString().slice(0, 10);
    const kwVor = isoWeekKey(vorDatum);
    if (kwVor) {
      erledigtChip = chipHtml(erledigt - (data.done_by_week[kwVor] || 0), 'W', vorDatum);
    }
  }

  const kachel = (label, wert, opts = {}) => wert == null ? '' : `
      <div class="kpi-card kpi-card--k ${opts.warn && wert > 0 ? 'kpi-card--warn' : ''} fade-in">
        <div class="kpi-card__label">${label}</div>
        <div class="kpi-card__value ${opts.warn && wert > 0 ? 'kpi-card__value--warn' : ''}${opts.accent ? ' kpi-card__value--accent' : ''}">${wert}</div>
        <div class="kpi-card__detail">${opts.detail || ''}${opts.chips || ''}</div>
      </div>`;

  // Alte Snapshots tragen im source-String ein Em-Dash (U+2014); seit #181
  // schreibt der Fetcher einen Mittelpunkt. Fuer die Anzeige normalisieren.
  const quelle = ((data._meta && data._meta.source) || 'KORODUR Work Cockpit').replace(/\u2014/g, '·');
  const zeit = data._meta && data._meta.generated_at
    ? new Date(data._meta.generated_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '';
  const inArbeitDetail = data.by_status && 'Beansprucht' in data.by_status
    ? 'In Progress + Beansprucht' : 'In Progress';

  return `
    <div class="kopf fade-in">
      <h1 class="kopf__titel">Reporting</h1>
      <p class="kopf__stand">Stand ${formatSnapshotLabel(datum || '')}${zeit ? ', ' + zeit + ' Uhr' : ''} · ${quelle}</p>
    </div>
    <div class="kpi-row kpi-row--kopf">
      ${kachel('Blockiert', cur.blockiert, { warn: true, chips: chips('blockiert', true) })}
      ${kachel('In Review', cur.inReview, { chips: chips('inReview') })}
      ${kachel('Bereit', cur.bereit, { chips: chips('bereit') })}
      ${kachel('In Arbeit', cur.inArbeit, { detail: inArbeitDetail + ' ', chips: chips('inArbeit') })}
      ${kachel(kwNr ? 'Erledigt / KW ' + kwNr : 'Erledigt / KW', erledigt, { chips: erledigtChip })}
      ${kachel('Aktiv gesamt', cur.aktiv, { accent: true, detail: 'ohne Done und Verworfen ', chips: chips('aktiv') })}
    </div>
  `;
}

// ─── Phasen-Repo-Matrix ──────────────────────────────
// Spalten: Repos mit aktiven Issues, Kuerzel mit vollem Namen im Tooltip.
// Zeilen: alle Phasen in Board-Reihenfolge inkl. On Hold (ohne Warnfarbe)
// und ohne Done. "Aktiv" heisst ohne Done und Verworfen (#149 Punkt 5).
const REPO_KUERZEL = {
  'KORODUR-International/korodur-review-reporting': 'rr',
  'KORODUR-International/korodur-operating-model': 'om',
  'sfleischmann-3steps2/KORODUR-Website': 'ws',
  'KORODUR-International/korodur-referenzverzeichnis': 'rf',
  'KORODUR-International/korodur-crm': 'crm',
  'KORODUR-International/korodur-produktdatenbank': 'pd',
  'KORODUR-International/korodur-lokale-ki': 'ki',
  'KORODUR-International/korodur-redaktion': 'red',
  'KORODUR-International/korodur-translation': 'tr',
  'KORODUR-International/korodur-skills': 'sk',
  'KORODUR-International/korodur-tds-output': 'tds',
  'KORODUR-International/korodur-ausschreibungstexte': 'at',
  'KORODUR-International/korodur-rapidset': 'rs',
  'KORODUR-International/korodur-military': 'mil',
  '(Draft / kein Repo)': 'dr',
};

function repoKuerzel(name) {
  if (REPO_KUERZEL[name]) return REPO_KUERZEL[name];
  // Fallback fuer neue Repos: Kurzform aus dem Namen; das Kuerzel hier
  // nachpflegen, sobald ein Repo dazukommt. Tooltip traegt immer den
  // vollen Namen.
  const kurz = (name.split('/').pop() || name).replace(/^korodur-/i, '');
  return kurz.slice(0, 3).toLowerCase();
}

function projektAktiv(p) {
  return p.total - (p.done || 0) - (p.discarded || 0);
}

function renderMatrix(data) {
  const projekte = (data.projects || []).filter(p => p && p.by_status);
  if (!projekte.length) {
    return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">PHASEN JE REPO</h3>
      <p class="matrix__hinweis">Die Phasen-Matrix gibt es ab Snapshot v3 (16.08.2026). Dieser Snapshot ist älter; die Kopfzahlen und der Zeitverlauf gelten weiter.</p>
    </div>`;
  }

  const spalten = projekte.filter(p => projektAktiv(p) > 0)
    .sort((a, b) => projektAktiv(b) - projektAktiv(a));
  const ohneStatus = spalten.some(p => (p.by_status.none || 0) > 0);
  const zeilen = ohneStatus ? [...PHASEN, 'none'] : PHASEN;

  const kopf = `<tr><th class="matrix__phase"></th>${spalten.map(p =>
    `<th class="matrix__repo" title="${p.name}">${repoKuerzel(p.name)}</th>`).join('')}<th class="matrix__summe">Summe</th></tr>`;

  const rows = zeilen.map(phase => {
    const werte = spalten.map(p => p.by_status[phase] || 0);
    const summe = werte.reduce((a, b) => a + b, 0);
    const label = phase === 'none' ? 'Ohne Status' : phase;
    const warn = phase === 'Blocked';
    return `<tr class="${warn ? 'matrix__zeile--warn' : ''}${phase === 'none' ? ' matrix__zeile--triage' : ''}">
      <th class="matrix__phase">${label}</th>
      ${werte.map(w => `<td>${w || ''}</td>`).join('')}
      <td class="matrix__summe">${summe}</td>
    </tr>`;
  }).join('');

  const gesamt = spalten.reduce((s, p) => s + projektAktiv(p), 0);
  const fuss = `<tr class="matrix__fuss">
    <th class="matrix__phase">Aktiv</th>
    ${spalten.map(p => `<td>${projektAktiv(p)}</td>`).join('')}
    <td class="matrix__summe">${gesamt}</td>
  </tr>`;

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">PHASEN JE REPO</h3>
      <div class="matrix-scroll">
        <table class="matrix">
          <thead>${kopf}</thead>
          <tbody>${rows}</tbody>
          <tfoot>${fuss}</tfoot>
        </table>
      </div>
      <p class="matrix__fussnote">Zahlen sind aktive Issues (ohne Done und Verworfen). Maus auf ein Kürzel zeigt das Repo.</p>
    </div>
  `;
}

// ─── Zeitverlauf: Mini-Chart je Phase (KW-Endstand) ──
// Bestaende als Wochen-Endstand, nicht als Durchschnitt (#149 Punkt 6).
// Eine Serie beginnt an dem Tag, ab dem es die Phase gibt; Statusmodell-
// Brueche (Ready bis 31.07., On Hold ab 15.08.) werden nicht geglaettet.
function kwEndstaende() {
  const map = new Map();
  for (const r of timeseries) {
    const kw = isoWeekKey(r.date);
    if (kw) map.set(kw, r);        // letzte Zeile je KW gewinnt (aufsteigend sortiert)
  }
  return [...map.entries()].map(([kw, row]) => ({ kw, row }));
}

function miniChart(phase, punkte) {
  const W = 170, H = 44, pad = 4;
  const werte = punkte.map(p => p.wert);
  const max = Math.max(...werte, 1);
  const pts = werte.map((v, i) => {
    const x = pad + (werte.length > 1 ? i / (werte.length - 1) : 0.5) * (W - 2 * pad);
    const y = pad + (1 - v / max) * (H - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const letzt = punkte[punkte.length - 1];
  const farbe = phase === 'Blocked' ? 'var(--warn)'
    : phase === 'On Hold' ? 'var(--muted)' : 'var(--secondary)';
  const [lx, ly] = pts[pts.length - 1].split(',');

  return `
    <div class="phasen-chart" title="${phase}: ${weekLabel(punkte[0].kw)} bis ${weekLabel(letzt.kw)}, Wochen-Endstand">
      <div class="phasen-chart__kopf">
        <span class="phasen-chart__name">${phase}</span>
        <span class="phasen-chart__wert${phase === 'Blocked' && letzt.wert > 0 ? ' phasen-chart__wert--warn' : ''}">${letzt.wert}</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${pts.join(' ')}" fill="none" stroke-width="2"
                  stroke-linejoin="round" stroke-linecap="round" style="stroke:${farbe}"/>
        <circle cx="${lx}" cy="${ly}" r="2.6" style="fill:${farbe}"/>
      </svg>
      <div class="phasen-chart__achse"><span>${weekLabel(punkte[0].kw)}</span><span>${weekLabel(letzt.kw)}</span></div>
    </div>`;
}

function renderPhasenVerlauf(data) {
  const doneBars = renderDoneByWeek(data);
  const wochen = kwEndstaende();

  let charts = '';
  if (wochen.length >= 2) {
    charts = PHASEN.map(phase => {
      const punkte = wochen
        .filter(w => w.row.by_status && phase in w.row.by_status)
        .map(w => ({ kw: w.kw, wert: w.row.by_status[phase] }));
      return punkte.length >= 2 ? miniChart(phase, punkte) : '';
    }).join('');
  }

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">ZEITVERLAUF</h3>
      ${charts
        ? `<div class="phasen-grid">${charts}</div>`
        : '<p class="matrix__hinweis">Die Phasen-Kurven bauen sich mit den kommenden Wochen auf.</p>'}
      ${doneBars}
    </div>
  `;
}

// ─── Done by Calendar Week (KW) ──────────────────────
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

// ─── Done by Month (legacy fallback) ─────────────────
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

// ─── Bereichs-Zeile (kompakt statt Cards, #181) ──────
function renderBereichsZeile(data) {
  const aktive = (data.areas || [])
    .map(a => ({ ...a, aktiv: a.total - (a.done || 0) - (a.discarded || 0) }))
    .filter(a => a.aktiv > 0);
  if (!aktive.length) return '';

  return `
    <div class="bereiche-zeile fade-in">
      <span class="bereiche-zeile__titel">Bereiche</span>
      ${aktive.map(a => `
        <span class="bereiche-zeile__chip" title="${a.name}: ${a.aktiv} aktive Issues${a.blocked > 0 ? ', davon ' + a.blocked + ' blockiert' : ''}">
          ${areaMeta(a.name).emoji} ${a.name} <strong>${a.aktiv}</strong>${a.blocked > 0 ? `<span class="bereiche-zeile__warn" title="davon blockiert">${a.blocked}</span>` : ''}
        </span>`).join('')}
    </div>
  `;
}

// ─── Fuss: Owner-Split klein + Meta ──────────────────
function renderFuss(data) {
  const o = data.by_owner || {};
  const teile = [['Human', o.Human], ['Claude', o.Claude], ['Either', o.Either], ['Ohne', o.none]]
    .filter(([, n]) => n > 0);
  const split = teile.length
    ? `<span class="footer__split">Owner-Typ: ${teile.map(([l, n]) => `${l} <strong>${n}</strong>`).join(' · ')}</span><br>`
    : '';
  const generiert = data._meta && data._meta.generated_at
    ? ` · Generiert am ${new Date(data._meta.generated_at).toLocaleDateString('de-DE')}`
    : '';

  return `
    <div class="footer">
      ${split}
      KORODUR Work Cockpit Reporting${generiert}
      · <a href="https://github.com/KORODUR-International/korodur-review-reporting" target="_blank">GitHub</a>
    </div>
  `;
}

// ─── Render Dashboard ────────────────────────────────
function renderDashboard(data) {
  const main = document.getElementById('main');
  main.innerHTML = `
    ${renderKopf(data)}
    <div id="segment-strip"></div>
    ${renderMatrix(data)}
    ${renderPhasenVerlauf(data)}
    ${renderBereichsZeile(data)}
    ${renderFuss(data)}
  `;
}

// ─── Segment-Zeile (Fach-Segmente neben dem Board) ───
// Zeigt die Kernzahlen der Fach-Segmente, sofern schon Snapshots da sind.
// Jedes Segment laedt fuer sich: fehlt eine Datenquelle (Secret noch nicht
// gesetzt, Notion-Ausfall), faellt nur diese Karte weg, nie die ganze Zeile
// und nie die Board-Seite.
async function loadSegmentStrip() {
  const host = document.getElementById('segment-strip');
  if (!host) return;

  const karten = (await Promise.all([segRedaktion(), segReferenzen()])).filter(Boolean);
  if (!karten.length) return;

  host.innerHTML = `
    <div class="segment-strip fade-in">
      <div class="segment-strip__title">SEGMENTE</div>
      ${karten.join('')}
    </div>
  `;
}

// Neuesten Snapshot eines Segments holen. Fehlt etwas, gibt es null statt
// einer Ausnahme, damit ein Segment das andere nicht mitreisst.
async function segLatest(dir) {
  try {
    const idxRes = await fetch(dir + 'index.json');
    if (!idxRes.ok) return null;
    const keys = await idxRes.json();
    if (!Array.isArray(keys) || keys.length === 0) return null;
    const res = await fetch(dir + keys[0] + '.json');
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function segRedaktion() {
  const d = await segLatest('data/redaktion/');
  if (!d) return '';

  const [lo, hi] = d.puffer_ziel || [8, 12];
  const state = (d.puffer >= lo && d.puffer <= hi) ? 'ok'
    : (d.puffer >= Math.ceil(lo / 2) || d.puffer > hi) ? 'warn' : 'crit';
  const freq = (d.frequenz || {}).pro_woche_linkedin ?? 0;
  // Deutsches Dezimalkomma. Vor Issue #175 stand hier dauerhaft "0/Wo", der
  // englische Punkt war deshalb nie sichtbar.
  const dez = n => Number(n || 0).toLocaleString('de-DE',
    { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return `
    <a class="seg-card" href="redaktion.html">
      <span class="ampel ampel--${state}"></span>
      <span class="seg-card__name">📝 Redaktion</span>
      <span class="seg-card__kpi">Puffer <strong>${d.puffer}</strong> (Ziel ${lo} bis ${hi})</span>
      <span class="seg-card__kpi">Vorlauf <strong>${dez(d.vorlauf_wochen)} Wo</strong></span>
      <span class="seg-card__kpi">LinkedIn <strong>${dez(freq)}/Wo</strong></span>
      <span class="seg-card__kpi">In Pr&uuml;fung <strong>${(d.totals || {}).in_pruefung || 0}</strong></span>
      <span class="seg-card__link">Details &rarr;</span>
    </a>
  `;
}

async function segReferenzen() {
  const d = await segLatest('data/snapshots/referenzen/');
  if (!d) return '';

  const t = d.totals || {};
  const z = d.ziel || {};
  const ziel = z.zielwert || 0;
  const erarbeitet = z.ab_de_freigabe || 0;
  // Ampel am Jahresziel, nicht am Bestand: der Bestand ist ueberwiegend
  // Altbestand und sagt nichts ueber unseren Fortschritt.
  const state = !ziel ? 'warn'
    : erarbeitet >= ziel ? 'ok'
      : erarbeitet > 0 ? 'warn' : 'crit';

  return `
    <a class="seg-card" href="referenzen.html">
      <span class="ampel ampel--${state}"></span>
      <span class="seg-card__name">🏗️ Referenzen</span>
      <span class="seg-card__kpi">Jahresziel <strong>${erarbeitet}/${ziel}</strong> Prio&nbsp;A</span>
      <span class="seg-card__kpi">Bestand <strong>${d.gesamt ?? 0}</strong></span>
      <span class="seg-card__kpi">In Arbeit <strong>${t.in_arbeit || 0}</strong></span>
      <span class="seg-card__kpi">Datenschuld <strong>${(d.datenschuld || {}).eintraege_betroffen ?? 0}</strong></span>
      <span class="seg-card__link">Details &rarr;</span>
    </a>
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
