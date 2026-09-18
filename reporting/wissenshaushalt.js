/* ============================================
   KORODUR Work Cockpit, Architektur: Block Wissenshaushalt (Issue #225)
   Liest data/wissenshaushalt/wissenshaushalt.json, geschrieben vom
   nächtlichen Snapshot (scripts/fetch_wissenshaushalt.py). Die Zahlen dort
   stammen aus check_budget.py, budget.json und korb_stand.py des
   Operating-Model-Repos; diese Datei rechnet nur Balkenlängen und Zustände.

   Keine Zahl steht fest im Code oder im HTML: Budget, Ziel und die Schwelle
   des Korbs kommen aus der Datei. Öffentliche Seite: gerendert werden Pfade,
   Zeichen, Budgets, Ziele, Abschnittszahl und Alter, nie Titel oder Inhalte.
   In dev: symlink src/data -> ../data; in production liegt data/ im Root.
   ============================================ */

const WH_URL = 'data/wissenshaushalt/wissenshaushalt.json';
const WH_TABELLE_ZEILEN = 30;

document.addEventListener('DOMContentLoaded', async () => {
  const ziel = document.getElementById('wh');
  if (!ziel) return;
  try {
    const res = await fetch(WH_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    ziel.innerHTML = whRender(await res.json());
  } catch (e) {
    ziel.innerHTML = '<p class="wh-leer">Noch keine Messung veröffentlicht. Die Zahlen erscheinen nach dem nächsten nächtlichen Snapshot.</p>';
  }
});

function whEsc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function whZahl(n) {
  return Number(n).toLocaleString('de-DE');
}

function whZeit(iso) {
  const d = new Date(iso);
  const datum = d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });
  const zeit = d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
  return datum + ', ' + zeit + ' Uhr';
}

function whDatum(isoTag) {
  const [j, m, t] = isoTag.split('-');
  return t + '.' + m + '.' + j;
}

// Zustand einer Datei gegen budget.json. Grenze wie im Gate: die eigene Zahl
// unter budgets, sonst der Zielwert der Gruppe.
function whZustand(z) {
  if (z.gemessen === false) return { key: 'fehlt', icon: '!', label: 'fehlt im Repo' };
  if (z.zeichen == null) return { key: 'ohne', icon: '', label: 'nicht gemessen' };
  const grenze = z.budget != null ? z.budget : z.ziel;
  if (z.ziel != null && z.zeichen <= z.ziel) return { key: 'ziel', icon: '✓', label: 'im Ziel' };
  if (grenze != null && z.zeichen <= grenze) return { key: 'budget', icon: '▲', label: 'über Ziel, im Budget' };
  if (grenze != null) return { key: 'ueber', icon: '✕', label: 'über Budget' };
  return { key: 'ohne', icon: '', label: 'ohne Wert in budget.json' };
}

function whBadge(zustand) {
  // Ohne Wert in budget.json sagt das der Gruppenkopf einmal, nicht jede Zeile.
  if (zustand.key === 'ohne') return '';
  const icon = zustand.icon ? '<span aria-hidden="true">' + zustand.icon + '</span> ' : '';
  return '<span class="wh-status wh-status--' + zustand.key + '">' + icon + whEsc(zustand.label) + '</span>';
}

function whMeter(z, skala) {
  const pct = v => Math.min(100, (v / skala) * 100).toFixed(2) + '%';
  const zustand = whZustand(z);
  let marken = '';
  if (z.ziel != null) marken += '<span class="wh-mark wh-mark--ziel" style="left:' + pct(z.ziel) + '" title="Ziel ' + whZahl(z.ziel) + '"></span>';
  if (z.budget != null && z.budget !== z.ziel) marken += '<span class="wh-mark wh-mark--budget" style="left:' + pct(z.budget) + '" title="Budget ' + whZahl(z.budget) + '"></span>';
  const fill = z.zeichen != null ? '<span class="wh-fill wh-fill--' + zustand.key + '" style="width:' + pct(z.zeichen) + '"></span>' : '';
  return '<div class="wh-track">' + fill + marken + '</div>';
}

function whZahlen(z, ohneHinweis) {
  const teile = [];
  if (z.budget != null) teile.push('Budget ' + whZahl(z.budget));
  if (z.ziel != null) teile.push('Ziel ' + whZahl(z.ziel));
  const oben = z.zeichen != null ? '<b>' + whZahl(z.zeichen) + '</b> Zeichen' : '<b>keine Messung</b>';
  if (!teile.length && ohneHinweis) teile.push('kein Wert in budget.json');
  return oben + (teile.length ? '<span>' + teile.join(' · ') + '</span>' : '');
}

function whSkala(zeilen) {
  const werte = [];
  zeilen.forEach(z => [z.zeichen, z.budget, z.ziel].forEach(v => { if (v != null) werte.push(v); }));
  return werte.length ? Math.max(...werte) * 1.06 : 1;
}

function whZeilen(zeilen, label, ohneHinweis) {
  const skala = whSkala(zeilen);
  return zeilen.map(z => {
    const zustand = whZustand(z);
    const titel = label(z).titel;
    return '<div class="wh-row" title="' + whEsc(titel) + '">' +
      '<div class="wh-name">' + whEsc(label(z).text) + '</div>' +
      '<div class="wh-meter">' + whMeter(z, skala) + '</div>' +
      '<div class="wh-num">' + whZahlen(z, ohneHinweis) + '</div>' +
      '<div class="wh-state">' + whBadge(zustand) + '</div>' +
      '</div>';
  }).join('');
}

function whRepoZeilen(repos, ohneHinweis) {
  const gemessen = repos.filter(r => r.zustand === 'gemessen')
    .sort((a, b) => b.zeichen - a.zeichen || a.repo.localeCompare(b.repo));
  const rest = repos.filter(r => r.zustand !== 'gemessen')
    .sort((a, b) => a.zustand.localeCompare(b.zustand) || a.repo.localeCompare(b.repo));
  const kurz = r => r.repo.split('/').pop();
  let html = whZeilen(gemessen, r => ({ text: kurz(r), titel: r.repo + '/CLAUDE.md' }), ohneHinweis);
  html += rest.map(r => {
    const text = r.zustand === 'nicht vorhanden' ? 'keine CLAUDE.md im Repo' : 'nicht abrufbar' + (r.grund ? ' (' + r.grund + ')' : '');
    return '<div class="wh-row wh-row--leer" title="' + whEsc(r.repo) + '">' +
      '<div class="wh-name">' + whEsc(kurz(r)) + '</div>' +
      '<div class="wh-meter wh-hinweis">' + whEsc(text) + '</div>' +
      '<div class="wh-num"></div><div class="wh-state"></div></div>';
  }).join('');
  return html;
}

// Sparkline über den Verlauf. Eine Serie, deshalb keine Legende; die Linie
// der Schwelle nur, wenn die Datei eine führt.
function whSpark(punkte, schwelle, einheit) {
  const b = 240, h = 44, rand = 6;
  if (!punkte.length) return '';
  if (punkte.length === 1) {
    return '<p class="wh-spark-hinweis">Verlauf ab dem zweiten Lauf.</p>';
  }
  const werte = punkte.map(p => p.wert);
  if (schwelle != null) werte.push(schwelle);
  let lo = Math.min(...werte), hi = Math.max(...werte);
  if (hi === lo) { hi += 1; lo = Math.max(0, lo - 1); }
  const x = i => rand + (i / (punkte.length - 1)) * (b - 2 * rand);
  const y = v => h - rand - ((v - lo) / (hi - lo)) * (h - 2 * rand);
  const linie = punkte.map((p, i) => x(i).toFixed(1) + ',' + y(p.wert).toFixed(1)).join(' ');
  let svg = '<svg class="wh-spark" viewBox="0 0 ' + b + ' ' + h + '" role="img" aria-label="Verlauf über ' + punkte.length + ' Läufe">';
  if (schwelle != null) {
    svg += '<line class="wh-spark-schwelle" x1="' + rand + '" x2="' + (b - rand) + '" y1="' + y(schwelle).toFixed(1) + '" y2="' + y(schwelle).toFixed(1) + '"></line>';
  }
  svg += '<polyline class="wh-spark-linie" points="' + linie + '"></polyline>';
  punkte.forEach((p, i) => {
    const letzte = i === punkte.length - 1;
    svg += '<g><title>' + whEsc(whZeit(p.zeit) + ': ' + whZahl(p.wert) + ' ' + einheit) + '</title>' +
      '<circle class="wh-spark-hit" cx="' + x(i).toFixed(1) + '" cy="' + y(p.wert).toFixed(1) + '" r="9"></circle>' +
      (letzte ? '<circle class="wh-spark-end" cx="' + x(i).toFixed(1) + '" cy="' + y(p.wert).toFixed(1) + '" r="4"></circle>' : '') +
      '</g>';
  });
  return svg + '</svg>';
}

function whKachel(titel, wert, unter, zustand, spark) {
  return '<div class="wh-tile">' +
    '<div class="wh-tile__head"><span>' + whEsc(titel) + '</span>' + (zustand ? whBadge(zustand) : '') + '</div>' +
    '<div class="wh-tile__value">' + wert + '</div>' +
    '<div class="wh-tile__sub">' + unter + '</div>' +
    spark + '</div>';
}

function whTabelle(verlauf) {
  const zeilen = verlauf.slice(-WH_TABELLE_ZEILEN).reverse().map(e => {
    const refs = Object.entries(e.dateien || {})
      .filter(([d, v]) => d.includes('/references/') && v != null)
      .reduce((s, [, v]) => s + v, 0);
    const global = (e.dateien || {})['claude-config/CLAUDE.md'];
    return '<tr><td>' + whEsc(whZeit(e.gemessen_am)) + '</td>' +
      '<td><code>' + whEsc((e.om_commit || '').slice(0, 7)) + '</code></td>' +
      '<td class="wh-td-num">' + (global != null ? whZahl(global) : '') + '</td>' +
      '<td class="wh-td-num">' + whZahl(refs) + '</td>' +
      '<td class="wh-td-num">' + whZahl(e.korb.abschnitte) + '</td>' +
      '<td class="wh-td-num">' + whZahl(e.korb.zeichen) + '</td>' +
      '<td class="wh-td-num">' + (e.korb.alter_tage != null ? whZahl(e.korb.alter_tage) : '') + '</td></tr>';
  }).join('');
  const mehr = verlauf.length > WH_TABELLE_ZEILEN ? ', die jüngsten ' + whZahl(WH_TABELLE_ZEILEN) + ' von ' + whZahl(verlauf.length) : '';
  return '<details class="wh-details"><summary>Verlauf als Tabelle (' + whZahl(verlauf.length) + ' ' + (verlauf.length === 1 ? 'Lauf' : 'Läufe') + mehr + ')</summary>' +
    '<div class="aw-tablewrap"><table class="aw-table wh-table">' +
    '<tr><th>Gemessen</th><th>Commit</th><th>CLAUDE.md global</th><th>Referenzen gesamt</th><th>Korb Abschnitte</th><th>Korb Zeichen</th><th>Ältester (Tage)</th></tr>' +
    zeilen + '</table></div></details>';
}

function whRender(daten) {
  const s = daten.stand;
  const verlauf = daten.verlauf || [];
  const global = s.anweisungsschicht.find(z => z.datei === 'claude-config/CLAUDE.md');
  const korb = s.korb;

  const kacheln = [];
  if (global) {
    const teile = [];
    if (global.budget != null) teile.push('Budget ' + whZahl(global.budget));
    if (global.ziel != null) teile.push('Ziel ' + whZahl(global.ziel));
    kacheln.push(whKachel('Globale CLAUDE.md', global.zeichen != null ? whZahl(global.zeichen) : 'keine Messung',
      'Zeichen · ' + teile.join(' · '), whZustand(global),
      whSpark(verlauf.filter(e => e.dateien && e.dateien[global.datei] != null)
        .map(e => ({ zeit: e.gemessen_am, wert: e.dateien[global.datei] })), global.ziel, 'Zeichen')));
  }
  const korbZustand = korb.ernte_faellig
    ? { key: 'budget', icon: '▲', label: 'Ernte fällig' }
    : { key: 'ziel', icon: '✓', label: 'unter der Schwelle' };
  kacheln.push(whKachel('Learnings-Korb', whZahl(korb.abschnitte) + ' <small>von ' + whZahl(korb.schwelle) + '</small>',
    'ungeerntete Abschnitte · Ernte fällig ab ' + whZahl(korb.schwelle) + ' · ' + whZahl(korb.zeichen) + ' Zeichen',
    korbZustand,
    whSpark(verlauf.map(e => ({ zeit: e.gemessen_am, wert: e.korb.abschnitte })), korb.schwelle, 'Abschnitte')));
  kacheln.push(whKachel('Ältester Abschnitt',
    korb.alter_tage != null ? whZahl(korb.alter_tage) + ' <small>' + (korb.alter_tage === 1 ? 'Tag' : 'Tage') + '</small>' : 'keiner',
    korb.aeltester ? 'ungeerntet seit ' + whEsc(whDatum(korb.aeltester)) : 'der Korb ist leer',
    null,
    whSpark(verlauf.filter(e => e.korb.alter_tage != null).map(e => ({ zeit: e.gemessen_am, wert: e.korb.alter_tage })), null, 'Tage')));

  const commit = s.om_commit ? ' · Operating Model bei <code>' + whEsc(s.om_commit.slice(0, 7)) + '</code>' : '';
  const anweisung = s.anweisungsschicht.slice().sort((a, b) => a.datei.localeCompare(b.datei));
  const ohneWertRepos = s.repo_claude_md.every(r => r.budget == null && r.ziel == null);

  return '<p class="wh-stand">Gemessen am ' + whEsc(whZeit(s.gemessen_am)) + commit +
    ' · Repos laut Board-Snapshot vom ' + whEsc(whDatum(s.repos_aus_snapshot)) + '</p>' +
    '<div class="wh-tiles">' + kacheln.join('') + '</div>' +
    '<div class="wh-group">' +
    '<div class="wh-group__head"><h3>Anweisungsschicht</h3><p><code>claude-config/</code> im Operating-Model-Repo, gegen Budget und Ziel aus <code>budget.json</code>.</p>' +
    '<p class="wh-legend"><span class="wh-legend__ziel"></span>Ziel <span class="wh-legend__budget"></span>Budget, wo es vom Ziel abweicht</p></div>' +
    whZeilen(anweisung, z => ({ text: z.datei.replace(/^claude-config\//, ''), titel: z.datei }), true) +
    '</div>' +
    '<div class="wh-group">' +
    '<div class="wh-group__head"><h3>Repo-CLAUDE.md</h3><p>Je Repo am Board, Default-Branch.' +
    (ohneWertRepos ? ' <code>budget.json</code> führt für diese Dateien keine Zahl, die Balken stehen deshalb ohne Schwelle.' : '') + '</p></div>' +
    whRepoZeilen(s.repo_claude_md, !ohneWertRepos) +
    '</div>' +
    whTabelle(verlauf);
}
