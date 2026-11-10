/* ============================================
   KORODUR Work Cockpit, Referenzen
   Rendert data/snapshots/referenzen/<datum>.json (Tages-Aggregat des Notion-
   Referenzverzeichnisses) + referenzen-timeseries.json. Read-only, nur
   Aggregatzahlen: keine Objekttitel, keine Betreiber, Verarbeiter, GU,
   Architekten, keine Orte (die Seite ist ohne Login erreichbar).
   In dev: symlink src/data -> ../data; in production: data/ liegt im Root.

   Ab Snapshot 2.0: drei Ziele über alle Prioritäten. Historische Prio-A-
   Werte bleiben gesondert sichtbar und werden nicht neu interpretiert.
   ============================================ */

const REF_DIR = 'data/snapshots/referenzen/';

const REF_MONTHS_DE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const REF_MONTHS_KURZ = [
  'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
];

// Bucket-Reihenfolge und die Notion-Status dahinter. Spiegelt STATUS_BUCKETS
// in scripts/fetch_referenzen.py. Wer dort etwas aendert, aendert es hier mit,
// sonst benennen die Unterzeilen Status, die es nicht mehr gibt.
// tests/test_referenzen_render.mjs vergleicht beide Listen und wird rot, wenn
// sie auseinanderlaufen.
// Vierzehn Stufen seit 29.10.2026 (rr#359), dreizehn seit 22.09.2026
// (rv#177); davor zwölf (rr#211). Die zehn
// Altnamen (Zu Bearbeiten, In Bearbeitung - inhaltlich, Onepager erstellt,
// DE-Freigabe und so weiter) gibt es in Notion nicht mehr. Die Bucket-Keys
// bleiben unveraendert, damit die Zeitreihe und die Sparklines durchlaufen.
const REF_BUCKETS = [
  { key: 'offen', label: 'Offen', color: 'var(--muted)',
    statuses: ['offen', 'Bilder sind da'] },
  { key: 'in_arbeit', label: 'In Arbeit', color: 'var(--secondary)',
    statuses: ['RAW: Info+Bilder da', 'Informationen fehlen', 'STRUCTURED: Info', 'Fragen VOR V1 beantwortet'] },
  { key: 'in_abnahme', label: 'In Abnahme', color: '#6b5b95',
    statuses: ['V1 Entwurf fertig', 'V1 Feedback da', 'V2 Entwurf fertig', 'V2 Feedback da'] },
  // Seit 29.10.2026 (rr#359): inhaltlich fertig und anonymisiert nutzbar, die
  // Freigabe liegt beim Vertrieb. Nicht freigegeben, keine finale Version DE.
  // Die Kachel zählt den reinen Status einschließlich Website-Altbestand und
  // heißt deshalb anders als „wartet auf Freigabe“ auf der Zielkarte, die
  // ohne Altbestand zählt (rr#374, Korrekturrunde 08.11.2026).
  { key: 'fertig_freigabe_offen', label: 'Freigabe steht aus, mit Altbestand', color: 'var(--warning)',
    statuses: ['Fertig - Freigabe steht aus'] },
  { key: 'freigegeben', label: 'Freigegeben', color: '#7dd0a5',
    statuses: ['Freigabe da (fachlich & rechtlich)', 'finale Version DE'] },
  { key: 'veroeffentlicht', label: 'Veröffentlicht', color: 'var(--success)',
    statuses: ['Veröffentlicht'] },
];
const REF_OHNE_STATUS = { key: 'ohne_status', label: 'Ohne Status', color: 'var(--danger)' };

// Strategische Prioritaet der Einsatzbereiche (Steffi, 30.07.2026). Nicht zu
// verwechseln mit der Anzeigereihenfolge der Website (KORODUR-Website#496).
// Schwerindustrie und Industrie & Produktion stehen beide auf Prio 1, deshalb
// steht in der Spalte zweimal die 1 und danach die 3.
// Die Namen muessen wortgleich zu den Notion-Optionen sein. Am 06.08.2026 war
// das einen halben Tag lang nicht der Fall: der vierte Bereich hiess bis dahin
// "Außenflächen / ..." und fiel dadurch mit 46 Nennungen in die offene
// Zuordnung, waehrend die Tabelle ihn mit 0 auswies. Seither wacht das
// Begriffs-Gate darueber (.verbotene-begriffe). Zweite Umbenennung 07.08.2026
// (Abstimmung MH): der vierte Bereich heisst jetzt "Infrastruktur".
const REF_EINSATZBEREICHE = [
  { name: 'Schwerindustrie', prio: 1 },
  { name: 'Industrie & Produktion', prio: 1 },
  { name: 'Lager & Logistik', prio: 3 },
  { name: 'Infrastruktur', prio: 4 },
  { name: 'Parkdeck & Tiefgarage', prio: 5 },
  { name: 'Verkauf & Ausstellung', prio: 6 },
];
// Ursprung des Website-Harvests. Spiegelt URSPRUNG_IMPORT in
// scripts/fetch_referenzen.py und trennt in v1 den geerbten Altbestand von der
// eigenen Arbeitsmenge, solange "Veroeffentlicht am" fehlt.
const REF_ALTBESTAND = 'Website';

let refSeries = [];

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const idxRes = await fetch(REF_DIR + 'index.json');
    if (!idxRes.ok) throw new Error('no-data');
    const keys = await idxRes.json();
    if (!Array.isArray(keys) || keys.length === 0) throw new Error('no-data');

    const snapRes = await fetch(REF_DIR + keys[0] + '.json');
    if (!snapRes.ok) throw new Error('no-data');
    const snap = await snapRes.json();

    try {
      const tsRes = await fetch(REF_DIR + 'referenzen-timeseries.json');
      if (tsRes.ok) {
        const ts = await tsRes.json();
        if (Array.isArray(ts)) refSeries = ts.slice().sort((a, b) => a.date.localeCompare(b.date));
      }
    } catch { /* Verlauf bleibt leer, der Rest rendert */ }

    renderReferenzen(snap);
    const meta = document.getElementById('header-meta');
    if (meta) meta.textContent = `Snapshot: ${refFormatDate(snap._meta.snapshot_date)}`;
  } catch {
    renderEmpty();
  }
});

// ─── Helfer ──────────────────────────────────────────
function refEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function refFormatDate(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return key || '';
  return `${parseInt(m[3], 10)}. ${REF_MONTHS_DE[parseInt(m[2], 10) - 1]} ${m[1]}`;
}

// Ein fehlender Wert ist keine Null. "n. v." sagt "nicht gemessen", eine 0
// wuerde eine Messung behaupten, die es nicht gibt.
function refFehlt(v) {
  return (v === null || v === undefined || Number.isNaN(v)) ? 'n.&nbsp;v.' : v;
}

function refPct(teil, ganz) {
  return ganz > 0 ? (teil / ganz) * 100 : 0;
}

// ─── Render ──────────────────────────────────────────
function renderReferenzen(d) {
  const main = document.getElementById('main');
  const t = d.totals || {};

  main.innerHTML = `
    <div class="snapshot-header fade-in">
      <h1 class="snapshot-header__title">REFERENZEN: BESTAND UND FORTSCHRITT</h1>
      <p class="snapshot-header__sub">
        ${refEsc(d._meta.source)} &middot; ${refFormatDate(d._meta.snapshot_date)}
        &middot; ${d.gesamt ?? 0} Referenzen im Verzeichnis
      </p>
    </div>

    ${renderZiel(d)}
    ${renderBestandKacheln(d, t)}
    ${renderUnbekannterStatus(t)}
    ${renderEinsatzbereiche(d)}
    ${renderZulauf(d)}

    <div class="footer">
      Referenz-Segment &middot; Quelle: Notion-Referenzverzeichnis (nur Aggregatzahlen)
      &middot; Kennzahlen-Definitionen:
      <a href="https://github.com/KORODUR-International/korodur-review-reporting/blob/main/docs/kennzahlen-referenzen.md" target="_blank">docs/kennzahlen-referenzen.md</a>
      &middot; Generiert am ${new Date(d._meta.generated_at).toLocaleDateString('de-DE')}
      &middot; <a href="https://github.com/KORODUR-International/korodur-review-reporting" target="_blank">GitHub</a>
    </div>
  `;
}

// Seit #319 steht die Seite nur noch aus Ziel, Bestand, Abdeckung und
// Zulauf; mit #321 sind die übrigen Blöcke samt Code gelöscht, die Liste
// steht in docs/kennzahlen-referenzen.md Abschnitt 0. Die Warnung über
// unbekannte Status stand im Gesamtbestand und
// bleibt als Absicherung eigenständig: ohne sie fehlten solche Referenzen
// still in allen Kacheln.
function renderUnbekannterStatus(t) {
  if (!((t.unbekannt || 0) > 0)) return '';
  return `<p class="rf-nv"><b>${t.unbekannt} Referenzen tragen einen Status, den das Mapping in
    <code>scripts/fetch_referenzen.py</code> nicht kennt.</b> Sie fehlen in allen Kacheln oben.</p>`;
}

// ─── Band 1: Zielzahl ────────────────────────────────
// Ein Balken gegen die 20, zweifarbig. ab_de_freigabe ist kumulativ und
// enthaelt die veroeffentlichten mit, deshalb ist der helle Abschnitt die
// Differenz und nicht der Rohwert (sonst stuende der Fortschritt doppelt drin).
function renderZiel(d) {
  const z = d.ziele;
  // Ein alter Snapshot kennt die neuen Messfelder nicht. Seine Prio-A-
  // Zahlen dürfen weder als aktuelle Menge noch als Null weiterlaufen.
  const termine = z?.termine || [
    {datum: '2026-10-15', zielwert: 10, messgroesse: 'de_intern'},
    {datum: '2026-12-15', zielwert: 20, messgroesse: 'de_intern'},
    {datum: '2026-12-15', zielwert: 10, messgroesse: 'en_fr_live'},
  ];
  // Zwei Kacheln statt drei (#319): das DE-Ziel läuft gegen den größten
  // Termin, die kleineren Termine stehen als Etappenmarke im Balken.
  const intern = termine.filter(m => m.messgroesse !== 'en_fr_live')
    .sort((a, b) => a.zielwert - b.zielwert || a.datum.localeCompare(b.datum));
  const live = termine.filter(m => m.messgroesse === 'en_fr_live');
  const datum = iso => iso.split('-').reverse().join('.');
  const karte = (label, measure, ziel, etappen, zusatz = '') => {
    const known = measure?.messbar === true && Number.isFinite(measure.wert);
    const marken = etappen.map(e => `<span class="rf-goal__etappe" style="left:${refPct(e.zielwert, ziel.zielwert)}%"
        title="${e.zielwert} bis ${refEsc(datum(e.datum))}"></span>`).join('');
    const legende = etappen.length
      ? `<div class="rf-goal__etappen">${etappen.map(e => `Etappe ${e.zielwert} bis ${refEsc(datum(e.datum))}`).join(' &middot; ')} &middot; Ziel ${ziel.zielwert} bis ${refEsc(datum(ziel.datum))}</div>`
      : `<div class="rf-goal__etappen">Ziel bis ${refEsc(datum(ziel.datum))}</div>`;
    return `<div class="rf-goal">
      <div class="rf-goal__label">${label}</div>
      <div class="rf-goal__value">${known ? measure.wert : 'n. v.'} <small>von ${ziel.zielwert}</small></div>
      ${known ? `<div class="rf-goal__bahn"><div class="rf-goal__track"><div class="rf-goal__seg" style="width:${Math.min(refPct(measure.wert, ziel.zielwert), 100)}%;background:#7dd0a5"></div></div>${marken}</div>`
        : '<p class="rf-warn">Noch nicht messbar</p>'}
      ${legende}
      ${zusatz}
    </div>`;
  };
  const cards = [
    intern.length ? renderStufenKarte(z, intern, datum, d._meta?.snapshot_date || '') : '',
    ...live.map(m => karte('Übersetzt und live, EN und FR', z?.en_fr_live, m, [])),
  ].join('');
  return `<div class="band fade-in"><h3>Referenzziele 2026</h3><span>Alle Prioritäten, einschließlich leerer Priorität</span></div>
    <div class="rf-goals rf-goals--${Math.max(1, (intern.length ? 1 : 0) + live.length)} fade-in">${cards}</div>
    ${!z ? '<p class="rf-nv">Die neue Zählbasis ist in diesem Snapshot noch nicht erhoben. Historische Werte werden nicht umgerechnet.</p>' : ''}
    ${!z && d.ziel ? `<details><summary>Historische Zählung: nur Prio A, Stand ${refEsc(d._meta?.snapshot_date || '')}</summary>${renderHistorischesZiel(d)}</details>` : ''}`;
}

// ─── Jahresziel in zwei Stufen (rr#374) ──────────────
// Beschluss Steffi, 08.11.2026: Stufe 1 = inhaltlich fertig und intern
// fachlich freigegeben (ab "Fertig - Freigabe steht aus"), Stufe 2 =
// Freigabesituation geklärt, öffentlich oder nur intern (ab "Freigabe da
// (fachlich & rechtlich)"). Beide gegen dieselben Termine; erledigt heißt
// erst Stufe 2. Stufe 1 umfasst Stufe 2; die Menge dazwischen wartet auf
// Freigabe.
//
// Ein Snapshot vor der Umstellung führt keine Stufenfelder. Dann leitet die
// Seite sie aus vorhandenen Feldern ab (Stufe 2 = de_intern, Stufe 1 =
// de_intern plus fertig_freigabe_offen) und sagt das dazu; fehlt
// fertig_freigabe_offen, bleibt Stufe 1 "n. v." statt 0.
function refStufen(z) {
  const zahl = m => (m?.messbar === true && Number.isFinite(m.wert)) ? m.wert : null;
  if (z?.stufe_1 && z?.stufe_2) {
    return { s1: zahl(z.stufe_1), s2: zahl(z.stufe_2), abgeleitet: false };
  }
  const de = zahl(z?.de_intern);
  const offen = Number.isFinite(z?.fertig_freigabe_offen?.wert) ? z.fertig_freigabe_offen.wert : null;
  return {
    s1: de !== null && offen !== null ? de + offen : null,
    s2: de,
    abgeleitet: de !== null,
  };
}

// Wert einer Stufe in einer Zeile der Zeitreihe (rr#374, Korrekturrunde).
// Stufe 2 ist dieselbe Regel wie ziel_de_intern, das die Zeitreihe seit dem
// 23.09.2026 auf der Zählbasis alle_prioritaeten führt. Stufe 1 gibt es nur,
// wo die Zeitreihe ziel_stufe_1 führt (gemessen oder aus dem Tages-Snapshot
// abgeleitet, ab 29.10.2026). Kein Wert wird geschätzt oder aus der anderen
// Stufe übernommen; die Bestandsspalte fertig_freigabe_offen der Zeitreihe
// enthält Altbestand und ist deshalb keine Quelle für Stufe 1.
function refStufeAm(r, stufe) {
  if (!r || r.ziel_basis !== 'alle_prioritaeten') return null;
  if (stufe === 1) return Number.isFinite(r.ziel_stufe_1) ? r.ziel_stufe_1 : null;
  if (Number.isFinite(r.ziel_stufe_2)) return r.ziel_stufe_2;
  return Number.isFinite(r.ziel_de_intern) ? r.ziel_de_intern : null;
}

// Verlauf einer Stufe: alle messbaren Tage der Zeitreihe und der Tag des
// angezeigten Snapshots mit dem Wert der Karte; er ersetzt eine Zeile
// desselben Datums.
function refStufenVerlauf(series, stufe, heute, aktuell) {
  const punkte = (series || [])
    .filter(r => r.date && r.date !== heute)
    .map(r => ({ date: r.date, wert: refStufeAm(r, stufe) }))
    .filter(p => p.wert !== null);
  if (heute && aktuell !== null) punkte.push({ date: heute, wert: aktuell });
  return punkte.sort((a, b) => a.date.localeCompare(b.date));
}

// Eine Termin-Zeile je Stufe. Ein Termin, der noch nicht verstrichen ist,
// zeigt den heutigen Stand ("erreicht" oder "fehlen N"). Ein verstrichener
// Termin zeigt den Wert am Stichtag aus der Zeitreihe und das Datum, seit dem
// das Ziel ununterbrochen erreicht ist. Reicht diese Strecke bis zum ersten
// messbaren Tag zurück, ist der Tag des Erreichens nicht bekannt, und die
// Zeile sagt "spätestens". Fehlt der Wert am Stichtag, steht genau das da.
function refTerminZeile(t, heute, verlauf, aktuell, datum) {
  const tag = refEsc(datum(t.datum));
  if (!heute || heute <= t.datum) {
    const termin = `${t.zielwert} zum ${tag}`;
    if (aktuell === null) return `${termin}: ${refFehlt(null)}`;
    return aktuell >= t.zielwert ? `${termin} erreicht` : `${termin}: fehlen ${t.zielwert - aktuell}`;
  }
  const amStichtag = verlauf.find(p => p.date === t.datum);
  const ab = verlauf.length && verlauf[0].date > t.datum
    ? ` (Zeitreihe dieser Stufe erst ab ${refEsc(datum(verlauf[0].date))})` : '';
  const kopf = amStichtag
    ? `${tag}: ${amStichtag.wert} von ${t.zielwert}`
    : `${tag}: Wert am Stichtag nicht messbar${ab}`;
  if (aktuell === null) return `${kopf}, heute ${refFehlt(null)}`;
  if (aktuell < t.zielwert) return `${kopf}, noch nicht erreicht, fehlen ${t.zielwert - aktuell}`;
  let i = verlauf.length - 1;
  while (i > 0 && verlauf[i - 1].wert >= t.zielwert) i -= 1;
  return `${kopf}, erreicht ${i === 0 ? 'spätestens ' : ''}am ${refEsc(datum(verlauf[i].date))}`;
}

function renderStufenKarte(z, intern, datum, heute = '') {
  const ziel = intern[intern.length - 1];
  const etappen = intern.slice(0, -1);
  const { s1, s2, abgeleitet } = refStufen(z);
  const wartet = s1 !== null && s2 !== null ? Math.max(0, s1 - s2) : null;
  const stand = (wert, stufe) => {
    const verlauf = refStufenVerlauf(refSeries, stufe, heute, wert);
    return intern.map(t => refTerminZeile(t, heute, verlauf, wert, datum)).join('<br>');
  };
  const wert = (v, text) => `<div style="flex:1 1 240px"><div class="rf-goal__value">${v === null ? 'n. v.' : v} <small>von ${ziel.zielwert}</small></div>
      <div class="rf-goal__etappen">${text}</div></div>`;
  const marken = etappen.map(e => `<span class="rf-goal__etappe" style="left:${refPct(e.zielwert, ziel.zielwert)}%"
      title="${e.zielwert} bis ${refEsc(datum(e.datum))}"></span>`).join('');
  const w2 = s2 === null ? 0 : Math.min(refPct(s2, ziel.zielwert), 100);
  const wW = wartet === null ? 0 : Math.min(refPct(wartet, ziel.zielwert), 100 - w2);
  const balken = s2 === null ? '<p class="rf-warn">Noch nicht messbar</p>'
    : `<div class="rf-goal__bahn"><div class="rf-goal__track"><div class="rf-goal__seg" style="width:${w2}%;background:#7dd0a5"></div><div class="rf-goal__seg" style="width:${wW}%;background:var(--warning)"></div></div>${marken}</div>`;
  const legende = `<div class="rf-goal__leg">
      <span><i style="background:#7dd0a5"></i>Stufe 2, erledigt: ${refFehlt(s2)}</span>
      <span><i style="background:var(--warning)"></i>wartet auf Freigabe: ${refFehlt(wartet)}</span>
    </div>`;
  const termine = `<div class="rf-goal__etappen">${etappen.map(e => `Etappe ${e.zielwert} bis ${refEsc(datum(e.datum))}`).join(' &middot; ')}${etappen.length ? ' &middot; ' : ''}Ziel ${ziel.zielwert} bis ${refEsc(datum(ziel.datum))}, gleiche Termine für beide Stufen</div>`;
  return `<div class="rf-goal">
      <div class="rf-goal__label">DE-Referenzen in zwei Stufen</div>
      <div style="display:flex;flex-wrap:wrap;gap:12px 32px">
        ${wert(s1, `<b>Stufe 1:</b> inhaltlich fertig und intern fachlich freigegeben<br>${stand(s1, 1)}`)}
        ${wert(s2, `<b>Stufe 2:</b> Freigabesituation geklärt, öffentlich oder nur intern<br>${stand(s2, 2)}`)}
      </div>
      ${balken}
      ${legende}
      ${termine}
      <div class="rf-goal__note"><b>Erledigt heißt erst Stufe 2.</b> Stufe 1 zeigt den Fortschritt der Arbeit,
        die Menge dazwischen wartet nur noch auf die Klärung der Freigabe.${abgeleitet
          ? ' Dieser Snapshot führt die Stufen noch nicht selbst; sie sind aus der bisherigen Zielzahl und der Menge, die auf Freigabe wartet, abgeleitet.'
          : ''}</div>
    </div>`;
}

function renderHistorischesZiel(d) {
  const z = d.ziel || {};
  const ziel = z.zielwert || 0;
  if (!ziel) return '';

  const erarbeitet = z.ab_de_freigabe || 0;
  const draussen = z.veroeffentlicht || 0;
  const nurErarbeitet = Math.max(0, erarbeitet - draussen);

  const wDraussen = Math.min(refPct(draussen, ziel), 100);
  const wErarbeitet = Math.min(refPct(nurErarbeitet, ziel), 100 - wDraussen);

  const hb = z.high_by_bucket || {};
  const verteilung = [...REF_BUCKETS, REF_OHNE_STATUS]
    .filter(b => (hb[b.key] || 0) > 0)
    .map(b => `${hb[b.key]} ${refEsc(b.label)}`)
    .join(' &middot; ');

  return `
    <div class="band fade-in"><h3>Historische Zielzahl</h3><span>${ziel} Prio-A-Referenzen</span></div>
    <div class="rf-goal fade-in">
      <div class="rf-goal__top">
        <div>
          <div class="rf-goal__label">Fortschritt gegen die Zielzahl, nur Priorit&auml;t ${refEsc(z.prioritaet || 'high')}</div>
          <div class="rf-goal__value">${erarbeitet} <small>von ${ziel} Prio&nbsp;A</small></div>
        </div>
        <div class="rf-goal__side">
          ${z.high_gesamt || 0} Referenzen auf Priorit&auml;t ${refEsc(z.prioritaet || 'high')} im Bestand${verteilung ? `<br>${verteilung}` : ''}
          ${refTempo(d, ziel, erarbeitet)}
        </div>
      </div>
      <div class="rf-goal__track">
        <div class="rf-goal__seg" style="width:${wDraussen}%;background:var(--success)"></div>
        <div class="rf-goal__seg" style="width:${wErarbeitet}%;background:#7dd0a5"></div>
      </div>
      <div class="rf-goal__ticks">${refZielTicks(ziel)}</div>
      <div class="rf-goal__leg">
        <span><i style="background:#7dd0a5"></i>ab &bdquo;finale Version DE&ldquo; erarbeitet: ${erarbeitet} von ${ziel}</span>
        <span><i style="background:var(--success)"></i>davon ver&ouml;ffentlicht, drau&szlig;en beim Kunden: ${draussen}</span>
      </div>
      <div class="rf-goal__note">
        Der Zielbalken z&auml;hlt ausschlie&szlig;lich Referenzen mit Priorit&auml;t
        ${refEsc(z.prioritaet || 'high')} (Prio A: Rapid Set, NEODUR Level, NEODUR HE 65, NEODUR HE 60 rapid).
        Die Kachel &bdquo;Ver&ouml;ffentlicht&ldquo; weiter unten z&auml;hlt den gesamten Bestand
        einschlie&szlig;lich Altbestand und ist deshalb deutlich h&ouml;her.
      </div>
    </div>
  `;
}

function refZielTicks(ziel) {
  const schritt = ziel % 4 === 0 ? ziel / 4 : Math.max(1, Math.round(ziel / 4));
  const out = [];
  for (let v = 0; v <= ziel; v += schritt) out.push(`<span>${v}</span>`);
  if (out.length && !out[out.length - 1].includes(`>${ziel}<`)) out.push(`<span>${ziel}</span>`);
  return out.join('');
}

// Verbleibende Monate und das rechnerisch noetige Tempo. Der Snapshot liefert
// das Datum, nicht die Uhr des Betrachters: sonst wandert die Aussage, sobald
// jemand einen alten Snapshot ansieht.
function refTempo(d, ziel, erarbeitet) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec((d._meta || {}).snapshot_date || '');
  if (!m) return '';
  const monat = parseInt(m[2], 10);
  const monateRest = 12 - monat + 1;
  const offen = Math.max(0, ziel - erarbeitet);
  if (monateRest <= 0) return '';
  if (!offen) return '<br><b>Ziel erreicht.</b>';
  const tempo = Math.ceil((offen / monateRest) * 10) / 10;
  return `<br>Noch ${monateRest} Monate bis Jahresende, n&ouml;tig sind ${String(tempo).replace('.', ',')} je Monat`;
}

// ─── Band 2: Kachelreihe Bestand ─────────────────────
function renderBestandKacheln(d, t) {
  const gesamt = d.gesamt ?? 0;
  const alt = (d.by_ursprung || {})[REF_ALTBESTAND] || 0;
  const anteilAlt = gesamt ? Math.round(refPct(alt, gesamt)) : 0;

  const kacheln = REF_BUCKETS.map(b => `
    <div class="kpi-card fade-in">
      <div class="kpi-card__label">${b.label}</div>
      <div class="kpi-card__value">${t[b.key] || 0}</div>
      <div class="kpi-card__detail">${refDelta(b.key)}${refStatusListe(d, b)}</div>
      ${refSparkline(b.key, b.color)}
    </div>
  `).join('');

  return `
    <div class="band fade-in"><h3>Bestand</h3><span>alle ${gesamt} Referenzen nach Bearbeitungsstatus</span></div>
    <div class="kpi-row">
      ${kacheln}
      <div class="kpi-card fade-in">
        <div class="kpi-card__label">Gesamt</div>
        <div class="kpi-card__value">${gesamt}</div>
        <div class="kpi-card__detail">
          ${refDelta('gesamt')}${alt} davon Altbestand von korodur.de (${anteilAlt}&nbsp;%),
          ${gesamt - alt} eigene Arbeitsmenge
        </div>
        ${refSparkline('gesamt', 'var(--primary)')}
      </div>
    </div>
  `;
}

// Die Rohstatus hinter einer Kachel, aber nur die besetzten. Alle aufzuzaehlen
// waehrend acht davon auf 0 stehen, macht die Kachel unlesbar.
function refStatusListe(d, bucket) {
  const bs = d.by_status || {};
  const teile = bucket.statuses.filter(s => (bs[s] || 0) > 0).map(s => `${refEsc(s)} ${bs[s]}`);
  if (!teile.length) return bucket.statuses.map(refEsc).join(' &middot; ');
  return teile.join(' &middot; ');
}

// ─── Band 6: Abdeckung nach Einsatzbereich ───────────
// Sortiert nach strategischer Prioritaet, nicht nach Anzahl. Genau das ist die
// Aussage: die Reihenfolge der Zeilen ist der Anspruch, die Laenge der Balken
// ist der Ist-Zustand.
//
// "Luecke" und "Ueberhang" kommen aus dem Rangvergleich, nicht aus einem
// gesetzten Schwellenwert: ein Bereich mit hoher Prioritaet und niedrigem
// Abdeckungsrang ist eine Luecke, umgekehrt ein Ueberhang. Damit haengt die
// Aussage an den Daten und nicht an einer Zahl, die irgendwann niemand mehr
// begruenden kann. Referenzen je Use Case waere der bessere Nenner, die
// Use-Case-Liste ist aber noch nicht final (korodur-referenzverzeichnis#41).
function renderEinsatzbereiche(d) {
  const eb = d.einsatzbereiche || {};
  const items = eb.items || [];
  if (!items.length) return '';

  const byName = new Map(items.map(i => [i.name, i.nennungen || 0]));
  const kern = REF_EINSATZBEREICHE.map(e => ({ ...e, nennungen: byName.get(e.name) || 0 }));

  // Abdeckungsrang: 1 = meiste Nennungen.
  const rangOrder = [...kern].sort((a, b) => b.nennungen - a.nennungen);
  rangOrder.forEach((e, i) => { e.rang = i + 1; });

  // Ein Befund braucht eine deutliche Abweichung, nicht eine von einem Rang.
  // Schwelle ist die halbe Tabelle: erst wenn Anspruch und Abdeckung um
  // mindestens drei Plaetze auseinanderliegen, ist das eine Aussage und nicht
  // Rauschen. Sonst haengt der Befund an zwei Nennungen Unterschied.
  const schwelle = Math.ceil(kern.length / 2);
  kern.forEach(e => {
    e.prioRang = kern.filter(o => o.prio < e.prio).length + 1;
    const abstand = e.rang - e.prioRang;
    if (abstand >= schwelle) e.befund = 'luecke';
    else if (-abstand >= schwelle) e.befund = 'ueberhang';
    else e.befund = '';
  });

  const max = Math.max(1, ...kern.map(e => e.nennungen));
  const rows = kern.map(e => `
    <div class="rf-eb">
      <div class="rf-eb__n"><span class="rf-tag${e.prio <= 2 ? ' rf-tag--hoch' : ''}">${e.prio}</span> ${refEsc(e.name)}</div>
      <div class="rf-eb__t"><div class="rf-eb__b" style="width:${refPct(e.nennungen, max)}%;background:${e.prio <= 2 ? 'var(--primary)' : 'var(--secondary)'}"></div></div>
      <div class="rf-eb__v">${e.nennungen}</div>
      <div class="rf-eb__r">${e.rang}.</div>
      <div class="rf-eb__m">${e.befund === 'luecke' ? '<span class="rf-luecke">L&uuml;cke</span>'
        : e.befund === 'ueberhang' ? '<span class="rf-ueberhang">&Uuml;berhang</span>' : ''}</div>
    </div>
  `).join('');

  // Trinkwasser und die offene Zuordnung stehen seit #319 nicht mehr auf der
  // Seite; die Tabelle zeigt nur die sechs beschlossenen Bereiche.

  return `
    <div class="band fade-in">
      <h3>Abdeckung nach Einsatzbereich</h3>
      <span>sechs beschlossene Bereiche, sortiert nach strategischer Priorit&auml;t</span>
    </div>
    <div class="status-section fade-in">
      <div class="rf-eb rf-eb__head">
        <div class="rf-eb__n">Prio &nbsp; Einsatzbereich</div>
        <div>Nennungen</div>
        <div class="rf-eb__v">Anz.</div>
        <div class="rf-eb__r">Rang</div>
        <div class="rf-eb__m">Befund</div>
      </div>
      ${rows}
      <p class="rf-verdict">${refAbdeckungVerdict(kern)}</p>
      <p class="chart-note rf-note-top">
        Mehrfachauswahl ist gewollt: eine Referenz kann mehrere Bereiche tragen.
        Gez&auml;hlt werden ${eb.nennungen_gesamt ?? 0} Nennungen auf
        ${eb.eintraege_mit_nennung ?? 0} von ${eb.eintraege_gesamt ?? 0} Referenzen.
        Referenzen je Use Case w&auml;re der aussagekr&auml;ftigere Nenner, die
        Use-Case-Ebene ist aber noch nicht entschieden
        (<a href="https://github.com/KORODUR-International/korodur-referenzverzeichnis/issues/41" target="_blank">Referenzverzeichnis#41</a>).
      </p>
    </div>

  `;
}

function refAbdeckungVerdict(kern) {
  const sortiert = [...kern].sort((a, b) => a.prio - b.prio || a.name.localeCompare(b.name));
  const haelfte = Math.ceil(sortiert.length / 2);
  const oben = sortiert.slice(0, haelfte);
  const unten = sortiert.slice(haelfte);
  const schnittOben = oben.reduce((s, e) => s + e.nennungen, 0) / (oben.length || 1);
  const schnittUnten = unten.reduce((s, e) => s + e.nennungen, 0) / (unten.length || 1);
  const fmt = v => String(Math.round(v * 10) / 10).replace('.', ',');

  if (schnittOben < schnittUnten) {
    return `<b>Die Abdeckung l&auml;uft der Priorit&auml;t entgegen.</b> Die
      ${oben.length} Bereiche mit der h&ouml;chsten Priorit&auml;t kommen im Schnitt auf
      ${fmt(schnittOben)} Nennungen, die ${unten.length} mit der niedrigsten auf
      ${fmt(schnittUnten)}. Wir belegen am besten, was uns strategisch am wenigsten wert ist.`;
  }
  return `Die ${oben.length} Bereiche mit der h&ouml;chsten Priorit&auml;t kommen im Schnitt auf
    ${fmt(schnittOben)} Nennungen, die ${unten.length} mit der niedrigsten auf ${fmt(schnittUnten)}.`;
}

// ─── Band 7: Zulauf je Monat ─────────────────────────
// Der Netto-Durchsatz (rr#321) stand bis zum 09.11.2026 daneben und ist mit
// rr#381 entfallen (Beschluss Steffi, 09.11.2026). Snapshots und Zeitreihe
// laufen weiter; Definition und Rückweg-Commit stehen in
// docs/kennzahlen-referenzen.md Abschnitt 3.

// Eine Monatssaeule. Nicht gemessen ist nicht null: ohne Wert kein Balken,
// sondern "n. v." (Entscheidung 03.08.2026).
function refMonatsSaeule(k, wert, { farbe, max }) {
  const [y, m] = k.split('-');
  const gemessen = Number.isFinite(wert);
  const text = gemessen ? wert : refFehlt(null);
  const balken = gemessen
    ? `<div class="month-chart__bar" style="height:${Math.max(refPct(wert, max), 2)}%;background:${farbe}"></div>`
    : '';
  return `
    <div class="month-chart__col" title="${refEsc(k)}: ${gemessen ? wert : 'nicht gemessen'}">
      <div class="month-chart__bar-wrap">
        <div class="month-chart__value">${text}</div>
        ${balken}
      </div>
      <div class="month-chart__label">${REF_MONTHS_KURZ[parseInt(m, 10) - 1]}<br><small>${y}</small></div>
    </div>`;
}

function renderZulauf(d) {
  const zl = d.zulauf || {};
  const je = zl.je_monat || {};
  const keys = Object.keys(je).sort();
  if (!keys.length) return '';

  const maxZ = Math.max(1, ...keys.map(k => je[k] || 0));
  const zulauf = keys.map(k => refMonatsSaeule(k, je[k], { farbe: 'var(--secondary)', max: maxZ })).join('');

  return `
    <div class="band fade-in"><h3>Zulauf je Monat</h3><span>Website-Import herausgerechnet</span></div>
    <div class="status-section fade-in">
      <p class="chart-note">
        <b>Zulauf:</b> neue Referenzen im Verzeichnis, Basis ${refEsc(zl.basis || '')}.
        ${zl.ausgeschlossen ? `${zl.ausgeschlossen} Eintr&auml;ge mit Ursprung ${refEsc(zl.ohne_ursprung || 'Website')} sind
        herausgerechnet, sie kamen alle in einem einzigen Import und w&uuml;rden jede Monatskurve platt walzen.` : ''}
      </p>
      <div class="month-chart">${zulauf}</div>
    </div>
  `;
}

// ─── Sparkline und Delta ─────────────────────────────
function refSparkline(metric, color) {
  if (!refSeries || refSeries.length < 2) return '';
  const vals = refSeries.map(r => r[metric] || 0);
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

// Delta gegen den vorletzten Snapshot. Ohne Vergleichstag gibt es kein Delta,
// und 0 waere hier falsch: 0 hiesse "unveraendert", nicht "kein Vergleich".
function refDelta(metric) {
  if (!refSeries || refSeries.length < 2) return '';
  const jetzt = refSeries[refSeries.length - 1][metric];
  const vorher = refSeries[refSeries.length - 2][metric];
  if (jetzt === undefined || vorher === undefined || jetzt === null || vorher === null) return '';
  const diff = jetzt - vorher;
  if (!diff) return '<span class="delta delta--neutral">&plusmn;0</span> ';
  const cls = diff > 0 ? 'delta--up' : 'delta--down';
  return `<span class="delta ${cls}">${diff > 0 ? '+' : ''}${diff}</span> `;
}

// ─── Empty State ─────────────────────────────────────
function renderEmpty() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="snapshot-header fade-in">
      <h1 class="snapshot-header__title">REFERENZEN: BESTAND UND FORTSCHRITT</h1>
      <p class="snapshot-header__sub">Notion-Referenzverzeichnis (Aggregat)</p>
    </div>
    <div class="loading">
      <div style="text-align:center;line-height:1.7;">
        Noch keine Referenz-Snapshots vorhanden.<br>
        Der erste Datenpunkt entsteht automatisch beim n&auml;chsten t&auml;glichen Lauf
        am fr&uuml;hen Morgen, sofern das Secret <code>NOTION_KEY</code> gesetzt und die
        Integration mit dem Referenzverzeichnis verbunden ist.
      </div>
    </div>
  `;
  const meta = document.getElementById('header-meta');
  if (meta) meta.textContent = 'Wartet auf ersten Snapshot';
}
