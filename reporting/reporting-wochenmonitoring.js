/* #296: isolated Berlin-week monitoring. No fetch, clock or source mutation.
 * Load the companion CSS, then ReportingWochenmonitoring.mount(host,
 * {snapshot, roadmap, stichtag}); call the returned destroy() before disposal.
 * stichtag is the Berlin date of the selected snapshot, not its UTC filename.
 * Contract: docs/reporting-datenvertrag.md. Integration belongs to #297.
 */
(function (global) {
  'use strict';
  const INSTANCES = new WeakMap();
  const DAY = 86400000;
  const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const AREAS = new Set(['Marketing', 'CRM & Sales Ops', 'Internationalisierung',
    'Wissensaufbau', 'AI & Infrastruktur', 'Strategie', 'Redaktion']);
  const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const number = value => value === null ? '–' : value.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  const dateLabel = value => value.split('-').reverse().join('.');
  const iso = value => new Date(value).toISOString().slice(0, 10);
  function calendar(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && iso(time) === value ? time : null;
  }
  function timestamp(value) {
    return typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  }
  function berlinDate(value) {
    if (!timestamp(value)) return null;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(value));
    const get = key => parts.find(part => part.type === key).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function weekLabel(monday) {
    const thursday = monday + 3 * DAY, year = new Date(thursday).getUTCFullYear();
    const week = Math.ceil(((thursday - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
    return `KW ${week} / ${year}`;
  }
  function identity(row) {
    if (!row || typeof row.repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(row.repo)
        || ['.', '..'].includes(row.repo.split('/')[1]) || !Number.isSafeInteger(row.nummer) || row.nummer < 1) return null;
    return { key: `${row.repo}#${row.nummer}`,
      url: `https://github.com/${row.repo.split('/').map(encodeURIComponent).join('/')}/issues/${row.nummer}` };
  }

  function compile(snapshot, stichtag) {
    const block = snapshot?.abschluss_monitoring, today = calendar(stichtag);
    if (!block || snapshot?._meta?.version !== '3.4' || today === null
        || block.zeitzone !== 'Europe/Berlin' || block.basis !== 'board_bestand'
        || !timestamp(block.stand) || berlinDate(block.stand) !== stichtag || block.bis !== stichtag
        || !Array.isArray(block.issues) || !block.tage || typeof block.tage !== 'object' || Array.isArray(block.tage)) return null;
    const weekday = (new Date(today).getUTCDay() + 6) % 7;
    const monday = today - weekday * DAY, start = monday - 28 * DAY;
    if (block.von !== iso(start)) return null;
    const byDay = new Map(), seen = new Map(), conflicts = new Set();
    let invalid = false;
    for (const row of block.issues) {
      const id = identity(row), day = calendar(row?.datum);
      if (!id || day === null || day < start || day > today || !timestamp(row.closed_at)
          || Date.parse(row.closed_at) > Date.parse(block.stand) || berlinDate(row.closed_at) !== row.datum) { invalid = true; continue; }
      // Only public fields participate; a duplicate mapping never duplicates an issue.
      const signature = JSON.stringify([row.datum, row.closed_at, row.bereich,
        Array.isArray(row.meilensteine) ? [...new Set(row.meilensteine)].sort() : []]);
      if (seen.has(id.key)) {
        if (seen.get(id.key).signature !== signature) conflicts.add(id.key);
      } else seen.set(id.key, { id, row, signature });
    }
    for (const [key, entry] of seen) {
      if (conflicts.has(key)) { invalid = true; continue; }
      if (!byDay.has(entry.row.datum)) byDay.set(entry.row.datum, []);
      byDay.get(entry.row.datum).push(entry);
    }
    for (const rows of byDay.values()) rows.sort((a, b) => a.row.repo.localeCompare(b.row.repo) || a.row.nummer - b.row.nummer);
    const values = new Map();
    let complete = block.vollstaendig === true && !invalid && block.datenluecken?.anzahl === 0;
    for (let time = start; time <= today; time += DAY) {
      const date = iso(time), count = block.tage[date];
      // Refuse a displayed daily count unless its complete drilldown agrees.
      const valid = !invalid && Number.isSafeInteger(count) && count >= 0
        && count === (byDay.get(date)?.length || 0) && (block.vollstaendig === true || count > 0);
      values.set(date, valid ? count : null);
      if (!valid) complete = false;
    }
    const weeks = Array.from({ length: 4 }, (_, i) => {
      const first = start + i * 7 * DAY;
      const counts = Array.from({ length: 7 }, (_, d) => values.get(iso(first + d * DAY)));
      return { label: weekLabel(first), total: complete ? counts.reduce((a, b) => a + b, 0) : null };
    });
    let sum = 0, refSum = 0;
    const days = DAYS.map((label, i) => {
      const date = iso(monday + i * DAY), future = i > weekday;
      const daily = future ? null : values.get(date);
      sum = sum === null || daily === null ? null : sum + daily;
      const reference = complete && !future
        ? [0, 1, 2, 3].reduce((n, w) => n + values.get(iso(start + (w * 7 + i) * DAY)), 0) / 4 : null;
      refSum = refSum === null || reference === null ? null : refSum + reference;
      return { label, date, future, provisional: i === weekday, daily, cumulative: sum,
        reference, referenceCumulative: refSum, issues: byDay.get(date) || [] };
    });
    return { block, days, weeks, complete, week: weekLabel(monday),
      weeklyMean: complete ? weeks.reduce((n, week) => n + week.total, 0) / 4 : null };
  }

  function mount(host, { snapshot, roadmap, stichtag } = {}) {
    if (!host?.ownerDocument || typeof host.replaceChildren !== 'function') throw new TypeError('mount requires a DOM host element');
    const doc = host.ownerDocument, restoreFocus = host.contains(doc.activeElement);
    INSTANCES.get(host)?.destroy();
    const cleanup = [], dynamicCleanup = [];
    let destroyed = false, selected = null, view = 'kumuliert';
    function el(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function listen(node, type, fn, dynamic = false) {
      node.addEventListener(type, fn);
      (dynamic ? dynamicCleanup : cleanup).push(() => node.removeEventListener(type, fn));
    }
    function svgEl(tag, attrs = {}, text) {
      const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function link(label, url) {
      const node = el('a', '', label); node.setAttribute('href', url);
      if (url.startsWith('https://github.com/')) {
        node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer');
      }
      return node;
    }
    const root = el('section', 'reporting-wochenmonitoring');
    root.setAttribute('aria-label', 'Wochenmonitoring');
    host.replaceChildren(root);
    const handle = { destroy() {
      if (destroyed) return;
      destroyed = true;
      [...cleanup, ...dynamicCleanup].forEach(remove => remove()); root.remove();
      if (INSTANCES.get(host) === handle) INSTANCES.delete(host);
    } };
    INSTANCES.set(host, handle);
    root.append(el('h2', 'rw-title', 'Wochenmonitoring'));
    const data = compile(snapshot, stichtag);
    if (!data) {
      root.append(el('p', 'rw-notice', 'Wochenvergleich für diesen Stand nicht verfügbar. Die Berlin-Daten fehlen oder sind nicht kompatibel.'));
      if (restoreFocus) { root.setAttribute('tabindex', '-1'); root.focus(); }
      return handle;
    }
    const time = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new Date(data.block.stand));
    root.append(el('p', 'rw-intro', `${data.week} · Datenstand ${dateLabel(stichtag)}, ${time} Uhr (Europe/Berlin)`));
    root.append(el('p', 'rw-note', 'Abschlussmenge im Board-Bestand, keine Zielerreichung. Referenz: Durchschnitt der vier direkt vorherigen abgeschlossenen Kalenderwochen.'));
    if (!data.complete) root.append(el('p', 'rw-notice', 'Vergleich nicht vollständig verfügbar. Vorliegende Tageswerte zeigen nur die belegte Teilmenge; fehlende Werte bleiben unbekannt.'));
    const controls = el('div', 'rw-controls'); controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Darstellung');
    const buttons = [];
    const chart = el('div', 'rw-chart');
    const legend = el('div', 'rw-legend');
    legend.append(el('span', 'rw-key-current', '● Aktuelle Woche · durchgezogen'), el('span', 'rw-key-reference', '□ Referenz · gestrichelt'));
    const tableHost = el('div', 'rw-values');
    const panel = el('div', 'rw-drilldown'); panel.setAttribute('data-drilldown', 'true');
    const announcer = el('p', 'rw-sr'); announcer.setAttribute('role', 'status'); announcer.setAttribute('aria-live', 'polite');
    const lookup = new Map();
    if (Array.isArray(roadmap?.lanes)) for (const lane of roadmap.lanes) for (const ms of lane?.meilensteine || []) {
      if (typeof ms?.id === 'string' && SLUG.test(ms.id)) lookup.set(ms.id, lookup.has(ms.id) ? null : ms);
    }
    function showDay(day) {
      selected = day.date;
      for (const button of dayButtons) button.setAttribute('aria-pressed', String(button.getAttribute('data-tag') === selected));
      panel.replaceChildren(el('h3', '', `${day.label}, ${dateLabel(day.date)}: ${number(day.daily)} Abschlüsse${day.provisional ? ' · vorläufig' : ''}`));
      panel.append(el('p', 'rw-note', 'Zuordnung zum gewählten Snapshot. Die Liste zeigt diesen einzelnen Tag, auch in der kumulierten Ansicht.'));
      if (Array.isArray(roadmap?.lanes)) panel.append(el('p', 'rw-note', `Roadmap-Titel: aktueller Plan · ${calendar(roadmap.stand) === null ? 'Stand unbekannt' : `Stand ${dateLabel(roadmap.stand)}`} · kein historischer Planstand.`));
      if (!day.issues.length) panel.append(el('p', '', 'Keine Abschlüsse an diesem Tag.'));
      else {
        const list = el('ol', 'rw-issue-list');
        for (const { id, row } of day.issues) {
          const li = el('li', 'rw-issue'); li.append(link(id.key, id.url));
          li.append(el('span', 'rw-area', AREAS.has(row.bereich) ? row.bereich : 'Nicht zugeordnet'));
          const assignments = el('span', 'rw-assignments');
          const ids = Array.isArray(row.meilensteine) ? [...new Set(row.meilensteine)] : [];
          if (!ids.length) assignments.append(el('span', '', 'Meilenstein fehlt'));
          for (const msid of ids) {
            if (typeof msid !== 'string' || !SLUG.test(msid)) { assignments.append(el('span', '', 'Ungültige Meilenstein-ID')); continue; }
            if (msid === 'adhoc') { assignments.append(el('span', '', 'Ad hoc')); continue; }
            const ms = lookup.get(msid);
            if (ms) assignments.append(link(typeof ms.titel === 'string' && ms.titel ? ms.titel : msid, `roadmap.html?sel=${encodeURIComponent(msid)}`));
            else assignments.append(el('span', '', `${msid} · ${lookup.has(msid) ? 'ID nicht eindeutig' : 'nicht in Roadmap verfügbar'}`));
          }
          li.append(assignments); list.append(li);
        }
        panel.append(list);
      }
      announcer.textContent = `${number(day.daily)} Abschlüsse vom ${dateLabel(day.date)} geöffnet${day.provisional ? ', vorläufig' : ''}.`;
    }
    let dayButtons = [];
    function renderChart() {
      const daily = view === 'tag';
      const current = data.days.map(d => daily ? d.daily : d.cumulative);
      const reference = data.days.map(d => daily ? d.reference : d.referenceCumulative);
      const max = Math.max(1, ...current, ...reference), top = Math.ceil(max / 4) * 4;
      const x = i => 58 + i * 90, y = n => 220 - n / top * 176;
      const svg = svgEl('svg', { viewBox: '0 0 640 260', role: 'img', 'aria-label': `${daily ? 'Tägliche' : 'Kumulierte'} Abschlüsse bis zum Snapshot. Exakte Tageswerte und Abschlusslisten folgen unter dem Diagramm.` });
      svg.append(svgEl('text', { x: 14, y: 18, class: 'rw-axis-title' }, daily ? 'Abschlüsse pro Tag' : 'Abschlüsse kumuliert'));
      for (let i = 0; i <= 4; i++) {
        const n = top * i / 4;
        svg.append(svgEl('line', { x1: 48, x2: 616, y1: y(n), y2: y(n), class: 'rw-grid' }));
        svg.append(svgEl('text', { x: 40, y: y(n) + 4, 'text-anchor': 'end', class: 'rw-axis' }, number(n)));
      }
      data.days.forEach((day, i) => svg.append(svgEl('text', { x: x(i), y: 246, 'text-anchor': 'middle', class: 'rw-axis' }, day.label + (day.provisional ? '*' : ''))));
      for (const [key, values] of [['referenz', reference], ['aktuell', current]]) {
        let segment = [];
        const flush = () => {
          if (segment.length) svg.append(svgEl('polyline', { points: segment.join(' '), class: `rw-line rw-${key}` }));
          segment = [];
        };
        values.forEach((value, i) => {
          if (value === null) { flush(); return; }
          if (daily) svg.append(svgEl('rect', { x: x(i) + (key === 'aktuell' ? -19 : 2), y: y(value), width: 17, height: 220 - y(value),
            class: `rw-bar rw-${key}`, 'data-balken': key }));
          else {
            segment.push(`${x(i)},${y(value)}`);
            svg.append(key === 'aktuell' ? svgEl('circle', { cx: x(i), cy: y(value), r: 4, class: `rw-dot${data.days[i].provisional ? ' rw-provisional' : ''}`, 'data-punkt': key })
              : svgEl('rect', { x: x(i)-3, y: y(value)-3, width: 6, height: 6, class: 'rw-reference-dot', 'data-punkt': key }));
          }
        });
        flush();
      }
      chart.replaceChildren(svg);
    }
    function renderValues() {
      dynamicCleanup.splice(0).forEach(remove => remove()); dayButtons = [];
      const table = el('table', 'rw-table');
      table.append(el('caption', '', `${view === 'tag' ? 'Pro Tag' : 'Kumuliert'} · Tagesbuttons öffnen die jeweiligen Abschlüsse`));
      const head = el('thead'), header = el('tr');
      for (const title of ['Tag', 'Aktuell', 'Referenz Ø', 'Abschlüsse ansehen']) { const th = el('th', '', title); th.setAttribute('scope', 'col'); header.append(th); }
      head.append(header); table.append(head);
      const body = el('tbody');
      for (const day of data.days) {
        const tr = el('tr', day.provisional ? 'rw-today' : ''); tr.setAttribute('data-datum', day.date);
        const th = el('th'); th.setAttribute('scope', 'row');
        th.append(el('span', '', `${day.label} ${day.date.slice(8)}.${day.date.slice(5,7)}.`),
          el('small', 'rw-day-state', day.future ? 'Zukunft' : day.provisional ? 'vorläufig*' : 'abgeschlossen'));
        tr.append(th);
        for (const [key, value] of [['aktuell', view === 'tag' ? day.daily : day.cumulative], ['referenz', view === 'tag' ? day.reference : day.referenceCumulative]]) {
          const td = el('td', '', number(value)); td.setAttribute('data-reihe', key); tr.append(td);
        }
        const td = el('td');
        if (!day.future && day.daily !== null) {
          const button = el('button', 'rw-day-button', `${number(day.daily)} ansehen`); button.setAttribute('type', 'button');
          button.setAttribute('data-tag', day.date); button.setAttribute('aria-pressed', String(selected === day.date));
          button.setAttribute('aria-label', `${day.label}, ${dateLabel(day.date)}: ${number(day.daily)} Abschlüsse ansehen${day.provisional ? ', vorläufig' : ''}`);
          listen(button, 'click', () => showDay(day), true); dayButtons.push(button); td.append(button);
        } else td.append(el('span', 'rw-note', day.future ? 'Noch offen' : 'Unbekannt'));
        tr.append(td); body.append(tr);
      }
      table.append(body); tableHost.replaceChildren(table);
    }
    for (const [key, label] of [['kumuliert', 'Kumuliert'], ['tag', 'Pro Tag']]) {
      const button = el('button', 'rw-mode', label); button.setAttribute('type', 'button'); button.setAttribute('data-mode', key);
      listen(button, 'click', () => {
        view = key;
        buttons.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        renderChart(); renderValues();
      });
      listen(button, 'keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? buttons[0] : event.key === 'End' ? buttons[1] : buttons.find(b => b !== button);
        next.focus(); next.click();
      });
      button.setAttribute('aria-pressed', String(key === view)); buttons.push(button); controls.append(button);
    }
    root.append(controls, chart, legend, el('p', 'rw-note', '* Laufender Berliner Kalendertag: vorläufig. Historische Referenztage sind abgeschlossen. Zukunft bleibt leer.'), tableHost, panel, announcer);
    const basis = el('details', 'rw-basis'); basis.append(el('summary', '', 'Vergleichsbasis und Datengrenzen'));
    const list = el('ul');
    for (const week of data.weeks) list.append(el('li', '', `${week.label}: ${number(week.total)} Abschlüsse`));
    basis.append(list, el('p', '', `Gesamtwochenmittel: ${number(data.weeklyMean)} Abschlüsse. Nullwochen zählen im Nenner vier mit.`),
      el('p', 'rw-note', `Datenstand: ${dateLabel(stichtag)}, ${time} Uhr (Europe/Berlin). Scope: Board-Bestand zum Snapshot. Entfernte oder archivierte Issues können fehlen; keine vollständige Ereignishistorie.`));
    root.append(basis);
    renderChart(); renderValues();
    panel.append(el('p', 'rw-note', 'Einen Tageswert auswählen, um die Abschlussliste zu öffnen. Zuordnung zum gewählten Snapshot.'));
    if (restoreFocus) buttons[0].focus();
    return handle;
  }
  global.ReportingWochenmonitoring = Object.freeze({ mount });
})(window);
