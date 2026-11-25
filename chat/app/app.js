// Layerwise Chat dashboard — vanilla JS SPA, no build step.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = t => { if (!t) return ''; const s = Date.now() / 1000 - t; return s < 60 ? 'now' : s < 3600 ? `${~~(s / 60)}m` : s < 86400 ? `${~~(s / 3600)}h` : `${~~(s / 86400)}d`; };
const CH = ['instagram', 'messenger', 'whatsapp', 'telegram', 'web'];
const chip = c => `<span class="ch ${c}">${({ instagram: 'IG', messenger: 'FB', whatsapp: 'WA', telegram: 'TG', web: 'WEB' })[c] || c}</span>`;

async function api(method, url, body) {
  const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && !url.startsWith('/auth')) { location.hash = '#/login'; throw new Error('Signed out'); }
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(j?.error || r.statusText);
  return j;
}
function toast(msg) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 3200); }
function modal(html, onMount) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('mousedown', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg); onMount?.(bg.firstChild, () => bg.remove()); return bg;
}
const opt = (v, label, sel) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(label)}</option>`;

// ---------- shell ----------
const NAV = [['dashboard', 'Dashboard'], ['inbox', 'Live Chat'], ['contacts', 'Contacts'], ['flows', 'Flows'], ['automations', 'Automations'], ['sequences', 'Sequences'], ['broadcasts', 'Broadcasts'], ['settings', 'Settings']];
let unread = 0, stream;
function shell(active, html) {
  $('#root').innerHTML = `<div class="app"><nav class="side"><div class="brand"><i></i>Layerwise Chat</div>
    ${NAV.map(([k, l]) => `<a href="#/${k}" class="${k === active ? 'on' : ''}">${l}${k === 'inbox' && unread ? `<span class="badge">${unread}</span>` : ''}</a>`).join('')}
    <div class="grow"></div><a href="#" id="logout">Sign out</a></nav><main class="main" id="main">${html}</main></div>`;
  $('#logout').onclick = async e => { e.preventDefault(); await api('POST', '/auth/logout'); location.hash = '#/login'; };
  return $('#main');
}
function openStream() {
  if (stream) return;
  stream = new EventSource('/api/stream');
  stream.onmessage = e => {
    const d = JSON.parse(e.data);
    if (d.notify) toast('🔔 ' + d.notify.text);
    if (d.alert === 'takeover') toast('🙋 A contact asked for a human');
    window.dispatchEvent(new CustomEvent('fdm:inbox', { detail: d }));
  };
}

// ---------- auth ----------
async function pageLogin() {
  const { needsSetup } = await api('GET', '/auth/status');
  $('#root').innerHTML = `<div class="auth"><form class="card" id="f"><h1>${needsSetup ? 'Create admin account' : 'Sign in'}</h1>
    <p class="sub">${needsSetup ? 'First run — this account owns the workspace.' : 'Layerwise Chat chat automation'}</p>
    ${needsSetup ? '<label>Name</label><input name="name">' : ''}
    <label>Email</label><input name="email" type="email" required><label>Password</label><input name="password" type="password" required minlength="8">
    <p></p><button class="btn p" style="width:100%">${needsSetup ? 'Create account' : 'Sign in'}</button><p class="help" id="err"></p></form></div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    try { await api('POST', needsSetup ? '/auth/setup' : '/auth/login', Object.fromEntries(new FormData(e.target))); location.hash = needsSetup ? '#/settings' : '#/dashboard'; }
    catch (err) { $('#err').textContent = err.message; }
  };
}

// ---------- dashboard ----------
async function pageDashboard() {
  const s = await api('GET', '/stats?days=14');
  const max = Math.max(1, ...s.daily.map(d => d.inbound + d.outbound));
  shell('dashboard', `<div class="page"><h1>Dashboard</h1><p class="sub">Last 14 days</p>
    <div class="grid g4">
      ${[['Contacts', s.contacts], ['New contacts', s.new_contacts], ['Active contacts', s.active_contacts], ['Messages in', s.msgs_in], ['Messages out', s.msgs_out], ['Failed sends', s.failed], ['Waiting for human', s.takeover]]
        .map(([l, v]) => `<div class="card kpi"><span>${l}</span><b>${v}</b></div>`).join('')}
    </div><p></p>
    <div class="grid g2">
      <div class="card"><h2>Messages per day</h2>${s.daily.length ? `<div class="bars">${s.daily.map(d => `<div title="${d.d}: ${d.inbound} in / ${d.outbound} out"><i class="o" style="height:${d.outbound / max * 110}px"></i><i style="height:${d.inbound / max * 110}px"></i></div>`).join('')}</div>
        <p class="help">Dark = inbound, light = outbound</p>` : '<div class="empty">No messages yet</div>'}</div>
      <div class="card"><h2>Top automations</h2><table>${s.top_triggers.map(t => `<tr><td>${esc(t.name || t.type)}</td><td><span class="pill">${t.type}</span></td><td style="text-align:right"><b>${t.runs}</b></td></tr>`).join('') || '<tr><td class="empty">None yet</td></tr>'}</table>
        <h2 style="margin-top:16px">Contacts by channel</h2>${s.by_channel.map(c => `${chip(c.channel)} <b>${c.n}</b>`).join(' &nbsp; ') || '<span class="help">—</span>'}</div>
    </div></div>`);
}

// ---------- inbox ----------
let inboxSel = null;
async function pageInbox() {
  shell('inbox', `<div class="inbox"><div class="list"><div style="padding:10px;border-bottom:1px solid var(--line)" class="row">
      <input id="q" placeholder="Search…" style="flex:1"><select id="flt" style="width:auto"><option value="">All</option><option value="1">Needs human</option></select></div><div id="cl"></div></div>
    <div class="conv" id="conv"><div class="empty">Select a conversation</div></div><div class="info" id="info"></div></div>`);
  const loadList = async () => {
    const q = $('#q')?.value || ''; const f = $('#flt')?.value || '';
    const { rows } = await api('GET', `/contacts?sort=recent&limit=200&q=${encodeURIComponent(q)}&takeover=${f}`);
    unread = rows.reduce((s, r) => s + (r.unread ? 1 : 0), 0);
    if (!$('#cl')) return;
    $('#cl').innerHTML = rows.map(c => `<div class="ci ${c.id === inboxSel ? 'on' : ''}" data-id="${c.id}"><div class="t"><b>${esc(c.name || c.username || c.external_id)}</b><span>${chip(c.channel)} <span class="help">${ago(c.last_message_at)}</span></span></div>
      <div class="m">${c.human_takeover ? '<span class="pill warn">human</span> ' : ''}${c.unread ? '<span class="badge">' + c.unread + '</span> ' : ''}${esc(c.last_text || '')}</div></div>`).join('') || '<div class="empty">No conversations yet</div>';
    $$('.ci').forEach(el => el.onclick = () => { inboxSel = +el.dataset.id; loadList(); openConv(inboxSel); });
  };
  $('#q').oninput = loadList; $('#flt').onchange = loadList;
  const onEvt = e => { if (!$('#cl')) return window.removeEventListener('fdm:inbox', onEvt); loadList(); if (e.detail.contact_id === inboxSel) openConv(inboxSel, true); };
  window.addEventListener('fdm:inbox', onEvt);
  await loadList(); if (inboxSel) openConv(inboxSel);
}
function bubble(m) {
  const p = m.payload || {};
  const btns = [...(p.buttons || []), ...(p.quick_replies || [])];
  const cls = m.direction === 'in' ? 'in' : `out ${m.sender?.startsWith('agent') ? 'agent' : m.sender === 'ai' ? 'ai' : ''} ${m.status === 'failed' ? 'failed' : ''}`;
  return `<div class="b ${cls}" dir="auto">${p.image_url ? `<img src="${esc(p.image_url)}" style="max-width:200px;border-radius:8px;display:block">` : ''}${esc(m.text)}${btns.length ? `<div class="btns">${btns.map(b => `<span>${esc(b.title)}${b.url ? ' ↗' : ''}</span>`).join('')}</div>` : ''}<small>${m.direction === 'out' ? esc(m.sender || 'bot') + ' · ' : ''}${new Date(m.created_at * 1000).toLocaleString()}${m.status === 'failed' ? ' · FAILED: ' + esc(m.error) : ''}</small></div>`;
}
async function openConv(id, keepScroll) {
  const [c, msgs, flows, seqs] = await Promise.all([api('GET', `/contacts/${id}`), api('GET', `/contacts/${id}/messages`), api('GET', '/flows'), api('GET', '/sequences')]);
  const conv = $('#conv'); if (!conv) return;
  conv.innerHTML = `<div class="row" style="padding:12px 16px;border-bottom:1px solid var(--line);background:#fff">${chip(c.channel)}<b>${esc(c.name || c.username || c.external_id)}</b><span class="sp"></span>
      <button class="btn sm ${c.human_takeover ? 'p' : ''}" id="tk">${c.human_takeover ? '▶ Resume bot' : '⏸ Pause bot (take over)'}</button></div>
    <div class="msgs" id="msgs">${msgs.map(bubble).join('')}</div>
    <form class="composer" id="cmp"><input id="txt" placeholder="${c.human_takeover ? 'Reply as agent…' : 'Reply (tip: pause the bot first)'}" autocomplete="off">
      <select id="sf" style="width:150px"><option value="">Send flow…</option>${flows.map(f => opt(f.id, f.name)).join('')}</select><button class="btn p">Send</button></form>`;
  const box = $('#msgs'); box.scrollTop = box.scrollHeight;
  $('#tk').onclick = async () => { await api('PUT', `/contacts/${id}`, { human_takeover: c.human_takeover ? 0 : 1 }); openConv(id); };
  $('#cmp').onsubmit = async e => {
    e.preventDefault(); const text = $('#txt').value.trim(); const flow_id = $('#sf').value;
    if (!text && !flow_id) return;
    try { await api('POST', `/contacts/${id}/send`, flow_id ? { flow_id } : { text }); $('#txt').value = ''; $('#sf').value = ''; openConv(id); } catch (err) { toast(err.message); openConv(id); }
  };
  renderContactInfo($('#info'), c, seqs, () => openConv(id));
}
function renderContactInfo(el, c, seqs, refresh) {
  el.innerHTML = `<h2>${esc(c.name || '—')}</h2><div class="help">${chip(c.channel)} ${c.username ? '@' + esc(c.username) : ''} · ID ${esc(c.external_id)}</div>
    <label>Name</label><input id="ci_name" value="${esc(c.name || '')}"><label>Email</label><input id="ci_email" value="${esc(c.email || '')}"><label>Phone</label><input id="ci_phone" value="${esc(c.phone || '')}">
    <label>Tags</label><div id="ci_tags">${c.tags.map(t => `<span class="pill acc">${esc(t)} <a href="#" data-t="${esc(t)}">×</a></span>`).join('')}</div>
    <div class="row" style="margin-top:6px"><input id="ci_nt" placeholder="add tag" style="flex:1"><button class="btn sm" id="ci_at">Add</button></div>
    <label>Custom fields</label>${Object.entries(c.fields).map(([k, v]) => `<div class="row"><code>${esc(k)}</code><span style="flex:1;word-break:break-all">${esc(v)}</span></div>`).join('') || '<div class="help">none</div>'}
    <label>Sequences</label>${c.sequences.map(s => `<div><span class="pill">${esc(s.name)}</span> ${s.status} · step ${s.step}</div>`).join('') || '<div class="help">none</div>'}
    <div class="row" style="margin-top:6px"><select id="ci_seq" style="flex:1"><option value="">Enroll in sequence…</option>${seqs.map(s => opt(s.id, s.name)).join('')}</select></div>
    <label><input type="checkbox" id="ci_sub" style="width:auto" ${c.subscribed ? 'checked' : ''}> Subscribed to broadcasts</label>
    <p></p><div class="row"><button class="btn p" id="ci_save">Save</button><button class="btn d" id="ci_del">Delete</button></div>`;
  const save = async (extra = {}) => { await api('PUT', `/contacts/${c.id}`, { name: $('#ci_name').value, email: $('#ci_email').value, phone: $('#ci_phone').value, subscribed: $('#ci_sub').checked ? 1 : 0, ...extra }); refresh(); };
  $('#ci_save').onclick = () => save().then(() => toast('Saved'));
  $('#ci_at').onclick = () => { const t = $('#ci_nt').value.trim(); if (t) save({ tags: [...new Set([...c.tags, t])] }); };
  $$('#ci_tags a').forEach(a => a.onclick = e => { e.preventDefault(); save({ tags: c.tags.filter(x => x !== a.dataset.t) }); });
  $('#ci_seq').onchange = async e => { if (e.target.value) { await api('POST', `/contacts/${c.id}/enroll`, { sequence_id: e.target.value }); refresh(); } };
  $('#ci_del').onclick = async () => { if (confirm('Delete this contact and its history?')) { await api('DELETE', `/contacts/${c.id}`); inboxSel = null; route(); } };
}

// ---------- contacts ----------
async function pageContacts() {
  const tags = await api('GET', '/tags');
  shell('contacts', `<div class="page"><div class="row"><h1>Contacts</h1><span class="sp"></span><a class="btn" href="/api/contacts/export.csv">Export CSV</a></div><p class="sub">Everyone who has messaged or commented.</p>
    <div class="row" style="margin-bottom:12px"><input id="q" placeholder="Search name, @username, email, phone" style="max-width:320px">
      <select id="ch" style="width:auto"><option value="">All channels</option>${CH.map(c => opt(c, c)).join('')}</select>
      <select id="tg" style="width:auto"><option value="">All tags</option>${tags.map(t => opt(t.tag, `${t.tag} (${t.n})`)).join('')}</select><span id="tot" class="help"></span></div>
    <div class="card" style="padding:0"><table><thead><tr><th>Name</th><th>Channel</th><th>Email / phone</th><th>Tags</th><th>Last message</th></tr></thead><tbody id="tb"></tbody></table></div></div>`);
  const load = async () => {
    const { rows, total } = await api('GET', `/contacts?limit=500&q=${encodeURIComponent($('#q').value)}&channel=${$('#ch').value}&tag=${encodeURIComponent($('#tg').value)}`);
    $('#tot').textContent = `${total} contacts`;
    $('#tb').innerHTML = rows.map(c => `<tr class="click" data-id="${c.id}"><td><b>${esc(c.name || c.username || c.external_id)}</b>${c.username ? `<div class="help">@${esc(c.username)}</div>` : ''}</td><td>${chip(c.channel)}</td>
      <td>${esc(c.email || '')}<div class="help">${esc(c.phone || '')}</div></td><td>${c.tags.map(t => `<span class="pill acc">${esc(t)}</span>`).join('')}</td><td class="help">${ago(c.last_message_at)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No contacts</td></tr>';
    $$('#tb tr.click').forEach(tr => tr.onclick = () => { inboxSel = +tr.dataset.id; location.hash = '#/inbox'; });
  };
  $('#q').oninput = load; $('#ch').onchange = load; $('#tg').onchange = load; load();
}

// ---------- flows list ----------
async function pageFlows() {
  const [flows, tpls] = await Promise.all([api('GET', '/flows'), api('GET', '/templates')]);
  shell('flows', `<div class="page"><div class="row"><h1>Flows</h1><span class="sp"></span><button class="btn p" id="new">+ New flow</button></div><p class="sub">Conversations the bot runs. Attach them to triggers in Automations.</p>
    <div class="card" style="padding:0"><table><thead><tr><th>Name</th><th>Active triggers</th><th>Runs</th><th>Updated</th><th></th></tr></thead><tbody>
    ${flows.map(f => `<tr class="click" data-id="${f.id}"><td><b>${esc(f.name)}</b></td><td>${f.triggers}</td><td>${f.runs}</td><td class="help">${ago(f.updated_at)} ago</td>
      <td style="text-align:right"><button class="btn sm" data-dup="${f.id}">Duplicate</button> <button class="btn sm d" data-del="${f.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No flows yet — start from a template</td></tr>'}
    </tbody></table></div></div>`);
  $$('tr.click').forEach(tr => tr.onclick = e => { if (e.target.closest('button')) return; location.hash = '#/flows/' + tr.dataset.id; });
  $$('[data-dup]').forEach(b => b.onclick = async () => { await api('POST', `/flows/${b.dataset.dup}/duplicate`); route(); });
  $$('[data-del]').forEach(b => b.onclick = async () => { if (confirm('Delete flow? Triggers using it will stop.')) { await api('DELETE', `/flows/${b.dataset.del}`); route(); } });
  $('#new').onclick = () => modal(`<h2>New flow</h2><label>Name</label><input id="fn" placeholder="My flow"><label>Start from</label>
    <div class="item" style="cursor:pointer;padding:8px;border:2px solid var(--acc);border-radius:8px;margin:6px 0" data-t=""><b>Blank</b></div>
    ${tpls.map(t => `<div style="cursor:pointer;padding:8px;border:1px solid var(--line);border-radius:8px;margin:6px 0" data-t="${t.key}"><b>${esc(t.name)}</b><div class="help">${esc(t.description)}</div></div>`).join('')}
    <p></p><button class="btn p" id="cr">Create</button>`, (m, close) => {
    let t = ''; $$('[data-t]', m).forEach(d => d.onclick = () => { t = d.dataset.t; $$('[data-t]', m).forEach(x => x.style.border = '1px solid var(--line)'); d.style.border = '2px solid var(--acc)'; });
    $('#cr', m).onclick = async () => { const { id } = await api('POST', '/flows', { name: $('#fn', m).value || undefined, template: t || undefined }); close(); location.hash = '#/flows/' + id; };
  });
}

// ---------- automations (triggers) ----------
const TT = { keyword: 'DM keyword', comment: 'Post / Reel comment', story_reply: 'Story reply', welcome: 'Welcome (first message)', default: 'Default reply (no match)', ref: 'Ref link (ig.me / m.me / t.me)' };
async function pageAutomations() {
  const [trs, flows] = await Promise.all([api('GET', '/triggers'), api('GET', '/flows')]);
  shell('automations', `<div class="page"><div class="row"><h1>Automations</h1><span class="sp"></span><button class="btn p" id="new">+ New trigger</button></div>
    <p class="sub">What starts a flow. Higher priority wins when several match.</p>
    <div class="card" style="padding:0"><table><thead><tr><th>Name</th><th>Type</th><th>Channel</th><th>Keywords</th><th>Flow</th><th>Runs</th><th>On</th><th></th></tr></thead><tbody>
    ${trs.map(t => `<tr><td><b>${esc(t.name)}</b></td><td><span class="pill">${TT[t.type]}</span></td><td>${t.channel === 'any' ? 'All' : chip(t.channel)}</td>
      <td>${t.match_type === 'any' ? '<span class="pill">any text</span>' : t.keywords.map(k => `<span class="pill acc">${esc(k)}</span>`).join('')}${t.post_id ? `<div class="help">post: ${esc(t.post_id)}</div>` : ''}</td>
      <td>${esc(t.flow_name || '—')}</td><td>${t.runs}</td><td><input type="checkbox" style="width:auto" data-tog="${t.id}" ${t.active ? 'checked' : ''}></td>
      <td style="text-align:right"><button class="btn sm" data-ed="${t.id}">Edit</button> <button class="btn sm d" data-del="${t.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">No triggers yet</td></tr>'}</tbody></table></div></div>`);
  const edit = (t = { type: 'keyword', channel: 'any', match_type: 'contains', keywords: [], public_replies: [], priority: 0, active: 1 }) => modal(`<h2>${t.id ? 'Edit' : 'New'} trigger</h2>
    <label>Name</label><input id="n" value="${esc(t.name || '')}">
    <div class="row"><div style="flex:1"><label>Type</label><select id="ty">${Object.entries(TT).map(([k, v]) => opt(k, v, t.type)).join('')}</select></div>
      <div style="flex:1"><label>Channel</label><select id="ch">${opt('any', 'All channels', t.channel)}${CH.map(c => opt(c, c, t.channel)).join('')}</select></div></div>
    <div id="kwbox"><label>Match</label><select id="mt">${[['contains', 'Message contains keyword'], ['word', 'Contains keyword as whole word'], ['exact', 'Message is exactly'], ['starts', 'Starts with'], ['any', 'Any message']].map(([k, v]) => opt(k, v, t.match_type)).join('')}</select>
      <label id="kwl">Keywords (comma separated)</label><input id="kw" value="${esc(t.keywords.join(', '))}" placeholder="link, price, info"></div>
    <div id="cbox"><label>Post / media IDs (optional, comma separated — empty = all posts)</label><input id="pid" value="${esc(t.post_id || '')}">
      <label>Public comment replies (one per line, a random one is used)</label><textarea id="pr" placeholder="Sent! Check your DMs 📩">${esc(t.public_replies.join('\n'))}</textarea></div>
    <label>Flow to run</label><select id="fl"><option value="">—</option>${flows.map(f => opt(f.id, f.name, t.flow_id)).join('')}</select>
    <label>Priority</label><input id="pr2" type="number" value="${t.priority || 0}">
    <p></p><button class="btn p" id="sv">Save</button>`, (m, close) => {
    const sync = () => { const ty = $('#ty', m).value; $('#cbox', m).style.display = ty === 'comment' ? '' : 'none';
      $('#kwbox', m).style.display = ['welcome', 'default'].includes(ty) ? 'none' : ''; $('#mt', m).parentElement && ($('#mt', m).style.display = ty === 'ref' ? 'none' : '');
      $('#kwl', m).textContent = ty === 'ref' ? 'Ref codes (e.g. promo26 → t.me/yourbot?start=promo26, ig.me/m/you?ref=promo26)' : 'Keywords (comma separated)'; };
    $('#ty', m).onchange = sync; sync();
    $('#sv', m).onclick = async () => {
      const body = { name: $('#n', m).value, type: $('#ty', m).value, channel: $('#ch', m).value, match_type: $('#ty', m).value === 'ref' ? 'exact' : $('#mt', m).value,
        keywords: $('#kw', m).value.split(',').map(s => s.trim()).filter(Boolean), post_id: $('#pid', m).value.trim() || null,
        public_replies: $('#pr', m).value.split('\n').map(s => s.trim()).filter(Boolean), flow_id: +$('#fl', m).value || null, priority: +$('#pr2', m).value, active: t.active };
      if (!body.flow_id) return toast('Pick a flow');
      await api(t.id ? 'PUT' : 'POST', t.id ? `/triggers/${t.id}` : '/triggers', body); close(); route();
    };
  });
  $('#new').onclick = () => edit();
  $$('[data-ed]').forEach(b => b.onclick = () => edit(trs.find(t => t.id === +b.dataset.ed)));
  $$('[data-del]').forEach(b => b.onclick = async () => { if (confirm('Delete trigger?')) { await api('DELETE', `/triggers/${b.dataset.del}`); route(); } });
  $$('[data-tog]').forEach(b => b.onchange = async () => { const t = trs.find(x => x.id === +b.dataset.tog); await api('PUT', `/triggers/${t.id}`, { ...t, active: b.checked }); });
}

// ---------- sequences ----------
async function pageSequences() {
  const [seqs, flows] = await Promise.all([api('GET', '/sequences'), api('GET', '/flows')]);
  shell('sequences', `<div class="page"><div class="row"><h1>Sequences</h1><span class="sp"></span><button class="btn p" id="new">+ New sequence</button></div>
    <p class="sub">Drip campaigns. Enroll with an Action node (“Subscribe to sequence”) or from the inbox. Note: Meta channels only deliver within 24h of the user's last message.</p>
    <div class="card" style="padding:0"><table><thead><tr><th>Name</th><th>Steps</th><th>Active</th><th>Completed</th><th></th></tr></thead><tbody>
    ${seqs.map(s => `<tr><td><b>${esc(s.name)}</b> ${s.active ? '' : '<span class="pill">paused</span>'}</td><td>${s.steps.map(st => `<span class="pill">+${st.amount}${st.unit} → ${esc(flows.find(f => f.id === +st.flow_id)?.name || '?')}</span>`).join(' ')}</td>
      <td>${s.active_count}</td><td>${s.completed_count}</td><td style="text-align:right"><button class="btn sm" data-ed="${s.id}">Edit</button> <button class="btn sm d" data-del="${s.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No sequences</td></tr>'}</tbody></table></div></div>`);
  const edit = (s = { name: '', steps: [{ amount: 1, unit: 'd', flow_id: '' }], active: 1 }) => modal(`<h2>${s.id ? 'Edit' : 'New'} sequence</h2><label>Name</label><input id="n" value="${esc(s.name)}">
    <label>Steps (delay is from the previous step)</label><div id="st"></div><button class="btn sm" id="add">+ Step</button>
    <label><input type="checkbox" id="ac" style="width:auto" ${s.active ? 'checked' : ''}> Active</label><p></p><button class="btn p" id="sv">Save</button>`, (m, close) => {
    const steps = s.steps.map(x => ({ ...x }));
    const draw = () => { $('#st', m).innerHTML = steps.map((x, i) => `<div class="row" style="margin:4px 0"><input type="number" min="0" value="${x.amount}" data-i="${i}" data-k="amount" style="width:70px">
      <select data-i="${i}" data-k="unit" style="width:90px">${[['m', 'minutes'], ['h', 'hours'], ['d', 'days']].map(([k, v]) => opt(k, v, x.unit)).join('')}</select>
      <select data-i="${i}" data-k="flow_id" style="flex:1"><option value="">flow…</option>${flows.map(f => opt(f.id, f.name, x.flow_id)).join('')}</select><button class="btn sm d" data-rm="${i}">×</button></div>`).join('');
      $$('[data-k]', m).forEach(el => el.onchange = () => steps[el.dataset.i][el.dataset.k] = el.value);
      $$('[data-rm]', m).forEach(b => b.onclick = () => { steps.splice(+b.dataset.rm, 1); draw(); }); };
    draw(); $('#add', m).onclick = () => { steps.push({ amount: 1, unit: 'd', flow_id: '' }); draw(); };
    $('#sv', m).onclick = async () => { await api(s.id ? 'PUT' : 'POST', s.id ? `/sequences/${s.id}` : '/sequences', { name: $('#n', m).value, steps, active: $('#ac', m).checked }); close(); route(); };
  });
  $('#new').onclick = () => edit();
  $$('[data-ed]').forEach(b => b.onclick = () => edit(seqs.find(s => s.id === +b.dataset.ed)));
  $$('[data-del]').forEach(b => b.onclick = async () => { if (confirm('Delete sequence?')) { await api('DELETE', `/sequences/${b.dataset.del}`); route(); } });
}

// ---------- broadcasts ----------
async function pageBroadcasts() {
  const [bs, flows, tags] = await Promise.all([api('GET', '/broadcasts'), api('GET', '/flows'), api('GET', '/tags')]);
  shell('broadcasts', `<div class="page"><div class="row"><h1>Broadcasts</h1><span class="sp"></span><button class="btn p" id="new">+ New broadcast</button></div>
    <p class="sub">Send a flow to a segment. Instagram/Messenger/WhatsApp contacts outside the 24-hour window are skipped (WhatsApp needs approved templates for those — use WhatsApp Manager).</p>
    <div class="card" style="padding:0"><table><thead><tr><th>Name</th><th>Flow</th><th>Status</th><th>Audience</th><th>Sent</th><th>Skipped</th><th>Failed</th><th></th></tr></thead><tbody>
    ${bs.map(b => `<tr><td><b>${esc(b.name)}</b><div class="help">${b.scheduled_at ? 'scheduled ' + new Date(b.scheduled_at * 1000).toLocaleString() : ''}</div></td><td>${esc(b.flow_name || '—')}</td>
      <td><span class="pill ${b.status === 'sent' ? 'ok' : b.status === 'sending' ? 'warn' : ''}">${b.status}</span></td><td>${b.total}</td><td>${b.sent}</td><td>${b.skipped}</td><td>${b.failed}</td>
      <td style="text-align:right">${b.status === 'scheduled' ? `<button class="btn sm" data-cx="${b.id}">Cancel</button>` : ''} <button class="btn sm d" data-del="${b.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">No broadcasts</td></tr>'}</tbody></table></div></div>`);
  $('#new').onclick = () => modal(`<h2>New broadcast</h2><label>Name</label><input id="n"><label>Flow to send</label><select id="fl">${flows.map(f => opt(f.id, f.name)).join('')}</select>
    <label>Channel</label><select id="ch">${opt('any', 'All channels')}${CH.map(c => opt(c, c)).join('')}</select>
    <label>Has ANY of tags</label><select id="ta" multiple size="4">${tags.map(t => opt(t.tag, t.tag)).join('')}</select>
    <label>Exclude tags</label><select id="tn" multiple size="3">${tags.map(t => opt(t.tag, t.tag)).join('')}</select>
    <label>Schedule (empty = send now)</label><input type="datetime-local" id="at">
    <p id="aud" class="help"></p><button class="btn p" id="sv">Send</button>`, (m, close) => {
    const seg = () => ({ channel: $('#ch', m).value, tags_any: [...$('#ta', m).selectedOptions].map(o => o.value), tags_none: [...$('#tn', m).selectedOptions].map(o => o.value) });
    const aud = async () => { const a = await api('POST', '/broadcasts/audience', seg()); $('#aud', m).textContent = `${a.total} contacts match · ${a.eligible} reachable now`; };
    $$('select', m).forEach(s => s.onchange = aud); aud();
    $('#sv', m).onclick = async () => { if (!confirm('Send this broadcast?')) return; await api('POST', '/broadcasts', { name: $('#n', m).value, flow_id: +$('#fl', m).value, segment: seg(), scheduled_at: $('#at', m).value || null }); close(); setTimeout(route, 600); };
  });
  $$('[data-del]').forEach(b => b.onclick = async () => { await api('DELETE', `/broadcasts/${b.dataset.del}`); route(); });
  $$('[data-cx]').forEach(b => b.onclick = async () => { await api('POST', `/broadcasts/${b.dataset.cx}/cancel`); route(); });
}

// ---------- settings ----------
async function pageSettings(tab = 'channels') {
  const s = await api('GET', '/settings');
  const c = s.channels || {}; const v = (o, k) => esc(o?.[k] || '');
  const tabs = [['channels', 'Channels'], ['ai', 'AI'], ['widget', 'Web chat widget'], ['team', 'Team'], ['api', 'API']];
  let body = '';
  if (tab === 'channels') body = `
    <div class="card"><h2>General</h2><label>Public URL of this server (https, used for webhooks)</label><input id="pub" value="${esc(s.general?.public_url || '')}" placeholder="https://bot.yourdomain.com"></div><p></p>
    <div class="card"><h2>Meta app (Instagram · Messenger · WhatsApp)</h2>
      <label>Webhook callback URL</label><code>${esc(s.urls.meta_webhook)}</code>
      <div class="row"><div style="flex:1"><label>Verify token</label><input id="m_vt" value="${v(c.meta, 'verify_token')}"></div><div style="flex:1"><label>App secret (validates webhook signatures)</label><input id="m_as" value="${v(c.meta, 'app_secret')}"></div></div>
      <p class="help">Subscribe: Instagram → <code>messages, messaging_postbacks, comments</code> · Page → <code>messages, messaging_postbacks, messaging_referrals, feed</code> · WhatsApp → <code>messages</code></p></div><p></p>
    <div class="grid g2">
    <div class="card"><h2>${chip('instagram')} Instagram</h2><label>Login type</label><select id="ig_lt">${opt('instagram', 'Instagram Login (graph.instagram.com)', c.instagram?.login_type)}${opt('facebook', 'Facebook Login via Page (graph.facebook.com)', c.instagram?.login_type)}</select>
      <label>Instagram professional account ID</label><input id="ig_id" value="${v(c.instagram, 'ig_user_id')}"><label>Access token</label><input id="ig_tok" value="${v(c.instagram, 'access_token')}">
      <p></p><button class="btn sm" data-test="instagram">Test connection</button></div>
    <div class="card"><h2>${chip('messenger')} Facebook Messenger</h2><label>Page ID</label><input id="fb_id" value="${v(c.messenger, 'page_id')}"><label>Page access token</label><input id="fb_tok" value="${v(c.messenger, 'page_access_token')}">
      <p></p><button class="btn sm" data-test="messenger">Test connection</button></div>
    <div class="card"><h2>${chip('whatsapp')} WhatsApp Cloud API</h2><label>Phone number ID</label><input id="wa_id" value="${v(c.whatsapp, 'phone_number_id')}"><label>Access token (system user, permanent)</label><input id="wa_tok" value="${v(c.whatsapp, 'access_token')}">
      <p></p><button class="btn sm" data-test="whatsapp">Test connection</button></div>
    <div class="card"><h2>${chip('telegram')} Telegram</h2><label>Bot token (from @BotFather)</label><input id="tg_tok" value="${v(c.telegram, 'bot_token')}">
      <label>Mode</label><select id="tg_mode">${opt('polling', 'Long polling (works without a public URL)', c.telegram?.mode)}${opt('webhook', 'Webhook (needs Public URL)', c.telegram?.mode)}</select>
      <p></p><div class="row"><button class="btn sm" data-test="telegram">Test connection</button><button class="btn sm" id="tgwh">Register webhook</button></div></div>
    </div><p></p><button class="btn p" id="sv">Save channels</button>`;
  if (tab === 'ai') body = `<div class="card" style="max-width:640px"><h2>AI provider (bring your own key)</h2><p class="help">Any OpenAI-compatible API: OpenAI <code>https://api.openai.com/v1</code>, OpenRouter <code>https://openrouter.ai/api/v1</code>, Groq <code>https://api.groq.com/openai/v1</code>, local Ollama <code>http://localhost:11434/v1</code>.</p>
    <label>Base URL</label><input id="ai_url" value="${esc(s.ai?.base_url || 'https://api.openai.com/v1')}"><label>API key</label><input id="ai_key" value="${esc(s.ai?.api_key || '')}"><label>Default model</label><input id="ai_model" value="${esc(s.ai?.model || 'gpt-4o-mini')}">
    <p></p><div class="row"><button class="btn p" id="sv">Save</button><button class="btn" data-test="ai">Test</button></div></div>`;
  if (tab === 'widget') body = `<div class="card" style="max-width:760px"><h2>Embed the web chat on any site</h2><p class="help">Paste before &lt;/body&gt;. Web chat has no 24-hour limit and is the easiest channel to test flows on.</p>
    <code>&lt;script src="${esc(s.urls.widget)}" data-title="Chat with us" data-color="#b0298f" async&gt;&lt;/script&gt;</code>
    <p class="help">Ref triggers: add <code>data-ref="promo26"</code> to start a specific flow on that page.</p><p><a href="/widget-demo.html" target="_blank">Open widget demo page ↗</a></p></div>`;
  if (tab === 'team') { const users = await api('GET', '/users'); body = `<div class="card" style="max-width:640px"><h2>Team</h2><table>${users.map(u => `<tr><td>${esc(u.name || '')}</td><td>${esc(u.email)}</td><td><span class="pill">${u.role}</span></td><td><button class="btn sm d" data-du="${u.id}">Remove</button></td></tr>`).join('')}</table>
    <h2 style="margin-top:16px">Add agent</h2><div class="row"><input id="un" placeholder="Name" style="flex:1"><input id="ue" placeholder="Email" style="flex:1"><input id="up" placeholder="Password (8+)" type="password" style="flex:1"><button class="btn p" id="ua">Add</button></div></div>`; }
  if (tab === 'api') body = `<div class="card" style="max-width:760px"><h2>REST API</h2><p class="help">Send <code>Authorization: Bearer &lt;key&gt;</code> to any <code>/api/*</code> endpoint (e.g. <code>GET /api/contacts</code>, <code>POST /api/contacts/:id/send {"text"|"flow_id"}</code>, <code>POST /api/contacts/:id/enroll</code>). Use it from n8n, Make or Zapier.</p>
    <p>Current key: <code>${esc(s.api_key || 'none')}</code></p><button class="btn p" id="gk">Generate new key</button><p id="nk"></p></div>`;
  shell('settings', `<div class="page"><h1>Settings</h1><p></p><div class="tabs">${tabs.map(([k, l]) => `<a href="#/settings/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>${body}</div>`);
  $$('[data-test]').forEach(b => b.onclick = async () => { try { const r = await api('POST', `/settings/test/${b.dataset.test}`); toast('✅ Connected: ' + JSON.stringify(r.result).slice(0, 120)); } catch (e) { toast('❌ ' + e.message); } });
  if (tab === 'channels') {
    $('#sv').onclick = async () => {
      await api('PUT', '/settings', { general: { ...s.general, public_url: $('#pub').value.replace(/\/$/, '') }, channels: { ...c,
        meta: { ...c.meta, verify_token: $('#m_vt').value, app_secret: $('#m_as').value },
        instagram: { ...c.instagram, login_type: $('#ig_lt').value, ig_user_id: $('#ig_id').value, access_token: $('#ig_tok').value },
        messenger: { ...c.messenger, page_id: $('#fb_id').value, page_access_token: $('#fb_tok').value },
        whatsapp: { ...c.whatsapp, phone_number_id: $('#wa_id').value, access_token: $('#wa_tok').value },
        telegram: { ...c.telegram, bot_token: $('#tg_tok').value, mode: $('#tg_mode').value } } });
      toast('Saved'); pageSettings('channels');
    };
    $('#tgwh').onclick = async () => { try { await api('POST', '/settings/telegram-webhook'); toast('Telegram webhook registered'); } catch (e) { toast(e.message); } };
  }
  if (tab === 'ai') $('#sv').onclick = async () => { await api('PUT', '/settings', { ai: { base_url: $('#ai_url').value, api_key: $('#ai_key').value, model: $('#ai_model').value } }); toast('Saved'); };
  if (tab === 'team') { $('#ua').onclick = async () => { try { await api('POST', '/users', { name: $('#un').value, email: $('#ue').value, password: $('#up').value }); pageSettings('team'); } catch (e) { toast(e.message); } };
    $$('[data-du]').forEach(b => b.onclick = async () => { try { await api('DELETE', `/users/${b.dataset.du}`); pageSettings('team'); } catch (e) { toast(e.message); } }); }
  if (tab === 'api') $('#gk').onclick = async () => { const r = await api('POST', '/settings/api-key'); $('#nk').innerHTML = `New key (copy now, shown once): <code>${esc(r.api_key)}</code>`; };
}

// ---------- router ----------
async function route() {
  const [, page, arg] = (location.hash || '#/dashboard').split('/');
  if (page === 'login') return pageLogin();
  try { await api('GET', '/me'); } catch { return; }
  openStream();
  const pages = { dashboard: pageDashboard, inbox: pageInbox, contacts: pageContacts, flows: arg ? () => window.FlowBuilder.open(+arg) : pageFlows, automations: pageAutomations, sequences: pageSequences, broadcasts: pageBroadcasts, settings: () => pageSettings(arg) };
  try { await (pages[page] || pageDashboard)(); } catch (e) { toast(e.message); }
}
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
