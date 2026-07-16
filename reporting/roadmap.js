/* ============================================
   KORODUR Work Cockpit — Roadmap
   Rendert data/roadmap/roadmap-<jahr>.json.
   Read-only: kein Board-Zugriff zur Laufzeit.
   In dev: symlink src/data -> ../data; in production (GitHub Pages): data/ is at root
   ============================================ */

const ROADMAP_URL = 'data/roadmap/roadmap-2026.json';

const MONTH_NAMES = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const TYP_LABEL = { meilenstein: 'Meilenstein', schluessel: 'Schlüsselereignis', entscheidung: 'Entscheidungspunkt', fixpunkt: 'Externer Fixpunkt' };
const STATUS_LABEL = { offen: 'offen', erreicht: 'erreicht', verschoben: 'verschoben', entfallen: 'entfallen' };

// Confidence: öffentlich nur als Symbol (Herleitung/Prozente bleiben intern).
// hoch ●●● / mittel ●●○ / niedrig ●○○
const CONF_SYMBOL = { hoch: '●●●', mittel: '●●○', niedrig: '●○○' };
const CONF_LABEL = { hoch: 'hoch', mittel: 'mittel', niedrig: 'niedrig' };
function confSymbolHtml(conf) {
  if (!conf || !CONF_SYMBOL[conf]) return '';
  return `<span class="rm-conf rm-conf--${conf}" title="Confidence: ${CONF_LABEL[conf]}" aria-label="Confidence ${CONF_LABEL[conf]}">${CONF_SYMBOL[conf]}</span>`;
}

// Zoom-Stufen (Konzept §4). start/ende null = Zeitraum aus der JSON.
const ZOOMS = [
  { key: 'q3', label: 'Q3', start: '2026-07-01', ende: '2026-09-30', outlook: false },
  { key: 'q4', label: 'Q4', start: '2026-10-01', ende: '2026-12-31', outlook: false },
  { key: 'h2', label: 'H2 gesamt', start: null, ende: null, outlook: false },
  { key: 'h2p', label: 'inkl. 2027', start: null, ende: null, outlook: true },
];

let DATA = null;
let AREA = {};              // areaId -> {name, farbe}
const areaOf = id => AREA[id] || { name: id || 'Unbekannt', farbe: 'var(--muted)' };
const todayIso = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const state = {
  zoom: 'h2p',
  fix: false,               // externe Fixpunkte (Standard: ausgeblendet, Review 14.07.)
  decisions: true,          // Entscheidungspunkte
  achieved: true,           // erreichte Meilensteine
  areas: null,              // Set aktiver Area-IDs (null = alle)
  selected: null,           // {kind: 'ms'|'lane', id}
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
const fmtShort = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}.${m}.`; };
const dayMs = 86400000;
const toDate = iso => new Date(iso + 'T12:00:00');

function zoomDef() {
  const z = ZOOMS.find(z => z.key === state.zoom) || ZOOMS[3];
  return {
    ...z,
    start: z.start || DATA.zeitraum.start,
    ende: z.ende || DATA.zeitraum.ende,
  };
}
function pct(iso) {
  const z = zoomDef();
  const t0 = toDate(z.start), t1 = toDate(z.ende);
  return ((toDate(iso) - t0) / (t1 - t0 + dayMs)) * 100;
}
const inWindow = iso => { const x = pct(iso); return x >= 0 && x <= 100; };

// Monate im aktiven Fenster: [{label, leftPct, widthPct}]
function monthsInWindow() {
  const z = zoomDef();
  const t0 = toDate(z.start), t1 = toDate(z.ende);
  const months = [];
  const cur = new Date(t0.getFullYear(), t0.getMonth(), 1, 12);
  while (cur <= t1) {
    const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, 12);
    const from = Math.max(cur, t0), to = Math.min(next, new Date(t1.getTime() + dayMs));
    months.push({
      label: MONTH_NAMES[cur.getMonth()] + ' ' + String(cur.getFullYear()).slice(2),
      left: ((from - t0) / (t1 - t0 + dayMs)) * 100,
      width: ((to - from) / (t1 - t0 + dayMs)) * 100,
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

// Fortschritt: erreicht / (gesamt ohne entfallen); verschoben zählt als offen
function progress(meilensteine) {
  const rel = meilensteine.filter(m => m.status !== 'entfallen');
  return { done: rel.filter(m => m.status === 'erreicht').length, total: rel.length };
}
function overallProgress() {
  const all = DATA.lanes.flatMap(l => l.meilensteine);
  return progress(all);
}

function visibleMs(list) {
  return list.filter(m => {
    if (m.status === 'entfallen') return false;
    if (!state.decisions && m.typ === 'entscheidung') return false;
    if (!state.achieved && m.status === 'erreicht') return false;
    return inWindow(m.datum);
  });
}
function activeLanes() {
  return DATA.lanes.filter(l => !state.areas || state.areas.has(l.area));
}

/* --- State aus/in URL (teilbare Ansichten, testbare Zustände) --- */
function readStateFromUrl() {
  const p = new URLSearchParams(location.search);
  if (p.has('zoom') && ZOOMS.some(z => z.key === p.get('zoom'))) state.zoom = p.get('zoom');
  if (p.has('fix')) state.fix = p.get('fix') === '1';
  if (p.has('dec')) state.decisions = p.get('dec') === '1';
  if (p.has('done')) state.achieved = p.get('done') === '1';
  if (p.has('areas')) {
    const ids = p.get('areas').split(',').filter(id => DATA.areas.some(a => a.id === id));
    if (ids.length) state.areas = new Set(ids);
  }
  if (p.has('sel')) {
    const id = p.get('sel');
    if (DATA.lanes.some(l => l.id === id)) state.selected = { kind: 'lane', id };
    else if (DATA.lanes.some(l => l.meilensteine.some(m => m.id === id))
      || DATA.fixpunkte.some(f => f.id === id)) state.selected = { kind: 'ms', id };
  }
}
function writeStateToUrl() {
  const p = new URLSearchParams();
  if (state.zoom !== 'h2p') p.set('zoom', state.zoom);
  if (state.fix) p.set('fix', '1');
  if (!state.decisions) p.set('dec', '0');
  if (!state.achieved) p.set('done', '0');
  if (state.areas) p.set('areas', [...state.areas].join(','));
  if (state.selected) p.set('sel', state.selected.id);
  const qs = p.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
}

/* --- Lookups --- */
function findMs(id) {
  for (const lane of DATA.lanes) {
    const m = lane.meilensteine.find(m => m.id === id);
    if (m) return { m, lane };
  }
  const f = DATA.fixpunkte.find(f => f.id === id);
  if (f) return { m: f, lane: null };
  return null;
}

/* --- Marker-HTML --- */
function markerHtml(m, laneId, color) {
  const x = pct(m.datum);
  const cls = ['rm-marker', 'rm-marker--' + m.typ];
  if (m.status === 'erreicht') cls.push('is-done');
  if (m.status === 'verschoben') cls.push('is-moved');
  if (state.selected && state.selected.kind === 'ms' && state.selected.id === m.id) cls.push('is-selected');
  return `<button type="button" class="${cls.join(' ')}" style="left:${x}%;--rm-c:${color}"
    data-ms="${esc(m.id)}" data-lane="${esc(laneId || '')}"
    aria-label="${esc(m.titel)} (${fmtDate(m.datum)})"></button>`;
}
function labelHtml(m, idx) {
  const x = pct(m.datum);
  const side = idx % 2 === 0 ? 'above' : 'below';
  let anchor = `left:${x}%;transform:translateX(-50%)`;
  if (x < 8) anchor = `left:${x}%`;
  if (x > 92) anchor = `right:${100 - x}%;text-align:right`;
  const warn = m.klaerung ? '⚠ ' : '';
  const done = m.status === 'erreicht' ? '✓ ' : '';
  const moved = m.status === 'verschoben' ? ' (verschoben)' : '';
  return `<div class="rm-mslabel rm-mslabel--${side}" style="${anchor}">
    <span class="rm-mslabel__d">${fmtShort(m.datum)}</span> ${done}${warn}<b>${esc(m.titel)}</b>${confSymbolHtml(m.confidence)}${moved}
  </div>`;
}

/* --- Chart --- */
function rangeHtml(m, color) {
  if (!m.zeitraum) return '';
  const r0 = Math.max(0, pct(m.zeitraum.von));
  const r1 = Math.min(100, pct(m.zeitraum.bis));
  if (r1 <= r0) return '';
  return `<div class="rm-range" style="left:${r0}%;width:${r1 - r0}%;background:${color}"></div>`;
}

function laneRowHtml(lane) {
  const color = areaOf(lane.area).farbe;
  const z = zoomDef();
  const p = progress(lane.meilensteine);
  const ms = visibleMs(lane.meilensteine);
  const dashed = lane.stil === 'empfehlung' || lane.stil === 'parallel';

  // Balken auf das Fenster beschneiden; klickbar wie der Lane-Name
  let barHtml = '';
  if (lane.balken) {
    const b0 = Math.max(0, pct(lane.balken.start));
    const b1 = Math.min(100, pct(lane.balken.ende));
    if (b1 > b0) {
      barHtml = `<div class="rm-bar${dashed ? ' rm-bar--dashed' : ''}" data-lanebtn="${esc(lane.id)}" style="left:${b0}%;width:${b1 - b0}%;--rm-c:${color}"></div>`;
    }
  }

  // Segmente: einzelne (meist gestrichelte/vorläufige) Balkenabschnitte über dem Lane-Balken
  let segHtml = '';
  if (Array.isArray(lane.segmente)) {
    segHtml = lane.segmente.map(s => {
      const s0 = Math.max(0, pct(s.von));
      const s1 = Math.min(100, pct(s.bis));
      if (s1 <= s0) return '';
      const segDashed = s.stil === 'gestrichelt' || s.stil === 'vorlaeufig';
      return `<div class="rm-bar rm-bar--seg${segDashed ? ' rm-bar--dashed' : ''}" style="left:${s0}%;width:${s1 - s0}%;--rm-c:${color}" title="vorläufig ${fmtShort(s.von)} bis ${fmtShort(s.bis)}"></div>`;
    }).join('');
  }
  const gridHtml = monthsInWindow().slice(1).map(m => `<div class="rm-grid-v" style="left:${m.left}%"></div>`).join('');
  const today = DATA.heute || todayIso();
  const todayHtml = inWindow(today) ? `<div class="rm-today" style="left:${pct(today)}%"></div>` : '';
  const selCls = state.selected && state.selected.kind === 'lane' && state.selected.id === lane.id ? ' is-selected' : '';

  return `
  <div class="rm-row rm-lane${selCls}">
    <div class="rm-lane__label">
      <button type="button" class="rm-lane__name" data-lanebtn="${esc(lane.id)}">${esc(lane.name)}</button>
      ${lane.hinweis ? `<div class="rm-lane__note">${esc(lane.hinweis)}</div>` : ''}
      <div class="rm-lane__progress">
        <div class="rm-progress"><div class="rm-progress__fill" style="width:${p.total ? (p.done / p.total) * 100 : 0}%;--rm-c:${color}"></div></div>
        <span class="rm-lane__count">${p.done}/${p.total}</span>
      </div>
    </div>
    <div class="rm-lane__zone">
      ${gridHtml}${todayHtml}${barHtml}${segHtml}
      ${ms.map(m => rangeHtml(m, color)).join('')}
      ${ms.map((m, i) => labelHtml(m, i)).join('')}
      ${ms.map(m => markerHtml(m, lane.id, color)).join('')}
    </div>
    <div class="rm-lane__next">${zoomDef().outlook && lane.weiter2027 ? `<span class="rm-chip">→ ${esc(lane.weiter2027)}</span>` : ''}</div>
  </div>`;
}

function fixRowHtml() {
  const fixe = visibleMs(DATA.fixpunkte);
  const gridHtml = monthsInWindow().slice(1).map(m => `<div class="rm-grid-v" style="left:${m.left}%"></div>`).join('');
  return `
  <div class="rm-row rm-lane rm-lane--fix">
    <div class="rm-lane__label">
      <span class="rm-lane__name rm-lane__name--static">Externe Fixpunkte</span>
      <div class="rm-lane__note">nur committete Termine</div>
    </div>
    <div class="rm-lane__zone">
      ${gridHtml}
      ${fixe.map(m => rangeHtml(m, 'var(--muted)')).join('')}
      ${fixe.map((m, i) => labelHtml(m, i)).join('')}
      ${fixe.map(m => markerHtml(m, null, 'var(--muted)')).join('')}
    </div>
    <div class="rm-lane__next"></div>
  </div>`;
}

function chartHtml() {
  const months = monthsInWindow();
  const z = zoomDef();
  const today = DATA.heute || todayIso();
  const lanes = activeLanes();
  const groups = [];
  let last = null;
  for (const lane of lanes) {
    if (lane.area !== last) {
      groups.push({ area: lane.area, lanes: [] });
      last = lane.area;
    }
    groups[groups.length - 1].lanes.push(lane);
  }
  return `
  <div class="status-section rm-chart${z.outlook ? ' rm-chart--outlook' : ''}">
    <div class="rm-chart__scroll">
      <div class="rm-row rm-months">
        <div></div>
        <div class="rm-months__zone">
          ${months.map(m => `<div class="rm-months__m" style="left:${m.left}%;width:${m.width}%">${m.label}</div>`).join('')}
          ${inWindow(today) ? `<div class="rm-months__today" style="left:${pct(today)}%">Heute</div>` : ''}
        </div>
        <div class="rm-months__next">${z.outlook ? esc(DATA.zeitraum.ausblickLabel) + ' →' : ''}</div>
      </div>
      ${state.fix ? fixRowHtml() : ''}
      ${groups.map(g => `
        <div class="rm-row rm-areahead">
          <div class="rm-areahead__label"><span class="rm-swatch" style="background:${areaOf(g.area).farbe}"></span>${esc(areaOf(g.area).name)}</div>
          <div></div><div></div>
        </div>
        ${g.lanes.map(laneRowHtml).join('')}
      `).join('')}
    </div>
  </div>`;
}

/* --- Toolbar --- */
function toolbarHtml() {
  const toggle = (id, label, on) =>
    `<label class="rm-toggle"><input type="checkbox" data-toggle="${id}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
  return `
  <div class="status-section rm-toolbar">
    <div class="rm-toolbar__group" role="group" aria-label="Zeitraum">
      ${ZOOMS.map(z => `<button type="button" class="rm-zoombtn${state.zoom === z.key ? ' is-active' : ''}" data-zoom="${z.key}">${z.label}</button>`).join('')}
    </div>
    <div class="rm-toolbar__group">
      ${toggle('fix', 'Externe Fixpunkte', state.fix)}
      ${toggle('dec', 'Entscheidungspunkte', state.decisions)}
      ${toggle('done', 'Erreichte', state.achieved)}
    </div>
    <div class="rm-toolbar__group" role="group" aria-label="Areas">
      ${DATA.areas.map(a => {
        const on = !state.areas || state.areas.has(a.id);
        return `<button type="button" class="rm-areachip${on ? ' is-active' : ''}" data-area="${a.id}" style="--rm-c:${a.farbe}">${esc(a.name.replace('WiP: ', ''))}</button>`;
      }).join('')}
    </div>
  </div>`;
}

/* --- Detail-Panel (Klick: was liegt darunter) --- */
function detailHtml() {
  if (!state.selected) {
    return `<div class="status-section rm-detail rm-detail--empty">Balken, Lane-Namen oder Meilenstein anklicken, um Details zu sehen.</div>`;
  }
  if (state.selected.kind === 'lane') {
    const lane = DATA.lanes.find(l => l.id === state.selected.id);
    if (!lane) return '';
    const p = progress(lane.meilensteine);
    const color = areaOf(lane.area).farbe;
    const zeitraumTxt = lane.balken ? ` · ${fmtShort(lane.balken.start)} bis ${fmtShort(lane.balken.ende)}` : '';
    return `
    <div class="status-section rm-detail">
      <div class="rm-detail__head">
        <span class="rm-swatch" style="background:${color}"></span>
        <h3 class="rm-detail__title">${esc(lane.name)}</h3>
        <span class="rm-detail__meta">${esc(areaOf(lane.area).name)}${zeitraumTxt}${lane.weiter2027 ? ' · 2027: ' + esc(lane.weiter2027) : ''} · Fortschritt ${p.done}/${p.total}</span>
        <button type="button" class="rm-detail__close" data-close aria-label="Schließen">×</button>
      </div>
      ${lane.hinweis ? `<p class="rm-detail__note">${esc(lane.hinweis)}</p>` : ''}
      <ul class="rm-detail__list">
        ${lane.meilensteine.map(m => `
          <li class="rm-detail__item${m.status === 'entfallen' ? ' is-gone' : ''}">
            <button type="button" class="rm-detail__mslink" data-ms="${esc(m.id)}" data-lane="${esc(lane.id)}">
              <span class="rm-detail__d">${fmtShort(m.datum)}</span>
              ${m.status === 'erreicht' ? '✓ ' : ''}${m.klaerung ? '⚠ ' : ''}${esc(m.titel)}
              <span class="rm-detail__status rm-detail__status--${m.status}">${STATUS_LABEL[m.status] || esc(m.status)}</span>
            </button>
          </li>`).join('')}
      </ul>
    </div>`;
  }
  const hit = findMs(state.selected.id);
  if (!hit) return '';
  const { m, lane } = hit;
  const areaName = lane ? areaOf(lane.area).name : 'Externer Fixpunkt';
  const issueLink = m.issue
    ? `<a class="rm-detail__issue" href="https://github.com/${esc(m.issue.replace('#', '/issues/'))}" target="_blank" rel="noopener">${esc(m.issue)}</a>`
    : '';
  return `
  <div class="status-section rm-detail">
    <div class="rm-detail__head">
      <h3 class="rm-detail__title">${m.status === 'erreicht' ? '✓ ' : ''}${esc(m.titel)}</h3>
      <span class="rm-detail__meta">${fmtDate(m.datum)}${m.zeitraum ? ` (${fmtShort(m.zeitraum.von)} bis ${fmtShort(m.zeitraum.bis)})` : ''} · ${esc(areaName)}${lane ? ' · ' + esc(lane.name) : ''} · ${TYP_LABEL[m.typ] || esc(m.typ)}</span>
      <button type="button" class="rm-detail__close" data-close aria-label="Schließen">×</button>
    </div>
    <p class="rm-detail__body">
      Status: <span class="rm-detail__status rm-detail__status--${m.status}">${STATUS_LABEL[m.status] || esc(m.status)}</span>
      ${m.erreichtAm ? ' am ' + fmtDate(m.erreichtAm) : ''} ${issueLink ? ' · Issue ' + issueLink : ''}
    </p>
    ${m.details ? `<p class="rm-detail__body">${esc(m.details)}</p>` : ''}
    ${m.confidence ? `<p class="rm-detail__body">Confidence: <b>${CONF_LABEL[m.confidence]}</b> ${confSymbolHtml(m.confidence)}</p>` : ''}
    ${m.abhaengigkeit ? `<p class="rm-detail__body">Abhängigkeit: ${esc(m.abhaengigkeit)}</p>` : ''}
    ${m.klaerung ? `<p class="rm-detail__warn">⚠ Abhängigkeit bzw. Termin noch zu klären</p>` : ''}
    ${lane ? `<button type="button" class="rm-detail__backlink" data-lanebtn="${esc(lane.id)}">Alle Meilensteine von „${esc(lane.name)}" zeigen</button>` : ''}
  </div>`;
}

/* --- Geparkt + Tabelle + Legende --- */
function parkedHtml() {
  if (!DATA.geparkt || !DATA.geparkt.length) return '';
  return `
  <div class="status-section rm-parked">
    <h3 class="status-section__title">BEWUSST GEPARKT</h3>
    <ul class="rm-parked__list">
      ${DATA.geparkt.map(g => `<li><b>${esc(g.titel)}</b>${g.wiedervorlage ? ` · Wiedervorlage ${fmtDate(g.wiedervorlage)}` : ''}${g.hinweis ? ` · ${esc(g.hinweis)}` : ''}</li>`).join('')}
    </ul>
  </div>`;
}
function tableHtml() {
  const rows = [];
  DATA.fixpunkte.forEach(m => rows.push({ m, area: 'Fixpunkt', lane: 'Externe Fixpunkte' }));
  DATA.lanes.forEach(l => l.meilensteine.forEach(m => rows.push({ m, area: areaOf(l.area).name, lane: l.name })));
  rows.sort((a, b) => a.m.datum.localeCompare(b.m.datum));
  return `
  <details class="rm-tablewrap">
    <summary>Tabellenansicht: alle Meilensteine chronologisch (${rows.length})</summary>
    <table class="proj-table rm-table">
      <thead><tr><th>Datum</th><th>Area</th><th>Kernschwerpunkt</th><th>Meilenstein</th><th>Typ</th><th>Status</th></tr></thead>
      <tbody>
        ${rows.map(r => `
        <tr class="${r.m.status === 'entfallen' ? 'is-gone' : ''}">
          <td class="rm-table__d">${fmtDate(r.m.datum)}</td>
          <td>${esc(r.area)}</td>
          <td>${esc(r.lane)}</td>
          <td class="proj-table__name">${r.m.klaerung ? '⚠ ' : ''}${esc(r.m.titel)}</td>
          <td>${TYP_LABEL[r.m.typ] || esc(r.m.typ)}</td>
          <td><span class="rm-detail__status rm-detail__status--${r.m.status}">${STATUS_LABEL[r.m.status] || esc(r.m.status)}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </details>`;
}
function legendHtml() {
  return `
  <div class="rm-legend">
    <span class="rm-legend__item"><span class="rm-shape rm-shape--ms"></span> Meilenstein</span>
    <span class="rm-legend__item"><span class="rm-shape rm-shape--key"></span> Schlüsselereignis</span>
    <span class="rm-legend__item"><span class="rm-shape rm-shape--dec"></span> Entscheidungspunkt</span>
    <span class="rm-legend__item"><span class="rm-shape rm-shape--fix"></span> Externer Fixpunkt</span>
    <span class="rm-legend__item"><span class="rm-shape rm-shape--solid"></span> committed</span>
    <span class="rm-legend__item"><span class="rm-shape rm-shape--dash"></span> läuft im Hintergrund / nicht committed bzw. vorläufig</span>
    <span class="rm-legend__item">⚠ Abhängigkeit / zu klären</span>
    <span class="rm-legend__item">✓ erreicht</span>
    <span class="rm-legend__item">Confidence: <span class="rm-conf rm-conf--hoch">●●●</span> hoch · <span class="rm-conf rm-conf--mittel">●●○</span> mittel · <span class="rm-conf rm-conf--niedrig">●○○</span> niedrig</span>
  </div>`;
}

/* --- Label-Kollisionen auflösen: überlappende Labels derselben Seite
       weichen auf eine zweite Ebene aus (nach dem Layout gemessen) --- */
function resolveLabelCollisions(root) {
  root.querySelectorAll('.rm-mslabel--far, .rm-mslabel--tight').forEach(el =>
    el.classList.remove('rm-mslabel--far', 'rm-mslabel--tight'));
  root.querySelectorAll('.rm-lane__zone').forEach(zone => {
    ['above', 'below'].forEach(side => {
      const labels = [...zone.querySelectorAll('.rm-mslabel--' + side)]
        .map(el => ({ el, rect: el.getBoundingClientRect() }))
        .sort((a, b) => a.rect.left - b.rect.left);
      let nearRight = -Infinity, farRight = -Infinity;
      labels.forEach(l => {
        if (l.rect.left < nearRight + 10) {
          l.el.classList.add('rm-mslabel--far');
          if (l.rect.left < farRight + 10) l.el.classList.add('rm-mslabel--tight');
          farRight = Math.max(farRight, l.rect.right);
        } else {
          nearRight = Math.max(nearRight, l.rect.right);
        }
      });
    });
  });
}

/* --- Tooltip --- */
function bindTooltip(root) {
  let tip = document.getElementById('rm-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'rm-tooltip';
    document.body.appendChild(tip);
  }
  root.querySelectorAll('.rm-marker').forEach(el => {
    el.addEventListener('mouseenter', () => {
      const hit = findMs(el.dataset.ms);
      if (!hit) return;
      const { m, lane } = hit;
      tip.innerHTML = `
        <div class="rm-tip__date">${fmtDate(m.datum)} · ${lane ? esc(areaOf(lane.area).name) + ' · ' + esc(lane.name) : 'Externer Fixpunkt'}</div>
        <div class="rm-tip__title">${m.status === 'erreicht' ? '✓ ' : ''}${esc(m.titel)}</div>
        ${m.confidence ? `<div class="rm-tip__conf">Confidence: ${CONF_LABEL[m.confidence]} ${confSymbolHtml(m.confidence)}</div>` : ''}
        ${m.details ? `<div class="rm-tip__body">${esc(m.details)}</div>` : ''}
        ${m.abhaengigkeit ? `<div class="rm-tip__dep">Abhängigkeit: ${esc(m.abhaengigkeit)}</div>` : ''}
        ${m.klaerung ? `<div class="rm-tip__warn">⚠ Abhängigkeit / zu klären</div>` : ''}
        <div class="rm-tip__hint">Klick für Details</div>`;
      tip.style.display = 'block';
      const r = el.getBoundingClientRect();
      let tx = r.left + 16, ty = r.top - 10;
      tip.style.left = '0px'; tip.style.top = '0px';
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      if (tx + tw > innerWidth - 12) tx = r.left - tw - 12;
      if (ty + th > innerHeight - 12) ty = innerHeight - th - 12;
      if (ty < 8) ty = 8;
      tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
    });
    el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  });
}

/* --- Render --- */
function render() {
  const main = document.getElementById('main');
  const staleTip = document.getElementById('rm-tooltip');
  if (staleTip) staleTip.style.display = 'none';
  const p = overallProgress();
  main.innerHTML = `
    <div class="rm-head">
      <div>
        <h2 class="rm-head__title">Kernschwerpunkte-Roadmap ${DATA.zeitraum.start.slice(0, 4)}</h2>
        <div class="rm-head__meta">Stand ${fmtDate(DATA.stand)} · Version ${esc(DATA.version)}${DATA.hinweis ? ' · ' + esc(DATA.hinweis.split('.')[0]) : ''}</div>
      </div>
      <div class="rm-head__progress">
        <span class="rm-head__count"><b>${p.done}</b> von <b>${p.total}</b> Meilensteinen erreicht</span>
        <div class="rm-progress rm-progress--big"><div class="rm-progress__fill" style="width:${p.total ? (p.done / p.total) * 100 : 0}%;--rm-c:var(--secondary)"></div></div>
      </div>
    </div>
    ${toolbarHtml()}
    ${legendHtml()}
    ${chartHtml()}
    ${detailHtml()}
    ${parkedHtml()}
    ${tableHtml()}
    <footer class="footer">Quelle: <code>data/roadmap/roadmap-2026.json</code> ·
      durchgezogener Balken = committed, gestrichelt = läuft im Hintergrund bzw. noch nicht committed
    </footer>`;

  document.getElementById('header-meta').textContent = `Roadmap · Stand ${fmtDate(DATA.stand)}`;

  // Interaktion
  main.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => { state.zoom = b.dataset.zoom; update(); }));
  main.querySelectorAll('[data-toggle]').forEach(t => t.addEventListener('change', () => {
    if (t.dataset.toggle === 'fix') state.fix = t.checked;
    if (t.dataset.toggle === 'dec') state.decisions = t.checked;
    if (t.dataset.toggle === 'done') state.achieved = t.checked;
    update();
  }));
  main.querySelectorAll('[data-area]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.area;
    const all = new Set(DATA.areas.map(a => a.id));
    if (!state.areas) state.areas = all;
    if (state.areas.has(id)) state.areas.delete(id); else state.areas.add(id);
    if (state.areas.size === 0 || state.areas.size === all.size) state.areas = null;
    update();
  }));
  main.querySelectorAll('[data-ms]').forEach(el => el.addEventListener('click', () => {
    state.selected = { kind: 'ms', id: el.dataset.ms };
    update();
  }));
  main.querySelectorAll('[data-lanebtn]').forEach(el => el.addEventListener('click', () => {
    state.selected = { kind: 'lane', id: el.dataset.lanebtn };
    update();
  }));
  main.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => { state.selected = null; update(); }));
  resolveLabelCollisions(main);
  bindTooltip(main);
}

function update() {
  writeStateToUrl();
  render();
}

/* --- Init --- */
(async function init() {
  const main = document.getElementById('main');
  try {
    const res = await fetch(ROADMAP_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DATA = await res.json();
  } catch (err) {
    main.innerHTML = `<div class="status-section rm-detail rm-detail--empty">
      Roadmap-Daten nicht gefunden (<code>${esc(ROADMAP_URL)}</code>).<br>
      In der lokalen Entwicklung: <code>ln -s ../data src/data</code> anlegen. (${esc(err.message)})</div>`;
    document.getElementById('header-meta').textContent = 'Roadmap · Daten fehlen';
    return;
  }
  DATA.areas.forEach(a => { AREA[a.id] = a; });
  const h2p = ZOOMS.find(z => z.key === 'h2p');
  if (DATA.zeitraum.ausblickLabel) h2p.label = 'inkl. ' + DATA.zeitraum.ausblickLabel;
  readStateFromUrl();
  render();

  // Labels nach Font-Swap und bei Resize neu vermessen
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => resolveLabelCollisions(document.getElementById('main')));
  }
  let resizeTimer = null;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => resolveLabelCollisions(document.getElementById('main')), 150);
  });
})();
