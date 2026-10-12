// `npm run blog`: builds the static blog into site/blog/ from blog-src/*.html
// and regenerates site/sitemap.xml. Each source file starts with a JSON
// metadata comment:  <!--{"title": "...", "description": "...", ...}-->
// followed by the article body HTML (h2/h3/p/ul/table/figure...).
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://nichespark.tech';
const STORE = 'https://chromewebstore.google.com/detail/nichespark/mfkjoekmjfphffamabelfngbonnjdgep';
const WA = 'https://wa.me/923130221118?text=Hi%2C%20I%20have%20a%20question%20about%20NicheSpark';
const THEME_SCRIPT = readFileSync('site/index.html', 'utf8').match(/<script>\(function\(\)\{try\{var t=localStorage[\s\S]*?<\/script>/)[0];
const OUT = 'site/blog';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ── Load posts ──────────────────────────────────────────────────────
const posts = readdirSync('blog-src')
  .filter((f) => f.endsWith('.html'))
  .map((file) => {
    const raw = readFileSync(join('blog-src', file), 'utf8');
    const m = raw.match(/^<!--(\{[\s\S]*?\})-->\s*/);
    if (!m) throw new Error(`${file}: missing metadata comment`);
    const meta = JSON.parse(m[1]);
    for (const key of ['title', 'description', 'date', 'category', 'excerpt']) if (!meta[key]) throw new Error(`${file}: missing ${key}`);
    let body = raw.slice(m[0].length).trim();
    // Give every h2 an id for the table of contents.
    const toc = [];
    body = body.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, inner) => {
      const id = slugify(inner);
      toc.push({ id, text: inner.replace(/<[^>]+>/g, '') });
      return `<h2 id="${id}">${inner}</h2>`;
    });
    const words = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
    return { ...meta, slug: file.replace(/\.html$/, ''), body, toc, words, minutes: Math.max(1, Math.round(words / 220)) };
  })
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || b.date.localeCompare(a.date));

// ── Shared chrome ───────────────────────────────────────────────────
const icons = `<link rel="icon" type="image/svg+xml" href="/assets/logo.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/logo-32.png" />
  <link rel="apple-touch-icon" href="/assets/logo-180.png" />`;
const themeToggle = `<button class="theme-toggle" type="button" id="theme-toggle" aria-label="Switch to dark theme">
          <svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          <svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>
        </button>`;
const header = `<header class="site-header" id="top">
    <nav class="container nav" aria-label="Main">
      <a class="logo" href="/" aria-label="NicheSpark home">
        <img class="logo-mark" src="/assets/logo.svg" alt="" width="32" height="32" />
        NicheSpark
      </a>
      <ul class="nav-links" id="nav-links">
        <li><a href="/#how">How it works</a></li>
        <li><a href="/#features">Features</a></li>
        <li><a href="/blog/">Blog</a></li>
        <li><a href="/#faq">FAQ</a></li>
        <li><a class="btn btn-primary btn-sm" href="${STORE}" target="_blank" rel="noopener">Add to Chrome</a></li>
      </ul>
      <div class="nav-end">
        ${themeToggle}
        <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-links">Menu</button>
      </div>
    </nav>
  </header>`;
const waIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 1.8a8.2 8.2 0 1 1-4.2 15.3l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 0 1 12 3.8Zm-3.3 4c-.2 0-.5 0-.8.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3 2.4.9 2.9.8 3.4.7.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4l-.5-.4-2-.9c-.3-.1-.5-.2-.7.1l-.9 1.1c-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.4.1-.6l.4-.5.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.5-.5-.5-.7-.5h-.6Z"/></svg>';
const footer = `<footer class="site-footer">
    <div class="container footer-grid">
      <a class="logo" href="/" aria-label="NicheSpark home">
        <img class="logo-mark" src="/assets/logo.svg" alt="" width="26" height="26" style="width:26px;height:26px" />
        NicheSpark
      </a>
      <ul class="footer-links">
        <li><a href="/#how">How it works</a></li>
        <li><a href="/blog/">Blog</a></li>
        <li><a href="/changelog/">Changelog</a></li>
        <li><a href="/privacy.html">Privacy</a></li>
        <li><a href="${WA}" target="_blank" rel="noopener">WhatsApp: +92 313 0221118</a></li>
      </ul>
    </div>
    <div class="container" style="margin-top:18px">
      <p class="small">© <span id="year">2026</span> NicheSpark · Discover Keywords. Uncover Opportunities. Not affiliated with or endorsed by Google. Google is a trademark of Google LLC.</p>
    </div>
  </footer>

  <a class="wa-float" href="${WA}" target="_blank" rel="noopener" aria-label="Chat with NicheSpark on WhatsApp">
    ${waIcon}
    <span class="wa-label">Chat with us</span>
  </a>

  <button class="to-top" id="to-top" type="button" aria-label="Back to top">
    <svg class="ring" viewBox="0 0 52 52" aria-hidden="true"><circle class="track" cx="26" cy="26" r="24"/><circle class="bar" id="to-top-bar" cx="26" cy="26" r="24"/></svg>
    <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
  </button>

  <script src="/main.js" defer></script>`;

function page({ title, description, canonical, ogType, image, jsonld, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${canonical}" />
  <meta name="theme-color" content="#047857" />
  ${icons}
  <meta property="og:type" content="${ogType}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:site_name" content="NicheSpark" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${image}" />
  <meta name="twitter:card" content="summary_large_image" />
  ${THEME_SCRIPT}
  <link rel="stylesheet" href="/styles.css" />
  <script type="application/ld+json">
${JSON.stringify(jsonld, null, 2).replace(/^/gm, '  ')}
  </script>
</head>
<body class="page-legal page-blog">
  <a class="skip-link" href="#main">Skip to content</a>
  ${header}
${body}
  ${footer}
</body>
</html>
`;
}

const org = { '@id': `${SITE}/#organization` };
const ctaBox = `<aside class="post-cta" aria-label="Try NicheSpark">
          <div>
            <h2 class="post-cta-title">Collect these keywords automatically</h2>
            <p>NicheSpark runs A to Z, prefix and suffix research on real Google Autocomplete suggestions and saves every keyword for you. Free, no account, and your data stays in your browser.</p>
          </div>
          <a class="btn btn-primary" href="${STORE}" target="_blank" rel="noopener">Add to Chrome, it's free</a>
        </aside>`;

// ── Build ──────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const post of posts) {
  const url = `${SITE}/blog/${post.slug}/`;
  const image = post.image ? `${SITE}${post.image}` : `${SITE}/assets/og.png`;
  const related = posts.filter((p) => p.slug !== post.slug).slice(0, 3);
  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        '@id': `${url}#article`,
        headline: post.title,
        description: post.description,
        datePublished: post.date,
        dateModified: post.updated ?? post.date,
        author: org,
        publisher: org,
        image,
        wordCount: post.words,
        articleSection: post.category,
        mainEntityOfPage: url,
        isPartOf: { '@type': 'Blog', '@id': `${SITE}/blog/#blog`, name: 'NicheSpark Blog' },
        inLanguage: 'en',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog/` },
          { '@type': 'ListItem', position: 3, name: post.title, item: url },
        ],
      },
    ],
  };
  const toc = post.toc.length >= 3
    ? `<nav class="post-toc" aria-label="On this page"><p class="post-toc-title">On this page</p><ol>${post.toc.map((t) => `<li><a href="#${t.id}">${t.text}</a></li>`).join('')}</ol></nav>`
    : '';
  const body = `  <main id="main">
    <article class="post">
      <header class="post-hero">
        <div class="container post-narrow">
          <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/blog/">Blog</a></nav>
          <span class="eyebrow">${esc(post.category)}</span>
          <h1>${esc(post.title)}</h1>
          <p class="lead">${esc(post.excerpt)}</p>
          <p class="post-meta"><time datetime="${post.date}">${fmtDate(post.date)}</time> · ${post.minutes} min read · By the NicheSpark team</p>
        </div>
      </header>
      <div class="container post-narrow">
        ${toc}
        <div class="post-body">
${post.body.replace(/^/gm, '          ')}
        </div>
        ${ctaBox}
      </div>
    </article>
    <section class="section post-related" aria-labelledby="related-heading">
      <div class="container">
        <h2 id="related-heading">Keep reading</h2>
        <div class="grid grid-3">
${related.map((r) => card(r)).join('\n')}
        </div>
      </div>
    </section>
  </main>`;
  mkdirSync(join(OUT, post.slug), { recursive: true });
  writeFileSync(join(OUT, post.slug, 'index.html'), page({ title: `${post.title} | NicheSpark`, description: post.description, canonical: url, ogType: 'article', image, jsonld, body }));
}

function card(p) {
  return `          <a class="card post-card" href="/blog/${p.slug}/">
            <span class="eyebrow">${esc(p.category)}</span>
            <h3>${esc(p.title)}</h3>
            <p>${esc(p.excerpt)}</p>
            <span class="post-card-meta">${fmtDate(p.date)} · ${p.minutes} min read</span>
          </a>`;
}

const indexBody = `  <main id="main">
    <header class="post-hero">
      <div class="container post-narrow">
        <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a></nav>
        <span class="eyebrow">NicheSpark Blog</span>
        <h1>Keyword and niche research, <span class="accent">explained with real data</span></h1>
        <p class="lead">Practical guides to Google Autocomplete research: methods, modifiers and case studies built from suggestions we actually collected.</p>
      </div>
    </header>
    <section class="section" style="padding-top:48px">
      <div class="container">
        <div class="grid grid-3">
${posts.map(card).join('\n')}
        </div>
      </div>
    </section>
  </main>`;
writeFileSync(
  join(OUT, 'index.html'),
  page({
    title: 'NicheSpark Blog: Google Autocomplete Keyword Research Guides',
    description: 'Guides and case studies on Google Autocomplete keyword research, A to Z, prefix and suffix methods, and finding profitable niches.',
    canonical: `${SITE}/blog/`,
    ogType: 'website',
    image: `${SITE}/assets/og.png`,
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'Blog',
      '@id': `${SITE}/blog/#blog`,
      name: 'NicheSpark Blog',
      url: `${SITE}/blog/`,
      publisher: org,
      blogPost: posts.map((p) => ({ '@id': `${SITE}/blog/${p.slug}/#article` })),
    },
    body: indexBody,
  }),
);

// ── Changelog ─────────────────────────────────────────────────────
const releases = JSON.parse(readFileSync('blog-src/changelog.json', 'utf8'));
const typeOrder = ['Added', 'Changed', 'Fixed'];
const changelogBody = `  <main id="main">
    <header class="post-hero">
      <div class="container post-narrow">
        <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a></nav>
        <span class="eyebrow">Changelog</span>
        <h1>What's new in <span class="accent">NicheSpark</span></h1>
        <p class="lead">Every release of the extension, newest first. Chrome installs updates automatically after the Chrome Web Store approves them.</p>
      </div>
    </header>
    <section class="section" style="padding-top:48px">
      <div class="container post-narrow">
        <ol class="releases">
${releases
  .map(
    (r, i) => `          <li class="release" id="v${r.version.replace(/\./g, '-')}">
            <div class="release-head">
              <span class="release-version">v${esc(r.version)}</span>${i === 0 ? '<span class="release-latest">Latest</span>' : ''}
              <time datetime="${r.date}">${fmtDate(r.date)}</time>
            </div>
            <h2>${esc(r.title)}</h2>
            <p class="release-status">${esc(r.status)}</p>
            <ul class="release-changes">
${[...r.changes]
  .sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type))
  .map((c) => `              <li><span class="change-type change-${c.type.toLowerCase()}">${esc(c.type)}</span> ${esc(c.text)}</li>`)
  .join('\n')}
            </ul>
          </li>`,
  )
  .join('\n')}
        </ol>
        ${ctaBox}
      </div>
    </section>
  </main>`;
mkdirSync('site/changelog', { recursive: true });
writeFileSync(
  'site/changelog/index.html',
  page({
    title: "Changelog: What's New in NicheSpark",
    description: 'Release notes for the NicheSpark Chrome extension: new features, fixes and changes in every version.',
    canonical: `${SITE}/changelog/`,
    ogType: 'website',
    image: `${SITE}/assets/og.png`,
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      '@id': `${SITE}/changelog/#webpage`,
      name: 'NicheSpark changelog',
      url: `${SITE}/changelog/`,
      about: { '@id': `${SITE}/#software` },
      isPartOf: { '@id': `${SITE}/#website` },
      dateModified: releases[0].date,
    },
    body: changelogBody,
  }),
);

// ── Sitemap ────────────────────────────────────────────────────────
const latest = posts.reduce((d, p) => ((p.updated ?? p.date) > d ? (p.updated ?? p.date) : d), '2026-10-11');
const urls = [
  [`${SITE}/`, latest],
  [`${SITE}/blog/`, latest],
  ...posts.map((p) => [`${SITE}/blog/${p.slug}/`, p.updated ?? p.date]),
  [`${SITE}/changelog/`, releases[0].date],
  [`${SITE}/privacy.html`, '2026-10-11'],
];
writeFileSync(
  'site/sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d]) => `  <url><loc>${u}</loc><lastmod>${d}</lastmod></url>`).join('\n')}\n</urlset>\n`,
);
console.log(`Built changelog (${releases.length} releases) and ${posts.length} posts:`);
for (const p of posts) console.log(`  /blog/${p.slug}/  (${p.words} words, ${p.minutes} min)`);
