/* #297: goal and work overview. Public roadmap text, neutral issue identities.
 * Board stichtag and current Berlin heute are injected separately: an archive
 * contains historical work counts beside an explicitly current roadmap plan.
 */
(function (global) {
  'use strict';
  const INSTANCES = new WeakMap(), DAY = 86400000;
  const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const PHASES = [
    ['Bereit', ['Bereit']], ['In Arbeit', ['Beansprucht', 'In Progress']],
    ['In Review', ['In Review']], ['Blockiert', ['Blocked']],
    ['Backlog', ['Backlog']], ['On Hold', ['On Hold']], ['Später', ['Später']], ['Ohne Status', ['none']],
  ];
  const STATUSES = new Set(PHASES.flatMap(p => p[1]));
  const GROUPS = [['aktuell', 'Überfällig und nächste 30 Tage'], ['spaeter', 'Weitere datierte Ziele'],
    ['undatiert', 'Termin folgt'], ['erreicht', 'Als erreicht geführte Ziele'], ['entfallen', 'Entfallene Ziele']];
  function calendar(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value ? time : null;
  }
  const dateLabel = value => value.split('-').reverse().join('.');
  const validSlug = value => typeof value === 'string' && SLUG.test(value);
  function identity(row) {
    if (typeof row.repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(row.repo)
      || ['.', '..'].includes(row.repo.split('/')[1]) || !Number.isSafeInteger(row.nummer) || row.nummer < 1) return null;
    return { key: `${row.repo}#${row.nummer}`, repo: row.repo,
      url: `https://github.com/${row.repo.split('/').map(encodeURIComponent).join('/')}/issues/${row.nummer}` };
  }
  function roadmapModel(roadmap, today) {
    const available = Array.isArray(roadmap?.lanes), lookup = new Map();
    const lanes = available ? roadmap.lanes.filter(l => l && Array.isArray(l.meilensteine)) : [];
    const goals = [];
    for (const lane of lanes) for (const ms of lane.meilensteine) {
      if (!ms || !validSlug(ms.id)) continue;
      lookup.set(ms.id, lookup.has(ms.id) ? null : ms);
      const due = calendar(ms.datum);
      const group = ms.status === 'erreicht' ? 'erreicht' : ms.status === 'entfallen' ? 'entfallen'
        : due === null ? 'undatiert' : today !== null && due <= today + 30 * DAY ? 'aktuell' : 'spaeter';
      goals.push({ ms, lane, due, group });
    }
    return { available, lanes, goals, lookup };
  }
  function workModel(snapshot, lookup) {
    const available = /^3\.[0-4]$/.test(snapshot?._meta?.version || '') && Array.isArray(snapshot?.items);
    const seen = new Map(), conflicts = new Set(), rows = [];
    let invalid = 0;
    for (const [index, raw] of (available ? snapshot.items : []).entries()) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { invalid++; continue; }
      if (raw.status === 'Done' || raw.status === 'Verworfen' || raw.state === 'CLOSED' || raw.discarded === true
          || raw.stateReason === 'NOT_PLANNED' || raw.state_reason === 'NOT_PLANNED') continue;
      const id = identity(raw), ids = Array.isArray(raw.meilensteine) ? [...new Set(raw.meilensteine)] : [];
      const signature = JSON.stringify([raw.status, [...ids].sort(), raw.status_beobachtet_seit, raw.status_beobachtung_luecke]);
      if (id && seen.has(id.key)) { if (seen.get(id.key) !== signature) conflicts.add(id.key); continue; }
      if (id) seen.set(id.key, signature);
      rows.push({ raw, id, key: id?.key || `unidentified:${index}`, status: STATUSES.has(raw.status) ? raw.status : 'none',
        ids: ids.filter(validSlug), invalidIds: ids.some(id => !validSlug(id)), missing: ids.length === 0,
        known: ids.filter(id => validSlug(id) && id !== 'adhoc' && lookup.get(id)),
        unknown: ids.some(id => !validSlug(id) || (id !== 'adhoc' && !lookup.get(id))) });
    }
    return { available, assignmentsAvailable: available && /^3\.[34]$/.test(snapshot._meta.version), rows: rows.filter(row => !row.id || !conflicts.has(row.id.key)).sort((a,b) =>
      (a.id?.repo || '').localeCompare(b.id?.repo || '') || (a.raw.nummer || 0) - (b.raw.nummer || 0)),
      conflicts: conflicts.size, invalid,
      partial: (snapshot?._meta?.version === '3.4' ? snapshot?._meta?.board_vollstaendig !== true : snapshot?._meta?.board_vollstaendig === false) || conflicts.size > 0 || invalid > 0 };
  }
  function signal(ms, today) {
    if (ms.status === 'entfallen') return { kind: 'neutral', label: 'Entfallen' };
    if (ms.status === 'erreicht') return calendar(ms.erreichtAm) !== null && calendar(ms.erreichtAm) <= today
      ? { kind: 'erreicht', label: `✓ Belegt erreicht am ${dateLabel(ms.erreichtAm)}` }
      : { kind: 'neutral', label: 'Als erreicht geführt · gültiges Nachweisdatum fehlt' };
    const due = calendar(ms.datum), reasons = [];
    if (ms.klaerung === true) reasons.push('Klärung erforderlich');
    if (ms.abhaengigkeit) reasons.push('Abhängigkeit');
    if (ms.confidence === 'niedrig') reasons.push('Einschätzung niedrig');
    const overdue = due !== null && today !== null && due < today;
    if (overdue) reasons.unshift('! Überfällig');
    if (!reasons.length) reasons.push(due === today ? 'Heute fällig' : 'Offen');
    if (!['hoch','mittel','niedrig'].includes(ms.confidence)) reasons.push('Einschätzung unbekannt');
    if (!['offen','verschoben'].includes(ms.status)) reasons.push('Zielstatus unbekannt');
    if (ms.status === 'verschoben') reasons.push('verschoben');
    return { kind: overdue ? 'ueberfaellig' : (ms.klaerung === true || ms.abhaengigkeit || ms.confidence === 'niedrig') ? 'klaerung' : 'neutral', label: reasons.join(' · ') };
  }
  function mount(host, { snapshot, roadmap, stichtag, heute = stichtag, archiv = false } = {}) {
    if (!host?.ownerDocument || typeof host.replaceChildren !== 'function') throw new TypeError('mount requires a DOM host element');
    const doc = host.ownerDocument, restoreFocus = host.contains(doc.activeElement);
    INSTANCES.get(host)?.destroy();
    const cleanup = [], detailCleanup = [];
    let destroyed = false, selectedButton = null;
    function el(tag, cls, text) {
      const node = doc.createElement(tag); if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text; return node;
    }
    function listen(node, event, fn, detail = false) {
      node.addEventListener(event, fn); (detail ? detailCleanup : cleanup).push(() => node.removeEventListener(event, fn));
    }
    function link(label, url) {
      const a = el('a', '', label); a.setAttribute('href', url);
      if (url.startsWith('https:')) { a.setAttribute('target','_blank'); a.setAttribute('rel','noopener noreferrer'); }
      return a;
    }
    const root = el('div','reporting-ueberblick'); host.replaceChildren(root);
    const handle = { destroy() {
      if (destroyed) return; destroyed = true; [...cleanup,...detailCleanup].forEach(remove => remove());root.remove();
      if (INSTANCES.get(host) === handle) INSTANCES.delete(host);
    } };
    INSTANCES.set(host,handle);
    const today = calendar(heute), boardDay = calendar(stichtag), plan = roadmapModel(roadmap,today), work = workModel(snapshot,plan.lookup);
    const orientation = el('section','ru-orientation'); orientation.setAttribute('data-orientation','true'); orientation.setAttribute('aria-label','Orientierung');
    const stamp = snapshot?._meta?.generated_at;
    const validStamp = typeof stamp === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) && Number.isFinite(Date.parse(stamp));
    let stampLabel = 'Datenstand unbekannt';
    if (validStamp) stampLabel = 'Datenstand ' + new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(stamp)) + ' Uhr (Berlin)';
    orientation.append(el('p','ru-data-state',stampLabel));
    if (archiv) orientation.append(el('p','ru-state-note','Archivstand ausgewählt · Arbeitszahlen gehören zu diesem Snapshot.'));
    else if (boardDay !== null && today !== null && boardDay < today) orientation.append(el('p','ru-stale','Neuester Stand ist veraltet · der angezeigte Datenstand bleibt maßgeblich.'));
    const openGoals = plan.goals.filter(g => !['erreicht','entfallen'].includes(g.ms.status));
    const dueCount = plan.available && today !== null ? openGoals.filter(g => g.due !== null && g.due < today).length : null;
    const nextCount = plan.available && today !== null ? openGoals.filter(g => g.due !== null && g.due >= today && g.due <= today + 30*DAY).length : null;
    const reviewKnown = work.available && snapshot?._meta?.version === '3.4' && boardDay !== null;
    const reviews = work.rows.filter(row => row.id && row.status === 'In Review' && row.raw.status_beobachtung_luecke === false
      && calendar(row.raw.status_beobachtet_seit) !== null && boardDay-calendar(row.raw.status_beobachtet_seit) > 30*DAY).length;
    const indicators = el('p','ru-indicators');
    indicators.append(el('span','',`Überfällige Ziele: ${dueCount ?? 'unbekannt'}`),el('span','',`Ergebnisse in 30 Tagen: ${nextCount ?? 'unbekannt'}`),
      el('span','',`Reviews >30 Tage: ${reviewKnown ? (work.partial ? `${reviews} belegt` : reviews) : 'unbekannt'}`));
    orientation.append(indicators,el('p','ru-note','Review-Zahl: sicher beobachtete Statusdauer. Ziele folgen der Roadmap; Abschlussmengen sind kein Zielnachweis.'));
    root.append(orientation);
    const announcer = el('p','ru-sr'); announcer.setAttribute('role','status');announcer.setAttribute('aria-live','polite');
    const panel = el('section','ru-drilldown'); panel.setAttribute('aria-label','Zugehörige Arbeit');
    function assignments(row) {
      const node = el('span','ru-assignments');
      if (!work.assignmentsAvailable) { node.append(el('span','','Zuordnung nicht erhoben (Altformat)')); return node; }
      if (row.missing) node.append(el('span','','Meilenstein fehlt'));
      if (row.invalidIds) node.append(el('span','','Ungültige Meilenstein-ID'));
      for (const id of row.ids) {
        if (id === 'adhoc') {node.append(el('span','','Ad hoc'));continue;}
        const ms = plan.lookup.get(id);
        node.append(ms ? link(typeof ms.titel === 'string' ? ms.titel : id,`roadmap.html?sel=${encodeURIComponent(id)}`)
          : el('span','',`${id} · ${plan.lookup.has(id) ? 'ID nicht eindeutig' : 'Roadmap-Zuordnung unbekannt'}`));
      }
      return node;
    }
    function showList(container, button, title, rows, partial) {
      detailCleanup.splice(0).forEach(remove=>remove());
      if (selectedButton) selectedButton.setAttribute('aria-expanded','false'); selectedButton=button;button.setAttribute('aria-expanded','true');
      panel.replaceChildren(el('h3','',title));
      const close = el('button','ru-close','Liste schließen');close.setAttribute('type','button');
      listen(close,'click',()=>{panel.remove();button.setAttribute('aria-expanded','false');button.focus();selectedButton=null;},true);panel.append(close);
      if (!rows.length) panel.append(el('p','', work.available && !partial ? 'Keine zugehörigen Items in dieser Phase.' : 'Keine verlässliche vollständige Zahl verfügbar.'));
      const list = el('ol','ru-issue-list');list.setAttribute('data-issue-list','true');
      for (const row of rows) {
        const li = el('li','ru-issue');li.append(row.id ? link(row.id.key,row.id.url) : el('strong','','Draft / ohne Issue-Kennung'));
        li.append(el('span','ru-original-status',row.status === 'none' ? 'Status unbekannt' : row.status),assignments(row)); list.append(li);
      }
      panel.append(list);container.append(panel);announcer.textContent=(!work.available || partial) && !rows.length ? `${title}: Keine verlässliche vollständige Zahl verfügbar.` : `${title}: ${rows.length} vorliegende Items geöffnet.`;
    }
    function counts(container, rows, scope, allPhases = false, partial = work.partial) {
      container.setAttribute('data-scope',scope);
      const controls=el('div','ru-counts');controls.setAttribute('role','group');controls.setAttribute('aria-label','Arbeit nach Phase');
      const used = allPhases ? PHASES : PHASES.slice(0,4);
      for (const [label,statuses] of used) {
        const subset=rows.filter(row=>statuses.includes(row.status));
        const value=!work.available || (partial && subset.length===0) ? '–' : `${subset.length}${partial ? ' belegt' : ''}`;
        const button=el('button','ru-count',`${label} ${value}`);button.setAttribute('type','button');button.setAttribute('data-phase',label);
        button.setAttribute('aria-expanded','false');button.setAttribute('aria-label',`${label}: ${value} Items anzeigen`);
        listen(button,'click',()=>showList(container,button,label,subset,partial));controls.append(button);
      }
      container.append(controls);
    }
    function joined(ids) {if (!work.assignmentsAvailable) return [];const set=new Set(ids);return work.rows.filter(row=>row.known.some(id=>set.has(id)));}
    const goalsHost=el('section','ru-goals');goalsHost.setAttribute('aria-label','Ziele und Arbeitsstand');
    goalsHost.append(el('h2','','Ziele und Arbeitsstand'));
    const planStamp=calendar(roadmap?.stand) === null ? 'Stand unbekannt' : `Stand ${dateLabel(roadmap.stand)}`;
    goalsHost.append(el('p','ru-note',`Roadmap: aktueller Plan · ${planStamp}. Zieltermine bewertet zum ${today === null ? 'unbekannten Stichtag' : dateLabel(heute)}; kein historischer Planstand des Snapshots.`));
    if (!plan.available) goalsHost.append(el('p','ru-notice','Roadmap nicht verfügbar. Der Arbeitsvorrat bleibt sichtbar; Zielzuordnungen sind nicht auflösbar.'));
    else {
      if (work.available && !work.assignmentsAvailable) goalsHost.append(el('p','ru-notice','Meilensteinzuordnung in diesem Altformat nicht erhoben. Ziel- und Zuordnungszahlen sind unbekannt; globale Arbeitszahlen bleiben nutzbar.'));
      goalsHost.append(el('p','ru-note','Summen je Area und Jahresziel zählen eindeutige Items der jeweils gezeigten Ziele. Backlog, On Hold und Später stehen im Arbeitsvorrat.'));
      if (work.rows.some(r=>r.known.length>1)) goalsHost.append(el('p','ru-note','Zeilen nicht addierbar: Ein Issue kann zu mehreren Meilensteinen beitragen. Gesamtsummen zählen es einmal.'));
      const areas = Array.isArray(roadmap.areas) ? roadmap.areas.filter(a=>a && validSlug(a.id)) : [];
      const groups=[...areas];
      const knownAreas=new Set(areas.map(a=>a.id));
      if (plan.lanes.some(l=>!knownAreas.has(l.area))) groups.push({id:null,name:'Area nicht zugeordnet'});
      for (const [category,label] of GROUPS) {
        const entries=plan.goals.filter(g=>g.group===category);
        const group=el(category==='aktuell'?'div':'details','ru-goal-group');group.setAttribute('data-goals',category);
        group.append(el(category==='aktuell'?'h3':'summary','',`${label} (${entries.length})`));
        if (!entries.length) group.append(el('p','ru-note','Keine Ziele in dieser Gruppe.'));
        for (const area of groups) {
          const areaEntries=entries.filter(g=>area.id===null ? !knownAreas.has(g.lane.area) : g.lane.area===area.id);
          if (!areaEntries.length) continue;
          const areaNode=el('section','ru-area');areaNode.append(el('h3','',typeof area.name==='string'?area.name:area.id));
          counts(areaNode,joined(areaEntries.map(g=>g.ms.id)),`area:${area.id}`,false,work.partial || !work.assignmentsAvailable || areaEntries.some(g=>!plan.lookup.get(g.ms.id)));
          for (const lane of plan.lanes) {
            const laneEntries=areaEntries.filter(g=>g.lane===lane).sort((a,b)=>(a.due??Infinity)-(b.due??Infinity));
            if (!laneEntries.length) continue;
            const laneNode=el('section','ru-lane');laneNode.append(el('h4','',typeof lane.name==='string'?lane.name:'Jahresziel / Projekt'));
            if (lane.erreichtHeisst) laneNode.append(el('p','ru-outcome',String(lane.erreichtHeisst)));
            counts(laneNode,joined(laneEntries.map(g=>g.ms.id)),`lane:${lane.id}`,false,work.partial || !work.assignmentsAvailable || laneEntries.some(g=>!plan.lookup.get(g.ms.id)));
            for (const entry of laneEntries) {
              const {ms,due}=entry, rows=plan.lookup.get(ms.id) ? joined([ms.id]) : [];
              const msNode=el('article','ru-milestone');
              msNode.append(el('h5','',typeof ms.titel==='string'?ms.titel:ms.id));
              const state=signal(ms,today),text=el('p',`ru-signal ru-signal--${state.kind}`,state.label);text.setAttribute('data-signal',state.kind);
              msNode.append(el('p','ru-due',due===null?'Termin folgt':`Termin ${dateLabel(ms.datum)}`),text);
              if (!plan.lookup.get(ms.id)) msNode.append(el('p','ru-note','ID nicht eindeutig · Zuordnung prüfen'));
              if (rows.length && ['erreicht','entfallen'].includes(ms.status)) msNode.append(el('p','ru-note','Offene Arbeit vorhanden · Zuordnung prüfen'));
              counts(msNode,rows,`ms:${ms.id}`,false,work.partial || !work.assignmentsAvailable || !plan.lookup.get(ms.id));
              if (ms.details || ms.abhaengigkeit) {
                const detail=el('details','ru-context');detail.append(el('summary','','Ergebnis und Abhängigkeit'));
                if (ms.details) detail.append(el('p','',String(ms.details)));
                if (ms.abhaengigkeit) detail.append(el('p','',`Abhängigkeit: ${String(ms.abhaengigkeit)}`));
                msNode.append(detail);
              }
              laneNode.append(msNode);
            }
            areaNode.append(laneNode);
          }
          group.append(areaNode);
        }
        goalsHost.append(group);
      }
    }
    root.append(goalsHost);
    const stock=el('section','ru-stock');stock.setAttribute('aria-label','Arbeitsvorrat');stock.append(el('h2','','Arbeitsvorrat'));
    if (!work.available) stock.append(el('p','ru-notice','Issue-Daten für diesen Stand nicht verfügbar. Bestandszahlen und Zuordnungen sind unbekannt.'));
    if (work.partial) stock.append(el('p','ru-notice','Unvollständiger Arbeitsbestand: Gesamtzahl unbekannt. Die Listen enthalten nur die eindeutig vorliegenden Items.'));
    if (work.conflicts) stock.append(el('p','ru-notice',`${work.conflicts} widersprüchliche Issue-Kennungen sind aus den Zahlen ausgeschlossen.`));
    stock.append(el('p','ru-note','In Arbeit = Beansprucht + In Progress. In Review ist offene Abstimmung. Backlog, On Hold und Später zählen separat und nicht als laufende Arbeit.'));
    counts(stock,work.rows,'global',true);
    const drafts=work.rows.filter(row=>!row.id).length;
    stock.append(el('p','ru-note',work.available ? `${work.rows.length} eindeutig vorliegende offene Items, davon ${drafts} Drafts / ohne Issue-Kennung. Globale Summen zählen jedes Issue einmal.` : 'Keine verlässliche Grundgesamtheit verfügbar.'));
    const mapping=el('details','ru-stock-detail');mapping.append(el('summary','','Ad hoc und offene Zuordnungen'));
    for (const [id,label,predicate] of [['adhoc','Ad hoc',r=>r.ids.includes('adhoc')],['fehlt','Meilenstein fehlt',r=>r.missing],['unbekannt','Unbekannte oder ungültige Meilenstein-ID',r=>r.unknown]]) {
      const node=el('section','ru-mapping');node.append(el('h3','',label));counts(node,work.assignmentsAvailable ? work.rows.filter(predicate) : [],`zuordnung:${id}`,true,work.partial || !work.assignmentsAvailable);mapping.append(node);
    }
    mapping.append(el('p','ru-note','Zuordnungsgruppen können sich überlappen. Ein zusätzliches unbekanntes Ziel entfernt kein bekanntes Ziel.'));
    stock.append(mapping);
    const repos=el('details','ru-stock-detail');repos.append(el('summary','','Arbeitsvorrat nach Repository'));
    const repoNames=[...new Set(work.rows.map(row=>row.id?.repo || 'ohne-repo'))];
    for (const repo of repoNames) {
      const node=el('section','ru-repo');node.append(el('h3','',repo==='ohne-repo'?'Drafts / ohne Repository':repo));
      counts(node,work.rows.filter(row=>(row.id?.repo || 'ohne-repo')===repo),`repo:${repo}`,true);repos.append(node);
    }
    repos.append(el('p','ru-note','Repositories ergänzen die Zielhierarchie. Ein Repo ist kein Jahresziel; Roadmap-Area und Board-Bereich sind verschiedene Zuordnungen.'));
    stock.append(repos);root.append(stock,announcer);
    if (restoreFocus) {root.setAttribute('tabindex','-1');root.focus();}
    return handle;
  }
  global.ReportingUeberblick=Object.freeze({mount});
})(window);
