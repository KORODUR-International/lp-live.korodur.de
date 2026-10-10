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
// Dreizehn Stufen seit 22.09.2026 (rv#177); davor zwölf (rr#211). Die zehn
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
// wuerde eine Messung behaupten, die es nicht gibt (Durchsatz vor der
// Zaehlbasis alle_prioritaeten).
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
  // Zwei Kacheln statt drei (#319): die internen Freigaben laufen gegen das
  // größte DE-Ziel, die kleineren Termine stehen als Etappenmarke im Balken.
  const intern = termine.filter(m => m.messgroesse !== 'en_fr_live')
    .sort((a, b) => a.zielwert - b.zielwert || a.datum.localeCompare(b.datum));
  const live = termine.filter(m => m.messgroesse === 'en_fr_live');
  const datum = iso => iso.split('-').reverse().join('.');
  const karte = (label, measure, ziel, etappen) => {
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
    </div>`;
  };
  const cards = [
    intern.length ? karte('DE intern freigegeben', z?.de_intern, intern[intern.length - 1], intern.slice(0, -1)) : '',
    ...live.map(m => karte('Übersetzt und live, EN und FR', z?.en_fr_live, m, [])),
  ].join('');
  return `<div class="band fade-in"><h3>Referenzziele 2026</h3><span>Alle Prioritäten, einschließlich leerer Priorität</span></div>
    <div class="rf-goals rf-goals--${Math.max(1, (intern.length ? 1 : 0) + live.length)} fade-in">${cards}</div>
    ${!z ? '<p class="rf-nv">Die neue Zählbasis ist in diesem Snapshot noch nicht erhoben. Historische Werte werden nicht umgerechnet.</p>' : ''}
    ${!z && d.ziel ? `<details><summary>Historische Zählung: nur Prio A, Stand ${refEsc(d._meta?.snapshot_date || '')}</summary>${renderHistorischesZiel(d)}</details>` : ''}`;
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

// ─── Band 7: Zulauf gegen Netto-Durchsatz je Monat ───
// Durchsatz brutto braeuchte Datumsfelder je Stufe, die es bewusst nicht gibt
// (rv#35). Gemessen wird deshalb netto aus der Tageszeitreihe: Stand der
// intern freigegebenen DE-Master am Monatsende minus Stand am Vormonatsende
// (#321). Nur Snapshots auf der Zaehlbasis alle_prioritaeten zaehlen; die
// alte Prio-A-Zaehlung wird nicht angeschlossen. Fehlt das Vormonatsende,
// ist der Monat ein Teilmonat ab dem ersten Snapshot und traegt dieses Datum.
function refNettoDurchsatz(series) {
  const monate = new Map();
  for (const r of series || []) {
    if (r.ziel_basis !== 'alle_prioritaeten' || !Number.isFinite(r.ziel_de_intern)) continue;
    const k = r.date.slice(0, 7);
    const m = monate.get(k);
    if (m) m.letzter = r; else monate.set(k, { erster: r, letzter: r });
  }
  const vormonat = k => {
    const [y, m] = k.split('-').map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  };
  const out = {};
  for (const [k, m] of monate) {
    const vor = monate.get(vormonat(k));
    const start = vor ? vor.letzter : m.erster;
    out[k] = {
      wert: m.letzter.ziel_de_intern - start.ziel_de_intern,
      ab: vor ? null : m.erster.date,
      bis: m.letzter.date,
    };
  }
  return out;
}

// Eine Monatssaeule. Nicht gemessen ist nicht null: ohne Wert kein Balken,
// sondern "n. v." (Entscheidung 03.08.2026).
function refMonatsSaeule(k, wert, { farbe, max, vorzeichen = false, zusatz = '' }) {
  const [y, m] = k.split('-');
  const gemessen = Number.isFinite(wert);
  const text = !gemessen ? refFehlt(null) : (vorzeichen && wert > 0 ? `+${wert}` : wert);
  const balken = gemessen
    ? `<div class="month-chart__bar" style="height:${Math.max(refPct(Math.abs(wert), max), 2)}%;background:${wert < 0 ? 'var(--danger)' : farbe}"></div>`
    : '';
  return `
    <div class="month-chart__col" title="${refEsc(k)}: ${gemessen ? wert : 'nicht gemessen'}">
      <div class="month-chart__bar-wrap">
        <div class="month-chart__value">${text}</div>
        ${balken}
      </div>
      <div class="month-chart__label">${REF_MONTHS_KURZ[parseInt(m, 10) - 1]}<br><small>${zusatz || y}</small></div>
    </div>`;
}

function renderZulauf(d) {
  const zl = d.zulauf || {};
  const je = zl.je_monat || {};
  const netto = refNettoDurchsatz(refSeries);
  const keys = [...new Set([...Object.keys(je), ...Object.keys(netto)])].sort();
  if (!keys.length) return '';

  const kurz = iso => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[2]}.${m[1]}.` : ''; };
  const maxZ = Math.max(1, ...keys.map(k => je[k] || 0));
  const zulauf = keys.map(k => refMonatsSaeule(k, je[k], { farbe: 'var(--secondary)', max: maxZ })).join('');
  const maxN = Math.max(1, ...Object.values(netto).map(n => Math.abs(n.wert)));
  const durchsatz = keys.map(k => refMonatsSaeule(k, netto[k]?.wert, {
    farbe: 'var(--success)', max: maxN, vorzeichen: true,
    zusatz: netto[k]?.ab ? `ab ${kurz(netto[k].ab)}` : '',
  })).join('');
  const letzter = Object.values(netto).map(n => n.bis).sort().pop();

  return `
    <div class="band fade-in"><h3>Zulauf gegen Durchsatz</h3><span>je Monat, Website-Import herausgerechnet</span></div>
    <div class="status-section fade-in">
      <p class="chart-note">
        <b>Zulauf:</b> neue Referenzen im Verzeichnis, Basis ${refEsc(zl.basis || '')}.
        ${zl.ausgeschlossen ? `${zl.ausgeschlossen} Eintr&auml;ge mit Ursprung ${refEsc(zl.ohne_ursprung || 'Website')} sind
        herausgerechnet, sie kamen alle in einem einzigen Import und w&uuml;rden jede Monatskurve platt walzen.` : ''}
      </p>
      <div class="month-chart">${zulauf}</div>
      <p class="chart-note rf-note-top">
        <b>Netto-Durchsatz:</b> Ver&auml;nderung der intern freigegebenen DE-Master vom Vormonatsende
        zum Monatsende, aus den t&auml;glichen Snapshots. Netto hei&szlig;t: eine R&uuml;ckstufung z&auml;hlt
        dagegen. Gemessen seit Einf&uuml;hrung der Z&auml;hlbasis &uuml;ber alle Priorit&auml;ten am 23.09.2026;
        davor steht ${refFehlt(null)}, nicht 0.${letzter ? ` Letzter Snapshot: ${kurz(letzter)}` : ''}
      </p>
      <div class="month-chart">${durchsatz}</div>
      ${Object.keys(netto).length ? '' : `<p class="rf-nv"><b>Netto-Durchsatz: ${refFehlt(null)}</b>
        Die Zeitreihe enth&auml;lt noch keinen Snapshot auf der Z&auml;hlbasis &uuml;ber alle Priorit&auml;ten.</p>`}
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
