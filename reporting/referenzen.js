/* ============================================
   KORODUR Work Cockpit, Referenzen
   Rendert data/snapshots/referenzen/<datum>.json (Tages-Aggregat des Notion-
   Referenzverzeichnisses) + referenzen-timeseries.json. Read-only, nur
   Aggregatzahlen: keine Objekttitel, keine Betreiber, Verarbeiter, GU,
   Architekten, keine Orte (die Seite ist ohne Login erreichbar).
   In dev: symlink src/data -> ../data; in production: data/ liegt im Root.

   Zwei Zahlen, die gleich heissen und verschiedenes messen:
   ziel.veroeffentlicht zaehlt nur Prioritaet high, totals.veroeffentlicht den
   gesamten Bestand. Deshalb traegt der Zielbalken den Zusatz "Prio A" im
   Label und nicht nur in der Legende (Auflage aus der Pruefung 03.08.2026).
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
const REF_BUCKETS = [
  { key: 'offen', label: 'Offen', color: 'var(--muted)',
    statuses: ['offen', 'Zu Bearbeiten'] },
  { key: 'in_arbeit', label: 'In Arbeit', color: 'var(--secondary)',
    statuses: ['In Bearbeitung - inhaltlich', 'Inhaltlich bearbeitet', 'In Bearbeitung - Design'] },
  { key: 'in_abnahme', label: 'In Abnahme', color: '#6b5b95',
    statuses: ['Onepager erstellt', 'Abnahme/Review fachlich'] },
  { key: 'freigegeben', label: 'Freigegeben', color: '#7dd0a5',
    statuses: ['DE-Freigabe', 'Übersetzung'] },
  { key: 'veroeffentlicht', label: 'Veröffentlicht', color: 'var(--success)',
    statuses: ['Veröffentlicht'] },
];
// Der aktive Prozess laesst Veroeffentlicht bewusst weg: mit 130 Altbestaenden
// im Balken erschlaegt er jede andere Stufe und die Grafik sagt nichts mehr
// ueber die laufende Arbeit (Zielbild v4, abgenommen 30.07.2026).
const REF_PROZESS = REF_BUCKETS.filter(b => b.key !== 'veroeffentlicht');
const REF_OHNE_STATUS = { key: 'ohne_status', label: 'Ohne Status', color: 'var(--danger)' };

// Strategische Prioritaet der Einsatzbereiche (Steffi, 30.07.2026). Nicht zu
// verwechseln mit der Anzeigereihenfolge der Website (KORODUR-Website#496).
// Schwerindustrie und Industrie & Produktion stehen beide auf Prio 1, deshalb
// steht in der Spalte zweimal die 1 und danach die 3.
// Die Namen muessen wortgleich zu den Notion-Optionen sein. Am 06.08.2026 war
// das einen halben Tag lang nicht der Fall: der vierte Bereich hiess bis dahin
// "Außenflächen / ..." und fiel dadurch mit 46 Nennungen in die offene
// Zuordnung, waehrend die Tabelle ihn mit 0 auswies. Seither wacht das
// Begriffs-Gate darueber (.verbotene-begriffe).
const REF_EINSATZBEREICHE = [
  { name: 'Schwerindustrie', prio: 1 },
  { name: 'Industrie & Produktion', prio: 1 },
  { name: 'Lager & Logistik', prio: 3 },
  { name: 'Luftverkehr & öffentlicher Verkehr', prio: 4 },
  { name: 'Parkdeck & Tiefgarage', prio: 5 },
  { name: 'Verkauf & Ausstellung', prio: 6 },
];
// Eigene Produktreihe (MICROTOP), eigene Zielgruppe, kein Industrieboden.
// Steht deshalb ausserhalb der Tabelle und bekommt einen eigenen Hinweis.
const REF_EIGENER_BEREICH = 'Trinkwasser';

// Ursprung des Website-Harvests. Spiegelt URSPRUNG_IMPORT in
// scripts/fetch_referenzen.py und trennt in v1 den geerbten Altbestand von der
// eigenen Arbeitsmenge, solange "Veroeffentlicht am" fehlt.
const REF_ALTBESTAND = 'Website';

const REF_FREIGABE_ORDER = [
  { name: 'Öffentlich', color: 'var(--success)' },
  { name: 'Öffentlich (anonymisiert)', color: '#7dd0a5' },
  { name: 'Intern', color: 'var(--muted)' },
  { name: 'Freigabe offen', color: 'var(--warn)' },
  { name: '(ohne)', color: 'var(--mid-gray)' },
];

// Kennzahlen im Zeitverlauf. datenschuld_eintraege ist bewusst dabei: sinkt sie
// nicht, arbeiten wir an der Datenpflege vorbei.
const REF_TREND = [
  { key: 'gesamt', label: 'Gesamt', color: 'var(--primary)' },
  { key: 'veroeffentlicht', label: 'Veröffentlicht', color: 'var(--success)' },
  { key: 'offen', label: 'Offen', color: 'var(--muted)' },
  { key: 'in_arbeit', label: 'In Arbeit', color: 'var(--secondary)' },
  { key: 'ohne_status', label: 'Ohne Status', color: 'var(--danger)' },
  { key: 'datenschuld_eintraege', label: 'Datenschuld', color: 'var(--warn)' },
];

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
// wuerde eine Messung behaupten, die es nicht gibt (Durchsatz, v1).
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
    ${renderProzess(d, t)}
    ${renderGesamtbestand(d, t)}
    <div class="split-row">
      ${renderDatenschuld(d)}
      ${renderFreigabe(d)}
    </div>
    ${renderEinsatzbereiche(d)}
    ${renderZulauf(d)}
    ${renderRefTrend()}

    <div class="footer">
      Referenz-Segment &middot; Quelle: Notion-Referenzverzeichnis (nur Aggregatzahlen)
      &middot; Kennzahlen-Definitionen:
      <a href="https://github.com/KORODUR-International/korodur-operating-model/blob/main/docs/kennzahlen-referenzen.md" target="_blank">docs/kennzahlen-referenzen.md</a>
      &middot; Generiert am ${new Date(d._meta.generated_at).toLocaleDateString('de-DE')}
      &middot; <a href="https://github.com/KORODUR-International/korodur-operating-model" target="_blank">GitHub</a>
    </div>
  `;
}

// ─── Band 1: Jahresziel ──────────────────────────────
// Ein Balken gegen die 20, zweifarbig. ab_de_freigabe ist kumulativ und
// enthaelt die veroeffentlichten mit, deshalb ist der helle Abschnitt die
// Differenz und nicht der Rohwert (sonst stuende der Fortschritt doppelt drin).
function renderZiel(d) {
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
    <div class="band fade-in"><h3>Jahresziel 2026</h3><span>${ziel} Prio-A-Referenzen</span></div>
    <div class="rf-goal fade-in">
      <div class="rf-goal__top">
        <div>
          <div class="rf-goal__label">Fortschritt gegen das Jahresziel, nur Priorit&auml;t ${refEsc(z.prioritaet || 'high')}</div>
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
        <span><i style="background:#7dd0a5"></i>ab DE-Freigabe erarbeitet: ${erarbeitet} von ${ziel}</span>
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

// ─── Band 3: der aktive Prozess ──────────────────────
function renderProzess(d, t) {
  const zeilen = REF_PROZESS.concat([REF_OHNE_STATUS]);
  const max = Math.max(1, ...zeilen.map(b => t[b.key] || 0));
  const aktiv = REF_PROZESS.reduce((s, b) => s + (t[b.key] || 0), 0) + (t.ohne_status || 0);

  const rows = zeilen.map(b => {
    const c = t[b.key] || 0;
    const pct = refPct(c, max);
    const sub = b.key === 'ohne_status'
      ? 'Kein Bearbeitungsstatus gesetzt, z&auml;hlt als Triage-Schuld'
      : refStatusListe(d, b);
    return `
      <div class="rf-chain">
        <div class="rf-chain__n"${b.key === 'ohne_status' ? ' style="color:var(--danger)"' : ''}>${b.label}</div>
        <div class="rf-chain__t"><div class="rf-chain__b" style="width:${pct}%;background:${b.color}"></div></div>
        <div class="rf-chain__v">${c}</div>
      </div>
      <div class="rf-chain__sub">${sub}</div>
    `;
  }).join('');

  return `
    <div class="band fade-in"><h3>Woran es h&auml;ngt</h3><span>der aktive Prozess, ohne Ver&ouml;ffentlichtes</span></div>
    <div class="status-section fade-in">
      ${rows}
      <p class="rf-verdict">
        <b>Ver&ouml;ffentlichtes ist hier bewusst raus.</b> Mit ${t.veroeffentlicht || 0} im Balken
        erschl&auml;gt der Altbestand jede andere Stufe und die Grafik sagt nichts mehr &uuml;ber
        die laufende Arbeit. Was hier steht, ist die Arbeitsmenge: ${aktiv} Referenzen.
        ${refStauSatz(t)}
      </p>
    </div>
  `;
}

// Der Satz beschreibt, was die Balken zeigen, und wird aus den Zahlen
// abgeleitet statt festgeschrieben. Sonst steht in vier Wochen eine Aussage
// auf der Seite, die die Grafik daneben widerlegt.
function refStauSatz(t) {
  const zwischen = (t.in_arbeit || 0) + (t.in_abnahme || 0) + (t.freigegeben || 0);
  if (!zwischen) {
    return 'Zwischen Warteschlange und Freigabe liegt derzeit keine einzige.';
  }
  const besetzt = REF_PROZESS.filter(b => b.key !== 'offen' && (t[b.key] || 0) > 0);
  // Die Aufschluesselung nur dann, wenn sie etwas hinzufuegt. Bei einer
  // einzigen besetzten Stufe wiederholt die Klammer nur die Zahl davor.
  const stufen = besetzt.length > 1
    ? ` (${besetzt.map(b => `${t[b.key]} ${refEsc(b.label)}`).join(', ')})`
    : '';
  return `Davon ${t.offen || 0} in der Warteschlange und ${zwischen} in Bearbeitung${stufen}.`;
}

// ─── Band 4: Gesamtbestand, Altbestand gegen eigene Leistung ──
// Solange "Veroeffentlicht am" fehlt, ist Ursprung = Website die einzige
// Trennlinie zwischen geerbtem Bestand und eigener Arbeit (Entscheidung
// 03.08.2026). Sie steht deshalb hier und nicht in einer Fussnote.
function renderGesamtbestand(d, t) {
  const gesamt = d.gesamt ?? 0;
  if (!gesamt) return '';
  const ursprung = d.by_ursprung || {};
  const alt = ursprung[REF_ALTBESTAND] || 0;
  const eigen = gesamt - alt;

  // Der Balken stapelt nach Ursprung, nicht nach Status. Die Verteilung ueber
  // die Bearbeitungsstufen steht schon in der Kachelreihe und in der Kette;
  // ein dritter Statusbalken direkt ueber einer Ursprungs-Legende hat frueher
  // nur zwei Dimensionen vermischt.
  const stapel = [
    { c: alt, label: `Altbestand (${REF_ALTBESTAND})`, color: 'var(--mid-gray)', dunkel: true },
    { c: eigen, label: 'Eigene Arbeitsmenge', color: 'var(--secondary)' },
  ].filter(s => s.c > 0).map(s => {
    const pct = refPct(s.c, gesamt);
    return `<div style="width:${pct}%;background:${s.color}${s.dunkel ? ';color:var(--primary)' : ''}"
                 title="${refEsc(s.label)}: ${s.c}">${pct > 5 ? s.c : ''}</div>`;
  }).join('');

  const eigenDetail = Object.entries(ursprung)
    .filter(([k]) => k !== REF_ALTBESTAND)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${refEsc(k)} ${v}`).join(' &middot; ');

  return `
    <div class="band fade-in"><h3>Gesamtbestand</h3><span>${gesamt} Referenzen, Altbestand gegen eigene Arbeitsmenge</span></div>
    <div class="status-section fade-in">
      <div class="rf-stack">${stapel}</div>
      <div class="rf-stack__key">
        <div class="rf-stack__item" style="border-color:var(--mid-gray)">
          <b>${alt}</b><span>Altbestand von korodur.de, Ursprung ${refEsc(REF_ALTBESTAND)}.
          Z&auml;hlt in die Gesamtzahl, aber nicht auf das Jahresziel.</span>
        </div>
        <div class="rf-stack__item" style="border-color:var(--secondary)">
          <b>${eigen}</b><span>Eigene Arbeitsmenge, alles au&szlig;erhalb des Website-Imports.
          ${eigenDetail || 'Ursprung nicht erfasst'}.</span>
        </div>
      </div>
      <p class="rf-verdict">
        <b>Warum diese Trennung:</b> Der Altbestand ist geerbt, nicht erarbeitet. Solange die
        Felder &bdquo;Freigegeben am&ldquo; und &bdquo;Ver&ouml;ffentlicht am&ldquo; fehlen, ist der
        Ursprung die einzige Trennlinie zwischen geerbtem Bestand und eigener Leistung.
        ${(t.unbekannt || 0) > 0
          ? `<b class="rf-warn"> ${t.unbekannt} Referenzen tragen einen Status, den das Mapping in
             <code>scripts/fetch_referenzen.py</code> nicht kennt.</b> Sie fehlen in allen Kacheln oben.`
          : ''}
      </p>
    </div>
  `;
}

// ─── Band 5a: Datenschuld ────────────────────────────
function renderDatenschuld(d) {
  const ds = d.datenschuld || {};
  const n = ds.nennungen || {};
  const betroffen = ds.eintraege_betroffen || 0;
  const gesamt = ds.eintraege_gesamt || d.gesamt || 0;

  const zeilen = [
    ['Ohne Bearbeitungsstatus', n.ohne_status, 'nicht im Prozess verortet'],
    ['Freigabe offen', n.freigabe_offen, 'darf noch nicht nach drau&szlig;en'],
    ['Ohne Produkt-Relation', n.ohne_produkt_relation, 'kein Produkt zugeordnet'],
    ['Ohne Einsatzbereich', n.ohne_einsatzbereich, 'taucht in keiner Abdeckung auf'],
  ].filter(([, v]) => v !== undefined);

  const max = Math.max(1, ...zeilen.map(([, v]) => v || 0));

  return `
    <div class="status-section fade-in split-row__col">
      <h3 class="status-section__title">DATENSCHULD</h3>
      <p class="chart-note">
        ${betroffen} von ${gesamt} Referenzen haben mindestens eine offene Stelle.
        Eine Referenz kann mehrere tragen, die Balken z&auml;hlen deshalb Nennungen
        (${ds.nennungen_gesamt ?? 0}), nicht Referenzen.
      </p>
      ${zeilen.map(([label, v, hint]) => `
        <div class="rf-ds">
          <div class="rf-ds__n">${label}</div>
          <div class="rf-ds__t"><div class="rf-ds__b" style="width:${refPct(v || 0, max)}%"></div></div>
          <div class="rf-ds__v">${v || 0}</div>
          <div class="rf-ds__h">${hint}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// ─── Band 5b: Freigabestatus ─────────────────────────
function renderFreigabe(d) {
  const f = d.freigabestatus || {};
  const bekannt = REF_FREIGABE_ORDER.map(o => [o, f[o.name] || 0]);
  // Ein Wert, den die Liste oben nicht kennt, wird nicht verschluckt.
  const unbekannt = Object.entries(f).filter(([k]) => !REF_FREIGABE_ORDER.some(o => o.name === k));
  const summe = bekannt.reduce((s, [, v]) => s + v, 0) + unbekannt.reduce((s, [, v]) => s + v, 0);
  if (!summe) return '';

  const draussen = (f['Öffentlich'] || 0) + (f['Öffentlich (anonymisiert)'] || 0);

  const segs = bekannt.filter(([, v]) => v > 0).map(([o, v]) => {
    const pct = refPct(v, summe);
    return `<div class="funnel__seg" style="flex-grow:${v};background:${o.color}"
                 title="${refEsc(o.name)}: ${v}">${pct > 6 ? v : ''}</div>`;
  }).join('');

  const legend = bekannt.map(([o, v]) =>
    `<span class="status-legend__item"><span class="status-legend__dot" style="background:${o.color}"></span>${refEsc(o.name)}: ${v}</span>`
  ).join('') + unbekannt.map(([k, v]) =>
    `<span class="status-legend__item"><span class="status-legend__dot" style="background:var(--danger)"></span>${refEsc(k)}: ${v}</span>`
  ).join('');

  return `
    <div class="status-section fade-in split-row__col">
      <h3 class="status-section__title">FREIGABESTATUS</h3>
      <p class="chart-note">
        Wie viel vom Bestand &uuml;berhaupt nach drau&szlig;en darf. Rein menschliche
        Entscheidung, unabh&auml;ngig vom Bearbeitungsstatus.
        ${draussen} von ${summe} sind freigegeben.
      </p>
      <div class="funnel">${segs}</div>
      <div class="status-legend">${legend}</div>
    </div>
  `;
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

  // Alles, was nicht zu den sechs beschlossenen Bereichen gehoert. Trinkwasser
  // steht getrennt, der Rest ist offene Zuordnung.
  const rest = items.filter(i => !REF_EINSATZBEREICHE.some(e => e.name === i.name));
  const trinkwasser = rest.find(i => i.name === REF_EIGENER_BEREICH);
  const offen = rest.filter(i => i.name !== REF_EIGENER_BEREICH);
  const ohneBereich = ((d.datenschuld || {}).nennungen || {}).ohne_einsatzbereich || 0;

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

    ${trinkwasser ? `
    <div class="status-section fade-in">
      <h3 class="status-section__title">EIGENER BEREICH: TRINKWASSER, ${trinkwasser.nennungen} REFERENZEN</h3>
      <p class="rf-text">
        Trinkwasserbeh&auml;lter sind MICROTOP: eigene Produktreihe, eigene Zielgruppe
        (Kommunen und Ingenieurb&uuml;ros), eigener Kaufprozess. Kein Industrieboden,
        deshalb kein Einsatzbereich in der Tabelle oben und kein Weg dorthin im
        Industriebodenl&ouml;sungsfinder.
      </p>
      <p class="rf-verdict">Nicht zu verwechseln mit Trinkwasserdichtigkeit als Anforderung
      in einer Produktionshalle. Zwei verschiedene Dinge mit demselben Wortbestandteil.</p>
    </div>` : ''}

    ${(offen.length || ohneBereich) ? `
    <div class="status-section fade-in">
      <h3 class="status-section__title">NOCH OFFEN IN DER ZUORDNUNG</h3>
      <p class="rf-text">
        ${[
          ohneBereich ? `${ohneBereich} ohne Einsatzbereich` : '',
          ...offen.map(i => `${i.nennungen} ${refEsc(i.name)}`),
        ].filter(Boolean).join(' &middot; ')}.
        Diese Bereiche geh&ouml;ren nicht zum beschlossenen Modell und werden je Objekt
        entschieden
        (<a href="https://github.com/KORODUR-International/korodur-referenzverzeichnis/issues/37" target="_blank">Referenzverzeichnis#37</a>).
      </p>
    </div>` : ''}
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
function renderZulauf(d) {
  const zl = d.zulauf || {};
  const je = zl.je_monat || {};
  const keys = Object.keys(je).sort();
  const du = d.durchsatz || {};

  // Durchsatz ist heute nicht messbar. Der Hinweis steht bewusst vor dem
  // Leer-Guard: faellt der Zulauf weg, ist die fehlende Messung die einzige
  // Aussage, die die Sektion noch hat, und darf nicht mit verschwinden.
  const durchsatzHinweis = du.messbar === false
    ? `<p class="rf-nv">
         <b>Durchsatz je Monat: ${refFehlt(null)}</b>
         ${refEsc(du.grund || '')} Sobald die Datumsfelder stehen, kommt die zweite
         Kurve additiv dazu. Bis dahin zeichnen wir keine Nulllinie, sie w&uuml;rde
         eine Leistung von null behaupten, die niemand gemessen hat.
       </p>`
    : '';

  if (!keys.length) {
    if (!durchsatzHinweis) return '';
    return `
      <div class="band fade-in"><h3>Zulauf gegen Durchsatz</h3><span>je Monat</span></div>
      <div class="status-section fade-in">${durchsatzHinweis}</div>
    `;
  }

  const max = Math.max(1, ...keys.map(k => je[k]));
  const cols = keys.map(k => {
    const [y, m] = k.split('-');
    const v = je[k] || 0;
    return `
      <div class="month-chart__col" title="${refEsc(k)}: ${v}">
        <div class="month-chart__bar-wrap">
          <div class="month-chart__value">${v}</div>
          <div class="month-chart__bar" style="height:${Math.max(refPct(v, max), 2)}%"></div>
        </div>
        <div class="month-chart__label">${REF_MONTHS_KURZ[parseInt(m, 10) - 1]}<br><small>${y}</small></div>
      </div>
    `;
  }).join('');

  return `
    <div class="band fade-in"><h3>Zulauf gegen Durchsatz</h3><span>je Monat, Website-Import herausgerechnet</span></div>
    <div class="status-section fade-in">
      <p class="chart-note">
        Neue Referenzen im Verzeichnis, Basis ${refEsc(zl.basis || '')}.
        ${zl.ausgeschlossen ? `${zl.ausgeschlossen} Eintr&auml;ge mit Ursprung ${refEsc(zl.ohne_ursprung || 'Website')} sind
        herausgerechnet, sie kamen alle in einem einzigen Import und w&uuml;rden jede Monatskurve platt walzen.` : ''}
      </p>
      <div class="month-chart">${cols}</div>
      ${durchsatzHinweis}
    </div>
  `;
}

// ─── Band 8: Zeitverlauf ─────────────────────────────
function renderRefTrend() {
  if (!refSeries || refSeries.length < 2) {
    return `
      <div class="band fade-in"><h3>Entwicklung im Zeitverlauf</h3><span>t&auml;glicher Snapshot</span></div>
      <div class="status-section fade-in">
        <p class="trend-empty">
          Die Verlaufskurve baut sich t&auml;glich auf. Ab dem zweiten Snapshot
          erscheinen hier Bestand, Ver&ouml;ffentlichtes, offene Referenzen und
          die Datenschuld.
        </p>
      </div>
    `;
  }

  const W = 820, H = 280, padL = 34, padR = 18, padT = 16, padB = 30;
  const s = refSeries;
  const t0 = new Date(s[0].date).getTime();
  const tN = new Date(s[s.length - 1].date).getTime();
  const span = Math.max(1, tN - t0);
  const maxVal = Math.max(1, ...s.flatMap(r => REF_TREND.map(m => r[m.key] || 0)));
  const yMax = Math.ceil(maxVal * 1.1 / 5) * 5 || 5;
  const sx = d => padL + ((new Date(d).getTime() - t0) / span) * (W - padL - padR);
  const sy = v => padT + (1 - v / yMax) * (H - padT - padB);

  const grid = [0, 0.5, 1].map(f => {
    const v = Math.round(yMax * f);
    const y = sy(v);
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="trend__grid"/>
            <text x="${padL - 6}" y="${y + 3}" class="trend__ytick">${v}</text>`;
  }).join('');

  const lines = REF_TREND.map(m => {
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

  const legend = REF_TREND.map(m =>
    `<span class="trend-legend__item"><span class="trend-legend__dot" style="background:${m.color}"></span>${m.label}</span>`
  ).join('');

  return `
    <div class="band fade-in"><h3>Entwicklung im Zeitverlauf</h3><span>${s.length} Tagessnapshots</span></div>
    <div class="status-section fade-in">
      <svg class="trend-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
           aria-label="Verlauf der Referenz-Kennzahlen">
        ${grid}${lines}${xticks}
      </svg>
      <div class="trend-legend">${legend}</div>
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
        (06:00 UTC), sofern das Secret <code>NOTION_KEY</code> gesetzt und die
        Integration mit dem Referenzverzeichnis verbunden ist.
      </div>
    </div>
  `;
  const meta = document.getElementById('header-meta');
  if (meta) meta.textContent = 'Wartet auf ersten Snapshot';
}
