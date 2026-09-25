/* #295: isolated follow-up module for integration by #297.
 * Load reporting-nachfassen.css alongside this file, then call
 * window.ReportingNachfassen.mount(host, { snapshot, roadmap, stichtag }).
 * stichtag is an injected YYYY-MM-DD Berlin calendar day for the selected
 * snapshot. No clock, fetch, global element IDs or writes to source objects.
 * Returns { destroy() }; remounting the same host cleans up its previous view.
 * Schema/fixtures: docs/reporting-datenvertrag.md (#294).
 */
(function (global) {
  'use strict';
  const PHASES = ['In Review', 'Bereit', 'In Progress', 'Beansprucht', 'Blocked'];
  const GROUPS = [
    ['beobachtet', 'Sicher beobachtet über 30 Tage'],
    ['luecken', 'Beobachtung nicht vollständig belegt'],
    ['naeherung', 'Mögliche weitere Fälle, Dauer näherungsweise'],
    ['unbekannt', 'Dauer unbekannt'],
  ];
  const INSTANCES = new WeakMap();
  const DAY = 86400000;
  const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const PRIORITY = { P0: 0, P1: 1, P2: 2, P3: 3 };

  function calendar(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
  }
  function age(value, today) {
    const start = calendar(value);
    return start !== null && start <= today ? (today - start) / DAY : null;
  }
  function dateLabel(value) { return value.split('-').reverse().join('.'); }
  function issueIdentity(row) {
    if (typeof row.repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(row.repo)) return null;
    const [owner, repo] = row.repo.split('/');
    if (['.', '..'].includes(repo) || !Number.isSafeInteger(row.nummer) || row.nummer < 1) return null;
    return { key: `${row.repo}#${row.nummer}`, label: `${row.repo}#${row.nummer}`,
      url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${row.nummer}` };
  }
  function milestoneIndex(roadmap) {
    const available = Array.isArray(roadmap?.lanes);
    const index = new Map();
    if (available) for (const lane of roadmap.lanes) {
      if (!Array.isArray(lane?.meilensteine)) continue;
      for (const ms of lane.meilensteine) {
        if (!ms || typeof ms.id !== 'string' || !SLUG.test(ms.id)) continue;
        index.set(ms.id, index.has(ms.id) ? null : ms);
      }
    }
    return { available, index };
  }
  function assignments(row, lookup, today) {
    const result = [];
    const raw = Array.isArray(row.meilensteine) ? row.meilensteine : [];
    let due = Infinity;
    for (const id of new Set(raw)) {
      if (typeof id !== 'string' || !SLUG.test(id)) {
        result.push({ label: 'Ungültige Meilenstein-ID', note: 'Zuordnung prüfen' });
        continue;
      }
      if (id === 'adhoc') { result.push({ label: 'Ad hoc' }); continue; }
      const ms = lookup.index.get(id);
      if (!ms) {
        const note = !lookup.available ? 'Roadmap nicht verfügbar'
          : lookup.index.has(id) ? 'ID nicht eindeutig' : 'ID nicht in Roadmap';
        result.push({ label: id, note });
        continue;
      }
      const entry = { label: typeof ms.titel === 'string' && ms.titel ? ms.titel : id,
        url: `roadmap.html?sel=${encodeURIComponent(id)}` };
      const day = calendar(ms.datum);
      if (ms.status === 'erreicht') entry.note = 'Erreicht · Zuordnung prüfen';
      else if (ms.status === 'entfallen') entry.note = 'Entfallen · Zuordnung prüfen';
      else if (['offen', 'verschoben'].includes(ms.status)) {
        if (day !== null) {
          due = Math.min(due, day);
          entry.note = dateLabel(ms.datum) + (day < today ? ' · überfällig' : day === today ? ' · heute fällig' : '');
        } else entry.note = 'Termin folgt';
      } else entry.note = 'Meilensteinstatus unbekannt';
      result.push(entry);
    }
    if (!result.length) result.push({ label: 'Meilenstein fehlt' });
    return { milestones: result, due };
  }

  function duration(row, today, knownFormat) {
    const observed = knownFormat ? age(row.status_beobachtet_seit, today) : null;
    const estimated = age(row.status_seit, today);
    if (observed !== null && row.status_beobachtung_luecke === false) {
      return observed > 30 ? { group: 'beobachtet', days: observed,
        note: `Status beobachtet seit ${dateLabel(row.status_beobachtet_seit)}` } : null;
    }
    if (knownFormat && (observed !== null || row.status_beobachtung_luecke === true)) {
      if (observed !== null && observed > 30) return { group: 'luecken', days: observed,
        note: row.status_beobachtung_luecke === true ? 'Beobachtung mit Lücken' : 'Lücken-Metadaten fehlen',
        qualifier: 'seit Beobachtungsbeginn' };
      if (estimated !== null && estimated > 30) return { group: 'luecken', days: estimated,
        note: 'Dauer näherungsweise; Beobachtung mit Lücken', qualifier: 'näherungsweise' };
      if (observed !== null || estimated !== null) return null;
    }
    if (estimated !== null) return estimated > 30 ? { group: 'naeherung', days: estimated,
      qualifier: 'näherungsweise', note: 'Legacy-Näherung; kein belegter Statusbeginn' } : null;
    return { group: 'unbekannt', days: null, note: 'Keine auswertbare Dauer vorhanden' };
  }

  function compile(snapshot, roadmap, today) {
    const phases = Object.fromEntries(PHASES.map(status => [status,
      Object.fromEntries(GROUPS.map(([key]) => [key, []]))]));
    const available = Array.isArray(snapshot?.items);
    const knownFormat = snapshot?._meta?.version === '3.4';
    const lookup = milestoneIndex(roadmap);
    const seen = new Map(), candidates = [], conflicts = new Map();
    let invalid = 0;
    for (const row of available ? snapshot.items : []) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) { invalid++; continue; }
      if (!PHASES.includes(row.status) || row.discarded === true || row.state === 'CLOSED'
          || row.stateReason === 'NOT_PLANNED' || row.state_reason === 'NOT_PLANNED') continue;
      const identity = issueIdentity(row);
      const relevant = [row.status, row.status_beobachtet_seit, row.status_beobachtung_luecke,
        row.status_seit, row.prioritaet, Array.isArray(row.meilensteine) ? [...new Set(row.meilensteine)].sort() : []];
      const signature = JSON.stringify(relevant);
      if (identity && seen.has(identity.key)) {
        if (seen.get(identity.key) !== signature) conflicts.set(identity.key, identity);
        continue;
      }
      if (identity) seen.set(identity.key, signature);
      candidates.push({ row, identity });
    }
    for (const { row, identity } of candidates) {
      if (identity && conflicts.has(identity.key)) continue;
      const info = identity ? duration(row, today, knownFormat)
        : { group: 'unbekannt', days: null, note: 'Gültige Issue-Kennung fehlt; Dauer nicht sicher zuordenbar' };
      if (!info) continue;
      phases[row.status][info.group].push({ identity, ...info, ...assignments(row, lookup, today),
        priority: PRIORITY[row.prioritaet] ?? 9, number: identity ? row.nummer : 0 });
    }
    for (const phase of Object.values(phases)) for (const list of Object.values(phase)) {
      list.sort((a, b) => a.due - b.due || (b.days ?? -1) - (a.days ?? -1)
        || a.priority - b.priority || (a.identity?.key.split('#')[0] || '').localeCompare(b.identity?.key.split('#')[0] || '')
        || a.number - b.number);
    }
    return { phases, available, knownFormat, conflicts: [...conflicts.values()], invalid,
      partial: snapshot?._meta?.board_vollstaendig === false };
  }

  function mount(host, { snapshot, roadmap, stichtag } = {}) {
    if (!host?.ownerDocument || typeof host.replaceChildren !== 'function') throw new TypeError('mount requires a DOM host element');
    const doc = host.ownerDocument;
    const restoreFocus = host.contains(doc.activeElement);
    INSTANCES.get(host)?.destroy();
    const cleanup = [];
    let destroyed = false;
    function element(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function link(info, className) {
      const node = element('a', className, info.label);
      node.setAttribute('href', info.url);
      if (info.url.startsWith('https://github.com/')) {
        node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer');
      }
      return node;
    }
    function listen(node, type, callback) {
      node.addEventListener(type, callback);
      cleanup.push(() => node.removeEventListener(type, callback));
    }
    const root = element('section', 'reporting-nachfassen');
    root.setAttribute('aria-label', 'Gezielt nachfassen');
    host.replaceChildren(root);
    const handle = { destroy() {
      if (destroyed) return;
      destroyed = true;
      cleanup.forEach(remove => remove());
      root.remove();
      if (INSTANCES.get(host) === handle) INSTANCES.delete(host);
    } };
    INSTANCES.set(host, handle);
    root.append(element('h2', 'rn-title', 'Gezielt nachfassen'));
    const today = calendar(stichtag);
    if (today === null) {
      root.append(element('p', 'rn-notice', 'Der Stichtag fehlt oder ist ungültig. Die Statusdauer ist nicht auswertbar.'));
      return handle;
    }
    const data = compile(snapshot, roadmap, today);
    root.append(element('p', 'rn-intro', `Mehr als 30 Kalendertage im aktuellen Status · Stichtag ${dateLabel(stichtag)}`));
    root.append(element('p', 'rn-note', 'Lange Dauer bedeutet nicht zwingend fehlende Arbeit. Beobachtungen und Näherungen werden getrennt ausgewiesen.'));
    if (Array.isArray(roadmap?.lanes)) {
      const planDate = calendar(roadmap.stand);
      root.append(element('p', 'rn-note', `Roadmap: aktueller Plan · ${planDate === null
        ? 'Stand unbekannt' : `Stand ${dateLabel(roadmap.stand)}`} · kein historischer Planstand des Snapshots.`));
    }
    if (!data.available) root.append(element('p', 'rn-notice', 'Für diesen Snapshot fehlen auswertbare Issue-Daten. Die Anzahl ist unbekannt.'));
    if (data.available && !data.knownFormat) root.append(element('p', 'rn-notice',
      /^3\.[0-3]$/.test(snapshot?._meta?.version || '')
        ? 'Altformat: Die Statusdauer ist nur näherungsweise belegbar.'
        : 'Unbekanntes Snapshot-Format: Beobachtungen sind nicht sicher auswertbar; vorhandene Näherungen bleiben getrennt.'));
    if (data.partial) root.append(element('p', 'rn-notice', 'Unvollständige Datenbasis: Die Listen zeigen nur die vorliegenden Einträge.'));
    if (data.invalid) root.append(element('p', 'rn-notice', `${data.invalid} Datensätze sind nicht auswertbar.`));
    if (data.conflicts.length) {
      const note = element('details', 'rn-uncertain');
      note.append(element('summary', '', `${data.conflicts.length} widersprüchliche Kennung${data.conflicts.length === 1 ? '' : 'en'} · Statuszuordnung prüfen`));
      const list = element('ul', 'rn-conflicts');
      for (const identity of data.conflicts) {
        const entry = element('li'); entry.append(link(identity)); list.append(entry);
      }
      note.append(list); root.append(note);
    }
    const controls = element('div', 'rn-statuses');
    controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Status auswählen; Zahl der sicher beobachteten Fälle');
    const panel = element('div', 'rn-panel');
    const announcer = element('p', 'rn-sr');
    announcer.setAttribute('role', 'status'); announcer.setAttribute('aria-live', 'polite'); announcer.setAttribute('aria-atomic', 'true');
    const buttons = [];

    function listRow(row) {
      const li = element('li', 'rn-row');
      const context = element('div', 'rn-context');
      context.append(row.identity ? link(row.identity, 'rn-issue') : element('span', 'rn-issue', 'Eintrag ohne gültige Issue-Kennung'));
      const milestones = element('ul', 'rn-milestones');
      for (const ms of row.milestones) {
        const entry = element('li', 'rn-milestone');
        entry.append(ms.url ? link(ms) : element('span', '', ms.label));
        if (ms.note) entry.append(element('span', 'rn-ms-note', ms.note));
        milestones.append(entry);
      }
      context.append(milestones);
      const duration = element('div', 'rn-duration');
      duration.append(element('strong', '', row.days === null ? 'Dauer unbekannt' : `${row.days} Kalendertage`));
      if (row.qualifier) duration.append(element('span', '', row.qualifier));
      duration.append(element('span', 'rn-note', row.note));
      li.append(context, duration);
      return li;
    }
    function select(index, focus = false) {
      if (destroyed) return;
      const phase = PHASES[index], groups = data.phases[phase];
      buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
      panel.replaceChildren();
      panel.append(element('h3', 'rn-phase', phase));
      if (data.available) for (const [key, label] of GROUPS) {
        const entries = groups[key];
        if (key !== 'beobachtet' && !entries.length) continue;
        const section = element(key === 'beobachtet' ? 'section' : 'details', key === 'beobachtet' ? 'rn-proven' : 'rn-uncertain');
        section.setAttribute('data-gruppe', key);
        section.append(element(key === 'beobachtet' ? 'h4' : 'summary', 'rn-group-title', `${label} · ${entries.length}`));
        if (!entries.length) section.append(element('p', 'rn-empty', `Keine sicher beobachteten Fälle über 30 Tage in ${phase} in den vorliegenden Daten.`));
        else {
          const list = element('ol', 'rn-list');
          for (const row of entries) list.append(listRow(row));
          section.append(list);
        }
        panel.append(section);
      }
      const unknown = data.available ? '' : 'Anzahl unbekannt. ';
      announcer.textContent = `${phase}. ${unknown}${data.available ? `${groups.beobachtet.length} sicher beobachtete Fälle über 30 Tage; `
        + `${groups.luecken.length} mit unvollständiger Beobachtung, ${groups.naeherung.length} Näherungen, ${groups.unbekannt.length} mit unbekannter Dauer.` : ''}`;
      if (focus) buttons[index].focus();
    }
    PHASES.forEach((phase, index) => {
      const button = element('button', 'rn-status', phase);
      button.setAttribute('type', 'button'); button.setAttribute('data-status', phase);
      button.setAttribute('aria-label', `${phase}: ${data.available
        ? `${data.phases[phase].beobachtet.length} sicher beobachtete Fälle über 30 Tage` : 'Anzahl unbekannt'}`);
      if (data.available) button.append(element('span', 'rn-count', String(data.phases[phase].beobachtet.length)));
      listen(button, 'click', () => select(index));
      listen(button, 'keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % PHASES.length;
        else if (event.key === 'ArrowLeft') next = (index + PHASES.length - 1) % PHASES.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = PHASES.length - 1;
        else return;
        event.preventDefault(); select(next, true);
      });
      buttons.push(button); controls.append(button);
    });
    root.append(controls, panel, announcer);
    select(0, restoreFocus);
    return handle;
  }
  global.ReportingNachfassen = Object.freeze({ mount });
})(window);
