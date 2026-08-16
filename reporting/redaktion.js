/* ============================================
   KORODUR Work Cockpit, Redaktion (GF-Dashboard, Issue #141)
   Rendert zwei Quellen:
   - data/redaktion/<datum>.json (Tages-Aggregat des Notion-Redaktionsplans):
     Puffer, Vorlauf, Pipeline-Funnel, posted_by_week.
   - data/social/<woche>.json + timeseries.json (wöchentlicher Plattform-Export,
     Issue #139): Impressions, Interaktionen, Engagement-Rate, Beiträge je
     Plattform.
   Read-only, nur Aggregatzahlen, keine Beitragstitel, keine Personen
   (öffentliche Seite). In dev: symlink src/data -> ../data; in production:
   data/ liegt im Root.
   Referenz: konzepte/mockup-redaktion-dashboard-2026-08-10.html (PR #138).
   ============================================ */

const RED_DIR = 'data/redaktion/';
const SOC_DIR = 'data/social/';

const RED_MONTHS_DE = [
  'Januar','Februar','März','April','Mai','Juni',
  'Juli','August','September','Oktober','November','Dezember'
];

// Funnel-Stufen in Prozess-Reihenfolge (docs/WORKFLOW.md korodur-redaktion).
// Ordinal-Navy-Rampe hell->dunkel, dataviz-validiert (Issue #141 Design).
const FUNNEL = [
  { key: 'ideen',       label: 'Ideen',        color: '#8aa9c4' },
  { key: 'in_arbeit',   label: 'In Arbeit',    color: '#6f93b3' },
  { key: 'in_pruefung', label: 'In Prüfung',   color: '#567da1' },
  { key: 'freigegeben', label: 'Freigegeben',  color: '#3d688f' },
  { key: 'eingeplant',  label: 'Eingeplant',   color: '#24527c' },
  { key: 'gepostet',    label: 'Gepostet',     color: '#002d59' },
];

// Plattform-Farben, dataviz-validiert (Issue #141 Design). Cyan (Facebook)
// liegt unter 3:1 Kontrast, deshalb sind Direct Labels + Tabellenansicht
// Pflicht, nicht nur Legende/Farbe.
const SOC_COLORS = { li: '#1e5a96', fb: '#009ee3', ig: '#7a56a3' };
const SOC_LABELS = { li: 'LinkedIn', fb: 'Facebook', ig: 'Instagram' };

const LI_POSTS_ZIEL = 3;
const VORLAUF_ZIEL_WOCHEN = 4;

let socSeries = [];   // data/social/timeseries.json, aufsteigend nach Woche
let socLatest = null; // data/social/<neueste Woche>.json

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const idxRes = await fetch(RED_DIR + 'index.json');
    if (!idxRes.ok) throw new Error('no-data');
    const keys = await idxRes.json();
    if (!Array.isArray(keys) || keys.length === 0) throw new Error('no-data');

    const snapRes = await fetch(RED_DIR + keys[0] + '.json');
    if (!snapRes.ok) throw new Error('no-data');
    const snap = await snapRes.json();

    // Sichtbarkeit ist eine Zusatzquelle: fehlt sie, degradiert die Seite auf
    // den Aufbau-Zustand statt komplett zu scheitern (Issue #141 AC).
    try {
      const socIdxRes = await fetch(SOC_DIR + 'index.json');
      if (socIdxRes.ok) {
        const socKeys = await socIdxRes.json();
        if (Array.isArray(socKeys) && socKeys.length) {
          const latestRes = await fetch(SOC_DIR + socKeys[0] + '.json');
          if (latestRes.ok) socLatest = await latestRes.json();
        }
      }
      const tsRes = await fetch(SOC_DIR + 'timeseries.json');
      if (tsRes.ok) {
        const ts = await tsRes.json();
        if (Array.isArray(ts)) socSeries = ts.slice().sort((a, b) => a.week.localeCompare(b.week));
      }
    } catch { /* Sichtbarkeit bleibt im Aufbau-Zustand */ }

    renderRedaktion(snap);
    const meta = document.getElementById('header-meta');
    if (meta) {
      meta.textContent = `Snapshot: ${redFormatDate(snap._meta.snapshot_date)}`
        + (socLatest ? ` · Plattform-Export: ${kwLabel(socLatest._meta.week)}` : '');
    }
  } catch {
    renderEmpty();
  }
});

function redFormatDate(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return key || '';
  return `${parseInt(m[3], 10)}. ${RED_MONTHS_DE[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

function kwLabel(weekKey) {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey || '');
  return m ? `KW ${parseInt(m[2], 10)}` : (weekKey || '');
}

// Montag einer ISO-Kalenderwoche als Date (UTC). Basis fuer isoWeekRangeLabel
// und die Luecken-Fuellung in buildFreqSeries.
function mondayOfIsoWeek(weekKey) {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey || '');
  if (!m) return null;
  const year = +m[1], week = +m[2];
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay() || 7;
  const monday = new Date(simple); monday.setUTCDate(simple.getUTCDate() - dow + 1);
  return monday;
}

// ISO-Kalenderwoche (Donnerstag-verankert) eines Datums, z. B. fuer die
// Luecken-Fuellung in buildFreqSeries (spiegelt iso_week_key aus
// scripts/import_social.py, das Python-isocalendar() nutzt).
function isoWeekKeyOfDate(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Montag-Sonntag einer ISO-Kalenderwoche, z. B. "03.–09.08." (spiegelt
// scripts/import_social.py:iso_week_range in JS).
function isoWeekRangeLabel(weekKey) {
  const monday = mondayOfIsoWeek(weekKey);
  if (!monday) return '';
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const dd = n => String(n).padStart(2, '0');
  const sameMonth = monday.getUTCMonth() === sunday.getUTCMonth();
  return sameMonth
    ? `${dd(monday.getUTCDate())}.&ndash;${dd(sunday.getUTCDate())}.${dd(sunday.getUTCMonth() + 1)}.`
    : `${dd(monday.getUTCDate())}.${dd(monday.getUTCMonth() + 1)}.&ndash;${dd(sunday.getUTCDate())}.${dd(sunday.getUTCMonth() + 1)}.`;
}

// ─── Formatierung ────────────────────────────────────
// Fehlt ein Wert im Snapshot, stand hier bisher wortwoertlich "undefined" auf
// einer Seite, die ohne Login erreichbar ist. Ein fehlender Wert ist auch keine
// Null: "n. v." sagt "nicht gemessen", eine 0 wuerde eine Messung behaupten.
function fehltZeichen(v) {
  return (v === null || v === undefined || Number.isNaN(v)) ? 'n.&nbsp;v.' : v;
}
function fmtNum(v) {
  return (v === null || v === undefined || Number.isNaN(v)) ? 'n.&nbsp;v.' : v.toLocaleString('de-DE');
}
function fmtPct1(fraction) {
  return (fraction === null || fraction === undefined || Number.isNaN(fraction))
    ? 'n.&nbsp;v.'
    : (fraction * 100).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function fmtWochen(v) {
  return (v === null || v === undefined || Number.isNaN(v))
    ? 'n.&nbsp;v.'
    : v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// ─── Ampel-Logik ─────────────────────────────────────
// Puffer: Ziel per Snapshot (aktuell 10-15, Issue #140), Fallback nur wenn
// puffer_ziel im Snapshot fehlt.
function pufferState(puffer, ziel) {
  const [lo, hi] = ziel || [10, 15];
  if (puffer >= lo && puffer <= hi) return 'ok';
  if (puffer >= Math.ceil(lo / 2)) return 'warn';
  if (puffer > hi) return 'warn';
  return 'crit';
}
// Beiträge diese Woche: Ziel 3 (LinkedIn), knapp ab der Hälfte.
function postsState(n, ziel) {
  if (n >= ziel) return 'ok';
  if (n >= Math.ceil(ziel / 2)) return 'warn';
  return 'crit';
}
// Terminierter Vorlauf: Ziel 4+ Wochen, knapp ab der Hälfte.
function vorlaufState(weeks, ziel) {
  if (weeks === null || weeks === undefined || Number.isNaN(weeks)) return 'crit';
  if (weeks >= ziel) return 'ok';
  if (weeks >= ziel / 2) return 'warn';
  return 'crit';
}
function ampelBadge(state, label) {
  return `<span class="ampel-badge ampel-badge--${state}"><span class="ampel-badge__dot"></span>${label}</span>`;
}

// ─── Sparkline (generisch, Werte-Array) ──────────────
function sparklineSvg(values, accent) {
  if (!values || values.length < 2) return '';
  const W = 110, H = 26, p = 3;
  const min = Math.min(...values), max = Math.max(...values), rg = max - min || 1;
  const pts = values.map((v, i) =>
    `${(p + i / (values.length - 1) * (W - 2 * p)).toFixed(1)},${(p + (1 - (v - min) / rg) * (H - 2 * p)).toFixed(1)}`);
  const [lx, ly] = pts[pts.length - 1].split(',');
  return `
    <svg class="kpi-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <polyline points="${pts.join(' ')}" fill="none" stroke="#b8c4cf" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="${lx}" cy="${ly}" r="3.4" fill="${accent}" stroke="#fff" stroke-width="1.5"/>
    </svg>`;
}

// ─── Render: Gesamtseite ─────────────────────────────
function renderRedaktion(d) {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="snapshot-header fade-in">
      <h1 class="snapshot-header__title">REDAKTION: SICHTBARKEIT &amp; PIPELINE</h1>
      <p class="snapshot-header__sub">
        Was unsere Social-Media-Arbeit bewirkt und ob die Redaktion rund l&auml;uft
        &middot; ${d.gesamt ?? 0} Beitr&auml;ge im Redaktionsplan, Stand ${redFormatDate(d._meta.snapshot_date)}
      </p>
    </div>

    ${renderSichtbarkeit()}
    ${renderAmpelRow(d)}
    ${renderBottomRow(d)}

    <div class="footer">
      Redaktions-Segment &middot; Quelle: Notion-Redaktionsplan (Aggregat) + w&ouml;chentliche Plattform-Exporte
      &middot; Generiert am ${new Date(d._meta.generated_at).toLocaleDateString('de-DE')}
      &middot; <a href="https://github.com/KORODUR-International/korodur-review-reporting" target="_blank">GitHub</a>
    </div>
  `;
}

// ─── 1+2 · Sichtbarkeit ───────────────────────────────
function socTotals(row) {
  if (!row) return null;
  return {
    imp: (row.li_impressions || 0) + (row.fb_views || 0) + (row.ig_views || 0),
    inter: (row.li_interactions || 0) + (row.fb_interactions || 0) + (row.ig_interactions || 0),
    er: row.li_engagement_rate,
    posts: row.li_posts,
  };
}

function socDeltaLine(curr, prev, isPct) {
  if (curr == null || prev == null) return '';
  if (isPct && !prev) return '';
  const diff = isPct ? Math.round(((curr - prev) / prev) * 100) : curr - prev;
  const cls = diff >= 0 ? 'kpi-card__delta--up' : 'kpi-card__delta--down';
  const sign = diff >= 0 ? '+' : '';
  const unit = isPct ? '&nbsp;%' : '';
  return `<div class="kpi-card__delta ${cls}">${sign}${diff}${unit} <small>vs. Vorwoche</small></div>`;
}

function renderSichtbarkeit() {
  if (!socSeries.length) {
    return `
      <div class="section-title">SICHTBARKEIT <small>LinkedIn, Facebook, Instagram</small></div>
      <div class="status-section fade-in">
        <p class="trend-empty">
          Die Sichtbarkeits-Auswertung baut sich mit dem ersten w&ouml;chentlichen
          Plattform-Export auf. Sobald <code>data/social/</code> Daten enth&auml;lt,
          erscheinen hier Impressions, Interaktionen und die Engagement-Rate.
        </p>
      </div>
    `;
  }

  const last = socSeries[socSeries.length - 1];
  const prev = socSeries.length >= 2 ? socSeries[socSeries.length - 2] : null;
  const t = socTotals(last), pt = prev ? socTotals(prev) : null;
  const range = isoWeekRangeLabel(last.week);
  const window8 = socSeries.slice(-8);

  const sparkImp = sparklineSvg(window8.map(r => socTotals(r).imp), 'var(--secondary)');
  const sparkInt = sparklineSvg(window8.map(r => socTotals(r).inter), 'var(--secondary)');
  const sparkEr = sparklineSvg(
    window8.filter(r => r.li_engagement_rate != null).map(r => r.li_engagement_rate * 100), 'var(--secondary)');

  const platforms = last.ig_views == null ? 'LinkedIn + Facebook, Instagram n.&nbsp;v.' : 'LinkedIn + Facebook + Instagram';
  return `
    <div class="section-title">SICHTBARKEIT &middot; ${kwLabel(last.week)} <small>${platforms}${range ? `, Kalenderwoche ${range}` : ''}</small></div>
    <div class="kpi-row">
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Sichtbarkeit (Impressions / Woche)</div>
        <div class="kpi-card__value kpi-card__value--hero">${fmtNum(t.imp)}</div>
        ${pt ? socDeltaLine(t.imp, pt.imp, true) : ''}
        ${sparkImp}
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Interaktionen / Woche</div>
        <div class="kpi-card__value">${fmtNum(t.inter)}</div>
        ${pt ? socDeltaLine(t.inter, pt.inter, false) : ''}
        <div class="kpi-card__detail">Reaktionen, Kommentare, geteilte Beitr&auml;ge</div>
        ${sparkInt}
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Engagement-Rate LinkedIn</div>
        <div class="kpi-card__value">${fmtPct1(t.er)}<span class="kpi-card__unit">%</span></div>
        <div class="kpi-card__detail">LinkedIn-Definition inkl. Klicks: (Klicks + Reaktionen + Kommentare + Shares) / Impressions</div>
        ${sparkEr}
      </div>
    </div>
    ${renderSichtbarkeitChart()}
  `;
}

function renderSichtbarkeitChart() {
  if (socSeries.length < 2) {
    return `
      <div class="status-section fade-in vis-chart-card">
        <h3 class="status-section__title">SICHTBARKEIT IM ZEITVERLAUF</h3>
        <p class="trend-empty">
          Der Zeitverlauf braucht mindestens zwei Wochen-Exporte. Ab dem
          zweiten Export erscheint hier die Kurve je Plattform.
        </p>
      </div>
    `;
  }

  const weeks = socSeries.slice(-12);
  const SERIES = [
    { tag: 'li', key: 'li_impressions' },
    { tag: 'fb', key: 'fb_views' },
    { tag: 'ig', key: 'ig_views' },
  ];
  const W = 900, H = 300, pl = 46, pr = 96, pt = 20, pb = 32;
  const allVals = weeks.flatMap(w => SERIES.map(s => w[s.key])).filter(v => v != null);
  const maxRaw = Math.max(1, ...allVals);
  const maxY = Math.ceil(maxRaw * 1.15 / 100) * 100 || 100;
  const x = i => pl + (weeks.length === 1 ? 0 : i / (weeks.length - 1) * (W - pl - pr));
  const y = v => pt + (1 - v / maxY) * (H - pt - pb);

  let s = '';
  for (let k = 0; k <= 4; k++) {
    const v = Math.round(maxY * k / 4);
    s += `<line x1="${pl}" y1="${y(v)}" x2="${W - pr}" y2="${y(v)}" class="trend__grid"/>`;
    s += `<text x="${pl - 8}" y="${y(v) + 4}" class="trend__ytick">${v}</text>`;
  }

  SERIES.forEach(sr => {
    const pts = weeks.map((w, i) => ({ i, v: w[sr.key] })).filter(p => p.v != null);
    if (!pts.length) return;
    const path = pts.map((p, idx) => `${idx ? 'L' : 'M'}${x(p.i)},${y(p.v)}`).join(' ');
    const color = SOC_COLORS[sr.tag];
    s += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = pts[pts.length - 1];
    s += `<circle cx="${x(last.i)}" cy="${y(last.v)}" r="4.5" fill="${color}" stroke="#fff" stroke-width="2"/>`;
    s += `<text x="${x(last.i) + 10}" y="${y(last.v) + 4}" font-size="12" fill="var(--ink)">${SOC_LABELS[sr.tag]} <tspan font-weight="bold">${fmtNum(last.v)}</tspan></text>`;
  });

  weeks.forEach((w, i) => {
    s += `<text x="${x(i)}" y="${H - 8}" font-size="11" fill="var(--muted)" text-anchor="middle">${kwLabel(w.week)}</text>`;
  });

  // Hover-Zonen mit nativem Tooltip (SVG <title>) je Woche, wertet alle drei
  // Plattformen aus -- ersetzt eine JS-Mousemove-Tooltipbox, die sich im
  // string-basierten Render-Test dieses Skripts nicht pruefen liesse.
  weeks.forEach((w, i) => {
    const half = weeks.length > 1 ? (x(1) - x(0)) / 2 : 60;
    const rows = SERIES.map(sr => `${SOC_LABELS[sr.tag]}: ${w[sr.key] == null ? 'n. v.' : fmtNum(w[sr.key]).replace('&nbsp;', ' ')}`).join(' · ');
    s += `<rect data-i="${i}" x="${x(i) - half}" y="${pt}" width="${half * 2}" height="${H - pt - pb}" fill="transparent" class="vis-hit"><title>${kwLabel(w.week)}: ${rows}</title></rect>`;
  });

  const missingIg = weeks.some(w => w.ig_views == null);

  let tbl = '<table><tr><th>Plattform</th>' + weeks.map(w => `<th>${kwLabel(w.week)}</th>`).join('') + '</tr>';
  SERIES.forEach(sr => {
    tbl += `<tr><td>${SOC_LABELS[sr.tag]}</td>` + weeks.map(w => `<td>${w[sr.key] == null ? 'n.&nbsp;v.' : fmtNum(w[sr.key])}</td>`).join('') + '</tr>';
  });
  tbl += '</table>';

  return `
    <div class="status-section fade-in vis-chart-card">
      <h3 class="status-section__title">SICHTBARKEIT IM ZEITVERLAUF</h3>
      <p class="chart-note">Impressions bzw. Aufrufe pro Kalenderwoche und Plattform${missingIg ? ' &middot; Instagram liefert nicht in jeder Woche Aufrufe' : ''}</p>
      <div class="chart-wrap">
        <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Impressions pro Woche und Plattform" class="vis-svg">${s}</svg>
      </div>
      <div class="legend">
        <span><i style="background:${SOC_COLORS.li}"></i>LinkedIn</span>
        <span><i style="background:${SOC_COLORS.fb}"></i>Facebook</span>
        <span><i style="background:${SOC_COLORS.ig}"></i>Instagram</span>
      </div>
      <details class="tbl"><summary>Werte als Tabelle</summary>${tbl}</details>
    </div>
  `;
}

// ─── 3 · Läuft die Redaktion? ─────────────────────────
function renderAmpelRow(d) {
  return `
    <div class="section-title">L&Auml;UFT DIE REDAKTION? <small>Frequenz und Vorarbeit, Quelle: Notion-Redaktionsplan + Plattform-Exporte</small></div>
    <div class="kpi-row">
      ${renderPostsTile()}
      ${renderPufferTile(d)}
      ${renderVorlaufTile(d)}
    </div>
  `;
}

function renderPostsTile() {
  if (!socSeries.length) {
    return `
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Beitr&auml;ge diese Woche</div>
        <div class="kpi-card__value">n.&nbsp;v.</div>
        <div class="kpi-card__detail">Noch kein LinkedIn-Export vorhanden</div>
      </div>`;
  }
  const last = socSeries[socSeries.length - 1];
  const n = last.li_posts || 0;
  const state = postsState(n, LI_POSTS_ZIEL);
  const label = state === 'ok' ? 'Ziel erreicht' : state === 'warn' ? 'knapp am Ziel' : 'unter Ziel';
  const last4 = socSeries.slice(-4).map(r => r.li_posts || 0);
  const avg = (last4.reduce((a, b) => a + b, 0) / last4.length)
    .toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const trend = last4.length > 1
    ? `Durchschnitt letzte ${last4.length} Wochen: ${avg} / Woche`
    : `erst ${last4.length} Export-Woche`;
  return `
    <div class="kpi-card fade-in">
      <div class="kpi-card__label">Beitr&auml;ge diese Woche ${ampelBadge(state, label)}</div>
      <div class="kpi-card__value">${n}<span class="kpi-card__unit">von ${LI_POSTS_ZIEL}</span></div>
      <div class="kpi-card__detail">LinkedIn, ${kwLabel(last.week)} &middot; ${trend}</div>
    </div>`;
}

function renderPufferTile(d) {
  const ziel = d.puffer_ziel || [10, 15];
  const [lo, hi] = ziel;
  const puffer = d.puffer || 0;
  const state = pufferState(d.puffer, ziel);
  const label = state === 'ok' ? 'im Ziel' : state === 'warn' ? 'knapp' : 'au&szlig;erhalb Ziel';
  const meterMax = Math.max(hi + 5, Math.ceil(puffer * 1.2), 1);
  const fillPct = Math.min(100, (puffer / meterMax) * 100);
  const bandLeft = (lo / meterMax) * 100;
  const bandWidth = ((hi - lo) / meterMax) * 100;
  const terminiert = d.geplant_zukunft != null
    ? ` &middot; davon ${d.geplant_zukunft} mit Datum terminiert` : '';
  return `
    <div class="kpi-card fade-in">
      <div class="kpi-card__label">Beitrags-Puffer ${ampelBadge(state, label)}</div>
      <div class="kpi-card__value">${fehltZeichen(d.puffer)}</div>
      <div class="kpi-card__detail">Freigegeben + eingeplant &middot; Ziel ${lo}&ndash;${hi}${terminiert}</div>
      <div class="meter">
        <div class="meter__scale">
          <div class="meter__band" style="left:${bandLeft}%; width:${bandWidth}%;"></div>
          <div class="meter__fill" style="width:${fillPct}%;"></div>
          <div class="meter__marker" style="left:${fillPct}%;"></div>
        </div>
        <div class="meter__ticks"><span>0</span><span>Ziel ${lo}&ndash;${hi}</span><span>${meterMax}</span></div>
      </div>
    </div>`;
}

function renderVorlaufTile(d) {
  const state = vorlaufState(d.vorlauf_wochen, VORLAUF_ZIEL_WOCHEN);
  const label = state === 'ok' ? 'im Ziel' : state === 'warn' ? 'knapp' : 'zu kurz';
  return `
    <div class="kpi-card fade-in">
      <div class="kpi-card__label">Terminierter Vorlauf ${ampelBadge(state, label)}</div>
      <div class="kpi-card__value">${fmtWochen(d.vorlauf_wochen)}<span class="kpi-card__unit">Wochen</span></div>
      <div class="kpi-card__detail">Wie weit die getimten Beitr&auml;ge in die Zukunft reichen &middot; Ziel ${VORLAUF_ZIEL_WOCHEN}+ Wochen</div>
    </div>`;
}

// ─── 4+5 · Beiträge je Woche & Pipeline-Funnel ────────
// Merge: Notion posted_by_week (Datumsfeld, historisch) als Basis, die
// juengste(n) Woche(n) mit echtem Social-Export ueberschreiben ihren
// Wochenwert mit li_posts (praeziser als das Notion-Datumsfeld, das laut
// Snapshot Datenschuld hat). Fallback-Wochen bleiben in der Beschriftung
// als solche gekennzeichnet (Issue #141 Scope).
// Fuellt jede Woche zwischen der ersten und letzten Woche in `series` mit
// einem 0-Stub (source: 'none'), damit Wochen ohne Beitrag auf der Achse
// sichtbar bleiben statt zu verschwinden -- sonst zeigt das Chart eine
// geschoente Frequenz, dabei sind die Luecken die Botschaft dieser KPI
// (Review PR #144, wie im abgenommenen Mockup KW 23-31).
function fillWeekGaps(series) {
  if (!series.length) return series;
  const byWeek = {};
  series.forEach(r => { byWeek[r.week] = r; });
  const filled = [];
  let cursor = mondayOfIsoWeek(series[0].week);
  const lastMonday = mondayOfIsoWeek(series[series.length - 1].week);
  while (cursor <= lastMonday) {
    const wk = isoWeekKeyOfDate(cursor);
    filled.push(byWeek[wk] || { week: wk, n: 0, source: 'none' });
    cursor = new Date(cursor.getTime() + 7 * 86400000);
  }
  return filled;
}

function buildFreqSeries(d) {
  const merged = {};
  Object.entries(d.posted_by_week || {}).forEach(([wk, n]) => { merged[wk] = { n, source: 'notion' }; });
  socSeries.forEach(r => {
    if (r.li_posts != null) merged[r.week] = { n: r.li_posts, source: 'export' };
  });
  const series = Object.keys(merged).sort().map(wk => ({ week: wk, ...merged[wk] }));
  return fillWeekGaps(series);
}

function renderFreqChart(d) {
  const series = buildFreqSeries(d).slice(-12);
  if (!series.length) {
    return '<p class="chart-note">Noch keine Wochenverteilung ver&ouml;ffentlichter Beitr&auml;ge.</p>';
  }

  const W = 560, H = 230, pl = 30, pr = 20, pt = 18, pb = 30;
  const maxY = Math.max(LI_POSTS_ZIEL + 1, ...series.map(r => r.n)) + 1;
  const slot = (W - pl - pr) / series.length;
  const bw = Math.min(24, slot * 0.55);
  const y = v => pt + (1 - v / maxY) * (H - pt - pb);

  let s = '';
  for (let v = 0; v <= maxY; v++) {
    s += `<line x1="${pl}" y1="${y(v)}" x2="${W - pr}" y2="${y(v)}" class="trend__grid"/>`;
    s += `<text x="${pl - 7}" y="${y(v) + 4}" font-size="11" fill="var(--muted)" text-anchor="end">${v}</text>`;
  }

  const hatFallback = series.some(r => r.source === 'notion');

  series.forEach((r, i) => {
    const cx = pl + slot * i + slot / 2;
    const titel = r.n > 0
      ? `${kwLabel(r.week)}: ${r.n} Beitr${r.n === 1 ? 'ag' : 'äge'} (Quelle: ${r.source === 'export' ? 'LinkedIn-Export' : 'Notion-Redaktionsplan'})`
      : `${kwLabel(r.week)}: kein Beitrag veröffentlicht`;
    if (r.n > 0) {
      const h = y(0) - y(r.n);
      s += `<path d="M${cx - bw / 2},${y(0)} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z" fill="${SOC_COLORS.li}" data-i="${i}"><title>${titel}</title></path>`;
      s += `<text x="${cx}" y="${y(r.n) - 6}" font-size="12" font-weight="bold" fill="var(--ink)" text-anchor="middle">${r.n}</text>`;
    } else {
      s += `<rect x="${cx - bw / 2}" y="${y(0) - 2}" width="${bw}" height="2" fill="#c9d2da" data-i="${i}"><title>${titel}</title></rect>`;
    }
    s += `<text x="${cx}" y="${H - 8}" font-size="11" fill="var(--muted)" text-anchor="middle">${kwLabel(r.week)}${r.source === 'notion' ? '*' : ''}</text>`;
  });

  s += `<line x1="${pl}" y1="${y(LI_POSTS_ZIEL)}" x2="${W - pr}" y2="${y(LI_POSTS_ZIEL)}" stroke="var(--muted)" stroke-width="1.5"/>`;
  s += `<text x="${pl + 4}" y="${y(LI_POSTS_ZIEL) - 6}" font-size="11.5" fill="var(--muted)">Ziel ${LI_POSTS_ZIEL} / Wo</text>`;

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Ver&ouml;ffentlichte Beitr&auml;ge je Kalenderwoche">${s}</svg>
    </div>
    ${hatFallback ? `<p class="chart-note">* aus dem Notion-Redaktionsplan (Datumsfeld "${datumsfeld(d)}"), nicht aus dem Plattform-Export.</p>` : ''}
  `;
}

// Welches Notion-Datumsfeld die Kadenz traegt, steht seit Issue #175 im
// Snapshot. Bis 10.08.2026 war das "veroeffentlicht" (Ist-Datum), seither
// "geplant" (Plan-Datum). Der Unterschied gehoert auf die Seite: sonst liest
// sich ein Naeherungswert wie eine Messung. Aeltere Snapshots ohne das Feld
// stammen aus der Zeit davor.
function datumsfeld(d) {
  return ((d || {})._meta || {}).datumsquelle || 'ver&ouml;ffentlicht';
}

function renderBottomRow(d) {
  const feld = datumsfeld(d);
  const quelle = socSeries.length
    ? `j&uuml;ngste Woche aus dem LinkedIn-Export, davor aus dem Notion-Redaktionsplan (Feld "${feld}")`
    : `aus dem Notion-Redaktionsplan (Feld "${feld}")`;
  return `
    <div class="grid-2">
      <div class="status-section fade-in">
        <h3 class="status-section__title">BEITR&Auml;GE JE WOCHE</h3>
        <p class="chart-note">Ver&ouml;ffentlichte Beitr&auml;ge (LinkedIn) &middot; Ziel: ${LI_POSTS_ZIEL} pro Woche &middot; ${quelle}</p>
        ${renderFreqChart(d)}
      </div>
      ${renderFunnel(d.totals || {})}
    </div>
  `;
}

// ─── Pipeline-Funnel (unverändert bis auf Farben, Issue #141 Design) ──
const FUNNEL_TITLE = 'PIPELINE: VON DER IDEE ZUM POST';

function renderFunnel(t) {
  const total = FUNNEL.reduce((s, f) => s + (t[f.key] || 0), 0);

  // Unbekannter Status: laut statt still. Zeigt an, dass das Mapping in
  // scripts/fetch_redaktion.py hinter dem Notion-Schema herhinkt.
  // Der Hinweis steht bewusst vor dem total-Guard: benennt Notion das Statusset
  // um, fallen alle Zeilen nach "unbekannt", der Funnel ist leer, und genau dann
  // muss die Warnung auf der Seite stehen und nicht nur im Action-Log.
  const unbekannt = t.unbekannt
    ? `<span class="funnel__discarded">+ ${t.unbekannt} mit unbekanntem Status (nicht im Funnel)</span>` : '';

  // Abgelehnt ist kein Mapping-Fehler, sondern eine Entscheidung: der Beitrag
  // kommt nie heraus. Er steht neben dem Funnel, damit die Summe der Stufen
  // weiter der Pipeline entspricht und die Ablehnung trotzdem sichtbar bleibt
  // (Issue #175, Statusmodell vom 11.08.2026).
  const abgelehnt = t.abgelehnt
    ? `<span class="funnel__discarded">+ ${t.abgelehnt} abgelehnt (nicht im Funnel)</span>` : '';

  if (!total) {
    if (!unbekannt) return '';
    return `
      <div class="status-section fade-in">
        <h3 class="status-section__title">${FUNNEL_TITLE}</h3>
        <p class="funnel-empty">
          Kein Beitrag liegt in einer bekannten Pipeline-Stufe, unbekannter
          Status: ${t.unbekannt}. Wir m&uuml;ssen das Mapping in
          <code>scripts/fetch_redaktion.py</code> ans Notion-Schema nachziehen,
          bis dahin ist die Pipeline hier blind.
        </p>
        <div class="status-legend">${unbekannt}${abgelehnt}</div>
      </div>
    `;
  }

  const segs = FUNNEL.map((f, i) => {
    const c = t[f.key] || 0;
    if (!c) return '';
    const pct = (c / total) * 100;
    // Die beiden hellsten Rampenfarben (Ideen, In Arbeit) fallen bei weißer
    // Schrift unter 3:1 Kontrast (dataviz-Review). Dunkle Schrift auf den
    // ersten drei, helle auf den letzten drei -- wie im Mockup validiert.
    const ink = i < 3 ? '#0f2b45' : '#ffffff';
    return `<div class="funnel__seg" style="flex-grow:${c};background:${f.color};color:${ink}"
                 title="${f.label}: ${c}">${pct > 6 ? c : ''}</div>`;
  }).join('');
  const legend = FUNNEL.map(f =>
    `<span class="status-legend__item"><span class="status-legend__dot" style="background:${f.color}"></span>${f.label}: ${t[f.key] || 0}</span>`
  ).join('');

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">${FUNNEL_TITLE}</h3>
      <div class="funnel">${segs}</div>
      <div class="status-legend">${legend}${unbekannt}${abgelehnt}</div>
    </div>
  `;
}

// ─── Empty State ─────────────────────────────────────
function renderEmpty() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="snapshot-header fade-in">
      <h1 class="snapshot-header__title">REDAKTION: SICHTBARKEIT &amp; PIPELINE</h1>
      <p class="snapshot-header__sub">Notion-Redaktionsplan (Aggregat) + Plattform-Exporte</p>
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
