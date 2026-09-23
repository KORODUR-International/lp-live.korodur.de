/* ============================================
   KORODUR Work Cockpit, Redaktion als Arbeitstool (Issue #274, davor #141)
   Eine Seite, zwei Blicke: oben der Satz und vier Kacheln für die
   Geschäftsführung, darunter Wochenraster und Arbeitsliste für die Redaktion.
   Quelle: data/redaktion/<datum>.json (Tages-Snapshot des Notion-
   Redaktionsplans, ab Version 2.0 mit der anonymisierten Beitragsliste
   "beitraege": Datum, Status, Kanal, Thema, hat_person).
   Keine Beitragstitel, keine Personen: die Seite ist öffentlich.
   Die Sichtbarkeits-Blöcke (renderZeitraum, renderSichtbarkeit, Chart aus
   data/social/) bleiben im Code und werden nicht mehr eingebunden; sie kommen
   als eigene Seite "Wirkung" zurück, sobald die Zahlen automatisch kommen
   (korodur-redaktion#44). data/social/ und der Import bleiben unverändert.
   In dev: symlink src/data -> ../data; in production: data/ liegt im Root.
   Zielbild: konzepte/mockup-redaktion-arbeitstool-2026-09-23.html.
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
  { key: 'ideen',       label: 'Ideen und offen', color: '#8aa9c4' },
  { key: 'in_arbeit',   label: 'In Arbeit',    color: '#6f93b3' },
  { key: 'in_pruefung', label: 'In Prüfung',   color: '#567da1' },
  { key: 'freigegeben', label: 'Freigegeben',  color: '#3d688f' },
  { key: 'eingeplant',  label: 'Getimed',      color: '#24527c' },
  { key: 'gepostet',    label: 'Erschienen',   color: '#002d59' },
];

// Plattform-Farben, dataviz-validiert (Issue #141 Design). Cyan (Facebook)
// liegt unter 3:1 Kontrast, deshalb sind Direct Labels + Tabellenansicht
// Pflicht, nicht nur Legende/Farbe.
const SOC_COLORS = { li: '#1e5a96', fb: '#009ee3', ig: '#7a56a3' };
const SOC_LABELS = { li: 'LinkedIn', fb: 'Facebook', ig: 'Instagram' };
// Bruecke zwischen den Kuerzeln der Timeseries-Spalten und den Plattform-Namen,
// unter denen import_social.py handgetragene Werte meldet (Feld "manuell").
const SOC_PLATTFORM = { li: 'linkedin', fb: 'facebook', ig: 'instagram' };

const LI_POSTS_ZIEL = 3;
// Terminierter Vorlauf, Ziele vom 16.09.2026 (Issue #257, Folie 6 der
// GF-Praesentation in korodur-redaktion#32): Ziel 2,5 bis 3 Wochen, gruen ab
// 2 Wochen, rot bei 1 Woche und weniger, dazwischen gelb.
const VORLAUF_ZIEL_WOCHEN = [2.5, 3];
const VORLAUF_GRUEN_AB_WOCHEN = 2;
const VORLAUF_ROT_BIS_WOCHEN = 1;

let socSeries = [];   // data/social/timeseries.json, aufsteigend nach Woche
let socLatest = null; // data/social/<neueste Woche>.json
let socZeitraeume = []; // data/social/meta-zeitraeume.json, aufsteigend nach bis (Issue #234)

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const idxRes = await fetch(RED_DIR + 'index.json');
    if (!idxRes.ok) throw new Error('no-data');
    const keys = await idxRes.json();
    if (!Array.isArray(keys) || keys.length === 0) throw new Error('no-data');

    const snapRes = await fetch(RED_DIR + keys[0] + '.json');
    if (!snapRes.ok) throw new Error('no-data');
    const snap = await snapRes.json();

    // Die Sichtbarkeit (data/social/) wird seit Issue #274 nicht mehr geladen:
    // die Seite bindet ihre Bloecke nicht mehr ein. Code und Daten bleiben.
    renderRedaktion(snap);
    const meta = document.getElementById('header-meta');
    if (meta) meta.textContent = `Snapshot: ${redFormatDate(snap._meta.snapshot_date)} · Quelle: Notion-Redaktionsplan`;
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

// Montag-Sonntag einer ISO-Kalenderwoche, z. B. "03. bis 09.08." (spiegelt
// scripts/import_social.py:iso_week_range in JS).
function isoWeekRangeLabel(weekKey) {
  const monday = mondayOfIsoWeek(weekKey);
  if (!monday) return '';
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const dd = n => String(n).padStart(2, '0');
  const sameMonth = monday.getUTCMonth() === sunday.getUTCMonth();
  return sameMonth
    ? `${dd(monday.getUTCDate())}. bis ${dd(sunday.getUTCDate())}.${dd(sunday.getUTCMonth() + 1)}.`
    : `${dd(monday.getUTCDate())}.${dd(monday.getUTCMonth() + 1)}. bis ${dd(sunday.getUTCDate())}.${dd(sunday.getUTCMonth() + 1)}.`;
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
// Terminierter Vorlauf (Issue #257): gruen ab 2 Wochen, rot bei 1 Woche und
// weniger, dazwischen gelb. Das Ziel 2,5 bis 3 Wochen liegt im gruenen Bereich.
function vorlaufState(weeks) {
  if (weeks === null || weeks === undefined || Number.isNaN(weeks)) return 'crit';
  if (weeks >= VORLAUF_GRUEN_AB_WOCHEN) return 'ok';
  if (weeks > VORLAUF_ROT_BIS_WOCHEN) return 'warn';
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
  const m = redaktionsModell(d);
  main.innerHTML = `
    <div class="snapshot-header fade-in">
      <h1 class="snapshot-header__title">REDAKTION: L&Auml;UFT SOCIAL MEDIA?</h1>
      <p class="snapshot-header__sub">
        Stand des Redaktionsplans und Vorlauf der n&auml;chsten Wochen
        &middot; ${d.gesamt ?? 0} Beitr&auml;ge im Redaktionsplan, Stand ${redFormatDate(d._meta.snapshot_date)}
        &middot; f&uuml;r Redaktion und Gesch&auml;ftsf&uuml;hrung
      </p>
    </div>

    ${renderSatz(m)}
    ${renderKacheln(m)}
    ${renderRaster(m)}
    <div class="grid-2">
      ${renderArbeitsliste(m)}
      <div>
        ${renderFunnel(d.totals || {}, d.eingeplant_erschienen)}
        ${renderThemenMix(m)}
      </div>
    </div>
    ${renderWochenChart(m)}
    ${renderSpaeter()}

    <div class="footer">
      Redaktions-Segment &middot; Quelle: Notion-Redaktionsplan (Aggregat und anonymisierte Beitragsliste, keine Titel, keine Personen)
      &middot; Generiert am ${new Date(d._meta.generated_at).toLocaleDateString('de-DE')}
      &middot; Nach dem Einplanen neu laden: <a href="${SNAPSHOT_WORKFLOW}" target="_blank" rel="noopener">Snapshot in GitHub starten</a>
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
  };
}

// Ein handgetragener Wert ist keine Messung des Exports. Er darf auf der Seite
// nicht aussehen wie einer, sonst zaehlt spaeter niemand mehr nach, woher er
// kommt. Instagram liefert Aufrufe und Interaktionen dauerhaft nur als
// Screenshot, nicht als Datei (Issue #146, entschieden am 17.08.2026).
function istManuell(row, tag) {
  return Array.isArray(row.manuell) && row.manuell.includes(SOC_PLATTFORM[tag]);
}

function manuellePlattformen(row) {
  return ['li', 'fb', 'ig'].filter(tag => istManuell(row, tag)).map(tag => SOC_LABELS[tag]);
}

const MANUELL_FUSSNOTE = '* aus dem Screenshot der Meta Business Suite '
  + '&uuml;bernommen, nicht aus einer Export-Datei.';

// Spaltenpaare je Kennzahl, damit der Wochenvergleich Plattform fuer
// Plattform rechnen kann statt nur auf der Summe.
const SOC_FELDER = {
  imp: { li: 'li_impressions', fb: 'fb_views', ig: 'ig_views' },
  inter: { li: 'li_interactions', fb: 'fb_interactions', ig: 'ig_interactions' },
};

// Ein Plattform-Wechsel ist kein Wachstum. Als Instagram in KW 33 erstmals
// Aufrufe lieferte, sprang die Summe von 918 auf 4.843, also +428 %, obwohl
// gut ein Drittel davon schlicht neu gemessen wurde statt neu entstanden.
// Der Vergleich laeuft deshalb nur ueber Plattformen, die in beiden Wochen
// einen Wert haben, und nennt die ausgelassene beim Namen.
function socVergleich(curr, prev, feld) {
  if (!curr || !prev) return null;
  const spalten = SOC_FELDER[feld];
  const res = { curr: 0, prev: 0, gemessen: 0, ausgelassen: [] };
  Object.keys(spalten).forEach(tag => {
    const cv = curr[spalten[tag]], pv = prev[spalten[tag]];
    if (cv == null && pv == null) return;
    if (cv == null || pv == null) { res.ausgelassen.push(SOC_LABELS[tag]); return; }
    res.curr += cv; res.prev += pv; res.gemessen++;
  });
  return res.gemessen ? res : null;
}

function socDeltaLine(v, isPct, bezug = 'Vorwoche') {
  if (!v) return '';
  if (isPct && !v.prev) return '';
  const diff = isPct ? Math.round(((v.curr - v.prev) / v.prev) * 100) : v.curr - v.prev;
  const cls = diff >= 0 ? 'kpi-card__delta--up' : 'kpi-card__delta--down';
  const sign = diff >= 0 ? '+' : '';
  const unit = isPct ? '&nbsp;%' : '';
  const ohne = v.ausgelassen.length ? `, ohne ${v.ausgelassen.join(' und ')}` : '';
  return `<div class="kpi-card__delta ${cls}">${sign}${diff}${unit} <small>vs. ${bezug}${ohne}</small></div>`;
}

// ─── 0 · Sichtbarkeit über vier Wochen (Issue #234) ──
// Facebook und Instagram kommen seit KW 34 nur noch als Zeitraum über vier
// volle Kalenderwochen (Screenshot der Business Suite, Entscheidung Steffi
// 14.09.2026). LinkedIn wird für dieselben vier Wochen aus der Timeseries
// summiert, damit alle drei Kanäle über dasselbe Fenster laufen. Ein
// Monatswert gehört nicht ins Wochenchart, deshalb dieser eigene Block.

function isoPlusTage(iso, tage) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + tage));
  return d.toISOString().slice(0, 10);
}

function zeitraumLabel(z) {
  const [vy, vm, vd] = z.von.split('-');
  const [by, bm, bd] = z.bis.split('-');
  return `${vd}.${vm}.${vy === by ? '' : vy} bis ${bd}.${bm}.${by}`;
}

function summeOderNull(werte) {
  const da = werte.filter(v => v !== null && v !== undefined);
  return da.length ? da.reduce((a, b) => a + b, 0) : null;
}

function followerNetto(p) {
  return (p && p.follower_neu != null && p.follower_verloren != null)
    ? p.follower_neu - p.follower_verloren : null;
}

function mitVorzeichen(n) {
  return n === null ? 'n.&nbsp;v.' : `${n > 0 ? '+' : ''}${n.toLocaleString('de-DE')}`;
}

// Werte eines Zeitraums je Kanal. LinkedIn nur aus den Wochen, die der
// Zeitraum nennt; fehlt eine davon, steht das an der Zahl.
function zeitraumWerte(z) {
  const rows = socSeries.filter(r => (z.wochen || []).includes(r.week));
  let li = null;
  if (rows.length) {
    li = {
      imp: rows.reduce((a, r) => a + (r.li_impressions || 0), 0),
      inter: rows.reduce((a, r) => a + (r.li_interactions || 0), 0),
      wochen: rows.length,
      tage: rows.every(r => r.tage_linkedin != null) ? rows.reduce((a, r) => a + r.tage_linkedin, 0) : null,
    };
  }
  return { li, fb: z.facebook || {}, ig: z.instagram || {} };
}

const ZR_FELDER = {
  imp: { li: w => (w.li ? w.li.imp : null), fb: w => w.fb.views, ig: w => w.ig.views },
  inter: { li: w => (w.li ? w.li.inter : null), fb: w => w.fb.interactions, ig: w => w.ig.interactions },
  reach: { fb: w => w.fb.reach, ig: w => w.ig.reach },
  follower: { fb: w => followerNetto(w.fb), ig: w => followerNetto(w.ig) },
};

// Wie socVergleich: nur Kanäle, die in beiden Zeiträumen einen Wert haben.
function zeitraumVergleich(curr, prev, feld) {
  if (!curr || !prev) return null;
  const res = { curr: 0, prev: 0, gemessen: 0, ausgelassen: [] };
  Object.entries(ZR_FELDER[feld]).forEach(([tag, wert]) => {
    const cv = wert(curr), pv = wert(prev);
    if (cv == null && pv == null) return;
    if (cv == null || pv == null) { res.ausgelassen.push(SOC_LABELS[tag]); return; }
    res.curr += cv; res.prev += pv; res.gemessen++;
  });
  return res.gemessen ? res : null;
}

function renderZeitraum() {
  if (!socZeitraeume.length) return '';
  const z = socZeitraeume[socZeitraeume.length - 1];
  const w = zeitraumWerte(z);
  const vorher = socZeitraeume.find(p => p.bis === isoPlusTage(z.von, -1));
  const p = vorher ? zeitraumWerte(vorher) : null;
  const delta = (feld, isPct) => (p ? socDeltaLine(zeitraumVergleich(w, p, feld), isPct, 'Vorzeitraum') : '');

  const liImp = w.li ? w.li.imp : null;
  const liInter = w.li ? w.li.inter : null;
  const kw = `${kwLabel(z.wochen[0])} bis ${kwLabel(z.wochen[z.wochen.length - 1]).replace('KW ', '')}`;
  let liHinweis = '';
  if (!w.li) liHinweis = ' &middot; LinkedIn n.&nbsp;v.';
  else if (w.li.wochen < z.wochen.length) liHinweis = ` &middot; LinkedIn erst ${w.li.wochen} von ${z.wochen.length} Wochen`;
  else if (w.li.tage != null && w.li.tage < 28) liHinweis = ` &middot; LinkedIn ${w.li.tage} von 28 Tagen (Export l&auml;uft bis zu 2 Tage nach)`;
  const vergleich = vorher ? '' : ' &middot; Vergleich mit dem Vorzeitraum, sobald es einen gibt';

  const fbNetto = followerNetto(w.fb), igNetto = followerNetto(w.ig);
  const reachLabel = w.fb.reach_label ? ` (dort &bdquo;${w.fb.reach_label}&ldquo;)` : '';

  return `
    <div class="section-title">SICHTBARKEIT &middot; LETZTE 4 WOCHEN <small>${zeitraumLabel(z)}, ${kw}${liHinweis}${vergleich}</small></div>
    <div class="kpi-row">
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Sichtbarkeit (Impressions / Aufrufe)</div>
        <div class="kpi-card__value kpi-card__value--hero">${fmtNum(summeOderNull([liImp, w.fb.views, w.ig.views]))}</div>
        ${delta('imp', true)}
        <div class="kpi-card__detail">LinkedIn ${fmtNum(liImp)} &middot; Facebook ${fmtNum(w.fb.views)}* &middot; Instagram ${fmtNum(w.ig.views)}*</div>
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Interaktionen</div>
        <div class="kpi-card__value">${fmtNum(summeOderNull([liInter, w.fb.interactions, w.ig.interactions]))}</div>
        ${delta('inter', false)}
        <div class="kpi-card__detail">LinkedIn ${fmtNum(liInter)} &middot; Facebook ${fmtNum(w.fb.interactions)}* &middot; Instagram ${fmtNum(w.ig.interactions)}*</div>
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Reichweite Meta</div>
        <div class="kpi-card__value">${fmtNum(summeOderNull([w.fb.reach, w.ig.reach]))}</div>
        ${delta('reach', true)}
        <div class="kpi-card__detail">Facebook ${fmtNum(w.fb.reach)}*${reachLabel} &middot; Instagram ${fmtNum(w.ig.reach)}*</div>
        <div class="kpi-card__detail">Summe beider Plattformen, dieselbe Person kann doppelt z&auml;hlen</div>
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Follower Meta (netto)</div>
        <div class="kpi-card__value">${mitVorzeichen(summeOderNull([fbNetto, igNetto]))}</div>
        ${delta('follower', false)}
        <div class="kpi-card__detail">Facebook ${mitVorzeichen(fbNetto)} (${fmtNum(w.fb.follower_neu)} neu, ${fmtNum(w.fb.follower_verloren)} verloren)* &middot; Instagram ${mitVorzeichen(igNetto)} (${fmtNum(w.ig.follower_neu)} neu, ${fmtNum(w.ig.follower_verloren)} verloren)*</div>
      </div>
    </div>
    <p class="chart-note" style="margin:-20px 0 32px">${MANUELL_FUSSNOTE} LinkedIn aus dem Export, summiert &uuml;ber dieselben vier Kalenderwochen.</p>
  `;
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
  const t = socTotals(last);
  const range = isoWeekRangeLabel(last.week);
  const window8 = socSeries.slice(-8);

  const sparkImp = sparklineSvg(window8.map(r => socTotals(r).imp), 'var(--secondary)');
  const sparkInt = sparklineSvg(window8.map(r => socTotals(r).inter), 'var(--secondary)');
  const sparkEr = sparklineSvg(
    window8.filter(r => r.li_engagement_rate != null).map(r => r.li_engagement_rate * 100), 'var(--secondary)');

  // Aus den Werten der Woche abgeleitet, nicht fest verdrahtet: die Lieferung
  // vom 14.09.2026 brachte fuer KW 34 bis 37 nur LinkedIn, und die Kopfzeile
  // behauptete trotzdem "LinkedIn + Facebook".
  const spalten = [['li', 'li_impressions'], ['fb', 'fb_views'], ['ig', 'ig_views']];
  const mit = spalten.filter(([, k]) => last[k] != null).map(([tag]) => SOC_LABELS[tag]);
  // Liegt die Woche in einem Meta-Zeitraum (Issue #234), fehlen Facebook und
  // Instagram hier nicht, sie stehen im 4-Wochen-Block darüber.
  const imZeitraum = socZeitraeume.some(z => (z.wochen || []).includes(last.week));
  const ohne = spalten.filter(([, k]) => last[k] == null).map(([tag]) => tag);
  const oben = imZeitraum ? ohne.filter(tag => tag !== 'li') : [];
  const nv = ohne.filter(tag => !oben.includes(tag));
  const label = tags => tags.map(tag => SOC_LABELS[tag]).join(' und ');
  const platforms = mit.join(' + ')
    + (nv.length ? `, ${label(nv)} n.&nbsp;v.` : '')
    + (oben.length ? `, ${label(oben)} im 4-Wochen-Block oben` : '');
  // LinkedIn liefert mit bis zu 2 Tagen Verzug. Deckt der Export die Woche
  // nicht voll ab, gehoert das an die Zahl, sonst liest sich eine Teilwoche
  // wie ein Einbruch.
  const tage = last.tage_linkedin;
  const tageHinweis = (tage != null && tage < 7)
    ? ` &middot; LinkedIn erst ${tage} von 7 Tagen (Export l&auml;uft bis zu 2 Tage nach)` : '';
  const manuell = manuellePlattformen(last);
  const manuellHinweis = manuell.length
    ? `<div class="kpi-card__detail">enth&auml;lt ${manuell.join(' und ')} aus dem Screenshot, nicht aus dem Export</div>` : '';
  return `
    <div class="section-title">SICHTBARKEIT JE WOCHE &middot; ${kwLabel(last.week)} <small>${platforms}${range ? `, Kalenderwoche ${range}` : ''}${tageHinweis}</small></div>
    <div class="kpi-row">
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Sichtbarkeit (Impressions / Woche)</div>
        <div class="kpi-card__value kpi-card__value--hero">${fmtNum(t.imp)}</div>
        ${socDeltaLine(socVergleich(last, prev, 'imp'), true)}
        ${manuellHinweis}
        ${sparkImp}
      </div>
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Interaktionen / Woche</div>
        <div class="kpi-card__value">${fmtNum(t.inter)}</div>
        ${socDeltaLine(socVergleich(last, prev, 'inter'), false)}
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
  // pr traegt die Direct Labels rechts neben der Kurve. Gemessen in Chrome mit
  // der SVG-Schrift der Seite (Arial 12): "Instagram 1.751*" ist 91,4 px breit,
  // ein sechsstelliger Wert mit Marker 104,8 px. Bei pr = 96 standen davon nur
  // 86 px zur Verfuegung, das Sternchen der Screenshot-Kennzeichnung fiel aus
  // der viewBox und war unsichtbar. 120 traegt auch den sechsstelligen Fall.
  const W = 900, H = 300, pl = 46, pr = 120, pt = 20, pb = 32;
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
    const marker = istManuell(weeks[last.i], sr.tag) ? '*' : '';
    s += `<text x="${x(last.i) + 10}" y="${y(last.v) + 4}" font-size="12" fill="var(--ink)">${SOC_LABELS[sr.tag]} <tspan font-weight="bold">${fmtNum(last.v)}${marker}</tspan></text>`;
  });

  weeks.forEach((w, i) => {
    s += `<text x="${x(i)}" y="${H - 8}" font-size="11" fill="var(--muted)" text-anchor="middle">${kwLabel(w.week)}</text>`;
  });

  // Hover-Zonen mit nativem Tooltip (SVG <title>) je Woche, wertet alle drei
  // Plattformen aus -- ersetzt eine JS-Mousemove-Tooltipbox, die sich im
  // string-basierten Render-Test dieses Skripts nicht pruefen liesse.
  weeks.forEach((w, i) => {
    const half = weeks.length > 1 ? (x(1) - x(0)) / 2 : 60;
    const rows = SERIES.map(sr => {
      if (w[sr.key] == null) return `${SOC_LABELS[sr.tag]}: n. v.`;
      return `${SOC_LABELS[sr.tag]}: ${fmtNum(w[sr.key]).replace('&nbsp;', ' ')}`
        + (istManuell(w, sr.tag) ? ' (Screenshot)' : '');
    }).join(' · ');
    s += `<rect data-i="${i}" x="${x(i) - half}" y="${pt}" width="${half * 2}" height="${H - pt - pb}" fill="transparent" class="vis-hit"><title>${kwLabel(w.week)}: ${rows}</title></rect>`;
  });

  const missingIg = weeks.some(w => w.ig_views == null);
  const hatManuell = weeks.some(w => SERIES.some(sr => istManuell(w, sr.tag)));
  const ersteZeitraumWoche = socZeitraeume.length ? socZeitraeume[0].wochen[0] : null;
  const zeitraumHinweis = ersteZeitraumWoche
    ? ` &middot; Facebook und Instagram ab ${kwLabel(ersteZeitraumWoche)} nur als 4-Wochen-Zeitraum oben` : '';

  let tbl = '<table><tr><th>Plattform</th>' + weeks.map(w => `<th>${kwLabel(w.week)}</th>`).join('') + '</tr>';
  SERIES.forEach(sr => {
    tbl += `<tr><td>${SOC_LABELS[sr.tag]}</td>` + weeks.map(w => {
      if (w[sr.key] == null) return '<td>n.&nbsp;v.</td>';
      return `<td>${fmtNum(w[sr.key])}${istManuell(w, sr.tag) ? '*' : ''}</td>`;
    }).join('') + '</tr>';
  });
  tbl += '</table>';
  if (hatManuell) tbl += `<p class="chart-note">${MANUELL_FUSSNOTE}</p>`;

  return `
    <div class="status-section fade-in vis-chart-card">
      <h3 class="status-section__title">SICHTBARKEIT IM ZEITVERLAUF</h3>
      <p class="chart-note">Impressions bzw. Aufrufe pro Kalenderwoche und Plattform${zeitraumHinweis || (missingIg ? ' &middot; Instagram liefert nicht in jeder Woche Aufrufe' : '')}${hatManuell ? ' &middot; mit * markierte Werte stammen aus einem Screenshot' : ''}</p>
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

// ─── Arbeitstool (Issue #274) ────────────────────────
// Eine Seite, zwei Blicke: der Satz und die vier Kacheln für die
// Geschäftsführung, Wochenraster und Arbeitsliste für die Redaktion.
// Quelle ist die anonymisierte Beitragsliste "beitraege" (Snapshot ab
// Version 2.0): Datum, Notion-Status, Kanal, Thema, hat_person. Kein Titel,
// keine Person; ein Chip zeigt Thema und Kanal, der Klick öffnet Notion.
// Zielbild: konzepte/mockup-redaktion-arbeitstool-2026-09-23.html.

// Notion-Ansichten des Redaktionsplans (geprüft am 23.09.2026). Der Kalender
// filtert "gepostet" heraus, erschienene Chips öffnen deshalb "Veröffentlicht".
const NOTION_DB = 'https://www.notion.so/2bc670e19e1a803b82abc1627dc0a0bd';
const NOTION_KALENDER = `${NOTION_DB}?v=2e2670e19e1a80e9b1f9000cfb466828`;
const NOTION_TODO = `${NOTION_DB}?v=2bc670e19e1a80908b6e000c907909e7`;
const NOTION_VEROEFFENTLICHT = `${NOTION_DB}?v=2e3670e19e1a80789673000c38b4632c`;
const SNAPSHOT_WORKFLOW = 'https://github.com/KORODUR-International/korodur-review-reporting/actions/workflows/cockpit_snapshot.yml';

// Mindestens so viele feste LinkedIn-Beiträge je Woche (Ziel 2 bis 3).
const WOCHE_MIN_FEST = 2;
// Der Satz prüft die laufende und die zwei folgenden Wochen.
const SATZ_WOCHEN = 3;
// Lücken-Regel der Arbeitsliste: die Wochen nach der laufenden.
const LUECKE_WOCHEN = 6;
// "In Prüfung" gilt ab so vielen Tagen ohne Bewegung als Stau.
const PRUEFUNG_STAU_TAGE = 28;
// Wochenraster: Vorwoche, laufende Woche und 8 folgende.
const RASTER_VON = -1, RASTER_BIS = 8;
// Fallback, falls ein Snapshot vor Version 2.0 keine Rastertage trägt
// (korodur-redaktion#45 klärt, ob Montag und Donnerstag bleiben).
const SLOTS_FALLBACK = [1, 4];
const THEMEN = ['Referenz', 'Know How', 'Messe', 'Image', 'Neuigkeiten'];
const TAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const TAGE_LANG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

// ─── Datum (ISO-Strings, UTC, keine Zeitzonen-Drift) ──
function tagDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
function tagIso(date) { return date.toISOString().slice(0, 10); }
function tagPlus(iso, n) { const d = tagDate(iso); d.setUTCDate(d.getUTCDate() + n); return tagIso(d); }
// ISO-Wochentag, 1 = Montag
function wochentag(iso) { return tagDate(iso).getUTCDay() || 7; }
function montagVon(iso) { return tagPlus(iso, 1 - wochentag(iso)); }
function tageZwischen(von, bis) { return Math.round((tagDate(bis) - tagDate(von)) / 86400000); }
function ddmm(iso) { return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`; }
function tagKurz(iso) { return `${TAGE_KURZ[wochentag(iso) - 1]} ${ddmm(iso)}`; }
function tagLang(iso) {
  return `${TAGE_LANG[wochentag(iso) - 1]}, ${parseInt(iso.slice(8, 10), 10)}. ${RED_MONTHS_DE[parseInt(iso.slice(5, 7), 10) - 1]}`;
}
function kwVon(iso) { return kwLabel(isoWeekKeyOfDate(tagDate(iso))); }
function wochenZahl(tage) { return Math.round(tage / 7 * 10) / 10; }
function komma(v) { return v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }

// ─── Beitrag: was ist er an diesem Stichtag? ─────────
// Zählregel aus #233: "eingeplant & getimed" mit Datum vor dem Stichtag ist
// erschienen, der Stichtag selbst zählt noch als getimed. "freigegeben" mit
// Datum ist ein reservierter Termin, "offen" (und jeder andere Status) mit
// Datum ist vorgemerkt (Entscheidungen vom 23.09.2026). Abgelehnt fällt raus.
function beitragArt(b, stichtag) {
  if (b.status === 'gepostet') return 'erschienen';
  if (b.status === 'eingeplant & getimed') return b.datum < stichtag ? 'erschienen' : 'getimed';
  if (b.status === 'freigegeben') return 'frei';
  if (b.status === 'abgelehnt') return null;
  return 'vorgemerkt';
}
function istLinkedin(b) { return (b.kanal || []).includes('Linkedin'); }
function istFest(art) { return art === 'erschienen' || art === 'getimed'; }

// ─── Das Modell: alle Zahlen der Seite an einer Stelle ──
// Rein rechnend, damit tests/test_redaktion_render.mjs Satz, Wochenbilanz und
// Arbeitsliste gegen die Fixture vom 23.09.2026 prüfen kann.
function redaktionsModell(d) {
  const stichtag = ((d || {})._meta || {}).snapshot_date;
  const hatListe = Array.isArray(d.beitraege);
  const liste = (d.beitraege || [])
    .map(b => ({ ...b, art: beitragArt(b, stichtag) }))
    .filter(b => b.art && b.datum);
  const slots = Array.isArray(d.slots) && d.slots.length ? d.slots : SLOTS_FALLBACK;
  const montag0 = montagVon(stichtag);

  const wochen = [];
  for (let w = RASTER_VON; w <= RASTER_BIS; w++) {
    const mo = tagPlus(montag0, 7 * w), so = tagPlus(mo, 6);
    const drin = liste.filter(b => b.datum >= mo && b.datum <= so);
    const li = drin.filter(istLinkedin);
    const zahl = art => li.filter(b => b.art === art).length;
    const woche = {
      offset: w, montag: mo, sonntag: so, kw: kwVon(mo), beitraege: drin,
      erschienen: zahl('erschienen'), getimed: zahl('getimed'),
      frei: zahl('frei'), vorgemerkt: zahl('vorgemerkt'),
      ohneKanal: drin.filter(b => !(b.kanal || []).length).length,
      vorbei: so < stichtag, laufend: w === 0,
    };
    woche.fest = woche.erschienen + woche.getimed;
    woche.bilanz = wochenBilanz(woche);
    wochen.push(woche);
  }

  const getimed = liste.filter(b => b.art === 'getimed').map(b => b.datum).sort();
  const letzterGetimed = getimed.length ? getimed[getimed.length - 1] : null;
  const freiMitTermin = liste.filter(b => b.art === 'frei').map(b => b.datum).sort();

  return {
    d, stichtag, hatListe, liste, slots, wochen, letzterGetimed, freiMitTermin,
    satz: gfSatz(d, wochen, letzterGetimed),
    arbeitsliste: arbeitsliste(d, stichtag, liste, wochen, slots, letzterGetimed, freiMitTermin),
  };
}

// Wochenbilanz gegen das Ziel: vorbei (im Ziel, unter Ziel), sonst belegt,
// einplanen (fest plus freigegeben mit Termin reicht) oder Lücke.
function wochenBilanz(w) {
  if (w.vorbei) return w.fest >= WOCHE_MIN_FEST ? 'im Ziel' : 'unter Ziel';
  if (w.fest >= WOCHE_MIN_FEST) return 'belegt';
  if (w.fest + w.frei >= WOCHE_MIN_FEST) return 'einplanen';
  return 'Lücke';
}
const BILANZ_TAG = { 'im Ziel': 'ok', 'unter Ziel': 'warn', belegt: 'ok', einplanen: 'info', 'Lücke': 'crit' };

// ─── 1 · Der Satz für die Geschäftsführung ───────────
// Grün: getimter Vorlauf mindestens 2 Wochen und die laufende plus die zwei
// folgenden Wochen mit je mindestens 2 festen LinkedIn-Beiträgen. Rot: der
// Vorlauf ist rot (1 Woche und weniger, dieselbe Grenze wie die Kachel,
// #257). Sonst gelb.
function gfSatz(d, wochen, letzterGetimed) {
  const naechste = wochen.filter(w => w.offset >= 0 && w.offset < SATZ_WOCHEN);
  const duenn = naechste.filter(w => w.fest < WOCHE_MIN_FEST);
  const vState = vorlaufState(d.vorlauf_wochen);
  const state = vState === 'crit' ? 'crit' : (vState === 'ok' && !duenn.length ? 'ok' : 'warn');
  const bis = letzterGetimed ? tagLang(letzterGetimed) : null;

  let text;
  if (state === 'ok') {
    text = `Social Media läuft: bis ${bis} ist in LinkedIn getimed, und die nächsten drei Wochen haben je mindestens zwei Beiträge.`;
  } else if (state === 'crit') {
    text = bis
      ? `Social Media stockt: in LinkedIn getimed ist nur bis ${bis}.`
      : 'Social Media stockt: kein Beitrag ist in LinkedIn getimed.';
  } else {
    const gruende = [];
    if (vState !== 'ok') gruende.push(`getimed ist nur bis ${bis} (${komma(d.vorlauf_wochen)} Wochen)`);
    if (duenn.length) {
      gruende.push(`${duenn.map(w => w.kw).join(', ')} ${duenn.length === 1 ? 'hat' : 'haben'} weniger als zwei feste Beiträge`);
    }
    text = `Social Media läuft, aber knapp: ${gruende.join('; ')}.`;
  }
  const n = d.freigegeben_mit_termin || 0;
  text += n
    ? ` ${n === 1 ? 'Ein freigegebener Beitrag' : `${n} freigegebene Beiträge`} mit Termin ${n === 1 ? 'wartet' : 'warten'} darauf, in LinkedIn eingeplant zu werden.`
    : ' Kein freigegebener Beitrag mit Termin wartet aufs Einplanen.';
  return { state, text };
}

function renderSatz(m) {
  const { state, text } = m.satz;
  const zeichen = { ok: 'OK', warn: '!', crit: '!!' }[state];
  return `
    <div class="red-satz red-satz--${state} fade-in">
      <div class="red-satz__licht" aria-hidden="true">${zeichen}</div>
      <div class="red-satz__text">${text}
        <small>Automatisch aus dem Redaktionsplan gebildet. Gelb, sobald der getimte Vorlauf unter 2 Wochen fällt oder eine der nächsten drei Wochen unter 2 Beiträgen liegt. Rot bei 1 Woche Vorlauf und weniger.</small>
      </div>
    </div>`;
}

// ─── 2 · Vier Kacheln ────────────────────────────────
function renderKacheln(m) {
  const d = m.d;
  return `
    <div class="section-title">L&Auml;UFT DIE REDAKTION? <small>Ziele aus der Social-Media-Strategie vom 16.09.2026: 2 bis 3 Beitr&auml;ge pro Woche auf LinkedIn, 2,5 bis 3 Wochen getimter Vorlauf, 10 bis 15 fertige Beitr&auml;ge</small></div>
    <div class="kpi-row red-kacheln">
      ${kachelWoche(m)}
      ${kachelVorlauf(m)}
      ${kachelFertig(d)}
      ${kachelNachschub(d, m.stichtag)}
    </div>`;
}

function kachelWoche(m) {
  const w = m.wochen.find(x => x.laufend);
  const state = w.fest >= WOCHE_MIN_FEST ? 'ok' : w.fest === 1 ? 'warn' : 'crit';
  const label = { ok: 'läuft', warn: 'knapp', crit: 'leer' }[state];
  const pbw = beitraegeJeWoche(m.d);
  const bis = letzteVolleWoche(m.d);
  const letzte = pbw[bis] || 0;
  const avg = [-3, -2, -1, 0].map(k => pbw[wocheVerschieben(bis, k)] || 0).reduce((a, b) => a + b, 0) / 4;
  const ohne = w.ohneKanal
    ? ` &middot; dazu ${w.ohneKanal} Beitr${w.ohneKanal === 1 ? 'ag' : '&auml;ge'} ohne Kanal-Angabe` : '';
  return `
    <div class="kpi-card fade-in">
      <div class="kpi-card__label">Diese Woche ${ampelBadge(state, label)}</div>
      <div class="kpi-card__value">${w.fest}<span class="kpi-card__unit">von 2 bis 3</span></div>
      <div class="kpi-card__detail">${w.kw} &middot; ${w.erschienen} erschienen, ${w.getimed} getimed (LinkedIn)${ohne} &middot; letzte Woche ${letzte}, Schnitt der letzten 4 Wochen ${komma(avg)}</div>
    </div>`;
}

function kachelVorlauf(m) {
  const d = m.d;
  const state = vorlaufState(d.vorlauf_wochen);
  // Grün beginnt unter dem Ziel (ab 2 Wochen), "im Ziel" würde bei 2,0 bis
  // 2,4 Wochen der Zielangabe daneben widersprechen.
  const label = state === 'ok' ? 'ausreichend' : state === 'warn' ? 'knapp' : 'zu kurz';
  const [lo, hi] = VORLAUF_ZIEL_WOCHEN.map(w => w.toLocaleString('de-DE'));
  const letzter = m.letzterGetimed ? `, der letzte am ${tagKurz(m.letzterGetimed)}` : '';
  const frei = m.freiMitTermin;
  const plus = frei.length
    ? ` &middot; plus ${frei.length} freigegebene mit Termin bis ${tagKurz(frei[frei.length - 1])}, noch nicht getimed` : '';
  return `
    <div class="kpi-card fade-in">
      <div class="kpi-card__label">Getimter Vorlauf ${ampelBadge(state, label)}</div>
      <div class="kpi-card__value">${fmtWochen(d.vorlauf_wochen)}<span class="kpi-card__unit">Wochen</span></div>
      <div class="kpi-card__detail">${fehltZeichen(d.geplant_zukunft)} Beitr&auml;ge in LinkedIn eingeplant${letzter} &middot; Ziel ${lo} bis ${hi} Wochen${plus}</div>
    </div>`;
}

function kachelFertig(d) {
  const ziel = d.puffer_ziel || [10, 15];
  const state = pufferState(d.puffer, ziel);
  const label = state === 'ok' ? 'im Ziel' : state === 'warn' ? 'knapp' : 'au&szlig;erhalb Ziel';
  const t = d.totals || {};
  const aufteilung = d.freigegeben_mit_termin != null
    ? ` (${d.freigegeben_mit_termin} mit Termin, ${d.freigegeben_ohne_termin} ohne)` : '';
  const reicht = d.puffer
    ? ` &middot; reicht rechnerisch bis ${ddmm(tagPlus(d._meta.snapshot_date, Math.round(d.puffer / WOCHE_MIN_FEST * 7)))} bei 2 pro Woche` : '';
  return `
    <div class="kpi-card fade-in">
      <div class="kpi-card__label">Fertige Beitr&auml;ge ${ampelBadge(state, label)}</div>
      <div class="kpi-card__value">${fehltZeichen(d.puffer)}</div>
      <div class="kpi-card__detail">${t.eingeplant || 0} getimed + ${t.freigegeben || 0} freigegeben${aufteilung} &middot; Ziel ${ziel[0]} bis ${ziel[1]}${reicht}</div>
    </div>`;
}

function pruefungStauTage(d, stichtag) {
  return d.in_pruefung_seit ? tageZwischen(d.in_pruefung_seit, stichtag) : 0;
}

function kachelNachschub(d, stichtag) {
  const t = d.totals || {};
  const n = t.in_pruefung || 0;
  const stau = pruefungStauTage(d, stichtag) >= PRUEFUNG_STAU_TAGE;
  const state = !n ? 'warn' : stau ? 'warn' : 'ok';
  const label = !n ? 'nichts in Pr&uuml;fung' : stau ? 'Pr&uuml;fung stockt' : 'in Bewegung';
  const hoechst = d.in_pruefung_hoechst_seit;
  const seit = d.in_pruefung_seit && n
    ? `seit dem ${ddmm(d.in_pruefung_seit)} bei ${n}${hoechst > n ? `, zwischendurch ${hoechst}` : ''} &middot; ` : '';
  const ohnePerson = d.offen_ohne_person != null ? `, davon ${d.offen_ohne_person} offen ohne zust&auml;ndige Person` : '';
  const info = ((d.by_status || {})['Info erforderlich']) || 0;
  return `
    <div class="kpi-card fade-in">
      <div class="kpi-card__label">Nachschub ${ampelBadge(state, label)}</div>
      <div class="kpi-card__value">${n}<span class="kpi-card__unit">in Pr&uuml;fung</span></div>
      <div class="kpi-card__detail">${seit}${t.ideen || 0} Ideen und offene Themen${ohnePerson}${info ? ` &middot; ${info} wartet auf Info` : ''}</div>
    </div>`;
}

// ─── 3 · Wochenraster ────────────────────────────────
const KANAL_KURZ = { Linkedin: 'LI', 'Fb/Insta': 'FI', Mailing: 'Mail' };
const ART_TEXT = { erschienen: 'erschienen', getimed: 'getimed', frei: 'nicht getimed', vorgemerkt: 'vorgemerkt' };

function chip(b) {
  const kanal = (b.kanal || []).length
    ? b.kanal.map(k => KANAL_KURZ[k] || k).sort().join(' ') : 'ohne Kanal';
  const warn = (b.kanal || []).length ? '' : ' red-chip--warn';
  const link = b.status === 'gepostet' ? NOTION_VEROEFFENTLICHT : NOTION_KALENDER;
  const thema = (b.thema || []).length ? b.thema.join(', ') : 'ohne Thema';
  return `<a class="red-chip red-chip--${b.art}${warn}" href="${link}" target="_blank" rel="noopener" title="In Notion öffnen">${thema}<span class="red-chip__k">${kanal} &middot; ${ART_TEXT[b.art]}</span></a>`;
}

function bilanzZelle(w) {
  const tag = `<span class="red-tag red-tag--${BILANZ_TAG[w.bilanz]}">${w.bilanz}</span>`;
  if (w.vorbei) return `<b>${w.fest}</b> erschienen ${tag}`;
  if (w.bilanz === 'belegt') {
    return `<b>${w.fest}</b> ${w.laufend ? 'erschienen/getimed' : 'getimed'} ${tag}${w.frei ? `<small>+ ${w.frei} freigegeben mit Termin</small>` : ''}`;
  }
  if (w.bilanz === 'einplanen') return `<b>${w.fest}</b> getimed + <b>${w.frei}</b> freigegeben ${tag}`;
  const fehlen = WOCHE_MIN_FEST - w.fest - w.frei;
  return `<b>${w.fest + w.frei}</b> mit Termin ${tag}<small>${w.vorgemerkt ? `${w.vorgemerkt} vorgemerkt, ` : ''}mind. ${fehlen} fehl${fehlen === 1 ? 't' : 'en'}</small>`;
}

function renderRaster(m) {
  if (!m.hatListe) {
    return `
      <div class="section-title">DIE N&Auml;CHSTEN WOCHEN</div>
      <div class="status-section fade-in"><p class="trend-empty">Dieser Snapshot kennt die Beitragsliste noch nicht (vor Version 2.0). Sie kommt mit dem n&auml;chsten Lauf.</p></div>`;
  }
  const horizontKw = m.letzterGetimed ? kwVon(m.letzterGetimed) : null;
  const zeilen = m.wochen.map(w => {
    let zellen = '';
    for (let t = 0; t < 7; t++) {
      const tag = tagPlus(w.montag, t);
      const drin = w.beitraege.filter(b => b.datum === tag);
      const cls = ['red-wk__tag'];
      if (t >= 5) cls.push('red-wk__we');
      if (tag === m.stichtag) cls.push('red-wk__heute');
      if (!drin.length && m.slots.includes(t + 1) && tag >= m.stichtag) cls.push('red-wk__frei');
      zellen += `<td class="${cls.join(' ')}">${drin.map(chip).join('')}</td>`;
    }
    const horizont = w.kw === horizontKw;
    const zcls = [w.vorbei ? 'red-wk__vorbei' : '', w.laufend ? 'red-wk__laufend' : '', horizont ? 'red-wk__horizont' : '']
      .filter(Boolean).join(' ');
    const marke = horizont ? `<span class="red-wk__marke">getimed bis ${ddmm(m.letzterGetimed)}</span>` : '';
    return `<tr class="${zcls}"><td class="red-wk__kw">${w.kw}<small>${ddmm(w.montag)} bis ${ddmm(w.sonntag)}</small>${marke}</td>${zellen}<td class="red-wk__sum">${bilanzZelle(w)}</td></tr>`;
  }).join('');
  const kopf = TAGE_KURZ.map((t, i) => `<th class="${i >= 5 ? 'red-wk__we' : ''}">${t}</th>`).join('');
  const slotNamen = m.slots.map(s => TAGE_KURZ[s - 1]).join(' und ');
  return `
    <div class="section-title">DIE N&Auml;CHSTEN WOCHEN <small>Ein Feld je Tag aus dem Feld &bdquo;geplant&ldquo; &middot; LinkedIn z&auml;hlt, Facebook und Instagram laufen mit &middot; Rastertage ${slotNamen} &middot; kein Titel, der Klick &ouml;ffnet Notion</small></div>
    <div class="status-section fade-in">
      <div class="red-wk-wrap">
        <table class="red-wk">
          <thead><tr><th class="red-wk__kw">Woche</th>${kopf}<th class="red-wk__sum">Bilanz LinkedIn</th></tr></thead>
          <tbody>${zeilen}</tbody>
        </table>
      </div>
      <div class="legend red-legende">
        <span><span class="red-chip red-chip--erschienen">erschienen</span></span>
        <span><span class="red-chip red-chip--getimed">in LinkedIn getimed</span></span>
        <span><span class="red-chip red-chip--frei">freigegeben, Termin vergeben, noch nicht getimed</span></span>
        <span><span class="red-chip red-chip--vorgemerkt">offen, Termin vorgemerkt</span></span>
        <span>LI = LinkedIn, FI = Facebook und Instagram</span>
      </div>
    </div>`;
}

// ─── 4 · Arbeitsliste ────────────────────────────────
// Regelbasiert, keine Handpflege. Eine Regel ohne Treffer erzeugt keine Zeile.
// (a) freigegeben mit Termin, nicht getimed; (b) Lücke in den nächsten
// LUECKE_WOCHEN Wochen, mit Terminvorschlag aus den freigegebenen ohne Termin;
// (c) In Prüfung seit mehr als 4 Wochen unverändert; (d) Datenpflege.
function arbeitsliste(d, stichtag, liste, wochen, slots, letzterGetimed, freiMitTermin) {
  const zeilen = [];

  if (d.freigegeben_mit_termin) {
    const n = d.freigegeben_mit_termin;
    const spanne = freiMitTermin.length
      ? ` (${ddmm(freiMitTermin[0])}${freiMitTermin.length > 1 ? ` bis ${ddmm(freiMitTermin[freiMitTermin.length - 1])}` : ''})` : '';
    const ende = [letzterGetimed, freiMitTermin[freiMitTermin.length - 1]].filter(Boolean).sort().pop();
    const neu = ende && ende > stichtag ? wochenZahl(tageZwischen(stichtag, ende)) : null;
    const wirkung = neu !== null && neu > (d.vorlauf_wochen || 0)
      ? ` Der getimte Vorlauf steigt damit von ${komma(d.vorlauf_wochen || 0)} auf ${komma(neu)} Wochen.` : '';
    zeilen.push({
      regel: 'a', stufe: 'warn', anzahl: n, link: NOTION_KALENDER, linkText: 'Notion-Kalender',
      titel: `${n === 1 ? 'freigegebener Beitrag trägt' : 'freigegebene Beiträge tragen'} einen Termin${spanne}, ${n === 1 ? 'ist' : 'sind'} aber nicht in LinkedIn eingeplant`,
      was: `Einplanen und auf „eingeplant &amp; getimed“ stellen.${wirkung}`,
    });
  }

  const luecken = wochen.filter(w => w.offset >= 1 && w.offset <= LUECKE_WOCHEN && w.fest + w.frei < WOCHE_MIN_FEST);
  if (luecken.length) {
    const ohne = d.freigegeben_ohne_termin || 0;
    const vorschlag = [];
    let fehlen = 0;
    luecken.forEach(w => {
      let bedarf = WOCHE_MIN_FEST - w.fest - w.frei;
      fehlen += bedarf;
      for (let t = 0; t < 7 && bedarf > 0; t++) {
        const tag = tagPlus(w.montag, t);
        if (!slots.includes(t + 1) || tag < stichtag) continue;
        if (w.beitraege.some(b => b.datum === tag && istLinkedin(b))) continue;
        vorschlag.push(tag); bedarf--;
      }
    });
    const nehmen = vorschlag.slice(0, ohne);
    const liste_ = luecken.map(w => `${w.kw} hat ${w.fest + w.frei} mit Termin${w.vorgemerkt ? ` (+ ${w.vorgemerkt} vorgemerkt)` : ''}`).join(', ');
    let was;
    if (!ohne) was = 'Kein freigegebener Beitrag ohne Termin übrig: Nachschub kommt nur aus der Prüfung.';
    else if (!nehmen.length) was = `${ohne} freigegebene ohne Termin, aber kein freier Rastertag in diesen Wochen.`;
    else {
      const rest = fehlen - nehmen.length;
      was = `${ohne} freigegebene ${ohne === 1 ? 'Beitrag hat' : 'Beiträge haben'} noch keinen Termin. Vorschlag: ${nehmen.map(tagKurz).join(', ')}`
        + (rest > 0 ? ` Danach fehlen noch ${rest}.` : '');
    }
    zeilen.push({
      regel: 'b', stufe: 'warn', anzahl: luecken.length, link: NOTION_TODO, linkText: 'Freigegebene ohne Termin',
      titel: `${luecken.length === 1 ? 'Woche' : 'Wochen'} mit weniger als ${WOCHE_MIN_FEST} Beiträgen: ${liste_}`,
      was,
    });
  }

  const n = (d.totals || {}).in_pruefung || 0;
  const stauTage = pruefungStauTage(d, stichtag);
  if (n && stauTage > PRUEFUNG_STAU_TAGE) {
    zeilen.push({
      regel: 'c', stufe: 'crit', anzahl: n, link: NOTION_TODO, linkText: 'In Prüfung',
      titel: `${n === 1 ? 'Beitrag steht' : 'Beiträge stehen'} seit ${Math.floor(stauTage / 7)} Wochen in Prüfung`,
      was: `Seit dem ${ddmm(d.in_pruefung_seit)} hat sich der Bestand nicht bewegt. Ohne Freigaben füllt sich der Vorrat an fertigen Beiträgen nicht nach.`,
    });
  }

  if (d.offen_ohne_person) {
    const k = d.offen_ohne_person;
    zeilen.push({
      regel: 'd', stufe: 'info', anzahl: k, link: NOTION_TODO, linkText: 'Offen ohne Person',
      titel: `${k === 1 ? 'Thema steht' : 'Themen stehen'} auf „offen“ ohne zuständige Person`,
      was: 'Wer schreibt? Ohne Person entsteht kein Beitrag für die Prüfung.',
    });
  }
  const ohneKanal = liste.filter(b => !(b.kanal || []).length);
  const ohneDatum = d.gepostet_ohne_datum || 0;
  if (ohneKanal.length || ohneDatum) {
    const teile = [];
    if (ohneKanal.length) teile.push(`${ohneKanal.length} ${ohneKanal.length === 1 ? 'Beitrag' : 'Beiträge'} ohne Kanal (${ohneKanal.map(b => tagKurz(b.datum)).join(', ')})`);
    if (ohneDatum) teile.push(`${ohneDatum} ${ohneDatum === 1 ? 'geposteter' : 'gepostete'} ohne Datum`);
    zeilen.push({
      regel: 'd', stufe: 'info', anzahl: ohneKanal.length + ohneDatum, link: NOTION_VEROEFFENTLICHT, linkText: 'Veröffentlicht',
      titel: teile.join(', '),
      was: 'Datenpflege: Kanal und Datum nachtragen, sonst fehlen sie in der Wochenzählung.',
      ohneZahl: true,
    });
  }
  return zeilen;
}

function renderArbeitsliste(m) {
  const zeilen = m.arbeitsliste;
  const inhalt = zeilen.length
    ? `<ul class="red-todo">${zeilen.map(z => `
        <li data-regel="${z.regel}"><span class="red-todo__punkt red-todo__punkt--${z.stufe}"></span>
          <div><div class="red-todo__t">${z.ohneZahl ? '' : `<b>${z.anzahl}</b> `}${z.titel}</div><div class="red-todo__w">${z.was}</div></div>
          <a class="red-todo__go" href="${z.link}" target="_blank" rel="noopener">${z.linkText}</a></li>`).join('')}</ul>`
    : '<p class="chart-note">Nichts zu tun: der Plan erf&uuml;llt alle Regeln.</p>';
  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">WAS ZU TUN IST</h3>
      <p class="chart-note">Aus dem Plan abgeleitet, keine Handpflege. Jeder Punkt &ouml;ffnet die passende Ansicht in Notion und verschwindet von selbst, sobald der Plan stimmt.</p>
      ${inhalt}
    </div>`;
}

// ─── 5 · Themen-Mix der nächsten 8 Wochen ────────────
function themenMix(m) {
  const bis = tagPlus(m.stichtag, 56);
  const drin = m.liste.filter(b => b.datum >= m.stichtag && b.datum < bis);
  const zaehler = {};
  THEMEN.forEach(t => { zaehler[t] = 0; });
  drin.forEach(b => {
    const th = (b.thema || []).length ? b.thema : ['ohne Thema'];
    th.forEach(t => { zaehler[t] = (zaehler[t] || 0) + 1; });
  });
  const zeilen = Object.entries(zaehler).sort((a, b) => b[1] - a[1]);
  return { anzahl: drin.length, bis, zeilen };
}

function renderThemenMix(m) {
  const mix = themenMix(m);
  const max = Math.max(1, ...mix.zeilen.map(([, n]) => n));
  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">THEMEN-MIX DER N&Auml;CHSTEN 8 WOCHEN</h3>
      <p class="chart-note">${mix.anzahl} Beitr&auml;ge mit Termin bis ${ddmm(tagPlus(mix.bis, -1))} &middot; Feld &bdquo;Thema&ldquo;, ein Beitrag kann mehrere tragen</p>
      <div class="red-mix">${mix.zeilen.map(([t, n]) => `
        <div><span>${t}</span><div class="red-mix__bar"><i style="width:${Math.round(n / max * 100)}%"></i></div><b>${n}</b></div>`).join('')}
      </div>
    </div>`;
}

// ─── 6 · Beiträge je Woche: Vergangenheit und Plan ───
// Links die vollen Wochen aus posted_by_week_linkedin (Lücken als 0), ab der
// laufenden Woche aus der Beitragsliste: erschienen, getimed (hell) und
// freigegeben mit Termin (schraffiert).
function buildWochenChart(m) {
  const hist = buildFreqSeries(m.d).slice(-9).map(r => ({ week: r.week, post: r.n, timed: 0, frei: 0 }));
  const plan = m.wochen.filter(w => w.offset >= 0 && w.offset <= 7).map(w => ({
    week: isoWeekKeyOfDate(tagDate(w.montag)), post: w.erschienen, timed: w.getimed, frei: w.frei, laufend: w.laufend,
  }));
  return hist.concat(plan);
}

function renderWochenChart(m) {
  const weeks = buildWochenChart(m);
  if (!weeks.length) return '';
  const W = 900, H = 230, pl = 34, pr = 12, pt = 16, pb = 30;
  const maxY = Math.max(LI_POSTS_ZIEL + 1, ...weeks.map(w => w.post + w.timed + w.frei)) + 1;
  const slot = (W - pl - pr) / weeks.length;
  const bw = Math.min(28, slot * 0.6);
  const y = v => pt + (1 - v / maxY) * (H - pt - pb);
  let s = `<defs><pattern id="red-schraffur" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff"/><line x1="0" y1="0" x2="0" y2="6" stroke="#009ee3" stroke-width="2"/></pattern></defs>`;
  for (let v = 0; v <= maxY; v++) {
    s += `<line x1="${pl}" y1="${y(v)}" x2="${W - pr}" y2="${y(v)}" class="trend__grid"/>`;
    s += `<text x="${pl - 7}" y="${y(v) + 4}" font-size="11" fill="var(--muted)" text-anchor="end">${v}</text>`;
  }
  s += `<rect x="${pl}" y="${y(3)}" width="${W - pl - pr}" height="${y(2) - y(3)}" fill="#27ae60" opacity=".08"/>`;
  s += `<text x="${pl + 6}" y="${y(3) - 5}" font-size="11" fill="#1c7c43">Ziel 2 bis 3 pro Woche</text>`;
  weeks.forEach((w, i) => {
    const cx = pl + slot * i + slot / 2, x = cx - bw / 2;
    let oben = 0;
    const seg = (n, fill, extra = '') => {
      if (!n) return;
      s += `<rect x="${x}" y="${y(oben + n)}" width="${bw}" height="${y(oben) - y(oben + n)}" fill="${fill}" rx="3" ${extra}/>`;
      oben += n;
    };
    seg(w.post, SOC_COLORS.li);
    seg(w.timed, '#009ee3');
    seg(w.frei, 'url(#red-schraffur)', 'stroke="#009ee3" stroke-width="1.5" stroke-dasharray="4 3"');
    const titel = `${kwLabel(w.week)}: ${w.post} erschienen${w.timed ? `, ${w.timed} getimed` : ''}${w.frei ? `, ${w.frei} freigegeben mit Termin` : ''}`;
    s += `<rect x="${cx - slot / 2}" y="${pt}" width="${slot}" height="${H - pt - pb}" fill="transparent"><title>${titel}</title></rect>`;
    if (oben) s += `<text x="${cx}" y="${y(oben) - 5}" font-size="12" font-weight="bold" fill="var(--ink)" text-anchor="middle">${oben}</text>`;
    else s += `<rect x="${x}" y="${y(0) - 2}" width="${bw}" height="2" fill="#c9d2da"/>`;
    s += `<text x="${cx}" y="${H - 9}" font-size="11" fill="${w.laufend ? '#009ee3' : 'var(--muted)'}" font-weight="${w.laufend ? 700 : 400}" text-anchor="middle">${kwLabel(w.week)}</text>`;
    if (w.laufend) {
      s += `<line x1="${cx - slot / 2}" x2="${cx - slot / 2}" y1="${pt}" y2="${H - pb + 4}" stroke="#009ee3" stroke-dasharray="3 3"/>`;
      s += `<text x="${cx - slot / 2 + 4}" y="${pt + 10}" font-size="10.5" fill="#009ee3">heute</text>`;
    }
  });
  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">BEITR&Auml;GE JE WOCHE</h3>
      <p class="chart-note">LinkedIn &middot; Ziel 2 bis 3 pro Woche &middot; aus dem Notion-Redaktionsplan (Feld &bdquo;${datumsfeld(m.d)}&ldquo;), eingeplante Beitr&auml;ge z&auml;hlen ab ihrem Datum als erschienen &middot; rechts vom Stichtag getimed (hell) und freigegeben mit Termin (schraffiert)</p>
      <div class="chart-wrap">
        <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Beitr&auml;ge je Kalenderwoche, erschienen und geplant">${s}</svg>
      </div>
    </div>`;
}

// ─── 7 · Später ──────────────────────────────────────
function renderSpaeter() {
  return `
    <div class="red-spaeter fade-in">
      <b>Sp&auml;ter</b>
      <span>Sichtbarkeit (Impressions, Interaktionen, Follower) zieht auf eine eigene Seite &bdquo;Wirkung&ldquo; um, sobald die Zahlen automatisch aus LinkedIn und Meta kommen (korodur-redaktion#44). Bis dahin: monatlicher Analytics-Review aus den Plattform-Exporten.</span>
    </div>`;
}

// ─── Beitragszahl je Woche (Issue #233) ──────────────
// Quelle ist der Redaktionsplan, nicht der LinkedIn-Export: dessen Spalte
// "Erstellt am" ist der Tag des Einplanens. Im Export vom 14.09.2026 standen
// alle 11 Beitraege aus KW 34 bis 37 auf 14. bis 20.08., die Seite haette
// KW 34 mit 9 und KW 35 bis 37 mit 0 gezeigt. Snapshots vor Version 1.4
// kennen das LinkedIn-Feld noch nicht und fallen auf alle Kanaele zurueck.
function beitraegeJeWoche(d) {
  return (d && (d.posted_by_week_linkedin || d.posted_by_week)) || {};
}

function wocheVerschieben(weekKey, wochen) {
  const monday = mondayOfIsoWeek(weekKey);
  if (!monday) return null;
  return isoWeekKeyOfDate(new Date(monday.getTime() + wochen * 7 * 86400000));
}

// Die zuletzt abgeschlossene Kalenderwoche vor dem Stichtag. Die laufende
// Woche ist angebrochen und laese sich montags immer wie "unter Ziel".
function letzteVolleWoche(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(((d || {})._meta || {}).snapshot_date || '');
  if (!m) return null;
  const stichtag = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return wocheVerschieben(isoWeekKeyOfDate(stichtag), -1);
}

// ─── 4+5 · Beiträge je Woche & Pipeline-Funnel ────────
// Fuellt jede Woche zwischen der ersten Woche in `series` und `bis` mit
// einem 0-Stub (source: 'none'), damit Wochen ohne Beitrag auf der Achse
// sichtbar bleiben statt zu verschwinden -- sonst zeigt das Chart eine
// geschoente Frequenz, dabei sind die Luecken die Botschaft dieser KPI
// (Review PR #144, wie im abgenommenen Mockup KW 23-31). Die Achse endet an
// der letzten vollen Woche, auch wenn die leer war: eine Serie von Nullen am
// Ende ist genau die Nachricht, die nicht abgeschnitten werden darf.
function fillWeekGaps(series, bis) {
  if (!series.length) return series;
  const byWeek = {};
  series.forEach(r => { byWeek[r.week] = r; });
  const filled = [];
  let cursor = mondayOfIsoWeek(series[0].week);
  const lastMonday = mondayOfIsoWeek(bis || series[series.length - 1].week);
  while (cursor <= lastMonday) {
    const wk = isoWeekKeyOfDate(cursor);
    filled.push(byWeek[wk] || { week: wk, n: 0, source: 'none' });
    cursor = new Date(cursor.getTime() + 7 * 86400000);
  }
  return filled;
}

function buildFreqSeries(d) {
  const bis = letzteVolleWoche(d);
  const series = Object.entries(beitraegeJeWoche(d))
    .filter(([wk]) => !bis || wk <= bis)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, n]) => ({ week, n, source: 'notion' }));
  return fillWeekGaps(series, bis);
}

// Welches Notion-Datumsfeld die Kadenz traegt, steht seit Issue #175 im
// Snapshot. Bis 10.08.2026 war das "veroeffentlicht" (Ist-Datum), seither
// "geplant" (Plan-Datum). Der Unterschied gehoert auf die Seite: sonst liest
// sich ein Naeherungswert wie eine Messung. Aeltere Snapshots ohne das Feld
// stammen aus der Zeit davor.
function datumsfeld(d) {
  return ((d || {})._meta || {}).datumsquelle || 'ver&ouml;ffentlicht';
}

// ─── Pipeline-Funnel (unverändert bis auf Farben, Issue #141 Design) ──
const FUNNEL_TITLE = 'PIPELINE: VON DER IDEE ZUM POST';

function renderFunnel(t, eingeplantErschienen) {
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
  // "In Arbeit" ist seit dem 11.08.2026 leer (Statusmodell); eine leere Stufe
  // bleibt aus der Legende draussen, damit sie nicht wie ein Befund aussieht.
  const legend = FUNNEL.filter(f => f.key !== 'in_arbeit' || t[f.key]).map(f =>
    `<span class="status-legend__item"><span class="status-legend__dot" style="background:${f.color}"></span>${f.label}: ${t[f.key] || 0}</span>`
  ).join('');

  // Gepostet enthaelt eingeplante Beitraege mit vergangenem Datum (Issue #233).
  // In Notion stehen sie weiter auf "eingeplant & getimed"; ohne diesen Satz
  // stimmt die Zahl hier nicht mit der Notion-Ansicht ueberein.
  const erschienen = eingeplantErschienen
    ? `<p class="chart-note" style="margin-top:14px">Erschienen enth&auml;lt ${eingeplantErschienen} eingeplante Beitr&auml;ge, deren Datum vorbei ist. In Notion stehen sie weiter auf &bdquo;eingeplant &amp; getimed&ldquo;.</p>` : '';

  return `
    <div class="status-section fade-in">
      <h3 class="status-section__title">${FUNNEL_TITLE}</h3>
      <div class="funnel">${segs}</div>
      <div class="status-legend">${legend}${unbekannt}${abgelehnt}</div>
      ${erschienen}
    </div>
  `;
}

// ─── Empty State ─────────────────────────────────────
function renderEmpty() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="snapshot-header fade-in">
      <h1 class="snapshot-header__title">REDAKTION: L&Auml;UFT SOCIAL MEDIA?</h1>
      <p class="snapshot-header__sub">Notion-Redaktionsplan (Aggregat und anonymisierte Beitragsliste)</p>
    </div>
    <div class="loading">
      <div style="text-align:center;line-height:1.7;">
        Noch keine Redaktions-Snapshots vorhanden.<br>
        Der erste Datenpunkt entsteht automatisch, sobald das Secret
        <code>NOTION_TOKEN</code> im Repo hinterlegt ist (t&auml;glicher Lauf am fr&uuml;hen Morgen).
      </div>
    </div>
  `;
  const meta = document.getElementById('header-meta');
  if (meta) meta.textContent = 'Wartet auf ersten Snapshot';
}
