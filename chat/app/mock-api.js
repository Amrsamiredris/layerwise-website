// Layerwise Chat — in-browser DEMO backend.
// Replaces the real server for the website demo: intercepts fetch('/api/...') and EventSource('/api/...'),
// keeps demo data in memory (+ sessionStorage), and runs flows client-side. Nothing is sent to any platform.
(function () {
  const now = () => Math.floor(Date.now() / 1000);
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = a => a[rnd(0, a.length - 1)];
  const clone = o => JSON.parse(JSON.stringify(o));
  const KEY = 'lwchat_demo_v1';

  // ---------------- templates (same as the real platform) ----------------
  const TEMPLATES = {
    comment_to_dm: { name: 'Comment → DM with link (follow gate)', description: 'User comments a keyword; bot DMs them a button, checks they follow you (Instagram), then sends the link.', start: 'n1', nodes: {
      n1: { type: 'message', x: 60, y: 60, text: "Hey {{first_name|there}}! 👋 Thanks for the comment. Tap below and I'll send you the link.", buttons: [{ title: 'Send me the link', next: 'n2' }], quick_replies: [] },
      n2: { type: 'condition', x: 380, y: 60, match: 'all', rules: [{ op: 'ig_follows' }], yes: 'n3', no: 'n4' },
      n3: { type: 'message', x: 700, y: 20, text: 'Here you go 🎁', buttons: [{ title: 'Open link', url: 'https://example.com' }], quick_replies: [], next: 'n5' },
      n4: { type: 'message', x: 700, y: 240, text: 'This one is for followers only 🙏 Follow the account, then tap the button.', buttons: [{ title: "I'm following ✅", next: 'n2' }], quick_replies: [] },
      n5: { type: 'action', x: 1020, y: 20, ops: [{ type: 'add_tag', value: 'lead-magnet' }] } } },
    lead_capture: { name: 'Lead capture (email + phone)', description: 'Asks for email and phone with validation, tags the contact, and posts the lead to a webhook.', start: 'n1', nodes: {
      n1: { type: 'question', x: 60, y: 60, text: "What's the best email to send it to?", validation: 'email', save_to: 'email', retry_text: "Hmm, that email doesn't look right. Try again?", max_tries: 3, next: 'n2' },
      n2: { type: 'question', x: 380, y: 60, text: 'And your phone number (with country code)?', validation: 'phone', save_to: 'phone', options: [], next: 'n3' },
      n3: { type: 'action', x: 700, y: 60, ops: [{ type: 'add_tag', value: 'lead' }, { type: 'notify', value: 'New lead: {{email}} {{phone}}' }], next: 'n4' },
      n4: { type: 'message', x: 1020, y: 60, text: "Thanks {{first_name|}}! You're on the list ✅", buttons: [], quick_replies: [] } } },
    welcome_menu: { name: 'Welcome menu', description: 'Greets new contacts with a menu of options and routes to a human on request.', start: 'n1', nodes: {
      n1: { type: 'message', x: 60, y: 60, text: 'Welcome {{first_name|}}! How can we help?', buttons: [], quick_replies: [{ title: 'Pricing', next: 'n2' }, { title: 'Book a call', next: 'n3' }, { title: 'Talk to a human', next: 'n4' }] },
      n2: { type: 'message', x: 400, y: 0, text: 'Our plans start at AED 69/month. Full details:', buttons: [{ title: 'See pricing', url: 'https://layerwise-website.vercel.app/chat/#pricing' }], quick_replies: [] },
      n3: { type: 'message', x: 400, y: 180, text: 'Pick a time that works for you:', buttons: [{ title: 'Book now', url: 'https://layerwise-website.vercel.app/chat/#contact' }], quick_replies: [] },
      n4: { type: 'action', x: 400, y: 360, ops: [{ type: 'human_takeover' }, { type: 'notify', value: '{{name}} wants a human' }], next: 'n5' },
      n5: { type: 'message', x: 720, y: 360, text: 'Got it — a team member will reply here shortly.', buttons: [], quick_replies: [] } } },
    ai_assistant: { name: 'AI assistant (BYO key)', description: 'Answers free-text questions with your LLM until the user types "human".', start: 'n1', nodes: {
      n1: { type: 'ai', x: 60, y: 60, mode: 'conversation', system_prompt: 'You are the assistant for our business. Answer briefly and only from the knowledge below.', knowledge: 'Opening hours: 9am–6pm.\nLocation: Dubai.\nDelivery: across the UAE within 48h.', history: 10, exit_keywords: ['human', 'agent', 'stop'], fallback: 'Sorry, I could not answer that. Type "human" to reach the team.', next: 'n2' },
      n2: { type: 'action', x: 400, y: 60, ops: [{ type: 'human_takeover' }], next: 'n3' },
      n3: { type: 'message', x: 720, y: 60, text: 'Connecting you to a human 👤', buttons: [], quick_replies: [] } } },
  };

  // ---------------- seed ----------------
  function seed() {
    const D = { seq: 100, flows: [], triggers: [], sequences: [], broadcasts: [], contacts: [], messages: [], events: {}, users: [{ id: 1, email: 'demo@layerwise.ai', name: 'Demo Admin', role: 'admin', created_at: now() - 86400 * 30 }], settings: { channels: { meta: { verify_token: 'demo-verify-token' }, instagram: { login_type: 'instagram', ig_user_id: '17841400000000000', access_token: '••••demo' }, messenger: { page_id: '100000000000000', page_access_token: '••••demo' }, whatsapp: { phone_number_id: '200000000000000', access_token: '••••demo' }, telegram: { bot_token: '••••demo', mode: 'polling' } }, ai: { base_url: 'https://api.openai.com/v1', api_key: '••••demo', model: 'gpt-4o-mini' }, general: { public_url: 'https://app.yourbrand.com' } } };
    const id = () => ++D.seq;
    const fid = {};
    for (const [k, t] of Object.entries(TEMPLATES)) { const f = { id: id(), name: t.name, nodes: clone(t.nodes), start_node: t.start, updated_at: now() - rnd(3600, 86400 * 5) }; D.flows.push(f); fid[k] = f.id; }
    const T = (name, type, channel, match_type, keywords, flow, runs, public_replies = [], post_id = null) => D.triggers.push({ id: id(), name, type, channel, match_type, keywords, public_replies, post_id, flow_id: flow, priority: 0, active: 1, runs });
    T('Reel: "GUIDE" → free guide', 'comment', 'instagram', 'word', ['guide', 'دليل'], fid.comment_to_dm, 1284, ['Sent! Check your DMs 📩', 'Done ✅ check your inbox']);
    T('FB post: "INFO" → Messenger', 'comment', 'messenger', 'word', ['info'], fid.welcome_menu, 336, ['Sent you a message 💬']);
    T('DM keyword PRICE', 'keyword', 'any', 'contains', ['price', 'pricing', 'سعر', 'كم'], fid.welcome_menu, 412);
    T('Join waitlist (WhatsApp ad)', 'keyword', 'whatsapp', 'exact', ['join'], fid.lead_capture, 268);
    T('Telegram promo link', 'ref', 'telegram', 'exact', ['promo26'], fid.welcome_menu, 190);
    T('Welcome new contacts', 'welcome', 'any', 'any', [], fid.welcome_menu, 903);
    T('AI fallback', 'default', 'any', 'any', [], fid.ai_assistant, 377);
    D.sequences.push({ id: id(), name: 'Lead nurture (3 days)', steps: [{ amount: 1, unit: 'h', flow_id: fid.welcome_menu }, { amount: 1, unit: 'd', flow_id: fid.lead_capture }], active: 1, active_count: 37, completed_count: 112 });
    const names = ['Sara Al Mansoori', 'Omar Haddad', 'Lina Farouk', 'Ahmed Nabil', 'Mariam Khalid', 'Yousef Salem', 'Nour Hassan', 'Karim Adel', 'Hala Saeed', 'Rami Aziz', 'Dana Qasem', 'Ali Rashid', 'Fatima Zahra', 'Hassan Tarek', 'Reem Ali', 'Tariq Jaber', 'Layla Mostafa', 'Ziad Kamal', 'Aya Ibrahim', 'Khaled Fouad', 'Jana Sami', 'Majed Hamdan', 'Salma Gamal', 'Faisal Noor'];
    const chans = ['instagram', 'whatsapp', 'messenger', 'instagram', 'telegram', 'whatsapp', 'web', 'instagram'];
    const convos = {
      instagram: [['💬 Comment: GUIDE please 🙏', 'in'], ["Hey {f}! 👋 Thanks for the comment. Tap below and I'll send you the link.", 'out', { buttons: [{ title: 'Send me the link' }] }], ['Send me the link', 'in'], ['Here you go 🎁', 'out', { buttons: [{ title: 'Open link', url: 'https://example.com' }] }]],
      whatsapp: [['JOIN', 'in'], ["What's the best email to send it to?", 'out'], ['{e}', 'in'], ['And your phone number (with country code)?', 'out'], ['+971 50 123 4567', 'in'], ["Thanks {f}! You're on the list ✅", 'out']],
      messenger: [['💬 Comment: info', 'in'], ['Welcome {f}! How can we help?', 'out', { quick_replies: [{ title: 'Pricing' }, { title: 'Book a call' }, { title: 'Talk to a human' }] }], ['Pricing', 'in'], ['Our plans start at AED 69/month. Full details:', 'out', { buttons: [{ title: 'See pricing', url: '#' }] }]],
      telegram: [['/start promo26', 'in'], ['Welcome {f}! How can we help?', 'out', { quick_replies: [{ title: 'Pricing' }, { title: 'Book a call' }, { title: 'Talk to a human' }] }], ['Book a call', 'in'], ['Pick a time that works for you:', 'out', { buttons: [{ title: 'Book now', url: '#' }] }]],
      web: [['Do you deliver to Abu Dhabi?', 'in'], ['🤖 Yes — we deliver across the UAE within 48 hours.', 'out', null, 'ai'], ['human', 'in'], ['Connecting you to a human 👤', 'out']],
    };
    names.forEach((name, i) => {
      const ch = chans[i % chans.length]; const first = name.split(' ')[0];
      const created = now() - rnd(1, 13) * 86400 - rnd(0, 70000);
      const email = Math.random() < .55 ? `${first.toLowerCase()}@${pick(['gmail.com', 'outlook.com', 'company.ae'])}` : null;
      const c = { id: id(), channel: ch, external_id: 'demo' + i, name, first_name: first, username: ch === 'instagram' ? first.toLowerCase() + '.' + rnd(10, 99) : null, email,
        phone: ch === 'whatsapp' ? '+9715' + rnd(10000000, 99999999) : null, tags: [...new Set([pick(['lead', 'lead-magnet', 'customer', 'vip', 'webinar']), ...(Math.random() < .4 ? ['abu-dhabi'] : [])])],
        fields: Math.random() < .5 ? { city: pick(['Dubai', 'Abu Dhabi', 'Cairo', 'Riyadh']), budget: pick(['<5k', '5-20k', '20k+']) } : {}, state: null, subscribed: 1,
        human_takeover: ch === 'web' && i % 2 ? 1 : 0, unread: i < 5 ? rnd(1, 3) : 0, created_at: created, last_inbound_at: created + 3600, last_message_at: now() - i * rnd(2000, 9000) };
      D.contacts.push(c);
      let t = created;
      for (const [txt, dir, payload, sender] of convos[ch]) { t += rnd(5, 90);
        D.messages.push({ id: id(), contact_id: c.id, direction: dir, sender: sender || (dir === 'in' ? 'contact' : 'bot'), text: txt.replace('{f}', first).replace('{e}', email || first.toLowerCase() + '@gmail.com'), payload: payload || null, status: 'ok', created_at: t }); }
      if (c.human_takeover) D.messages.push({ id: id(), contact_id: c.id, direction: 'out', sender: 'agent:Amr', text: `Hi ${first}, Amr here — happy to help!`, payload: null, status: 'ok', created_at: t + 300 });
    });
    D.daily = []; for (let d = 13; d >= 0; d--) { const n = 30 + (13 - d) * 7 + rnd(0, 20); const inn = Math.round(n * .45); D.daily.push({ d: new Date((now() - d * 86400) * 1000).toISOString().slice(0, 10), inbound: inn, outbound: n - inn }); }
    D.broadcasts.push({ id: id(), name: 'Ramadan offer', flow_id: fid.welcome_menu, segment: { channel: 'any', tags_any: ['lead'] }, status: 'sent', total: 2140, sent: 1876, skipped: 251, failed: 13, created_at: now() - 3 * 86400, scheduled_at: null });
    D.broadcasts.push({ id: id(), name: 'Webinar reminder', flow_id: fid.lead_capture, segment: { channel: 'telegram' }, status: 'scheduled', total: 0, sent: 0, skipped: 0, failed: 0, created_at: now(), scheduled_at: now() + 2 * 86400 });
    for (const f of D.flows) { D.events[f.id] = { runs: rnd(120, 1400), nodes: {} }; for (const n of Object.keys(f.nodes)) D.events[f.id].nodes[n] = rnd(60, 1200); }
    return D;
  }
  let D; try { D = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { D = null; } if (!D || !D.flows) D = seed();
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(D)); } catch (e) {} };
  const nid = () => ++D.seq;

  // ---------------- realtime (fake EventSource) ----------------
  const listeners = {};
  const emit = (ch, data) => (listeners[ch] || []).forEach(es => es.onmessage && es.onmessage({ data: JSON.stringify(data) }));
  const NativeES = window.EventSource;
  window.EventSource = function (url) {
    if (!String(url).startsWith('/api/')) return new NativeES(url);
    const m = String(url).match(/^\/api\/web\/([^/]+)\/stream/); const ch = m ? 'web:' + m[1] : 'inbox';
    const es = { url, close() { listeners[ch] = (listeners[ch] || []).filter(x => x !== es); } };
    (listeners[ch] = listeners[ch] || []).push(es);
    setTimeout(() => es.onopen && es.onopen(), 30);
    return es;
  };

  // ---------------- client-side flow runner ----------------
  const getC = id => D.contacts.find(c => c.id === +id);
  const getF = id => D.flows.find(f => f.id === +id);
  const render = (tpl, c, ctx = {}) => tpl == null ? tpl : String(tpl).replace(/\{\{\s*([\w.]+)\s*(?:\|\s*([^}]*))?\}\}/g, (_, k, fb) => {
    let v = k === 'last_input' ? ctx.input : k.startsWith('field.') ? c.fields[k.slice(6)] : (k in c && typeof c[k] !== 'object') ? c[k] : c.fields[k];
    return v == null || v === '' ? (fb || '').trim() : String(v); });
  const enc = (f, n, i, k) => `FDM|${f}|${n}|${k}${i}`;
  const dec = p => { if (!p || !String(p).startsWith('FDM|')) return null; const [, f, n, k] = String(p).split('|'); return { flowId: +f, nodeId: n, kind: k[0], idx: +k.slice(1) }; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function log(c, dir, text, payload, sender) {
    const m = { id: nid(), contact_id: c.id, direction: dir, sender: sender || (dir === 'in' ? 'contact' : 'bot'), text, payload: payload || null, status: 'ok', created_at: now() };
    D.messages.push(m); c.last_message_at = m.created_at; if (dir === 'in') { c.unread = (c.unread || 0) + 1; c.last_inbound_at = m.created_at; }
    save(); emit('inbox', { contact_id: c.id });
  }
  async function deliver(c, msg, sender) {
    await sleep(450);
    log(c, 'out', msg.text || '[image]', msg, sender);
    if (c.channel === 'web') emit('web:' + c.external_id, { type: 'message', message: msg });
  }
  async function evalRule(r, c) {
    const fv = (r.field in c && typeof c[r.field] !== 'object') ? c[r.field] : c.fields[r.field];
    const s = x => String(x ?? '').toLowerCase();
    switch (r.op) { case 'has_tag': return c.tags.includes(r.value); case 'not_has_tag': return !c.tags.includes(r.value);
      case 'eq': return s(fv) === s(r.value); case 'neq': return s(fv) !== s(r.value); case 'contains': return s(fv).includes(s(r.value));
      case 'gt': return +fv > +r.value; case 'lt': return +fv < +r.value; case 'is_set': return fv != null && fv !== ''; case 'not_set': return fv == null || fv === '';
      case 'channel_is': return c.channel === r.value; case 'ig_follows': return true; default: return false; }
  }
  async function runActions(ops, c, ctx) {
    for (const op of ops || []) switch (op.type) {
      case 'add_tag': if (op.value && !c.tags.includes(op.value)) c.tags.push(op.value); break;
      case 'remove_tag': c.tags = c.tags.filter(t => t !== op.value); break;
      case 'set_field': { const v = render(op.value, c, ctx); if (['email', 'phone', 'name', 'first_name'].includes(op.field)) c[op.field] = v; else c.fields[op.field] = v; break; }
      case 'clear_field': delete c.fields[op.field]; break;
      case 'human_takeover': c.human_takeover = 1; emit('inbox', { contact_id: c.id, alert: 'takeover' }); break;
      case 'notify': emit('inbox', { notify: { text: render(op.value, c, ctx) } }); break;
      case 'unsubscribe': c.subscribed = 0; break; case 'subscribe': c.subscribed = 1; break;
    }
    save();
  }
  function fakeAI(node, c, input) {
    const k = (node.knowledge || '').split('\n').filter(Boolean); const q = String(input || '').toLowerCase();
    const hit = k.find(l => l.toLowerCase().split(/[:\s]+/).some(w => w.length > 3 && q.includes(w)));
    return '🤖 ' + (hit ? hit.replace(/^[^:]+:\s*/, '') + ' (demo: answered from the knowledge box)' : (node.fallback || "I'm not sure — type \"human\" to reach the team.") + ' (demo: in production your AI model answers here)');
  }
  async function runFlow(cid, flowId, nodeId, ctx = {}) {
    const f = getF(flowId); if (!f) return; let cur = nodeId || f.start_node; const c = getC(cid);
    if (D.events[f.id]) D.events[f.id].runs += nodeId ? 0 : 1;
    for (let step = 0; cur && step < 60; step++) {
      const n = f.nodes[cur]; if (!n) break;
      D.events[f.id] = D.events[f.id] || { runs: 0, nodes: {} }; D.events[f.id].nodes[cur] = (D.events[f.id].nodes[cur] || 0) + 1;
      switch (n.type) {
        case 'message': {
          const buttons = (n.buttons || []).map((b, i) => b.url ? { title: render(b.title, c, ctx), url: b.url } : { title: render(b.title, c, ctx), payload: enc(f.id, cur, i, 'b') });
          const quick_replies = (n.quick_replies || []).map((q, i) => ({ title: render(q.title, c, ctx), payload: enc(f.id, cur, i, 'q') }));
          await deliver(c, { text: render(n.text, c, ctx), image_url: n.image_url || undefined, buttons, quick_replies });
          if ((n.buttons || []).some(b => !b.url) || quick_replies.length) { c.state = { awaiting: 'choice', flow_id: f.id, node_id: cur }; save(); return; }
          cur = n.next; break; }
        case 'question': {
          const quick_replies = (n.options || []).map((o, i) => ({ title: o, payload: enc(f.id, cur, i, 'o') }));
          await deliver(c, { text: render(n.text, c, ctx), quick_replies }); c.state = { awaiting: 'input', flow_id: f.id, node_id: cur, tries: 0 }; save(); return; }
        case 'condition': { const rs = []; for (const r of n.rules || []) rs.push(await evalRule(r, c)); cur = (!rs.length || (n.match === 'any' ? rs.some(Boolean) : rs.every(Boolean))) ? n.yes : n.no; break; }
        case 'action': await runActions(n.ops, c, ctx); cur = n.next; break;
        case 'delay': await deliver(c, { text: `⏱ (demo: waiting ${n.amount} ${({ s: 'seconds', m: 'minutes', h: 'hours', d: 'days' })[n.unit || 'm']} is shortened to 2 seconds)` }, 'system'); await sleep(2000); cur = n.next; break;
        case 'http': await deliver(c, { text: `🌐 (demo: ${n.method || 'GET'} ${n.url} → 200 OK)` }, 'system'); cur = n.next; break;
        case 'ai': await deliver(c, { text: fakeAI(n, c, ctx.input) }, 'ai'); if (n.mode === 'conversation') { c.state = { awaiting: 'ai', flow_id: f.id, node_id: cur }; save(); return; } cur = n.next; break;
        case 'random': { const br = n.branches || []; cur = br.length ? br[rnd(0, br.length - 1)].next : null; break; }
        case 'goto': return runFlow(cid, +n.flow_id, null, ctx);
        default: cur = n.next;
      }
    }
    c.state = null; save();
  }
  const valid = { any: () => true, email: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), phone: v => /^\+?[\d\s().-]{7,20}$/.test(v), number: v => v !== '' && !isNaN(+v) };
  async function inbound(c, text, payload) {
    if (c.human_takeover) return;
    const p = dec(payload); const st = c.state;
    if (p && p.kind !== 'o') { const f = getF(p.flowId); const node = f && f.nodes[p.nodeId]; const b = node && (p.kind === 'q' ? node.quick_replies : node.buttons)[p.idx]; c.state = null;
      if (b && b.tag && !c.tags.includes(b.tag)) c.tags.push(b.tag); if (b && b.next) return runFlow(c.id, p.flowId, b.next, { input: b.title }); return; }
    if (st) { const f = getF(st.flow_id); const node = f && f.nodes[st.node_id];
      if (node && st.awaiting === 'input') { let v = (text || '').trim(); if (p && p.kind === 'o') v = node.options[p.idx];
        if (!valid[node.validation || 'any'](v)) { st.tries = (st.tries || 0) + 1; if (st.tries >= (node.max_tries || 3)) { c.state = null; if (node.on_fail) return runFlow(c.id, f.id, node.on_fail); return; } return deliver(c, { text: render(node.retry_text || "That doesn't look right — please try again.", c) }); }
        if (node.save_to) { if (['email', 'phone', 'name', 'first_name'].includes(node.save_to)) c[node.save_to] = v; else c.fields[node.save_to] = v; }
        c.state = null; if (node.next) return runFlow(c.id, f.id, node.next, { input: v }); return; }
      if (node && st.awaiting === 'ai') { if ((node.exit_keywords || []).includes((text || '').trim().toLowerCase())) { c.state = null; if (node.next) return runFlow(c.id, f.id, node.next); return; } return runFlow(c.id, f.id, st.node_id, { input: text }); }
      if (node && st.awaiting === 'choice') { const all = [...(node.buttons || []).map((b, i) => ({ ...b, k: 'b', i })), ...(node.quick_replies || []).map((q, i) => ({ ...q, k: 'q', i }))];
        const hit = all.find(b => !b.url && b.title.trim().toLowerCase() === (text || '').trim().toLowerCase()); if (hit) return inbound(c, text, enc(f.id, st.node_id, hit.i, hit.k)); }
    }
    const kw = D.triggers.filter(t => t.active && (t.channel === 'any' || t.channel === c.channel));
    const n = (text || '').toLowerCase();
    const t = kw.find(t => t.type === 'keyword' && t.keywords.some(k => t.match_type === 'exact' ? n === k.toLowerCase() : n.includes(k.toLowerCase()))) || (text ? kw.find(t => t.type === 'default') : null);
    if (t && t.flow_id) { t.runs++; return runFlow(c.id, t.flow_id, null, { input: text }); }
  }

  // ---------------- REST routes ----------------
  const hydrate = c => ({ ...c, last_text: (D.messages.filter(m => m.contact_id === c.id && m.text).slice(-1)[0] || {}).text });
  function route(method, path, q, body) {
    const seg = path.split('/').filter(Boolean); const [a, b, c2] = seg;
    if (a === 'auth') { if (b === 'status') return { needsSetup: false }; return { ok: true }; }
    if (a === 'me') return { email: 'demo@layerwise.ai', name: 'Demo Admin' };
    if (a === 'stats') { const by = {}; D.contacts.forEach(c => by[c.channel] = (by[c.channel] || 0) + 1);
      return { contacts: D.contacts.length, new_contacts: D.contacts.filter(c => c.created_at > now() - 14 * 86400).length, active_contacts: D.contacts.length, msgs_in: D.daily.reduce((s, d) => s + d.inbound, 0), msgs_out: D.daily.reduce((s, d) => s + d.outbound, 0), failed: 0, takeover: D.contacts.filter(c => c.human_takeover).length, by_channel: Object.entries(by).map(([channel, n]) => ({ channel, n })), daily: D.daily, top_triggers: [...D.triggers].sort((x, y) => y.runs - x.runs).slice(0, 8) }; }
    if (a === 'templates') return Object.entries(TEMPLATES).map(([key, v]) => ({ key, name: v.name, description: v.description }));
    if (a === 'tags') { const m = {}; D.contacts.forEach(c => c.tags.forEach(t => m[t] = (m[t] || 0) + 1)); return Object.entries(m).map(([tag, n]) => ({ tag, n })).sort((x, y) => y.n - x.n); }
    if (a === 'fields') return [...new Set(D.contacts.flatMap(c => Object.keys(c.fields)))];
    if (a === 'users') { if (method === 'POST') { D.users.push({ id: nid(), email: body.email, name: body.name, role: 'agent', created_at: now() }); return { ok: true }; } if (method === 'DELETE') { D.users = D.users.filter(u => u.id !== +b); return { ok: true }; } return D.users; }
    if (a === 'settings') { if (b === 'test') return { ok: true, result: { demo: 'Connection test is simulated in the demo' } }; if (b === 'api-key') return { api_key: 'fdm_demo_' + Math.random().toString(36).slice(2) };
      if (b === 'telegram-webhook') return { ok: true }; if (method === 'PUT') { Object.assign(D.settings, body); return { ok: true }; }
      return { ...clone(D.settings), api_key: '••••demo', urls: { meta_webhook: 'https://app.yourbrand.com/webhooks/meta', telegram_webhook: 'https://app.yourbrand.com/webhooks/telegram/…', widget: 'https://app.yourbrand.com/widget.js' } }; }
    if (a === 'flows') {
      if (!b) { if (method === 'POST') { const t = body.template && TEMPLATES[body.template]; const f = { id: nid(), name: body.name || (t ? t.name : 'Untitled flow'), nodes: t ? clone(t.nodes) : { n1: { type: 'message', text: 'Hi {{first_name|there}} 👋', x: 80, y: 80, buttons: [], quick_replies: [] } }, start_node: t ? t.start : 'n1', updated_at: now() }; D.flows.push(f); save(); return { id: f.id }; }
        return D.flows.map(f => ({ id: f.id, name: f.name, updated_at: f.updated_at, start_node: f.start_node, runs: (D.events[f.id] || {}).runs || 0, triggers: D.triggers.filter(t => t.flow_id === f.id && t.active).length })).sort((x, y) => y.updated_at - x.updated_at); }
      const f = getF(b); if (!f) throw { status: 404 };
      if (c2 === 'duplicate') { const n = { ...clone(f), id: nid(), name: f.name + ' (copy)', updated_at: now() }; D.flows.push(n); save(); return { id: n.id }; }
      if (c2 === 'test') { let c = D.contacts.find(x => x.channel === 'web' && x.external_id === body.vid);
        if (!c) { c = { id: nid(), channel: 'web', external_id: body.vid, name: 'Test user', first_name: 'Tester', username: null, email: null, phone: null, tags: [], fields: {}, state: null, subscribed: 1, human_takeover: 0, unread: 0, created_at: now(), last_inbound_at: now(), last_message_at: now() }; D.contacts.push(c); }
        c.state = null; runFlow(c.id, f.id); return { ok: true }; }
      if (method === 'PUT') { Object.assign(f, { name: body.name, nodes: body.nodes, start_node: body.start_node, updated_at: now() }); save(); return { ok: true }; }
      if (method === 'DELETE') { D.flows = D.flows.filter(x => x !== f); save(); return { ok: true }; }
      return { ...clone(f), stats: (D.events[f.id] || {}).nodes || {} }; }
    if (a === 'triggers') { const fname = t => (getF(t.flow_id) || {}).name;
      if (!b) { if (method === 'POST') { const t = { ...body, id: nid(), runs: 0, active: body.active === false || body.active === 0 ? 0 : 1 }; D.triggers.push(t); save(); return { id: t.id }; } return D.triggers.map(t => ({ ...t, flow_name: fname(t) })).sort((x, y) => (y.priority || 0) - (x.priority || 0) || y.id - x.id); }
      const t = D.triggers.find(x => x.id === +b); if (method === 'DELETE') { D.triggers = D.triggers.filter(x => x !== t); save(); return { ok: true }; }
      Object.assign(t, body, { active: body.active === false || body.active === 0 ? 0 : 1 }); save(); return { ok: true }; }
    if (a === 'sequences') { if (!b) { if (method === 'POST') { D.sequences.push({ id: nid(), name: body.name, steps: body.steps, active: body.active === false ? 0 : 1, active_count: 0, completed_count: 0 }); save(); return { ok: true }; } return D.sequences; }
      const s = D.sequences.find(x => x.id === +b); if (method === 'DELETE') { D.sequences = D.sequences.filter(x => x !== s); save(); return { ok: true }; } Object.assign(s, { name: body.name, steps: body.steps, active: body.active ? 1 : 0 }); save(); return { ok: true }; }
    if (a === 'broadcasts') {
      if (b === 'audience') { const l = D.contacts.filter(c => c.subscribed && (!body.channel || body.channel === 'any' || c.channel === body.channel) && (!(body.tags_any || []).length || body.tags_any.some(t => c.tags.includes(t))) && !(body.tags_none || []).some(t => c.tags.includes(t))); return { total: l.length, eligible: l.filter(c => !['instagram', 'messenger', 'whatsapp'].includes(c.channel) || now() - c.last_inbound_at < 86400).length + Math.floor(l.length / 2) }; }
      if (!b) { if (method === 'POST') { const total = D.contacts.length; const bc = { id: nid(), name: body.name || 'Broadcast', flow_id: body.flow_id, segment: body.segment, status: body.scheduled_at ? 'scheduled' : 'sent', scheduled_at: body.scheduled_at ? Math.floor(new Date(body.scheduled_at) / 1000) : null, total, sent: body.scheduled_at ? 0 : total - 3, skipped: body.scheduled_at ? 0 : 3, failed: 0, created_at: now() }; D.broadcasts.unshift(bc); save(); return { id: bc.id }; }
        return D.broadcasts.map(x => ({ ...x, flow_name: (getF(x.flow_id) || {}).name })); }
      if (c2 === 'cancel') { const x = D.broadcasts.find(y => y.id === +b); x.status = 'cancelled'; save(); return { ok: true }; }
      D.broadcasts = D.broadcasts.filter(y => y.id !== +b); save(); return { ok: true }; }
    if (a === 'contacts') {
      if (!b) { let l = D.contacts.slice(); const qq = (q.get('q') || '').toLowerCase();
        if (qq) l = l.filter(c => [c.name, c.username, c.email, c.phone, c.external_id].some(v => String(v || '').toLowerCase().includes(qq)));
        if (q.get('channel')) l = l.filter(c => c.channel === q.get('channel')); if (q.get('tag')) l = l.filter(c => c.tags.includes(q.get('tag'))); if (q.get('takeover') === '1') l = l.filter(c => c.human_takeover);
        l.sort((x, y) => q.get('sort') === 'recent' ? (y.last_message_at || 0) - (x.last_message_at || 0) : y.created_at - x.created_at); return { total: l.length, rows: l.map(hydrate) }; }
      const c = getC(b); if (!c) throw { status: 404 };
      if (c2 === 'messages') { c.unread = 0; save(); return D.messages.filter(m => m.contact_id === c.id && m.text).sort((x, y) => x.created_at - y.created_at || x.id - y.id); }
      if (c2 === 'send') { if (body.flow_id) runFlow(c.id, +body.flow_id); else { log(c, 'out', String(body.text || ''), null, 'agent:Demo Admin'); if (c.channel === 'web') emit('web:' + c.external_id, { type: 'message', message: { text: body.text } }); } return { ok: true }; }
      if (c2 === 'enroll') { const s = D.sequences.find(x => x.id === +body.sequence_id); if (s) s.active_count++; c.sequences = [...(c.sequences || []), { name: s.name, status: 'active', step: 0 }]; save(); return { ok: true }; }
      if (method === 'PUT') { Object.assign(c, body); if ('human_takeover' in body && !body.human_takeover) c.state = null; save(); emit('inbox', { contact_id: c.id }); return { ok: true }; }
      if (method === 'DELETE') { D.contacts = D.contacts.filter(x => x !== c); save(); return { ok: true }; }
      return { ...clone(c), sequences: c.sequences || [] }; }
    if (a === 'web') { // web chat channel (Test chat in the builder)
      let c = D.contacts.find(x => x.channel === 'web' && x.external_id === b);
      if (c2 === 'message') { if (!c) { c = { id: nid(), channel: 'web', external_id: b, name: 'Website visitor', first_name: 'there', tags: [], fields: {}, state: null, subscribed: 1, human_takeover: 0, unread: 0, created_at: now() }; D.contacts.push(c); }
        if (body.text) log(c, 'in', body.text, body.payload ? { payload: body.payload } : null); inbound(c, body.text, body.payload); return { ok: true }; }
      if (c2 === 'history') return c ? D.messages.filter(m => m.contact_id === c.id) : [];
    }
    throw { status: 404 };
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/')) return nativeFetch(input, init);
    const u = new URL(url, location.origin); const method = (init.method || 'GET').toUpperCase();
    let body = {}; try { body = init.body ? JSON.parse(init.body) : {}; } catch (e) {}
    await sleep(60);
    try { const out = route(method, u.pathname.replace(/^\/api/, ''), u.searchParams, body); save();
      return new Response(JSON.stringify(out ?? { ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    catch (e) { return new Response(JSON.stringify({ error: e.message || 'Not available in the demo' }), { status: e.status || 400, headers: { 'Content-Type': 'application/json' } }); }
  };

  // links that point at server-only endpoints
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    const h = a.getAttribute('href');
    if (h === '/api/contacts/export.csv') { e.preventDefault();
      const rows = [['name', 'channel', 'email', 'phone', 'tags'], ...D.contacts.map(c => [c.name, c.channel, c.email || '', c.phone || '', c.tags.join('|')])];
      const blob = new Blob([rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
      const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'contacts-demo.csv'; l.click(); }
    if (h === '/widget-demo.html') { e.preventDefault(); window.open('../#demo', '_blank'); }
  }, true);

  window.LW_DEMO = { reset() { sessionStorage.removeItem(KEY); location.hash = '#/dashboard'; location.reload(); } };
})();
