---
title: Does the Holosun 507K X2 fit a P365 XL? A renderer check, not an article
description: The Field Notes renderer's own fixture. Every Markdown construct it supports and both live-data blocks, on real catalog parts, so the plumbing can be walked on a preview.
author: Gunforma
author_credential: Renderer fixture — not reviewed prose
type: guide
category: Optics
---

This page is a **fixture**, not a Field Note. It exists so that `field-note.mjs`
can be exercised on a deploy preview before any article is written, and it is
a 404 on gunforma.com. Every construct the renderer supports appears below,
plus both live-data blocks on parts that are in the catalog today.

## The fit question, answered from the live tables

A fit verdict is never typed into an article. The block below reads the
optic's footprint, the gun's cuts by SKU and the footprint-to-cut mapping on
every request, so it cannot disagree with the fit guides.

::fit optic=holosun-507k-x2 gun=p365-xl

The same optic on a model whose cut changes with the SKU suffix:

::fit optic=holosun-507k-x2 gun=p365-xmacro

And an optic that does *not* mount on this slide, so the "doesn't fit" shape
is on the page too:

::fit optic=holosun-507c-x2 gun=p365-xl

### Magazines go through the maker's own claim

::fit magazine=sig-sauer-p365-17rd-mag gun=p365-xmacro

::fit magazine=sig-sauer-p365-17rd-mag gun=p365

## What these cost today

Prices come from the nightly feed. A listing that no feed has verified in the
last seven days reads "Check price" — never a number we cannot stand behind.

::price holosun-507k-x2, holosun-507c-x2, sig-sauer-p365-17rd-mag

## Every construct the renderer supports

Inline: **bold**, *italic*, _also italic_, `code`, a [site link](/p365/) and an
[off-site link](https://www.sigsauer.com/) that opens in a new tab.

- An unordered list
- With a nested level
  - Like this
  - And this
- Back out

1. An ordered list
2. Second item

> A blockquote, for the builder quote that every article is required to carry.

| Column | Value | Right-aligned |
|---|---|---:|
| A | one | 1 |
| B | two | 22 |

```
a fenced code block, rendered verbatim
```

![A caption under the figure](/assets/gunforma-logo.png)

---

Raw HTML is text, not markup: <script>alert(1)</script> renders as those
characters. A link with a bad scheme, [like this](javascript:alert(1)), is
dropped to its text.
