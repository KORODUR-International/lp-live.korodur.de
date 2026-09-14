/**
 * KORODUR Work Cockpit Reporting v3
 * Umbau #181 nach dem in #149 gelockten Ziel-Layout (16.08.2026), Stufe 2
 * nach #237 (14.09.2026): Ringe gestern und heute im Kopf, Segmente,
 * Phasen je Repo nach Roadmap-Bereichen mit Sammelbecken und
 * Meilenstein-Hover, Hebel, Mini-Chart je Phase (KW-Endstand), Owner-Split
 * im Fuss. Bewegung, Meilenstein-Leiste, Meilenstein-Anteil und
 * Bereichszeile stehen seit #237 nicht mehr auf der Seite; ihre
 * Render-Funktionen bleiben, bis entschieden ist, ob sie zurückkommen.
 * Grundsatz: nur Zaehlungen, keine Issue-Titel, keine Freitexte.
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
let roadmapCache;              // undefined = ungeladen, null = nicht verfuegbar (#182)

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
    loadRoadmapFuerMatrix();
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

function chipHtml(diff, art, refDatum, invert, einheit) {
  if (diff == null) return '';
  const sign = diff > 0 ? '+' : '';
  const gut = invert ? diff < 0 : diff > 0;
  const cls = diff === 0 ? 'delta--neutral' : (gut ? 'delta--up' : 'delta--down');
  const was = art === 'T' ? 'Vortag' : 'Vorwoche';
  // `einheit` steht im Tooltip, nicht im Chip: eine Kachel zeigt Items, die
  // Meilenstein-Kachel Prozentpunkte, und "+3" heisst in beiden etwas
  // anderes. Der Chip bleibt kurz, der Titel sagt, was gemeint ist.
  return `<span class="delta ${cls}" title="gegen ${was} (${shortDayLabel(refDatum)})${einheit || ''}">${sign}${diff} ${art}</span>`;
}

// ─── Kopf: Ringe gestern und heute (#237) ────────────
// Zwei Ringe über alle aktiven Phasen, dazwischen die Zahlen mit Differenz.
// Der Ring zeigt die Verteilung, die Tabelle die Bewegung: eine Änderung um
// zwei Items sind bei rund 220 aktiven drei Grad Bogen, das sieht niemand
// (Entscheidung Steffi, 14.09.2026). Farben: Backlog bis In Review als
// Navy-Stufen hell nach dunkel (Fortschritt), Blockiert als Status rot,
// On Hold grau schraffiert (geparkt, kein Alarm). Mit dem dataviz-Validator
// geprüft: alle Nachbarpaare im Ring einschließlich Umlauf bestehen CVD und
// Normalsicht; die Legende trägt immer Text, die Schraffur ist die zweite
// Kodierung für On Hold.
const RING_PHASEN = [
  { label: 'Backlog', farbe: '#bcd0e2', wert: bs => bs['Backlog'] },
  { label: 'Bereit', farbe: '#6f93b3', wert: bs => bs['Bereit'] },
  {
    label: 'In Arbeit', farbe: '#2f5b85',
    wert: bs => ('In Progress' in bs || 'Beansprucht' in bs)
      ? (bs['In Progress'] || 0) + (bs['Beansprucht'] || 0) : undefined,
  },
  { label: 'In Review', farbe: '#002d59', wert: bs => bs['In Review'] },
  { label: 'Blockiert', farbe: '#d64541', wert: bs => bs['Blocked'] },
  { label: 'On Hold', farbe: 'url(#ring-schraffur)', legende: 'ring-punkt--schraffur', wert: bs => bs['On Hold'] },
  { label: 'Ohne Status', farbe: '#4d5660', nurWennDa: true, wert: bs => bs['none'] },
];
const RING_R = 62;
const RING_BREITE = 20;
const RING_LUECKE = 2;   // px Flächenlücke zwischen zwei Stücken

// Phasen einer Verteilung. `null` heißt: die Phase gab es in der Quelle
// nicht (Statusmodell-Bruch), dann erscheint sie nicht als 0.
function ringTeile(bs) {
  bs = bs || {};
  return RING_PHASEN
    .map(p => {
      const w = p.wert(bs);
      return { ...p, n: (w === undefined || w === null) ? null : w };
    })
    .filter(p => !p.nurWennDa || p.n > 0);
}

function ringSumme(teile) {
  return teile.reduce((s, t) => s + (t.n || 0), 0);
}

function ringSvg(teile, ariaLabel) {
  const summe = ringSumme(teile);
  const c = 2 * Math.PI * RING_R;
  const mitte = RING_R + RING_BREITE / 2 + 2;
  const groesse = mitte * 2;
  let versatz = 0;
  const stuecke = teile.filter(t => t.n > 0).map(t => {
    const laenge = (t.n / summe) * c;
    const sichtbar = Math.max(laenge - RING_LUECKE, 0.8);
    const svg = `<circle cx="${mitte}" cy="${mitte}" r="${RING_R}" fill="none"
        stroke="${t.farbe}" stroke-width="${RING_BREITE}"
        stroke-dasharray="${sichtbar.toFixed(2)} ${(c - sichtbar).toFixed(2)}"
        stroke-dashoffset="${(-versatz).toFixed(2)}"
        transform="rotate(-90 ${mitte} ${mitte})"><title>${t.label}: ${t.n} (${Math.round((t.n / summe) * 100)} %)</title></circle>`;
    versatz += laenge;
    return svg;
  }).join('');
  return `
    <svg class="ring__svg" viewBox="0 0 ${groesse} ${groesse}" role="img" aria-label="${ariaLabel}">
      ${stuecke}
      <text x="${mitte}" y="${mitte + 2}" text-anchor="middle" class="ring__zahl">${summe}</text>
      <text x="${mitte}" y="${mitte + 20}" text-anchor="middle" class="ring__einheit">aktiv</text>
    </svg>`;
}

function tagVorher(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function renderRinge(data) {
  const datum = (data._meta && data._meta.snapshot_date) || '';
  const heute = ringTeile(data.by_status);
  if (!ringSumme(heute)) return '';
  const { vortag } = deltaRefs(datum);
  const gestern = vortag && vortag.by_status ? ringTeile(vortag.by_status) : null;

  const heuteLabel = `${availableSnapshots[0] === datum ? 'Heute' : 'Stand'}, ${shortDayLabel(datum)}`;
  const gesternLabel = gestern
    ? `${vortag.date === tagVorher(datum) ? 'Gestern' : 'Letzter Stand davor'}, ${shortDayLabel(vortag.date)}`
    : 'Gestern';

  const nGestern = label => {
    if (!gestern) return null;
    const t = gestern.find(g => g.label === label);
    return t ? t.n : null;
  };
  const zahl = n => (n === null ? 'n.&nbsp;v.' : n);
  const zeilen = heute.map(t => {
    const g = nGestern(t.label);
    const diff = (g === null || t.n === null) ? null : t.n - g;
    const diffText = diff === null ? '' : (diff > 0 ? `+${diff}` : String(diff));
    const diffKlasse = diff ? ' ring-tab__diff--bewegt' : '';
    const punkt = t.legende
      ? `<span class="ring-punkt ${t.legende}"></span>`
      : `<span class="ring-punkt" style="background:${t.farbe}"></span>`;
    return `<tr>
        <th scope="row">${punkt}${t.label}</th>
        <td>${gestern ? zahl(g) : ''}</td>
        <td class="ring-tab__heute">${zahl(t.n)}</td>
        <td class="ring-tab__diff${diffKlasse}">${diffText}</td>
      </tr>`;
  }).join('');
  const summeG = gestern ? ringSumme(gestern) : null;
  const summeH = ringSumme(heute);
  const summeDiff = summeG === null ? '' : (summeH - summeG > 0 ? `+${summeH - summeG}` : String(summeH - summeG));

  // Das Schraffur-Muster steht einmal auf der Seite, beide Ringe verweisen
  // darauf; zwei gleiche IDs im Dokument wären ungültig.
  return `
    <div class="ringe fade-in">
      <svg class="ring__defs" width="0" height="0" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="ring-schraffur" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#e6e9ec"/>
            <line x1="0" y1="0" x2="0" y2="6" stroke="#8a939b" stroke-width="2.4"/>
          </pattern>
        </defs>
      </svg>
      <figure class="ring">
        ${gestern ? ringSvg(gestern, `Aktive Items je Phase, ${gesternLabel}`) : '<div class="ring__leer">Für den Vortag gibt es keinen Snapshot.</div>'}
        <figcaption class="ring__titel">${gesternLabel}</figcaption>
      </figure>
      <table class="ring-tab">
        <thead><tr><th></th><th>gestern</th><th>heute</th><th>&plusmn;</th></tr></thead>
        <tbody>${zeilen}</tbody>
        <tfoot><tr><th scope="row">Aktiv gesamt</th><td>${summeG === null ? '' : summeG}</td><td class="ring-tab__heute">${summeH}</td><td class="ring-tab__diff${summeDiff && summeDiff !== '0' ? ' ring-tab__diff--bewegt' : ''}">${summeDiff}</td></tr></tfoot>
      </table>
      <figure class="ring">
        ${ringSvg(heute, `Aktive Items je Phase, ${heuteLabel}`)}
        <figcaption class="ring__titel">${heuteLabel}</figcaption>
      </figure>
    </div>`;
}

function renderKopf(data) {
  const datum = data._meta && data._meta.snapshot_date;
  const { vortag, vorwoche } = deltaRefs(datum || '');

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

  // Meilenstein-Anteil (#227): Anteil der offenen Items, die auf einen
  // Roadmap-Meilenstein einzahlen. Alte Snapshots kennen den Block nicht,
  // dann entfaellt die Kachel, statt 0 % zu behaupten.
  const msB = data.meilenstein && data.meilenstein.bestand;
  const msWert = msAnteil(msB);
  let msKachel = '';
  if (msWert != null) {
    const refTms = vortag ? msAnteil(vortag.meilenstein) : null;
    const refWms = vorwoche ? msAnteil(vorwoche.meilenstein) : null;
    const msChips =
      (refTms != null ? chipHtml(msWert - refTms, 'T', vortag.date, false, ' Punkte') : '') +
      (refWms != null ? chipHtml(msWert - refWms, 'W', vorwoche.date, false, ' Punkte') : '');
    msKachel = kachel('Auf Meilenstein', msWert + '&thinsp;%', {
      detail: `${msB.auf} von ${msB.auf + msB.adhoc + msB.leer} offenen · ${msB.adhoc} adhoc · ${msB.leer} unklassifiziert `,
      chips: msChips,
    });
  }

  return `
    <div class="kopf fade-in">
      <h1 class="kopf__titel">Reporting</h1>
      <p class="kopf__stand">Stand ${formatSnapshotLabel(datum || '')}${zeit ? ', ' + zeit + ' Uhr' : ''} · ${quelle}</p>
    </div>
    ${renderRinge(data)}
    <div class="kpi-row kpi-row--kopf kpi-row--kopf-klein">
      ${kachel(kwNr ? 'Erledigt / KW ' + kwNr : 'Erledigt / KW', erledigt, { chips: erledigtChip })}
      ${msKachel}
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
  // Rename 19.08.2026: alter Slug bleibt fuer Snapshots vor dem Rename,
  // beide tragen dasselbe Kuerzel, damit die Spalte ueber die Zeitreihe
  // wiedererkennbar ist.
  'KORODUR-International/korodur-produktdatenbank': 'dpi',
  'KORODUR-International/korodur-digitale-produktinformationen': 'dpi',
  'KORODUR-International/korodur-lokale-ki': 'ki',
  'KORODUR-International/korodur-redaktion': 'red',
  'KORODUR-International/korodur-translation': 'tr',
  'KORODUR-International/korodur-skills': 'sk',
  'KORODUR-International/korodur-tds-output': 'tds',
  'KORODUR-International/korodur-ausschreibungstexte': 'at',
  'KORODUR-International/korodur-rapidset': 'rs',
  'KORODUR-International/korodur-military': 'mil',
  'KORODUR-International/korodur-corporate-design': 'cd',
  'KORODUR-International/korodur-konzepte': 'kz',
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

// Projekt-Repos der Roadmap, nach Bereich (#237, Entscheidung Steffi
// 14.09.2026): je Projekt ein Repo, Organisation & Enablement trägt zwei
// (Operating Model und Review & Reporting), CRM trägt zwei Lanes. Alle
// übrigen Repos laufen ins Sammelbecken; sie gehen nach und nach in die
// Projekt-Repos über. `lanes` sind die IDs aus roadmap-2026.json und
// speisen den Hover mit den nächsten Meilensteinen. `repos` führt Aliasse
// alter Slugs, damit ältere Snapshots dieselbe Spalte treffen.
const ROADMAP_PROJEKTE = [
  { bereich: 'Marketing', projekte: [
    { repos: ['sfleischmann-3steps2/KORODUR-Website'], lanes: ['website'] },
    { repos: ['KORODUR-International/korodur-redaktion'], lanes: ['content'] },
  ] },
  { bereich: 'CRM & Sales Ops', projekte: [
    { repos: ['KORODUR-International/korodur-crm'], lanes: ['vertriebsprozess', 'crm-daten'] },
  ] },
  { bereich: 'Wissensaufbau', projekte: [
    { repos: ['KORODUR-International/korodur-digitale-produktinformationen', 'KORODUR-International/korodur-produktdatenbank'], lanes: ['pdb'] },
    { repos: ['KORODUR-International/korodur-referenzverzeichnis'], lanes: ['referenzen'] },
  ] },
  { bereich: 'Internationalisierung', projekte: [
    { repos: ['KORODUR-International/korodur-translation'], lanes: ['uebersetzungen'] },
  ] },
  { bereich: 'AI & Infrastruktur', projekte: [
    { repos: ['KORODUR-International/korodur-lokale-ki'], lanes: ['lokale-ki'] },
    { repos: ['KORODUR-International/korodur-operating-model'], lanes: ['orga'] },
    { repos: ['KORODUR-International/korodur-review-reporting'], lanes: ['orga'] },
  ] },
];
const MATRIX_MEILENSTEINE = 3;

// Auf Meilenstein, adhoc oder unklassifiziert: dieselbe Regel wie
// meilenstein_bucket in scripts/fetch_snapshot.py.
function msKlasse(ids) {
  if (!ids || !ids.length) return 'leer';
  return ids.some(i => i !== 'adhoc') ? 'auf' : 'adhoc';
}

// Die nächsten offenen Meilensteine der Lanes eines Projekts, nach Datum.
// Überfällige zuerst, weil sie früher liegen, und als solche benannt.
function naechsteMeilensteine(roadmap, lanes, heute, anzahl = MATRIX_MEILENSTEINE) {
  if (!roadmap) return null;
  return (roadmap.lanes || [])
    .filter(l => lanes.includes(l.id))
    .flatMap(l => l.meilensteine || [])
    .filter(m => m && m.datum && m.titel && m.status !== 'erreicht' && m.status !== 'entfallen')
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .slice(0, anzahl)
    .map(m => ({ ...m, ueberfaellig: m.datum < heute }));
}

// Spalten der Matrix: erst die Projekt-Repos in Bereichsreihenfolge, dann
// ein Sammelbecken aus allen übrigen Repos mit aktiven Issues.
function matrixSpalten(data) {
  const projekte = (data.projects || []).filter(p => p && p.by_status);
  const vergeben = new Set();
  const spalten = [];
  ROADMAP_PROJEKTE.forEach((g, gi) => g.projekte.forEach((pr, pi) => {
    const treffer = projekte.filter(p => pr.repos.includes(p.name));
    treffer.forEach(p => vergeben.add(p.name));
    spalten.push({
      bereich: g.bereich, gruppeStart: pi === 0, name: pr.repos[0],
      kuerzel: repoKuerzel(pr.repos[0]), repos: pr.repos, lanes: pr.lanes, projekte: treffer,
    });
  }));
  const rest = projekte.filter(p => !vergeben.has(p.name) && projektAktiv(p) > 0)
    .sort((a, b) => projektAktiv(b) - projektAktiv(a));
  if (rest.length) {
    spalten.push({
      bereich: 'Sammelbecken', gruppeStart: true, name: 'Sammelbecken', kuerzel: 'weitere',
      repos: rest.map(p => p.name), lanes: [], projekte: rest, sammelbecken: true,
    });
  }
  return spalten;
}

function spalteStatus(sp, phase) {
  return sp.projekte.reduce((s, p) => s + (p.by_status[phase] || 0), 0);
}

function spalteAktiv(sp) {
  return sp.projekte.reduce((s, p) => s + projektAktiv(p), 0);
}

function spalteTitel(sp, roadmap, heute) {
  if (sp.sammelbecken) {
    return 'Sammelbecken: ' + sp.projekte.map(p => `${repoKuerzel(p.name)} ${projektAktiv(p)}`).join(' · ');
  }
  const ms = naechsteMeilensteine(roadmap, sp.lanes, heute);
  if (!ms) return sp.name;
  const zeilen = ms.length
    ? ms.map(m => `${m.datum.slice(8, 10)}.${m.datum.slice(5, 7)}. ${escHtml(m.titel)}${m.ueberfaellig ? ' (überfällig)' : ''}`)
    : ['keine offenen Meilensteine'];
  return `${sp.name}&#10;Nächste Meilensteine:&#10;${zeilen.join('&#10;')}`;
}

function renderMatrix(data, roadmap) {
  const projekte = (data.projects || []).filter(p => p && p.by_status);
  if (!projekte.length) {
    return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">PHASEN JE REPO</h3>
      <p class="matrix__hinweis">Die Phasen-Matrix gibt es ab Snapshot v3 (16.08.2026). Dieser Snapshot ist älter; die Kopfzahlen und der Zeitverlauf gelten weiter.</p>
    </div>`;
  }

  const heute = (roadmap && msHeute(roadmap)) || (data._meta && data._meta.snapshot_date) || '';
  const spalten = matrixSpalten(data);
  const ohneStatus = spalten.some(sp => spalteStatus(sp, 'none') > 0);
  const zeilen = ohneStatus ? [...PHASEN, 'none'] : PHASEN;
  const start = sp => (sp.gruppeStart ? ' matrix__gruppe-start' : '');
  const td = (cls, inhalt, extra = '') => `<td${cls.trim() ? ` class="${cls.trim()}"` : ''}${extra}>${inhalt}</td>`;

  const gruppen = [];
  spalten.forEach(sp => {
    if (!gruppen.length || gruppen[gruppen.length - 1].bereich !== sp.bereich) gruppen.push({ bereich: sp.bereich, n: 0 });
    gruppen[gruppen.length - 1].n++;
  });
  const kopfBereiche = `<tr class="matrix__bereiche"><th class="matrix__phase"></th>${gruppen.map(g =>
    `<th class="matrix__bereich matrix__gruppe-start" colspan="${g.n}">${escHtml(g.bereich)}</th>`).join('')}<th class="matrix__summe"></th></tr>`;
  const kopf = `<tr><th class="matrix__phase"></th>${spalten.map(sp =>
    `<th class="matrix__repo${start(sp)}" title="${spalteTitel(sp, roadmap, heute)}">${sp.kuerzel}</th>`).join('')}<th class="matrix__summe">Summe</th></tr>`;

  const rows = zeilen.map(phase => {
    const werte = spalten.map(sp => spalteStatus(sp, phase));
    const summe = werte.reduce((a, b) => a + b, 0);
    const label = phase === 'none' ? 'Ohne Status' : phase;
    const warn = phase === 'Blocked';
    return `<tr class="${warn ? 'matrix__zeile--warn' : ''}${phase === 'none' ? ' matrix__zeile--triage' : ''}">
      <th class="matrix__phase">${label}</th>
      ${werte.map((w, i) => td(start(spalten[i]), w || '')).join('')}
      <td class="matrix__summe">${summe}</td>
    </tr>`;
  }).join('');

  const gesamt = spalten.reduce((s, sp) => s + spalteAktiv(sp), 0);
  const fuss = `<tr class="matrix__fuss">
    <th class="matrix__phase">Aktiv</th>
    ${spalten.map(sp => td(start(sp), spalteAktiv(sp))).join('')}
    <td class="matrix__summe">${gesamt}</td>
  </tr>`;

  // Abgleich Arbeit gegen Roadmap: Anteil der aktiven Items je Spalte, die
  // auf einen Meilenstein einzahlen. Aus den Item-Zeilen, die das Feld seit
  // Snapshot 3.3 tragen; ältere Snapshots lassen die Zeile weg.
  let msZeile = '';
  if (data.meilenstein && Array.isArray(data.items) && data.items.length) {
    const zaehle = repos => {
      const eigene = data.items.filter(r => repos.includes(r.repo));
      return { auf: eigene.filter(r => msKlasse(r.meilensteine) === 'auf').length, alle: eigene.length };
    };
    const je = spalten.map(sp => zaehle(sp.repos));
    const sum = je.reduce((s, z) => ({ auf: s.auf + z.auf, alle: s.alle + z.alle }), { auf: 0, alle: 0 });
    const zelle = (z, cls) => z.alle
      ? td(cls, `${Math.round((z.auf / z.alle) * 100)}&thinsp;%`, ` title="${z.auf} von ${z.alle} aktiven Items auf einem Roadmap-Meilenstein"`)
      : td(cls, '');
    msZeile = `<tr class="matrix__ms">
      <th class="matrix__phase">davon auf Meilenstein</th>
      ${je.map((z, i) => zelle(z, start(spalten[i]))).join('')}
      ${zelle(sum, 'matrix__summe')}
    </tr>`;
  }

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">PHASEN JE REPO</h3>
      <div class="matrix-scroll">
        <table class="matrix">
          <thead>${kopfBereiche}${kopf}</thead>
          <tbody>${rows}</tbody>
          <tfoot>${fuss}${msZeile}</tfoot>
        </table>
      </div>
      <p class="matrix__fussnote">Zahlen sind aktive Issues (ohne Done und Verworfen). Spalten sind die Projekt-Repos der Roadmap nach Bereich, dazu das Sammelbecken für alle übrigen Repos. Maus auf ein Kürzel zeigt das Repo und die nächsten ${MATRIX_MEILENSTEINE} offenen Meilensteine; mehr auf dem Reiter <a href="roadmap.html">Roadmap</a>.</p>
    </div>
  `;
}

// ─── Meilenstein-Leiste (#182) ───────────────────────
// Schmale Sektion zwischen Matrix und Zeitverlauf: der Blick auf die
// Meilensteine, deretwegen priorisiert wird. Kommende Termine der naechsten
// 60 Tage aus roadmap-2026.json, Ueberfaellige mit Verzugstiefe aus den
// kennzahlen der roadmap-historie.json (dort vom Tageslauf aus dem
// Aenderungsprotokoll `aenderungen` aggregiert). Meilenstein-Titel sind auf
// der Roadmap-Seite bereits oeffentlich, das ist kein neuer
// Vertraulichkeitsfall; entfallene Termine erscheinen nie. Fehlen die
// Dateien, faellt nur diese Sektion weg, nie die Board-Seite.
const ROADMAP_URL = 'data/roadmap/roadmap-2026.json';
const MS_FENSTER_TAGE = 60;
// Confidence oeffentlich nur als Symbol, gleiche Sprache wie roadmap.js.
const MS_CONF_SYMBOL = { hoch: '●●●', mittel: '●●○', niedrig: '●○○' };
const MS_TYP_LABEL = {
  meilenstein: 'Meilenstein', schluessel: 'Schlüsselereignis',
  entscheidung: 'Entscheidungspunkt', fixpunkt: 'Externer Fixpunkt',
};

// Roadmap-Titel sind Freitext aus der JSON und laufen als einzige Inhalte
// dieser Seite durch innerHTML; alles andere sind Zaehlungen.
function escHtml(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// Einzige Heute-Quelle, wie auf der Roadmap-Seite: erst `heute` aus der
// JSON, sonst das Systemdatum.
function msHeute(roadmap) {
  if (roadmap && roadmap.heute) return roadmap.heute;
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}

function addTage(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diffTage(von, bis) {
  return Math.round((new Date(bis + 'T00:00:00Z') - new Date(von + 'T00:00:00Z')) / 86400000);
}

// Alle Termine der Roadmap: Lane-Meilensteine plus externe Fixpunkte.
function roadmapTermine(roadmap) {
  return (roadmap.lanes || []).flatMap(l => l.meilensteine || [])
    .concat(roadmap.fixpunkte || [])
    .filter(m => m && m.datum && m.titel);
}

// Auswahl fuer die Leiste: erreicht und entfallen fallen raus, der Rest
// teilt sich am Heute-Datum in ueberfaellig (mit Verzugstiefe aus den
// Historie-Kennzahlen) und kommend (bis einschliesslich Tag 60).
function meilensteinAuswahl(roadmap, kennzahlen, heute) {
  const offen = roadmapTermine(roadmap)
    .filter(m => m.status !== 'erreicht' && m.status !== 'entfallen');
  const grenze = addTage(heute, MS_FENSTER_TAGE);
  const kommend = offen
    .filter(m => m.datum >= heute && m.datum <= grenze)
    .sort((a, b) => a.datum.localeCompare(b.datum));
  const ueberfaellig = offen
    .filter(m => m.datum < heute)
    .map(m => ({ ...m, tage: diffTage(m.datum, heute), verzug: (kennzahlen || {})[m.id] || null }))
    .sort((a, b) => b.tage - a.tage);
  return { kommend, ueberfaellig };
}

function verzugText(m) {
  const teile = [`seit ${m.tage} Tag${m.tage === 1 ? '' : 'en'} überfällig`];
  if (m.verzug && m.verzug.verschiebungen > 0) {
    const t = m.verzug.tageGesamt;
    teile.push(`${m.verzug.verschiebungen}× verschoben (${t >= 0 ? '+' : ''}${t} T)`);
  }
  return teile.join(' · ');
}

function msChip(m, warn) {
  const conf = m.confidence && MS_CONF_SYMBOL[m.confidence]
    ? ` <span class="ms-chip__conf" title="Confidence: ${m.confidence}">${MS_CONF_SYMBOL[m.confidence]}</span>` : '';
  const typ = MS_TYP_LABEL[m.typ] || 'Termin';
  const marker = m.typ === 'entscheidung' ? '◆ ' : '';
  const datumKurz = `${m.datum.slice(8, 10)}.${m.datum.slice(5, 7)}.`;
  const info = warn ? ` <span class="ms-chip__verzug">${verzugText(m)}</span>` : '';
  return `<span class="ms-chip${warn ? ' ms-chip--warn' : ''}" title="${escHtml(typ)} · ${m.datum}">`
    + `<span class="ms-chip__datum">${datumKurz}</span> ${marker}${escHtml(m.titel)}${conf}${info}</span>`;
}

function renderMeilensteinLeiste(roadmap, kennzahlen) {
  const heute = msHeute(roadmap);
  const { kommend, ueberfaellig } = meilensteinAuswahl(roadmap, kennzahlen, heute);
  if (!kommend.length && !ueberfaellig.length) return '';

  const gruppe = (label, chips, warn) => chips.length ? `
      <div class="ms-gruppe">
        <span class="ms-gruppe__label${warn ? ' ms-gruppe__label--warn' : ''}">${label}</span>
        ${chips.join('')}
      </div>` : '';

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">MEILENSTEINE</h3>
      ${gruppe('Überfällig', ueberfaellig.map(m => msChip(m, true)), true)}
      ${gruppe(`Nächste ${MS_FENSTER_TAGE} Tage`, kommend.map(m => msChip(m, false)), false)}
      <p class="matrix__fussnote">Aus der Roadmap${roadmap.stand ? ` (Stand ${escHtml(roadmap.stand)})` : ''}; entfallene Termine erscheinen nicht. <a href="roadmap.html">Zur Roadmap &rarr;</a></p>
    </div>`;
}

// Seit #237 steht die Leiste nicht mehr auf der Seite: die nächsten
// Meilensteine erscheinen im Hover der Matrix. Die Matrix rendert sofort aus
// dem Snapshot und bekommt die Hover-Texte nach, sobald die Roadmap geladen
// ist. Fehlt sie, bleibt der Hover beim Repo-Namen.
async function loadRoadmapFuerMatrix() {
  const host = document.getElementById('matrix-host');
  if (!host || !currentSnapshot) return;
  try {
    if (roadmapCache === undefined) {
      const res = await fetch(ROADMAP_URL);
      if (!res.ok) { roadmapCache = null; return; }
      roadmapCache = { roadmap: await res.json(), kennzahlen: {} };
    }
    if (!roadmapCache) return;
    host.innerHTML = renderMatrix(currentSnapshot, roadmapCache.roadmap);
  } catch { /* Roadmap-Daten optional: Matrix bleibt ohne Meilenstein-Hover */ }
}

// ─── Meilenstein-Anteil (#227) ───────────────────────
// Zwei Fragen, zwei Reihen: Bestand heisst "woran arbeiten wir gerade",
// Fluss "was ist tatsaechlich fertig geworden". `adhoc` ist kein Makel,
// sondern Betriebsarbeit ausserhalb der Roadmap; `unklassifiziert` ist die
// Triage-Schuld und deshalb ein eigener Wert.
const MS_ANTEIL_WOCHEN = 8;       // so viele KW im Fluss, damit es lesbar bleibt
const MS_TOPF = [
  ['auf', 'auf Meilenstein', 'ms-stack__seg--auf'],
  ['adhoc', 'adhoc', 'ms-stack__seg--adhoc'],
  ['leer', 'unklassifiziert', 'ms-stack__seg--leer'],
];

function msSumme(b) {
  return b ? (b.auf || 0) + (b.adhoc || 0) + (b.leer || 0) : 0;
}

function msAnteil(bestand) {
  const gesamt = msSumme(bestand);
  if (!gesamt) return null;
  return Math.round(((bestand.auf || 0) / gesamt) * 100);
}

function msStackHtml(b) {
  const gesamt = msSumme(b);
  if (!gesamt) return '';
  return `<div class="ms-stack">${MS_TOPF.map(([k, label, cls]) => {
    const n = b[k] || 0;
    if (!n) return '';
    return `<span class="ms-stack__seg ${cls}" style="width:${(n / gesamt) * 100}%"
                  title="${n} ${label} (${Math.round((n / gesamt) * 100)} %)"></span>`;
  }).join('')}</div>`;
}

// Wochen ab der KW, in der es das Board-Feld gibt. Davor misst die Reihe
// nicht die Ad-hoc-Quote, sondern das Fehlen des Feldes (#227).
function msWochen(data) {
  const je = (data.meilenstein && data.meilenstein.je_woche) || {};
  const seit = (data.meilenstein && data.meilenstein.feldSeit) || '';
  const abKw = seit ? isoWeekKey(seit) : '';
  return Object.keys(je)
    .filter(k => !abKw || k >= abKw)
    .sort()
    .slice(-MS_ANTEIL_WOCHEN)
    .map(k => ({ kw: k, werte: je[k] }));
}

function renderMeilensteinAnteil(data) {
  const b = data.meilenstein && data.meilenstein.bestand;
  const anteil = msAnteil(b);
  if (anteil == null) return '';
  const seit = data.meilenstein.feldSeit;
  const wochen = msWochen(data);
  const unbekannt = data.meilenstein.unbekannt || {};
  const unbekanntKeys = Object.keys(unbekannt);

  const legende = MS_TOPF.map(([k, label, cls]) =>
    `<span class="ms-legende__eintrag"><span class="ms-legende__punkt ${cls}"></span>${label} <strong>${b[k] || 0}</strong></span>`
  ).join('');

  const flussZeilen = wochen.map(w => {
    const a = msAnteil(w.werte);
    return `
      <div class="ms-woche">
        <span class="ms-woche__kw" title="${weekRangeTitle(w.kw)}">${weekLabel(w.kw)}</span>
        ${msStackHtml(w.werte)}
        <span class="ms-woche__wert">${a == null ? '–' : a + '&thinsp;%'}</span>
        <span class="ms-woche__zahlen">${msSumme(w.werte)} erledigt</span>
      </div>`;
  }).join('');

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">MEILENSTEIN-ANTEIL</h3>
      <div class="ms-bestand">
        <div class="ms-bestand__kopf">
          <span class="ms-bestand__wert">${anteil}&thinsp;%</span>
          <span class="ms-bestand__text">der ${msSumme(b)} offenen Items zahlen auf einen Roadmap-Meilenstein ein</span>
        </div>
        ${msStackHtml(b)}
        <div class="ms-legende">${legende}</div>
      </div>
      ${flussZeilen
        ? `<div class="ms-fluss">
             <h4 class="trend-sub__title">ERLEDIGT / KW NACH MEILENSTEIN</h4>
             ${flussZeilen}
           </div>`
        : ''}
      <p class="matrix__hinweis">Bestand zählt alle offenen Items, auch Backlog, wo das Bereit-Gate den Meilenstein noch nicht verlangt. Die Wochenreihe beginnt mit dem Board-Feld am ${formatSnapshotLabel(seit)}; frühere Wochen zeigten nicht die Ad-hoc-Quote, sondern das Fehlen des Feldes.${unbekanntKeys.length ? ` <strong>${unbekanntKeys.length} ID ohne Roadmap-Eintrag:</strong> ${unbekanntKeys.join(', ')}.` : ''}</p>
    </div>
  `;
}

// ─── Hebel-Block (#183) ──────────────────────────────
// Sichtbar machen, welcher Eingriff am meisten entsperrt und was still
// liegt. Quelle sind die Item-Zeilen des Snapshots: blocked_by-Kanten
// ('owner/repo#nr', offene native Dependencies) und status_seit (seit wann
// in der Phase, vom Fetcher ueber die Tages-Snapshots fortgeschrieben).
// Nur Kuerzel und Nummern auf der Seite, keine Titel, keine Gruende, keine
// Adressaten: die Adressaten-Sicht lebt im Board und in den Reviews
// (Entscheidung 16.08. in #149). Aeltere Snapshots ohne die Felder lassen
// die Sektion einfach weg.
const LIEGE_SCHWELLE_TAGE = 14;   // Anzeige ab 14 Tagen ohne Phasenwechsel
const LIEGE_MAX_ZEILEN = 12;      // Rest als Zaehler, damit die Liste lesbar bleibt
// Backlog und On Hold sind bewusst geparkte Bestaende: Stillstand ist dort
// kein Signal. Liegezeit zaehlt nur in den Arbeitsphasen.
const LIEGE_PHASEN = ['Bereit', 'Beansprucht', 'In Progress', 'In Review', 'Blocked'];
const PRIO_RANG = { P0: 0, P1: 1, P2: 2, P3: 3 };

// Eine Kante 'owner/repo#nr' als Link: Kuerzel auf der Seite, das Issue
// oeffnet auf GitHub, dort greift der Login.
function kanteLink(kante) {
  const i = kante.lastIndexOf('#');
  const repo = kante.slice(0, i);
  const nr = kante.slice(i + 1);
  return `<a class="hebel__nr" href="https://github.com/${repo}/issues/${nr}"
    target="_blank" rel="noopener" title="${repo}#${nr}">${repoKuerzel(repo)}#${nr}</a>`;
}

function topEntsperrer(items) {
  const zaehler = new Map();
  for (const r of items || []) {
    for (const kante of r.blocked_by || []) {
      zaehler.set(kante, (zaehler.get(kante) || 0) + 1);
    }
  }
  return [...zaehler.entries()]
    .map(([kante, anzahl]) => ({ kante, anzahl }))
    .sort((a, b) => b.anzahl - a.anzahl || a.kante.localeCompare(b.kante))
    .slice(0, 5);
}

function liegezeiten(items, stichtag) {
  return (items || [])
    .filter(r => r.nummer != null && r.status_seit && LIEGE_PHASEN.includes(r.status))
    .map(r => ({ ...r, tage: diffTage(r.status_seit, stichtag) }))
    .filter(r => r.tage >= LIEGE_SCHWELLE_TAGE)
    .sort((a, b) => (PRIO_RANG[a.prioritaet] ?? 9) - (PRIO_RANG[b.prioritaet] ?? 9)
      || b.tage - a.tage
      || (`${a.repo}#${a.nummer}`).localeCompare(`${b.repo}#${b.nummer}`));
}

function renderHebel(data) {
  const items = data.items || [];
  const stichtag = (data._meta && data._meta.snapshot_date) || '';
  const entsperrer = topEntsperrer(items);
  const liegen = stichtag ? liegezeiten(items, stichtag) : [];
  // Nur die Zahl, keine Adressaten (#237, Entscheidung vom 16.08. in #149
  // bleibt): Top-Entsperrer sehen ausschliesslich native Dependencies. Am
  // 14.09.2026 trugen 2 von 13 blockierten Items eine, die uebrigen warten
  // laut Blocker-Grund auf Stellen ausserhalb des Boards.
  // `blocked_by` steht nur an Zeilen mit Kante, sein Fehlen sagt also nichts
  // über alte Snapshots. `status_seit` kam mit demselben Umbau (#183) und
  // steht an jeder Zeile: ohne ihn kennt der Snapshot keine Kanten, und
  // "extern blockiert" wäre eine Behauptung.
  const kenntKanten = items.some(r => 'status_seit' in r);
  const blockiert = kenntKanten ? items.filter(r => r.status === 'Blocked') : [];
  const extern = blockiert.filter(r => !(r.blocked_by && r.blocked_by.length)).length;
  if (!entsperrer.length && !liegen.length && !blockiert.length) return '';

  const externHtml = blockiert.length
    ? `<p class="hebel__extern"><strong>${extern} von ${blockiert.length}</strong> blockierten Issues sind extern blockiert, ohne Abh&auml;ngigkeit auf ein anderes Issue. Details im Board.</p>`
    : '';
  const entHtml = (entsperrer.length || blockiert.length) ? `
      <div class="hebel__spalte">
        <h4 class="hebel__untertitel">TOP-ENTSPERRER</h4>
        ${entsperrer.length ? `<ul class="hebel__liste">
          ${entsperrer.map(e => `<li>${kanteLink(e.kante)} blockiert
            <strong>${e.anzahl}</strong> Issue${e.anzahl === 1 ? '' : 's'}</li>`).join('')}
        </ul>` : ''}
        ${externHtml}
      </div>` : '';

  const gezeigt = liegen.slice(0, LIEGE_MAX_ZEILEN);
  const rest = liegen.length - gezeigt.length;
  const liegeHtml = liegen.length ? `
      <div class="hebel__spalte">
        <h4 class="hebel__untertitel">LIEGEZEITEN</h4>
        <ul class="hebel__liste">
          ${gezeigt.map(r => `<li>${kanteLink(`${r.repo}#${r.nummer}`)} still seit
            <strong>${r.tage}</strong> Tagen in ${r.status}${r.prioritaet ? ` <span class="hebel__prio">${r.prioritaet}</span>` : ''}</li>`).join('')}
        </ul>
        ${rest > 0 ? `<p class="matrix__fussnote">+${rest} weitere ab ${LIEGE_SCHWELLE_TAGE} Tagen</p>` : ''}
      </div>` : '';

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">HEBEL</h3>
      <div class="hebel">
        ${entHtml}
        ${liegeHtml}
      </div>
      <p class="matrix__fussnote">Kanten sind native GitHub-Dependencies (nur Nummern, keine Titel).
        Liegezeit ab ${LIEGE_SCHWELLE_TAGE} Tagen ohne Phasenwechsel in den Arbeitsphasen;
        Backlog und On Hold z&auml;hlen nicht. Klick &ouml;ffnet das Issue auf GitHub.</p>
    </div>`;
}

// ─── Bewegungs-Block (#221) ──────────────────────────
// Was an einem Tag dazugekommen ist, die Phase gewechselt hat und
// abgeschlossen wurde. Der Kopf zeigt Bestaende, die Matrix die Verteilung;
// hier steht die Veraenderung selbst.
//
// Zwei Quellen mit zwei verschiedenen Fenstern, das ist Absicht und muss auf
// der Seite lesbar bleiben:
//   Balken  = Kalendertage aus closed_at (done_by_day). Wird bei jedem Lauf
//             neu gebaut und ist deshalb auch fuer Tage ohne Snapshot
//             vollstaendig.
//   Listen  = Diff gegen den vorigen Snapshot (bewegungen.referenz). Board-
//             Zugang und Phasenwechsel haben keinen Zeitstempel, der Diff ist
//             der einzige Weg. Faellt ein Cron-Lauf aus, ist das Fenster
//             groesser, und die Ueberschrift nennt dann das echte Datum
//             statt "gestern" zu behaupten.
//
// Wie im Hebel-Block nur Kuerzel, Nummern und Select-Felder, keine Titel
// (#149/#179). Snapshots vor 3.2 kennen den Block nicht: dann faellt still
// weg, was fehlt, statt Nullen zu zeigen.
const BEW_MAX_ZEILEN = 12;    // Rest als Zaehler, damit die Spalte lesbar bleibt
const BEW_TAGE = 14;          // Fenster der Tagesbalken

// Sortierung der Bewegungszeilen: erst Bereich (damit Zusammengehoeriges
// beieinander steht), dann Prioritaet, dann Repo und Nummer.
function bewSortiert(zeilen) {
  return [...(zeilen || [])].sort((a, b) =>
    (a.bereich || '').localeCompare(b.bereich || '')
    || (PRIO_RANG[a.prioritaet] ?? 9) - (PRIO_RANG[b.prioritaet] ?? 9)
    || (`${a.repo}#${a.nummer}`).localeCompare(`${b.repo}#${b.nummer}`));
}

// Die letzten BEW_TAGE Kalendertage bis zum Stichtag, Luecken als Null.
// Ein fehlender Tag ist eine Aussage ("nichts abgeschlossen") und wird
// deshalb als leere Saeule gezeigt, nicht uebersprungen.
function bewTagesreihe(dbd, stichtag) {
  if (!stichtag) return [];
  const reihe = [];
  const d = new Date(stichtag + 'T00:00:00Z');
  if (isNaN(d)) return [];
  d.setUTCDate(d.getUTCDate() - (BEW_TAGE - 1));
  for (let i = 0; i < BEW_TAGE; i++) {
    const key = d.toISOString().slice(0, 10);
    reihe.push({ datum: key, anzahl: (dbd || {})[key] || 0 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return reihe;
}

// Achsenbeschriftung der Tagesbalken: nur die Tagesziffer, damit vierzehn
// Saeulen nebeneinander passen. Am Anfang der Reihe und an jedem Monatsersten
// kommt der Monat dazu, sonst waere ein Fenster ueber den Monatswechsel
// nicht eindeutig zu lesen.
function bewTagLabel(datum, i) {
  const tag = datum.slice(8);
  return (i === 0 || tag === '01') ? `${tag}.${datum.slice(5, 7)}.` : tag;
}

function bewZeile(z, zusatz) {
  const bereich = z.bereich
    ? `<span class="bewegung__bereich" title="${escHtml(z.bereich)}">${areaMeta(z.bereich).emoji} ${escHtml(z.bereich)}</span>`
    : '';
  const prio = z.prioritaet ? `<span class="hebel__prio">${escHtml(z.prioritaet)}</span>` : '';
  return `<li>${kanteLink(`${z.repo}#${z.nummer}`)}${zusatz || ''}${bereich}${prio}</li>`;
}

function bewSpalte(titel, zeilen, zusatzFn) {
  const alle = bewSortiert(zeilen);
  if (!alle.length) {
    return `
      <div class="bewegung__spalte">
        <h4 class="hebel__untertitel">${titel} <span class="bewegung__zahl">0</span></h4>
        <p class="matrix__fussnote">Keine Bewegung in diesem Fenster.</p>
      </div>`;
  }
  const gezeigt = alle.slice(0, BEW_MAX_ZEILEN);
  const rest = alle.length - gezeigt.length;
  return `
      <div class="bewegung__spalte">
        <h4 class="hebel__untertitel">${titel} <span class="bewegung__zahl">${alle.length}</span></h4>
        <ul class="hebel__liste">
          ${gezeigt.map(z => bewZeile(z, zusatzFn ? zusatzFn(z) : '')).join('')}
        </ul>
        ${rest > 0 ? `<p class="matrix__fussnote">+${rest} weitere</p>` : ''}
      </div>`;
}

function renderBewegung(data) {
  const stichtag = (data._meta && data._meta.snapshot_date) || '';
  const b = data.bewegungen;
  const reihe = bewTagesreihe(data.done_by_day, stichtag);
  const hatBalken = reihe.some(t => t.anzahl > 0);
  // Ohne Diff und ohne Tagesreihe gibt es nichts zu zeigen. Beides fehlt bei
  // Snapshots vor 3.2, die dann unveraendert rendern.
  if (!b && !hatBalken) return '';

  const max = Math.max(1, ...reihe.map(t => t.anzahl));
  const balken = hatBalken ? `
      <div class="trend-sub">
        <h4 class="hebel__untertitel">ERLEDIGT / TAG</h4>
        <div class="month-chart month-chart--schmal">
          ${reihe.map((t, i) => `
            <div class="month-chart__col" title="${shortDayLabel(t.datum)}: ${t.anzahl} erledigt">
              <div class="month-chart__bar-wrap">
                <div class="month-chart__value">${t.anzahl || ''}</div>
                <div class="month-chart__bar" style="height:${t.anzahl ? Math.max((t.anzahl / max) * 100, 6) : 0}%"></div>
              </div>
              <div class="month-chart__label">${bewTagLabel(t.datum, i)}</div>
            </div>`).join('')}
        </div>
        <p class="matrix__fussnote">Kalendertage nach Abschlussdatum, verworfene Issues z&auml;hlen nicht mit.</p>
      </div>` : '';

  if (!b || !b.referenz) {
    return balken ? `
    <div class="status-section fade-in">
      <h3 class="status-section__title">BEWEGUNG</h3>
      ${balken}
    </div>` : '';
  }

  const listen = `
      <div class="bewegung">
        ${bewSpalte('ERLEDIGT', b.erledigt, z => z.von ? ` aus ${escHtml(z.von)} ` : ' ')}
        ${bewSpalte('BEWEGT', b.bewegt, z => ` ${escHtml(z.von || 'ohne Phase')} &rarr; ${escHtml(z.nach || 'ohne Phase')} `)}
        ${bewSpalte('NEU', b.neu, z => ` ${escHtml(z.status || 'ohne Phase')} `)}
      </div>`;

  // Verworfen und Abgang sind selten und keine eigene Spalte wert. Sie duerfen
  // trotzdem nicht fehlen, sonst geht die Summenprobe nicht auf.
  const rand = [];
  if ((b.verworfen || []).length) {
    rand.push(`${b.verworfen.length} verworfen (als "not planned" geschlossen, z&auml;hlt nicht als erledigt)`);
  }
  if ((b.abgang || []).length) {
    rand.push(`${b.abgang.length} vom Board genommen`);
  }

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">BEWEGUNG</h3>
      ${balken}
      <p class="matrix__fussnote bewegung__fenster">Ver&auml;nderung gegen&uuml;ber dem Stand vom
        <strong>${shortDayLabel(b.referenz)}</strong>${b.referenz === vortagVon(stichtag) ? '' : ' (f&uuml;r den Tag davor gibt es keinen Snapshot)'}</p>
      ${listen}
      ${rand.length ? `<p class="matrix__fussnote">Au&szlig;erdem: ${rand.join(' &middot; ')}.</p>` : ''}
      <p class="matrix__fussnote">Nur K&uuml;rzel, Nummern und Board-Felder, keine Titel.
        Zeilen ohne Herkunftsphase sind in diesem Fenster angelegt <em>und</em> abgeschlossen worden.
        Klick &ouml;ffnet das Issue auf GitHub.</p>
    </div>`;
}

// Kalendarischer Vortag, um zu erkennen ob die Diff-Referenz wirklich der
// Vortag ist oder ob ein Snapshot fehlt.
function vortagVon(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d)) return null;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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
    <div id="matrix-host">${renderMatrix(data, roadmapCache ? roadmapCache.roadmap : null)}</div>
    ${renderHebel(data)}
    ${renderPhasenVerlauf(data)}
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
