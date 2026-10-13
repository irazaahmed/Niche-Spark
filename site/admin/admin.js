// NicheSpark admin page. Talks only to /api/admin/* on this site.
(() => {
  const $ = (id) => document.getElementById(id);
  const fmtNum = (n) => Number(n ?? 0).toLocaleString();
  const fmtDate = (s) => (s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
  function ago(s) {
    if (!s) return 'Never';
    const mins = Math.round((Date.now() - new Date(s).getTime()) / 60000);
    if (mins < 2) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const h = Math.round(mins / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
  }
  const METHOD_LABELS = { az: 'A to Z', prefix: 'Prefix', suffix: 'Suffix', question: 'Questions', template: 'Template' };

  /** Builds an element; children may be strings (always inserted as text) or nodes. */
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : String(c));
    return node;
  }

  async function api(action, body = {}) {
    const res = await fetch(`/api/admin/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* empty */
    }
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const call = async (fn, args) => (await api('rpc', { fn, args })).data;

  let users = [];
  let selected = null;

  function show(view) {
    $('view-loading').hidden = true;
    $('view-login').hidden = view !== 'login';
    $('view-app').hidden = view !== 'app';
    $('admin-logout').hidden = view !== 'app';
  }

  function loginError(message) {
    $('login-error').textContent = message || '';
  }

  function appError(e) {
    if (e && e.status === 401) {
      show('login');
      loginError('Your session ended. Please sign in again.');
      return;
    }
    $('app-error').textContent = e ? e.message : '';
  }

  function renderStats(o) {
    const items = [
      ['Accounts', o.users, `${fmtNum(o.new_7d)} new this week`],
      ['Active this week', o.active_7d, 'signed in or synced'],
      ['Email verified', o.verified, `of ${fmtNum(o.users)}`],
      ['Sign-in method', `${fmtNum(o.google_users)} / ${fmtNum(o.email_users)}`, 'Google / email'],
      ['Projects', o.projects, `${fmtNum(o.queries)} queries`],
      ['Keywords', o.keywords, 'across all accounts'],
    ];
    $('stats').replaceChildren(
      ...items.map(([label, value, sub]) =>
        el('div', { class: 'stat' }, el('div', { class: 'stat-label' }, label), el('div', { class: 'stat-value' }, typeof value === 'number' ? fmtNum(value) : value), el('div', { class: 'stat-sub' }, sub)),
      ),
    );
    const bars = (list, key, labelKey) => {
      const max = Math.max(1, ...list.map((x) => Number(x[key])));
      return list.length
        ? list.map((x) =>
            el('li', {}, el('span', { class: 'bar-label' }, x[labelKey]), el('span', { class: 'bar-track' }, el('span', { class: 'bar-fill', style: `width:${(Number(x[key]) / max) * 100}%` })), el('span', { class: 'bar-num' }, fmtNum(x[key]))),
          )
        : [el('li', { class: 'muted' }, 'No data yet.')];
    };
    $('countries').replaceChildren(...bars(o.countries || [], 'users', 'country'));
    $('signups').replaceChildren(...bars((o.signups_by_day || []).map((d) => ({ ...d, day: fmtDate(d.day + 'T12:00:00') })), 'users', 'day'));
  }

  function renderUsers() {
    const q = $('user-search').value.trim().toLowerCase();
    const list = q ? users.filter((u) => `${u.email} ${u.name}`.toLowerCase().includes(q)) : users;
    $('user-count').textContent = `(${fmtNum(list.length)}${q ? ` of ${fmtNum(users.length)}` : ''})`;
    $('users').replaceChildren(
      ...(list.length
        ? list.map((u) =>
            el(
              'tr',
              { class: selected?.id === u.id ? 'active' : '' },
              el('td', {}, el('div', { class: 'cell-strong' }, u.email), el('div', { class: 'muted small' }, u.name || '', u.role === 'admin' ? el('span', { class: 'tag' }, 'admin') : null, !u.email_verified ? el('span', { class: 'tag tag-warn' }, 'unverified') : null)),
              el('td', {}, u.methods || '—'),
              el('td', {}, fmtDate(u.created_at)),
              el('td', { title: u.last_seen || '' }, ago(u.last_seen || u.last_sync)),
              el('td', {}, [u.last_city, u.last_country].filter(Boolean).join(', ') || '—'),
              el('td', { class: 'num' }, fmtNum(u.projects)),
              el('td', { class: 'num' }, fmtNum(u.keywords)),
              el('td', {}, el('button', { class: 'btn btn-sm', type: 'button', onclick: () => openUser(u) }, 'View')),
            ),
          )
        : [el('tr', {}, el('td', { colspan: 8, class: 'muted' }, 'No accounts found.'))]),
    );
  }

  async function openUser(u) {
    selected = u;
    renderUsers();
    $('detail').hidden = false;
    $('keywords-box').hidden = true;
    $('detail-title').textContent = u.email;
    $('detail-meta').textContent = `Joined ${fmtDate(u.created_at)} · Sign-in: ${u.methods || '—'} · Last active ${ago(u.last_seen || u.last_sync)}${u.last_country ? ` · ${[u.last_city, u.last_country].filter(Boolean).join(', ')}` : ''} · ${fmtNum(u.queries)} queries`;
    $('delete-user').hidden = u.role === 'admin';
    $('projects').replaceChildren(el('tr', {}, el('td', { colspan: 8, class: 'muted' }, 'Loading…')));
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const projects = await call('admin_user_projects', { p_user: u.id });
      $('projects').replaceChildren(
        ...(projects.length
          ? projects.map((p) =>
              el(
                'tr',
                {},
                el('td', { class: 'cell-strong' }, p.name || '(no name)'),
                el('td', {}, p.seed || ''),
                el('td', {}, p.google_domain || ''),
                el('td', {}, Object.entries(p.methods || {}).map(([m, n]) => `${METHOD_LABELS[m] || m} ${n}`).join(', ') || '—'),
                el('td', { class: 'num' }, fmtNum(p.queries)),
                el('td', { class: 'num' }, fmtNum(p.keywords)),
                el('td', {}, fmtDate(p.updated_at)),
                el(
                  'td',
                  { class: 'row-actions' },
                  el('button', { class: 'btn btn-sm', type: 'button', onclick: () => openKeywords(u, p) }, 'Keywords'),
                  el('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => deleteProject(u, p) }, 'Delete'),
                ),
              ),
            )
          : [el('tr', {}, el('td', { colspan: 8, class: 'muted' }, 'This account has no projects.'))]),
      );
    } catch (e) {
      appError(e);
    }
  }

  async function openKeywords(u, p) {
    $('keywords-box').hidden = false;
    $('keywords-title').textContent = `Keywords in “${p.name}” (first 500 of ${fmtNum(p.keywords)})`;
    $('keywords').replaceChildren(el('tr', {}, el('td', { colspan: 4, class: 'muted' }, 'Loading…')));
    try {
      const rows = await call('admin_project_keywords', { p_user: u.id, p_project: p.id, p_limit: 500 });
      $('keywords').replaceChildren(
        ...(rows.length
          ? rows.map((k) =>
              el('tr', {}, el('td', {}, k.text), el('td', {}, (k.methods || []).map((m) => METHOD_LABELS[m] || m).join(', ')), el('td', { class: 'muted small' }, (k.source_queries || []).slice(0, 3).join(' · ')), el('td', { class: 'num' }, fmtNum(k.collection_count))),
            )
          : [el('tr', {}, el('td', { colspan: 4, class: 'muted' }, 'No keywords.'))]),
      );
      $('keywords-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      appError(e);
    }
  }

  async function deleteProject(u, p) {
    if (!confirm(`Delete the project “${p.name}” of ${u.email}?\n\nIts ${fmtNum(p.keywords)} keywords are deleted for good, also from the user's own browsers.`)) return;
    try {
      await call('admin_delete_project', { p_user: u.id, p_project: p.id });
      await loadAll();
      const fresh = users.find((x) => x.id === u.id);
      if (fresh) await openUser(fresh);
    } catch (e) {
      appError(e);
    }
  }

  async function deleteUser() {
    const u = selected;
    if (!u) return;
    const typed = prompt(`This permanently deletes the account ${u.email}, its ${fmtNum(u.projects)} projects and ${fmtNum(u.keywords)} keywords. It cannot be undone.\n\nType the email address to confirm:`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== u.email.toLowerCase()) {
      alert('The email did not match. Nothing was deleted.');
      return;
    }
    try {
      await call('admin_delete_user', { p_user: u.id });
      selected = null;
      $('detail').hidden = true;
      await loadAll();
    } catch (e) {
      appError(e);
    }
  }

  async function loadAll() {
    appError(null);
    const [overview, list] = await Promise.all([call('admin_overview'), call('admin_users')]);
    renderStats(overview);
    users = list || [];
    renderUsers();
  }

  async function enter(user) {
    $('admin-email').textContent = user.email;
    show('app');
    try {
      await loadAll();
    } catch (e) {
      appError(e);
    }
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError('');
    try {
      const { user } = await api('login', { email: $('login-email').value.trim(), password: $('login-password').value });
      $('login-password').value = '';
      await enter(user);
    } catch (err) {
      loginError(err.message);
    }
  });

  $('login-google').addEventListener('click', async () => {
    loginError('');
    try {
      const { url } = await api('google-start');
      location.href = url;
    } catch (err) {
      loginError(err.message);
    }
  });

  $('admin-logout').addEventListener('click', async () => {
    await api('logout').catch(() => {});
    users = [];
    selected = null;
    show('login');
  });
  $('refresh').addEventListener('click', () => loadAll().catch(appError));
  $('user-search').addEventListener('input', renderUsers);
  $('close-detail').addEventListener('click', () => {
    selected = null;
    $('detail').hidden = true;
    renderUsers();
  });
  $('delete-user').addEventListener('click', deleteUser);

  (async () => {
    const params = new URLSearchParams(location.search);
    const verifier = params.get('neon_auth_session_verifier');
    if (verifier || params.has('error')) history.replaceState(null, '', location.pathname);
    try {
      if (verifier) {
        const { user } = await api('google-finish', { verifier });
        return enter(user);
      }
      if (params.has('error')) throw new Error('Google sign-in was cancelled or failed.');
      const { user } = await api('me');
      await enter(user);
    } catch (err) {
      show('login');
      if (err.status !== 401 || verifier) loginError(err.message);
    }
  })();
})();
