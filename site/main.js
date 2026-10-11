// NicheSpark website behavior. No tracking, no third-party scripts.
(() => {
  const root = document.documentElement;
  root.classList.add('js');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Header: transparent over the hero, solid once scrolled ──────────
  const header = document.querySelector('.site-header');
  const toTop = document.getElementById('to-top');
  const toTopBar = document.getElementById('to-top-bar');
  const RING = 2 * Math.PI * 24;

  function onScroll() {
    const y = window.scrollY;
    if (header && !document.body.classList.contains('page-legal')) header.classList.toggle('scrolled', y > 40);
    if (toTop) {
      toTop.classList.toggle('show', y > 600);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, y / max) : 0;
      if (toTopBar) toTopBar.style.strokeDashoffset = String(RING * (1 - progress));
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  toTop?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    document.querySelector('.logo')?.focus({ preventScroll: true });
  });

  // ── Mobile navigation ────────────────────────────────────────────────
  const toggle = document.querySelector('.nav-toggle');
  const links = document.getElementById('nav-links');
  if (toggle && links) {
    const setOpen = (open) => {
      links.classList.toggle('open', open);
      header?.classList.toggle('menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Close' : 'Menu';
    };
    toggle.addEventListener('click', () => setOpen(!links.classList.contains('open')));
    links.addEventListener('click', (e) => {
      if (e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });
  }

  // ── Scroll reveal and count-up ───────────────────────────────────────
  function countUp(el) {
    const target = Number(el.dataset.count);
    if (!target || reduceMotion) return;
    const start = performance.now();
    const duration = 1200;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = String(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) requestAnimationFrame(step);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
  }

  const revealables = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('in');
          entry.target.querySelectorAll('[data-count]').forEach(countUp);
          io.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    revealables.forEach((el) => io.observe(el));
  } else {
    revealables.forEach((el) => el.classList.add('in'));
  }

  // ── Hero illustration ────────────────────────────────────────────────
  // Real Google Autocomplete suggestions captured by NicheSpark on 2026-10-11
  // on google.com. Shown as an illustration only.
  const CAPTURED = {
    a: ['mobile car detailing austin', 'mobile car detailing adelaide', 'mobile car detailing atlanta', 'mobile car detailing auckland'],
    b: ['mobile car detailing brisbane', 'mobile car detailing business', 'mobile car detailing boston', 'mobile car detailing business for sale'],
  };
  const SEED = 'mobile car detailing';
  const bar = document.getElementById('mock-bar');
  const status = document.getElementById('mock-status');
  const rows = document.getElementById('mock-rows');

  function renderRows(list, letter) {
    if (!rows) return;
    rows.replaceChildren(
      ...list.map((kw, i) => {
        const tr = document.createElement('tr');
        tr.style.animationDelay = `${i * 0.12}s`;
        tr.innerHTML = `<td></td><td><span class="tag">A to Z</span></td><td class="muted">…${letter}</td>`;
        tr.firstChild.textContent = kw;
        return tr;
      }),
    );
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function typeQuery(letter) {
    if (!status) return;
    const query = `${SEED} ${letter}`;
    for (let i = SEED.length - 4; i <= query.length; i++) {
      status.innerHTML = 'Collecting <b></b><span class="caret"></span>';
      status.querySelector('b').textContent = `“${query.slice(0, i)}`;
      await sleep(45);
    }
    status.querySelector('b').textContent = `“${query}”`;
  }

  async function runMock() {
    if (!bar || !status || !rows) return;
    if (reduceMotion) {
      bar.style.width = `${(2 / 26) * 100}%`;
      status.textContent = '2 of 26 queries done';
      renderRows([...CAPTURED.a.slice(0, 2), ...CAPTURED.b.slice(0, 2)], 'a');
      return;
    }
    let done = 0;
    for (;;) {
      for (const letter of Object.keys(CAPTURED)) {
        await typeQuery(letter);
        await sleep(700);
        done++;
        bar.style.width = `${(done / 26) * 100}%`;
        renderRows(CAPTURED[letter], letter);
        status.textContent = `${done} of 26 queries · ${CAPTURED[letter].length} suggestions saved`;
        await sleep(2600);
      }
      done = 0;
      bar.style.width = '4%';
    }
  }
  runMock();

  // ── Interactive query generator (mirrors the extension's rules) ─────
  const norm = (s) => s.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const PREFIXES = ['best', 'affordable', 'cheap', 'professional', 'top', 'local', 'how much is', 'is'];
  const SUFFIXES = ['near me', 'cost', 'prices', 'services', 'reviews', 'for sale', 'tips', 'vs'];
  const NOTES = {
    az: 'Adds every letter after your seed.',
    prefix: 'Puts example prefixes before your seed. In the extension you choose your own list.',
    suffix: 'Adds example suffixes after your seed. In the extension you choose your own list.',
  };

  const seedInput = document.getElementById('gen-seed');
  const list = document.getElementById('gen-list');
  const count = document.getElementById('gen-count');
  const note = document.getElementById('gen-note');
  const methodButtons = document.querySelectorAll('.seg button[data-method]');
  let method = 'az';

  function generate(seed) {
    const out = [];
    if (method === 'az') for (const l of LETTERS) out.push({ before: '', seed, after: l });
    if (method === 'prefix') for (const p of PREFIXES) out.push({ before: p, seed, after: '' });
    if (method === 'suffix') for (const s of SUFFIXES) out.push({ before: '', seed, after: s });
    const seen = new Set();
    return out.filter((q) => {
      const key = norm(`${q.before} ${q.seed} ${q.after}`).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function renderGenerator() {
    if (!seedInput || !list || !count) return;
    const seed = norm(seedInput.value);
    if (!seed) {
      list.innerHTML = '<li style="grid-column:1/-1">Enter a seed keyword to see queries.</li>';
      count.textContent = '0';
      return;
    }
    if (/[{}]/.test(seed)) {
      list.innerHTML = '<li style="grid-column:1/-1">A seed keyword cannot contain { or }.</li>';
      count.textContent = '0';
      return;
    }
    const queries = generate(seed);
    list.replaceChildren(
      ...queries.map((q, i) => {
        const li = document.createElement('li');
        li.style.animationDelay = `${Math.min(i, 20) * 0.02}s`;
        if (q.before) li.append(Object.assign(document.createElement('span'), { className: 'v', textContent: `${q.before} ` }));
        li.append(document.createTextNode(q.seed));
        if (q.after) li.append(Object.assign(document.createElement('span'), { className: 'v', textContent: ` ${q.after}` }));
        return li;
      }),
    );
    count.textContent = String(queries.length);
    if (note) note.textContent = NOTES[method];
  }

  methodButtons.forEach((btn) =>
    btn.addEventListener('click', () => {
      method = btn.dataset.method;
      methodButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      renderGenerator();
    }),
  );
  seedInput?.addEventListener('input', renderGenerator);
  renderGenerator();

  // ── Light / dark theme ───────────────────────────────────────────────
  // Follows the system until the visitor picks one; the choice is remembered
  // (the inline script in <head> applies it before the first paint).
  const themeToggle = document.getElementById('theme-toggle');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const currentTheme = () => root.getAttribute('data-theme') || (systemDark.matches ? 'dark' : 'light');
  function labelToggle() {
    if (!themeToggle) return;
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    themeToggle.setAttribute('aria-label', `Switch to ${next} theme`);
    themeToggle.title = `Switch to ${next} theme`;
  }
  themeToggle?.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try {
      localStorage.setItem('ns-theme', next);
    } catch {
      /* storage unavailable: the theme still applies for this visit */
    }
    labelToggle();
  });
  systemDark.addEventListener?.('change', labelToggle);
  labelToggle();

  // ── Footer year ──────────────────────────────────────────────────────
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
