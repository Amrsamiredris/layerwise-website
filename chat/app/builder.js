// Visual flow builder: drag nodes, drag from a port dot to a node to connect, click a connected dot to disconnect.
(function () {
  const TYPES = {
    message: { label: '💬 Message', make: () => ({ text: 'New message', buttons: [], quick_replies: [] }) },
    question: { label: '❓ Question (save input)', make: () => ({ text: 'What is your email?', validation: 'email', save_to: 'email', options: [], max_tries: 3 }) },
    condition: { label: '🔀 Condition', make: () => ({ match: 'all', rules: [{ op: 'has_tag', value: '' }] }) },
    action: { label: '⚡ Action', make: () => ({ ops: [{ type: 'add_tag', value: '' }] }) },
    delay: { label: '⏱ Delay', make: () => ({ amount: 1, unit: 'h' }) },
    http: { label: '🌐 HTTP request', make: () => ({ method: 'POST', url: 'https://', headers: [], mappings: [] }) },
    ai: { label: '🤖 AI reply', make: () => ({ mode: 'once', system_prompt: 'You are a helpful assistant for our business. Be brief.', knowledge: '', history: 10, exit_keywords: ['human'] }) },
    random: { label: '🎲 A/B split', make: () => ({ branches: [{ weight: 50 }, { weight: 50 }] }) },
    goto: { label: '↪ Go to flow', make: () => ({ flow_id: '' }) },
  };
  const OPS = { has_tag: 'has tag', not_has_tag: "doesn't have tag", eq: 'field equals', neq: 'field not equals', contains: 'field contains', gt: 'field >', lt: 'field <', is_set: 'field is set', not_set: 'field is empty', channel_is: 'channel is', ig_follows: 'follows my Instagram' };
  const ACTS = { add_tag: 'Add tag', remove_tag: 'Remove tag', set_field: 'Set field', clear_field: 'Clear field', subscribe_sequence: 'Subscribe to sequence', unsubscribe_sequence: 'Unsubscribe from sequence', human_takeover: 'Hand over to human', notify: 'Notify team (dashboard)', unsubscribe: 'Unsubscribe from broadcasts', subscribe: 'Subscribe to broadcasts' };

  let F, sel = null, zoom = 1, pan = { x: 40, y: 70 }, dirty = false, flows = [], seqs = [], stats = {};
  const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
  const set = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => a[k], o); if (v == null || v === '') delete t[last]; else t[last] = v; };
  const mark = () => { dirty = true; const b = $('#fb_save'); if (b) b.textContent = 'Save *'; };

  function ports(n) {
    const out = [];
    if (n.type === 'message') {
      (n.buttons || []).forEach((b, i) => { if (!b.url) out.push({ key: `buttons.${i}.next`, label: '🔘 ' + (b.title || 'button') }); });
      (n.quick_replies || []).forEach((q, i) => out.push({ key: `quick_replies.${i}.next`, label: '⚪ ' + (q.title || 'reply') }));
      if (!out.length) out.push({ key: 'next', label: 'Next' });
    } else if (n.type === 'question') { out.push({ key: 'next', label: 'Answered' }, { key: 'on_fail', label: 'Failed validation' }); }
    else if (n.type === 'condition') { out.push({ key: 'yes', label: '✅ Yes' }, { key: 'no', label: '❌ No' }); }
    else if (n.type === 'http') { out.push({ key: 'next', label: 'Success' }, { key: 'on_error', label: 'Error' }); }
    else if (n.type === 'ai') { out.push({ key: 'next', label: n.mode === 'conversation' ? 'On exit keyword' : 'Next' }); }
    else if (n.type === 'random') { (n.branches || []).forEach((b, i) => out.push({ key: `branches.${i}.next`, label: `${String.fromCharCode(65 + i)} · ${b.weight}%` })); }
    else if (n.type === 'goto') { }
    else out.push({ key: 'next', label: 'Next' });
    return out;
  }
  function preview(n) {
    switch (n.type) {
      case 'message': return (n.image_url ? '🖼 ' : '') + (n.text || '') + (n.buttons || []).filter(b => b.url).map(b => `\n🔗 ${b.title}`).join('');
      case 'question': return `${n.text || ''}\n→ saves to {{${n.save_to || '?'}}} (${n.validation || 'any'})`;
      case 'condition': return (n.rules || []).map(r => `${OPS[r.op] || r.op} ${r.field || ''} ${r.value || ''}`).join(n.match === 'any' ? '\nOR ' : '\nAND ');
      case 'action': return (n.ops || []).map(o => `${ACTS[o.type]}${o.field ? ' ' + o.field : ''}${o.value ? ': ' + (o.type.includes('sequence') ? (seqs.find(s => s.id == o.value)?.name || o.value) : o.value) : ''}`).join('\n');
      case 'delay': return `Wait ${n.amount} ${({ s: 'seconds', m: 'minutes', h: 'hours', d: 'days' })[n.unit]}`;
      case 'http': return `${n.method} ${n.url}`;
      case 'ai': return `${n.mode === 'conversation' ? 'Conversation mode' : 'Single reply'}\n${(n.system_prompt || '').slice(0, 80)}`;
      case 'random': return 'Random split';
      case 'goto': return '→ ' + (flows.find(f => f.id == n.flow_id)?.name || 'choose flow');
    }
    return '';
  }

  async function open(id) {
    const [f, fl, sq] = await Promise.all([api('GET', `/flows/${id}`), api('GET', '/flows'), api('GET', '/sequences')]);
    F = f; flows = fl; seqs = sq; stats = f.stats || {}; sel = null; dirty = false;
    const main = shell('flows', `<div class="fb"><div class="canvas-wrap" id="cw"><div class="canvas" id="cv"><svg class="edges" id="ed" width="1" height="1"></svg></div>
      <div class="zoom"><button class="btn sm" id="zi">+</button><button class="btn sm" id="zo">−</button><button class="btn sm" id="zr">Fit</button></div></div>
      <aside class="panel" id="pn"></aside>
      <div class="fb-top"><a class="btn" href="#/flows">←</a><input id="fn" value="${esc(F.name)}">
        <select id="add" style="width:auto"><option value="">+ Add step</option>${Object.entries(TYPES).map(([k, t]) => opt(k, t.label)).join('')}</select>
        <button class="btn p" id="fb_save">Save</button><button class="btn" id="test">▶ Test</button></div></div>`);
    main.style.overflow = 'hidden';
    $('#fn').oninput = e => { F.name = e.target.value; mark(); };
    $('#add').onchange = e => { if (e.target.value) addNode(e.target.value); e.target.value = ''; };
    $('#fb_save').onclick = save;
    $('#test').onclick = testChat;
    $('#zi').onclick = () => { zoom = Math.min(2, zoom + .1); applyT(); };
    $('#zo').onclick = () => { zoom = Math.max(.3, zoom - .1); applyT(); };
    $('#zr').onclick = fit;
    bindCanvas();
    draw(); fit(); panel();
    window.onbeforeunload = () => dirty ? 'unsaved' : undefined;
    const onKey = e => { if (!$('#cv')) return document.removeEventListener('keydown', onKey);
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) delNode(sel); };
    document.addEventListener('keydown', onKey);
  }

  async function save() {
    await api('PUT', `/flows/${F.id}`, { name: F.name, nodes: F.nodes, start_node: F.start_node });
    dirty = false; $('#fb_save').textContent = 'Save'; toast('Flow saved');
  }

  function addNode(type) {
    const ids = Object.keys(F.nodes).map(k => +k.replace(/\D/g, '') || 0);
    const id = 'n' + (Math.max(0, ...ids) + 1);
    const cw = $('#cw').getBoundingClientRect();
    const node = { type, ...TYPES[type].make(), x: Math.round((cw.width / 2 - pan.x) / zoom - 125), y: Math.round((cw.height / 2 - pan.y) / zoom - 60) };
    // auto-connect from selected node's first empty port
    if (sel && F.nodes[sel]) { const p = ports(F.nodes[sel]).find(p => !get(F.nodes[sel], p.key)); if (p) { set(F.nodes[sel], p.key, id); node.x = F.nodes[sel].x + 320; node.y = F.nodes[sel].y; } }
    F.nodes[id] = node; if (!F.start_node) F.start_node = id;
    sel = id; mark(); draw(); panel();
  }
  function delNode(id) {
    if (!confirm('Delete this step?')) return;
    delete F.nodes[id];
    for (const n of Object.values(F.nodes)) for (const p of ports(n)) if (get(n, p.key) === id) set(n, p.key, null);
    if (F.start_node === id) F.start_node = Object.keys(F.nodes)[0] || null;
    sel = null; mark(); draw(); panel();
  }

  // ---------- canvas ----------
  const applyT = () => { const cv = $('#cv'); if (cv) cv.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom})`; };
  function fit() {
    const ns = Object.values(F.nodes); const cw = $('#cw').getBoundingClientRect();
    if (!ns.length) return applyT();
    const minX = Math.min(...ns.map(n => n.x || 0)), minY = Math.min(...ns.map(n => n.y || 0));
    const maxX = Math.max(...ns.map(n => (n.x || 0) + 260)), maxY = Math.max(...ns.map(n => (n.y || 0) + 220));
    zoom = Math.max(.35, Math.min(1, (cw.width - 80) / (maxX - minX), (cw.height - 140) / (maxY - minY)));
    pan = { x: 40 - minX * zoom, y: 80 - minY * zoom }; applyT();
  }
  function draw() {
    const cv = $('#cv'); if (!cv) return;
    $$('.node', cv).forEach(n => n.remove());
    for (const [id, n] of Object.entries(F.nodes)) {
      const el = document.createElement('div');
      el.className = `node t-${n.type} ${sel === id ? 'sel' : ''} ${F.start_node === id ? 'start' : ''}`;
      el.dataset.id = id; el.style.left = (n.x || 0) + 'px'; el.style.top = (n.y || 0) + 'px';
      el.innerHTML = `<div class="inp"></div><div class="hd"><span>${TYPES[n.type]?.label || n.type}${F.start_node === id ? ' · START' : ''}</span><span class="stat">${stats[id] ? stats[id] + ' runs' : id}</span></div>
        <div class="bd">${esc(preview(n))}</div><div class="ports">${ports(n).map(p => `<div class="port">${esc(p.label)}${p.key.includes('.next') && stats[`${id}:${p.key[0]}${p.key.split('.')[1]}`] ? ` <span class="stat">(${stats[`${id}:${p.key[0]}${p.key.split('.')[1]}`]})</span>` : ''}<span class="dot ${get(n, p.key) ? 'on' : ''}" data-port="${p.key}"></span></div>`).join('')}</div>`;
      cv.appendChild(el);
    }
    edges();
  }
  function portXY(nodeId, key) {
    const n = F.nodes[nodeId]; const el = $(`.node[data-id="${nodeId}"]`); const dot = el && $(`.dot[data-port="${key}"]`, el);
    if (!dot) return null;
    let y = 0, e = dot; while (e && e !== el) { y += e.offsetTop; e = e.offsetParent; }
    return { x: n.x + el.offsetWidth, y: n.y + y + 7 };
  }
  const curve = (a, b) => { const dx = Math.max(60, Math.abs(b.x - a.x) / 2); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };
  function edges(tmp) {
    const svg = $('#ed'); if (!svg) return;
    let d = '';
    for (const [id, n] of Object.entries(F.nodes)) for (const p of ports(n)) {
      const t = get(n, p.key); if (!t || !F.nodes[t]) continue;
      const a = portXY(id, p.key); const b = { x: F.nodes[t].x, y: F.nodes[t].y + 21 }; if (a) d += `<path ${b.x < a.x ? 'style="stroke-dasharray:6 4;stroke:#f59e0b"' : ''} d="${curve(a, b)}"/>`;
    }
    if (tmp) d += `<path class="tmp" d="${curve(tmp.a, tmp.b)}"/>`;
    svg.innerHTML = d;
  }
  function bindCanvas() {
    const cw = $('#cw');
    const toCanvas = e => { const r = cw.getBoundingClientRect(); return { x: (e.clientX - r.left - pan.x) / zoom, y: (e.clientY - r.top - pan.y) / zoom }; };
    cw.addEventListener('wheel', e => { e.preventDefault(); const r = cw.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
      const nz = Math.max(.3, Math.min(2, zoom * (e.deltaY < 0 ? 1.1 : .9))); pan.x = mx - (mx - pan.x) * nz / zoom; pan.y = my - (my - pan.y) * nz / zoom; zoom = nz; applyT(); }, { passive: false });
    cw.addEventListener('mousedown', e => {
      const dot = e.target.closest('.dot'); const nodeEl = e.target.closest('.node');
      if (dot) { // connect / disconnect
        e.stopPropagation(); const from = nodeEl.dataset.id; const key = dot.dataset.port; const a = portXY(from, key); let moved = false;
        const mv = ev => { moved = true; edges({ a, b: toCanvas(ev) }); };
        const up = ev => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
          const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.node');
          if (moved && target && target.dataset.id !== from) { set(F.nodes[from], key, target.dataset.id); mark(); }
          else if (!moved && get(F.nodes[from], key)) { set(F.nodes[from], key, null); mark(); }
          else if (moved && !target) { // dropped on empty canvas -> quick add menu
            const at = toCanvas(ev); quickAdd(ev.clientX, ev.clientY, type => { const before = new Set(Object.keys(F.nodes)); sel = null; addNode(type);
              const nid = Object.keys(F.nodes).find(k => !before.has(k)); F.nodes[nid].x = Math.round(at.x); F.nodes[nid].y = Math.round(at.y - 20); set(F.nodes[from], key, nid); sel = nid; draw(); panel(); }); }
          draw(); if (sel === from) panel(); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); return;
      }
      if (nodeEl) { // select + drag
        const id = nodeEl.dataset.id; if (sel !== id) { sel = id; $$('.node').forEach(n => n.classList.toggle('sel', n.dataset.id === id)); panel(); }
        if (!e.target.closest('.hd') && !e.target.closest('.bd')) return;
        const n = F.nodes[id]; const s = { x: e.clientX, y: e.clientY, nx: n.x, ny: n.y };
        const mv = ev => { n.x = Math.round(s.nx + (ev.clientX - s.x) / zoom); n.y = Math.round(s.ny + (ev.clientY - s.y) / zoom); nodeEl.style.left = n.x + 'px'; nodeEl.style.top = n.y + 'px'; edges(); };
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); if (n.x !== s.nx || n.y !== s.ny) mark(); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); return;
      }
      // pan
      const s = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; cw.style.cursor = 'grabbing'; let moved = false;
      const mv = ev => { moved = true; pan.x = s.px + ev.clientX - s.x; pan.y = s.py + ev.clientY - s.y; applyT(); };
      const up = () => { cw.style.cursor = ''; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); if (!moved && sel) { sel = null; draw(); panel(); } };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
  }
  function quickAdd(x, y, cb) {
    const m = document.createElement('div'); m.className = 'card'; m.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:40;padding:6px;box-shadow:0 8px 24px #0002`;
    m.innerHTML = Object.entries(TYPES).map(([k, t]) => `<div data-k="${k}" style="padding:6px 10px;cursor:pointer;border-radius:6px">${t.label}</div>`).join('');
    document.body.appendChild(m);
    const close = () => { m.remove(); document.removeEventListener('mousedown', out); };
    const out = e => { if (!m.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', out));
    $$('[data-k]', m).forEach(d => { d.onmouseenter = () => d.style.background = '#eef2ff'; d.onmouseleave = () => d.style.background = ''; d.onclick = () => { close(); cb(d.dataset.k); }; });
  }

  // ---------- side panel ----------
  function targetSel(key, n) {
    return `<select data-target="${key}"><option value="">— not connected —</option>${Object.keys(F.nodes).filter(k => k !== sel).map(k => opt(k, `${k} · ${TYPES[F.nodes[k].type]?.label} · ${preview(F.nodes[k]).slice(0, 30)}`, get(n, key))).join('')}</select>`;
  }
  function panel() {
    const pn = $('#pn'); if (!pn) return;
    if (!sel || !F.nodes[sel]) {
      pn.innerHTML = `<h2>Flow</h2><p class="help">Drag a node by its header. Drag from a port <b>●</b> onto another step to connect, or drop on empty canvas to create one. Click a filled port to disconnect. Ctrl/⌘+S saves.</p>
        <label>Variables you can use in any text</label><p class="help"><code>{{first_name}}</code> <code>{{name}}</code> <code>{{username}}</code> <code>{{email}}</code> <code>{{phone}}</code> <code>{{last_input}}</code> <code>{{field.anything}}</code> · fallback: <code>{{first_name|there}}</code></p>
        <label>Steps</label>${Object.entries(F.nodes).map(([k, n]) => `<div class="item" style="cursor:pointer" data-go="${k}"><b>${k}</b> ${TYPES[n.type]?.label}${F.start_node === k ? ' <span class="pill ok">start</span>' : ''}<div class="help">${esc(preview(n).slice(0, 60))}</div></div>`).join('')}`;
      $$('[data-go]', pn).forEach(d => d.onclick = () => { sel = d.dataset.go; draw(); panel(); });
      return;
    }
    const n = F.nodes[sel]; const v = k => esc(n[k] ?? '');
    let h = `<div class="row"><h2 style="margin:0">${TYPES[n.type].label}</h2><span class="sp"></span><code>${sel}</code></div>
      <div class="row" style="margin:8px 0">${F.start_node === sel ? '<span class="pill ok">Start step</span>' : '<button class="btn sm" id="mk_start">Set as start</button>'}<button class="btn sm d" id="del">Delete</button></div>`;
    if (n.type === 'message') {
      h += `<label>Text</label><textarea data-f="text">${v('text')}</textarea><label>Image URL (optional)</label><input data-f="image_url" value="${v('image_url')}">
        <label>Buttons (max 3 on Instagram/Messenger/WhatsApp)</label>${(n.buttons || []).map((b, i) => `<div class="item"><div class="row"><input data-l="buttons.${i}.title" value="${esc(b.title)}" placeholder="Title (20 chars)" maxlength="20" style="flex:1"><button class="btn sm d" data-rm="buttons.${i}">×</button></div>
          <div class="row" style="margin-top:4px"><select data-btype="${i}" style="width:110px">${opt('flow', 'Next step', b.url ? 'url' : 'flow')}${opt('url', 'Open URL', b.url ? 'url' : 'flow')}</select>
          ${b.url != null ? `<input data-l="buttons.${i}.url" value="${esc(b.url)}" placeholder="https://" style="flex:1">` : `<div style="flex:1">${targetSel(`buttons.${i}.next`, n)}</div>`}</div>
          ${b.url == null ? `<input data-l="buttons.${i}.tag" value="${esc(b.tag || '')}" placeholder="tag on click (optional)" style="margin-top:4px">` : ''}</div>`).join('')}
        <button class="btn sm" data-add="buttons">+ Button</button>
        <label>Quick replies</label>${(n.quick_replies || []).map((q, i) => `<div class="item"><div class="row"><input data-l="quick_replies.${i}.title" value="${esc(q.title)}" maxlength="20" style="flex:1"><button class="btn sm d" data-rm="quick_replies.${i}">×</button></div>${targetSel(`quick_replies.${i}.next`, n)}</div>`).join('')}
        <button class="btn sm" data-add="quick_replies">+ Quick reply</button>
        ${!ports(n)[0].key.includes('.') ? `<label>Then go to</label>${targetSel('next', n)}` : '<p class="help">Flow waits for a tap. Typed text matching a button title also works.</p>'}`;
    }
    if (n.type === 'question') {
      h += `<label>Question</label><textarea data-f="text">${v('text')}</textarea>
        <label>Validation</label><select data-f="validation">${['any', 'email', 'phone', 'number'].map(x => opt(x, x, n.validation)).join('')}</select>
        <label>Save answer to</label><input data-f="save_to" value="${v('save_to')}" placeholder="email, phone, name or any custom field" list="fld">
        <datalist id="fld"><option>email</option><option>phone</option><option>name</option></datalist>
        <label>Answer options as quick replies (comma separated, optional)</label><input data-csv="options" value="${esc((n.options || []).join(', '))}">
        <label>Retry message</label><input data-f="retry_text" value="${v('retry_text')}" placeholder="That doesn't look right — please try again.">
        <label>Max tries</label><input type="number" data-f="max_tries" value="${v('max_tries') || 3}">
        <label>When answered</label>${targetSel('next', n)}<label>When validation fails</label>${targetSel('on_fail', n)}`;
    }
    if (n.type === 'condition') {
      h += `<label>Match</label><select data-f="match">${opt('all', 'ALL rules', n.match)}${opt('any', 'ANY rule', n.match)}</select>
        ${(n.rules || []).map((r, i) => `<div class="item"><div class="row"><select data-l="rules.${i}.op" style="flex:1">${Object.entries(OPS).map(([k, l]) => opt(k, l, r.op)).join('')}</select><button class="btn sm d" data-rm="rules.${i}">×</button></div>
          ${['eq', 'neq', 'contains', 'gt', 'lt', 'is_set', 'not_set'].includes(r.op) ? `<input data-l="rules.${i}.field" value="${esc(r.field || '')}" placeholder="field (email, city…)" style="margin-top:4px">` : ''}
          ${r.op === 'channel_is' ? `<select data-l="rules.${i}.value" style="margin-top:4px">${CH.map(c => opt(c, c, r.value)).join('')}</select>` : !['is_set', 'not_set', 'ig_follows'].includes(r.op) ? `<input data-l="rules.${i}.value" value="${esc(r.value || '')}" placeholder="value" style="margin-top:4px">` : ''}</div>`).join('')}
        <button class="btn sm" data-add="rules">+ Rule</button><label>Yes →</label>${targetSel('yes', n)}<label>No →</label>${targetSel('no', n)}
        <p class="help">“follows my Instagram” checks live via the API — use it as a follow gate after the user taps a button.</p>`;
    }
    if (n.type === 'action') {
      h += (n.ops || []).map((o, i) => `<div class="item"><div class="row"><select data-l="ops.${i}.type" style="flex:1">${Object.entries(ACTS).map(([k, l]) => opt(k, l, o.type)).join('')}</select><button class="btn sm d" data-rm="ops.${i}">×</button></div>
        ${['set_field', 'clear_field'].includes(o.type) ? `<input data-l="ops.${i}.field" value="${esc(o.field || '')}" placeholder="field name" style="margin-top:4px">` : ''}
        ${o.type.includes('sequence') ? `<select data-l="ops.${i}.value" style="margin-top:4px"><option value="">sequence…</option>${seqs.map(s => opt(s.id, s.name, o.value)).join('')}</select>`
          : ['add_tag', 'remove_tag', 'set_field', 'notify'].includes(o.type) ? `<input data-l="ops.${i}.value" value="${esc(o.value || '')}" placeholder="${o.type === 'notify' ? 'message to team' : 'value'}" style="margin-top:4px">` : ''}</div>`).join('')
        + `<button class="btn sm" data-add="ops">+ Action</button><label>Then go to</label>${targetSel('next', n)}`;
    }
    if (n.type === 'delay') h += `<div class="row"><div style="flex:1"><label>Wait</label><input type="number" min="1" data-f="amount" value="${v('amount')}"></div><div style="flex:1"><label>Unit</label><select data-f="unit">${[['s', 'seconds'], ['m', 'minutes'], ['h', 'hours'], ['d', 'days']].map(([k, l]) => opt(k, l, n.unit)).join('')}</select></div></div>
      <p class="help">Instagram/Messenger/WhatsApp only allow messages within 24h of the user's last message.</p><label>Then go to</label>${targetSel('next', n)}`;
    if (n.type === 'http') h += `<div class="row"><select data-f="method" style="width:90px">${['GET', 'POST', 'PUT', 'PATCH'].map(m => opt(m, m, n.method)).join('')}</select><input data-f="url" value="${v('url')}" style="flex:1"></div>
      <label>Headers</label>${(n.headers || []).map((x, i) => `<div class="row" style="margin:3px 0"><input data-l="headers.${i}.key" value="${esc(x.key || '')}" placeholder="Header"><input data-l="headers.${i}.value" value="${esc(x.value || '')}" placeholder="value"><button class="btn sm d" data-rm="headers.${i}">×</button></div>`).join('')}<button class="btn sm" data-add="headers">+ Header</button>
      <label>Body (JSON, variables allowed; empty = contact JSON)</label><textarea data-f="body">${v('body')}</textarea>
      <label>Save response values to fields</label>${(n.mappings || []).map((x, i) => `<div class="row" style="margin:3px 0"><input data-l="mappings.${i}.path" value="${esc(x.path || '')}" placeholder="data.order.status"><input data-l="mappings.${i}.field" value="${esc(x.field || '')}" placeholder="field"><button class="btn sm d" data-rm="mappings.${i}">×</button></div>`).join('')}<button class="btn sm" data-add="mappings">+ Mapping</button>
      <label>Success →</label>${targetSel('next', n)}<label>Error →</label>${targetSel('on_error', n)}`;
    if (n.type === 'ai') h += `<label>Mode</label><select data-f="mode">${opt('once', 'Single reply, then continue', n.mode)}${opt('conversation', 'Keep chatting until exit keyword', n.mode)}</select>
      <label>System prompt</label><textarea data-f="system_prompt">${v('system_prompt')}</textarea><label>Business knowledge (FAQ, prices, hours…)</label><textarea data-f="knowledge" style="min-height:110px">${v('knowledge')}</textarea>
      <div class="row"><div style="flex:1"><label>Model (empty = default)</label><input data-f="model" value="${v('model')}"></div><div style="width:90px"><label>History</label><input type="number" data-f="history" value="${v('history')}"></div></div>
      <label>Exit keywords (comma)</label><input data-csv="exit_keywords" value="${esc((n.exit_keywords || []).join(', '))}"><label>Fallback text if AI fails</label><input data-f="fallback" value="${v('fallback')}">
      <label>${n.mode === 'conversation' ? 'On exit →' : 'Then →'}</label>${targetSel('next', n)}`;
    if (n.type === 'random') h += (n.branches || []).map((b, i) => `<div class="item"><div class="row"><b>${String.fromCharCode(65 + i)}</b><input type="number" data-l="branches.${i}.weight" value="${b.weight}" style="width:80px">%<span class="sp"></span><button class="btn sm d" data-rm="branches.${i}">×</button></div>${targetSel(`branches.${i}.next`, n)}</div>`).join('') + `<button class="btn sm" data-add="branches">+ Branch</button>`;
    if (n.type === 'goto') h += `<label>Flow</label><select data-f="flow_id"><option value="">—</option>${flows.filter(f => f.id !== F.id).map(f => opt(f.id, f.name, n.flow_id)).join('')}</select>`;
    pn.innerHTML = h;

    const redraw = () => { const keep = document.activeElement?.dataset; draw(); };
    $$('[data-f]', pn).forEach(el => el[el.tagName === 'SELECT' ? 'onchange' : 'oninput'] = () => { n[el.dataset.f] = el.type === 'number' ? +el.value : el.value; mark(); redraw(); if (el.tagName === 'SELECT') panel(); });
    $$('[data-csv]', pn).forEach(el => el.oninput = () => { n[el.dataset.csv] = el.value.split(',').map(s => s.trim()).filter(Boolean); mark(); redraw(); });
    $$('[data-l]', pn).forEach(el => el[el.tagName === 'SELECT' ? 'onchange' : 'oninput'] = () => { const ks = el.dataset.l.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], n)[last] = el.type === 'number' ? +el.value : el.value; mark(); redraw(); if (el.tagName === 'SELECT') panel(); });
    $$('[data-target]', pn).forEach(el => el.onchange = () => { set(n, el.dataset.target, el.value || null); mark(); draw(); });
    $$('[data-rm]', pn).forEach(b => b.onclick = () => { const [arr, i] = b.dataset.rm.split('.'); n[arr].splice(+i, 1); mark(); draw(); panel(); });
    $$('[data-add]', pn).forEach(b => b.onclick = () => { const a = b.dataset.add; n[a] = n[a] || [];
      if (a === 'buttons' && n.buttons.length >= 3) toast('Note: Meta channels show max 3 buttons');
      n[a].push({ buttons: { title: 'Button' }, quick_replies: { title: 'Option' }, rules: { op: 'has_tag', value: '' }, ops: { type: 'add_tag', value: '' }, headers: { key: '', value: '' }, mappings: { path: '', field: '' }, branches: { weight: 50 } }[a]);
      mark(); draw(); panel(); });
    $$('[data-btype]', pn).forEach(s => s.onchange = () => { const b = n.buttons[+s.dataset.btype]; if (s.value === 'url') { b.url = 'https://'; delete b.next; } else delete b.url; mark(); draw(); panel(); });
    $('#mk_start', pn) && ($('#mk_start', pn).onclick = () => { F.start_node = sel; mark(); draw(); panel(); });
    $('#del', pn).onclick = () => delNode(sel);
  }

  // ---------- test chat (runs the saved flow over the web channel) ----------
  async function testChat() {
    if (dirty) await save();
    $('.tchat')?.remove();
    const vid = 'test_' + Math.random().toString(36).slice(2, 12);
    const box = document.createElement('div'); box.className = 'tchat';
    box.innerHTML = `<div class="hd">Test: ${esc(F.name)} <a href="#" id="tc_x">✕</a></div><div class="msgs" id="tc_m"></div><div class="qr" id="tc_q"></div>
      <form class="composer" id="tc_f"><input id="tc_i" placeholder="Type a reply…" autocomplete="off"><button class="btn p">Send</button></form>`;
    document.body.appendChild(box);
    const es = new EventSource(`/api/web/${vid}/stream`);
    const add = (cls, html) => { const d = document.createElement('div'); d.className = 'b ' + cls; d.innerHTML = html; $('#tc_m').appendChild(d); $('#tc_m').scrollTop = 1e9; return d; };
    const send = async (text, payload) => { add('in', esc(text)); $('#tc_q').innerHTML = ''; await fetch(`/api/web/${vid}/message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, payload }) }); };
    es.onmessage = e => { const { message: m } = JSON.parse(e.data);
      const d = add('out', `${m.image_url ? `<img src="${esc(m.image_url)}" style="max-width:100%;border-radius:8px;display:block">` : ''}${esc(m.text || '')}${(m.buttons || []).length ? `<div class="btns">${m.buttons.map((b, i) => `<button data-i="${i}">${esc(b.title)}${b.url ? ' ↗' : ''}</button>`).join('')}</div>` : ''}`);
      $$('button', d).forEach(b => b.onclick = () => { const bt = m.buttons[+b.dataset.i]; if (bt.url) window.open(bt.url, '_blank'); else send(bt.title, bt.payload); });
      $('#tc_q').innerHTML = (m.quick_replies || []).map((q, i) => `<button data-i="${i}">${esc(q.title)}</button>`).join('');
      $$('#tc_q button').forEach(b => b.onclick = () => { const q = m.quick_replies[+b.dataset.i]; send(q.title, q.payload); }); };
    $('#tc_f').onsubmit = e => { e.preventDefault(); const t = $('#tc_i').value.trim(); if (t) { send(t); $('#tc_i').value = ''; } };
    $('#tc_x').onclick = e => { e.preventDefault(); es.close(); box.remove(); };
    es.onopen = () => api('POST', `/flows/${F.id}/test`, { vid });
    window.addEventListener('hashchange', () => { es.close(); box.remove(); }, { once: true });
  }

  window.FlowBuilder = { open };
})();
