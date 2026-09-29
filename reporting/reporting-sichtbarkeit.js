/* ============================================
   KORODUR Work Cockpit, Sichtbarkeit (Issue #317/#319, davor #141/#234)
   Social-Kennzahlen unten an der Redaktion-Seite (seit #319, davor kurz
   unten an der Reporting-Seite): der 4-Wochen-Block
   (LinkedIn aus dem Export, Facebook und Instagram aus dem Meta-Zeitraum,
   Issue #234) und die Wochenansicht mit Zeitverlauf. Die Render-Funktionen
   stammen unverändert aus src/redaktion.js, wo sie seit Issue #274 nicht
   mehr eingebunden waren.
   Quelle: data/social/timeseries.json und data/social/meta-zeitraeume.json,
   geschrieben von scripts/import_social.py (Workflow social_import.yml).
   Unabhängig vom Redaktions-Snapshot: gezeigt wird immer der jüngste
   Import. ReportingSichtbarkeit.mount(host) lädt selbst und liefert
   {destroy()}; fehlen die Daten, bleibt der Aufbau-Zustand stehen.
   ============================================ */
(function (global) {
  'use strict';

  const SOC_DIR = 'data/social/';
  const SOC_COLORS = { li: '#1e5a96', fb: '#009ee3', ig: '#7a56a3' };
  const SOC_LABELS = { li: 'LinkedIn', fb: 'Facebook', ig: 'Instagram' };
  const SOC_PLATTFORM = { li: 'linkedin', fb: 'facebook', ig: 'instagram' };

  let socSeries = [];     // data/social/timeseries.json, aufsteigend nach Woche
  let socZeitraeume = []; // data/social/meta-zeitraeume.json, aufsteigend nach bis (Issue #234)

  // ─── Helfer aus redaktion.js ─────────────────────────
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

  function fmtNum(v) {
    return (v === null || v === undefined || Number.isNaN(v)) ? 'n.&nbsp;v.' : v.toLocaleString('de-DE');
  }

  function fmtPct1(fraction) {
    return (fraction === null || fraction === undefined || Number.isNaN(fraction))
      ? 'n.&nbsp;v.'
      : (fraction * 100).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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

  // ─── Laden und Einbinden (Issue #317) ────────────────
  function setDaten({ series = [], zeitraeume = [] } = {}) {
    socSeries = Array.isArray(series)
      ? series.filter(r => r && typeof r.week === 'string').slice().sort((a, b) => a.week.localeCompare(b.week)) : [];
    socZeitraeume = Array.isArray(zeitraeume)
      ? zeitraeume.filter(z => z && typeof z.bis === 'string').slice().sort((a, b) => a.bis.localeCompare(b.bis)) : [];
  }

  async function laden(fetchFn) {
    const holen = async name => {
      try {
        const res = await fetchFn(SOC_DIR + name, { cache: 'no-cache' });
        return res.ok ? await res.json() : [];
      } catch { return []; }
    }
    const [series, zeitraeume] = await Promise.all([holen('timeseries.json'), holen('meta-zeitraeume.json')]);
    return { series, zeitraeume };
  }

  function renderHtml() {
    return renderZeitraum() + renderSichtbarkeit();
  }

  function mount(host, { fetchFn = global.fetch } = {}) {
    if (!host?.ownerDocument) throw new TypeError('mount requires a DOM host element');
    let aktiv = true;
    host.innerHTML = '<p class="trend-empty">Sichtbarkeit wird geladen&hellip;</p>';
    const fertig = laden(fetchFn).then(daten => {
      if (!aktiv) return;
      setDaten(daten);
      host.innerHTML = renderHtml();
    });
    return { destroy() { aktiv = false; host.innerHTML = ''; }, fertig };
  }

  global.ReportingSichtbarkeit = Object.freeze({
    mount, laden, setDaten, renderHtml,
    renderZeitraum, renderSichtbarkeit, renderSichtbarkeitChart,
    socVergleich, socDeltaLine, istManuell, kwLabel, isoWeekRangeLabel,
  });
})(window);
