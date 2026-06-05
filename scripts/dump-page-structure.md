# DOM dump snippets

Paste these into Chrome DevTools console on the relevant page; copy the output into
`docs/page-structure.md`. Each snippet is intentionally tiny — only what the extension cares
about, no full-page HTML.

## tracker.gg match page tab nav

Cloudflare blocks headless browsers, so we can't fetch this from a service. Open the
match URL in **your** logged-in Chrome, then paste this into the DevTools console
(Ctrl+Shift+J) and share the resulting clipboard contents:

```js
// Step 1: find candidate tab nav containers and dump them (anchors OR buttons OR divs).
copy(JSON.stringify({
  url: location.href,
  // any element whose direct-children all sit on the same line and look like tabs
  byAnchor: [...document.querySelectorAll('a[href*="/r6siege/matches/"]')].map(a => ({
    href: a.getAttribute('href'),
    text: a.textContent.trim().slice(0, 30),
    cls: (a.className||'').toString().slice(0, 200),
    parentTag: a.parentElement?.tagName,
    parentCls: (a.parentElement?.className||'').toString().slice(0, 200),
  })),
  // tab-like elements by label text
  byLabel: [...document.querySelectorAll('*')]
    .filter(el => /^(Career|Scoreboard|Rounds|Summary|Overview)$/i.test((el.textContent||'').trim()) && (el.textContent||'').trim().length < 20)
    .slice(0, 12)
    .map(el => ({
      tag: el.tagName,
      text: el.textContent.trim(),
      href: el.getAttribute('href'),
      role: el.getAttribute('role'),
      cls: (el.className||'').toString().slice(0, 200),
      parentTag: el.parentElement?.tagName,
      parentCls: (el.parentElement?.className||'').toString().slice(0, 200),
      gpCls: (el.parentElement?.parentElement?.className||'').toString().slice(0, 200),
      gpTag: el.parentElement?.parentElement?.tagName,
    })),
}, null, 2))
```

Paste the clipboard contents back into the chat. From it I can pin the exact selector
for `findTrackerMatchNav` instead of guessing.

## stats.cc rank panel (profile page)

```js
// Adjust the selector once you've eyeballed the page; fall back to a body-text dump
// to let the agent spot which class names hold the rank.
copy([...document.querySelectorAll('[class*="rank" i], [class*="tier" i]')]
  .map(el => el.outerHTML.slice(0, 1500)).join('\n\n---\n\n'))
```

## stats.cc match nav

```js
copy([...document.querySelectorAll('ul, nav')]
  .filter(el => [...el.querySelectorAll('a[href]')]
    .filter(a => /^\/siege\/matches\/[0-9a-f-]{36}/.test(a.getAttribute('href') || '')).length >= 2)
  .map(el => el.outerHTML).join('\n\n---\n\n'))
```

## tracker.gg profile nav

```js
copy(document.querySelector('.v3-tabs')?.outerHTML ?? '(.v3-tabs not found)')
```

After pasting the output, mark the relevant section of `docs/page-structure.md` as
`verified` and replace `_unverified_` selectors with the exact ones you found.

## Find ANY rank icon (cross-site, exhaustive)

When swap "doesn't work" and you don't know if the icon is `<img>`, SVG `<image>`, or
CSS `background-image`. Looks for the slug in every attribute and computed style:

```js
copy(JSON.stringify((() => {
  const found = [];
  const RE = /champion-ranks?|copper|bronze|silver|gold|platinum|emerald|diamond|legend|unranked|rank/i;
  for (const el of document.querySelectorAll('*')) {
    const attrs = [...el.attributes].map(a => `${a.name}="${a.value}"`).join(' ');
    if (RE.test(attrs)) found.push({ tag: el.tagName, attrs: attrs.slice(0, 280) });
    const bg = window.getComputedStyle(el).backgroundImage;
    if (bg && RE.test(bg)) found.push({ tag: el.tagName + '_BG', bg: bg.slice(0, 280) });
  }
  return { url: location.href, count: found.length, sample: found.slice(0, 20) };
})(), null, 2))
```

## Stats.cc Champion SVG inspection

Documents the `<image>` + `<rect>` + `<text>` layered composition, including the
exact attributes we need to hide on swap:

```js
copy(JSON.stringify((() => {
  const champImg = [...document.querySelectorAll('image')]
    .find(i => /champion/i.test(i.getAttribute('href') || i.getAttribute('xlink:href') || ''));
  if (!champImg) return { error: 'no champion image' };
  const svg = champImg.closest('svg');
  return {
    url: location.href,
    svgOuter: svg.outerHTML.slice(0, 2000),
    children: [...svg.querySelectorAll('*')].slice(0, 30).map(el => ({
      tag: el.tagName,
      attrs: [...el.attributes].map(a => `${a.name}="${a.value}"`).join(' ').slice(0, 250),
      text: (el.textContent || '').trim().slice(0, 40),
    })),
  };
})(), null, 2))
```
