/* ============================================
   KORODUR Work Cockpit — Redaktion
   Rendert data/redaktion/<datum>.json (Tages-Aggregat des Notion-
   Redaktionsplans) + timeseries.json. Read-only, nur Aggregatzahlen —
   keine Beitragstitel, keine Personen (öffentliche Seite).
   In dev: symlink src/data -> ../data; in production: data/ liegt im Root.
   ============================================ */

const RED_DIR = 'data/redaktion/';

const RED_MONTHS_DE = [
  'Januar','Februar','März','April','Mai','Juni',
  'Juli','August','September','Oktober','November','Dezember'
];

// Funnel-Stufen in Prozess-Reihenfolge (docs/WORKFLOW.md korodur-redaktion)
const FUNNEL = [
  { key: 'ideen',       label: 'Ideen',        color: '#9aa7b4' },
  { key: 'in_arbeit',   label: 'In Arbeit',    color: 'var(--secondary)' },
  { key: 'in_pruefung', label: 'In Prüfung',   color: 'var(--warn)' },
  { key: 'freigegeben', label: 'Freigegeben',  color: '#8e6bb8' },
  { key: 'eingeplant',  label: 'Eingeplant',   color: 'var(--primary)' },
  { key: 'gepostet',    label: 'Gepostet',     color: 'var(--success)' },
];

let redSeries = [];

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const idxRes = await fetch(RED_DIR + 'index.json');
    if (!idxRes.ok) throw new Error('no-data');
    const keys = await idxRes.json();
    if (!Array.isArray(keys) || keys.length === 0) throw new Error('no-data');

    const snapRes = await fetch(RED_DIR + keys[0] + '.json');
    if (!snapRes.ok) throw new Error('no-data');
    const snap = await snapRes.json();

    try {
      const tsRes = await fetch(RED_DIR + 'timeseries.json');
      if (tsRes.ok) {
        const ts = await tsRes.json();
        if (Array.isArray(ts)) redSeries = ts.sort((a, b) => a.date.localeCompare(b.date));
      }
    } catch { /* Verlauf bleibt leer */ }

    renderRedaktion(snap);
    const meta = document.getElementById('header-meta');
    if (meta) meta.textContent = `Snapshot: ${redFormatDate(snap._meta.snapshot_date)}`;
  } catch {
    renderEmpty();
  }
});

function redFormatDate(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return key || '';
  return `${parseInt(m[3], 10)}. ${RED_MONTHS_DE[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

// ─── Ampel-Logik ─────────────────────────────────────
// Puffer: Ziel 8-12 freigegebene/eingeplante Beiträge.
function pufferState(puffer, ziel) {
  const [lo, hi] = ziel || [8, 12];
  if (puffer >= lo && puffer <= hi) return 'ok';
  if (puffer >= Math.ceil(lo / 2)) return 'warn';
  if (puffer > hi) return 'warn';
  return 'crit';
}
function ampelDot(state) {
  return `<span class="ampel ampel--${state}" aria-hidden="true"></span>`;
}

// ─── Render ──────────────────────────────────────────
function renderRedaktion(d) {
  const main = document.getElementById('main');
  const t = d.totals || {};
  const pState = pufferState(d.puffer, d.puffer_ziel);
  const freq = d.frequenz || {};

  main.innerHTML = `
    <div class="snapshot-header fade-in">
      <h1 class="snapshot-header__title">REDAKTION — SOCIAL MEDIA PIPELINE</h1>
      <p class="snapshot-header__sub">
        ${d._meta.source} &mdash; ${redFormatDate(d._meta.snapshot_date)}
      </p>
    </div>

    <div class="kpi-row">
      <div class="kpi-card fade-in ${pState === 'crit' ? 'kpi-card--warn' : ''}">
        <div class="kpi-card__label">${ampelDot(pState)} Puffer</div>
        <div class="kpi-card__value ${pState === 'crit' ? 'kpi-card__value--warn' : ''}">${d.puffer}</div>
        <div class="kpi-card__detail">Freigegeben + eingeplant &middot; Ziel ${(d.puffer_ziel || [8, 12]).join('&ndash;')}</div>
        ${redSparkline('puffer', 'var(--primary)')}
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Vorlauf</div>
        <div class="kpi-card__value">${d.vorlauf_wochen}<span class="kpi-card__unit"> Wo</span></div>
        <div class="kpi-card__detail">Terminierte Beitr&auml;ge voraus &middot; Ziel 8&ndash;12 Wochen</div>
        ${redSparkline('vorlauf_wochen', 'var(--secondary)')}
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Frequenz</div>
        <div class="kpi-card__value">${freq.pro_woche_linkedin ?? 0}<span class="kpi-card__unit">/Wo</span></div>
        <div class="kpi-card__detail">LinkedIn, &Oslash; letzte 4 Wochen &middot; Ziel ${(freq.ziel_linkedin || [2, 3]).join('&ndash;')}</div>
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">In Pr&uuml;fung</div>
        <div class="kpi-card__value">${t.in_pruefung || 0}</div>
        <div class="kpi-card__detail">Wartet auf die Anwendungstechnik</div>
        ${redSparkline('in_pruefung', 'var(--warn)')}
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Ideen-Vorrat</div>
        <div class="kpi-card__value">${t.ideen || 0}</div>
        <div class="kpi-card__detail">Offene Beitragsideen</div>
        ${redSparkline('ideen', '#9aa7b4')}
      </div>
    </div>

    ${renderFunnel(t)}
    ${renderRedTrend()}
    ${renderPostedByWeek(d)}
    ${renderKampagnen(d)}

    <div class="footer">
      Redaktions-Segment &mdash; Quelle: Notion-Redaktionsplan (nur Aggregatzahlen)
      &mdash; Generiert am ${new Date(d._meta.generated_at).toLocaleDateString('de-DE')}
      &mdash; <a href="https://github.com/KORODUR-International/korodur-operating-model" target="_blank">GitHub</a>
    </div>
  `;
}

// ─── Pipeline-Funnel ─────────────────────────────────
function renderFunnel(t) {
  const total = FUNNEL.reduce((s, f) => s + (t[f.key] || 0), 0);
  if (!total) return '';
  const segs = FUNNEL.map(f => {
    const c = t[f.key] || 0;
    if (!c) return '';
    const pct = (c / total) * 100;
    return `<div class="funnel__seg" style="flex-grow:${c};background:${f.color}"
                 title="${f.label}: ${c}">${pct > 6 ? c : ''}</div>`;
  }).join('');
  const legend = FUNNEL.map(f =>
    `<span class="status-legend__item"><span class="status-legend__dot" style="background:${f.color}"></span>${f.label}: ${t[f.key] || 0}</span>`
  ).join('');
  const verworfen = t.verworfen
    ? `<span class="funnel__discarded">+ ${t.verworfen} verworfen (z&auml;hlen nicht)</span>` : '';

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">PIPELINE — VON DER IDEE ZUM POST</h3>
      <div class="funnel">${segs}</div>
      <div class="status-legend">${legend}${verworfen}</div>
    </div>
  `;
}

// ─── Zeitverlauf ─────────────────────────────────────
const RED_TREND = [
  { key: 'puffer',      label: 'Puffer',      color: 'var(--primary)' },
  { key: 'in_pruefung', label: 'In Prüfung', color: 'var(--warn)' },
  { key: 'gepostet',    label: 'Gepostet',    color: 'var(--success)' },
  { key: 'ideen',       label: 'Ideen',       color: '#9aa7b4' },
];

function renderRedTrend() {
  if (!redSeries || redSeries.length < 2) {
    return `
      <div class="status-section fade-in">
        <h3 class="status-section__title">ENTWICKLUNG IM ZEITVERLAUF</h3>
        <p class="trend-empty">
          Die Verlaufskurve baut sich ab jetzt t&auml;glich auf. Ab dem zweiten
          Snapshot erscheinen hier Puffer, In Pr&uuml;fung, Gepostet und Ideen.
        </p>
      </div>
    `;
  }

  const W = 820, H = 280, padL = 34, padR = 18, padT = 16, padB = 30;
  const s = redSeries;
  const t0 = new Date(s[0].date).getTime();
  const tN = new Date(s[s.length - 1].date).getTime();
  const span = Math.max(1, tN - t0);
  const maxVal = Math.max(1, ...s.flatMap(r => RED_TREND.map(m => r[m.key] || 0)));
  const yMax = Math.ceil(maxVal * 1.1 / 5) * 5 || 5;
  const sx = d => padL + ((new Date(d).getTime() - t0) / span) * (W - padL - padR);
  const sy = v => padT + (1 - v / yMax) * (H - padT - padB);

  const grid = [0, 0.5, 1].map(f => {
    const v = Math.round(yMax * f);
    const y = sy(v);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="trend__grid"/>
            <text x="${padL - 6}" y="${y + 3}" class="trend__ytick">${v}</text>`;
  }).join('');

  const lines = RED_TREND.map(m => {
    const pts = s.map(r => `${sx(r.date).toFixed(1)},${sy(r[m.key] || 0).toFixed(1)}`).join(' ');
    const last = s[s.length - 1];
    return `
      <polyline points="${pts}" fill="none" stroke-width="2.5"
                stroke-linejoin="round" stroke-linecap="round" style="stroke:${m.color}"/>
      <circle cx="${sx(last.date).toFixed(1)}" cy="${sy(last[m.key] || 0).toFixed(1)}" r="3.2" style="fill:${m.color}"/>
    `;
  }).join('');

  const short = d => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(d); return m ? `${m[2]}.${m[1]}.` : d; };
  const tickIdx = [...new Set([0, Math.floor((s.length - 1) / 2), s.length - 1])];
  const xticks = tickIdx.map(i =>
    `<text x="${sx(s[i].date).toFixed(1)}" y="${H - 8}" class="trend__xtick"
           text-anchor="${i === 0 ? 'start' : i === s.length - 1 ? 'end' : 'middle'}">${short(s[i].date)}</text>`
  ).join('');

  const legend = RED_TREND.map(m =>
    `<span class="trend-legend__item"><span class="trend-legend__dot" style="background:${m.color}"></span>${m.label}</span>`
  ).join('');

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">ENTWICKLUNG IM ZEITVERLAUF</h3>
      <svg class="trend-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
           aria-label="Verlauf der Redaktions-Kennzahlen">
        ${grid}${lines}${xticks}
      </svg>
      <div class="trend-legend">${legend}</div>
    </div>
  `;
}

function redSparkline(metric, color) {
  if (!redSeries || redSeries.length < 2) return '';
  const vals = redSeries.map(r => r[metric] || 0);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const W = 100, H = 26, pad = 3;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (H - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `
    <svg class="kpi-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${pts.join(' ')}" fill="none" stroke-width="1.6"
                stroke-linejoin="round" stroke-linecap="round" style="stroke:${color}"/>
    </svg>
  `;
}

// ─── Gepostet je KW ──────────────────────────────────
function renderPostedByWeek(d) {
  const pbw = d.posted_by_week || {};
  const keys = Object.keys(pbw).sort().slice(-8);
  if (!keys.length) return '';
  const max = Math.max(...keys.map(k => pbw[k]));

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">GEPOSTET / KW</h3>
      <div class="month-chart">
        ${keys.map(k => `
          <div class="month-chart__col" title="${k}">
            <div class="month-chart__bar-wrap">
              <div class="month-chart__value">${pbw[k]}</div>
              <div class="month-chart__bar" style="height:${Math.max((pbw[k] / max) * 100, 6)}%"></div>
            </div>
            <div class="month-chart__label">KW ${parseInt(k.split('-W')[1], 10)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ─── Kampagnen ───────────────────────────────────────
function renderKampagnen(d) {
  const ks = d.kampagnen || [];
  if (!ks.length) return '';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const rows = ks.map(k => {
    const done = k.gepostet || 0;
    const pct = k.total ? Math.round((done / k.total) * 100) : 0;
    return `
      <div class="kampagne fade-in">
        <div class="kampagne__head">
          <span class="kampagne__name">${esc(k.label)}</span>
          <span class="kampagne__count">${done} / ${k.total} gepostet</span>
        </div>
        <div class="mini-bar">
          <div class="mini-bar__seg mini-bar__seg--done" style="width:${pct}%"></div>
          <div class="mini-bar__seg mini-bar__seg--progress" style="width:${k.total ? ((k.eingeplant + k.freigegeben) / k.total) * 100 : 0}%"></div>
          <div class="mini-bar__seg mini-bar__seg--open" style="width:${k.total ? ((k.in_pruefung + k.in_arbeit + k.ideen) / k.total) * 100 : 0}%"></div>
        </div>
        <div class="kampagne__detail">
          ${k.ideen} Ideen &middot; ${k.in_arbeit} in Arbeit &middot; ${k.in_pruefung} in Pr&uuml;fung &middot;
          ${k.freigegeben} freigegeben &middot; ${k.eingeplant} eingeplant
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">KAMPAGNEN</h3>
      ${rows}
    </div>
  `;
}

// ─── Empty State ─────────────────────────────────────
function renderEmpty() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="snapshot-header fade-in">
      <h1 class="snapshot-header__title">REDAKTION — SOCIAL MEDIA PIPELINE</h1>
      <p class="snapshot-header__sub">Notion-Redaktionsplan (Aggregat)</p>
    </div>
    <div class="loading">
      <div style="text-align:center;line-height:1.7;">
        Noch keine Redaktions-Snapshots vorhanden.<br>
        Der erste Datenpunkt entsteht automatisch, sobald das Secret
        <code>NOTION_TOKEN</code> im Repo hinterlegt ist (t&auml;glicher Lauf, 06:00 UTC).
      </div>
    </div>
  `;
  const meta = document.getElementById('header-meta');
  if (meta) meta.textContent = 'Wartet auf ersten Snapshot';
}
