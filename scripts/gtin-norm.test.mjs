#!/usr/bin/env node --test
// gtin-norm.test.mjs — unit tests for gtinNorm in refresh-affiliate-prices.mjs.
//
// Run:  node --test scripts/
//
// The function under test is imported from the real sync script rather than
// copied here, so the test cannot drift away from what actually ships.
//
// The case that matters is the whitespace one. Olight's Awin feed ships GTINs
// as "<valid EAN-13><space><trailing digits>", e.g. "6978095650162 78". The
// previous implementation stripped non-digits across the whole string and
// produced "697809565016278" — a 15-digit value that is not a GTIN and matches
// nothing, silently costing every Olight T2 (stored_op_gtin) match. 215 of
// Olight's 216 populated GTINs have this shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gtinNorm, feedImage } from './refresh-affiliate-prices.mjs';

test('whitespace GTIN keeps only the first token (the regression this fixes)', () => {
  // The exact value from the Olight feed, for the Osight C red-dot link.
  assert.equal(gtinNorm('6978095650162 78'), '6978095650162');
});

test('whitespace GTINs across the rest of the Olight feed sample', () => {
  assert.equal(gtinNorm('6972378121165 7'),  '6972378121165');
  assert.equal(gtinNorm('6978095650155 73'), '6978095650155');
  assert.equal(gtinNorm('6978095650216 53'), '6978095650216');
  assert.equal(gtinNorm('6978095650346 89'), '6978095650346');
  assert.equal(gtinNorm('6926540911115 1'),  '6926540911115');
});

test('the 13-digit result is what we already store, so T2 can match', () => {
  // These six are the op_gtin values already on Olight affiliate_links.
  for (const stored of ['6978095650254', '6978095650162', '6978095650445',
                        '6978095650179', '6978095650230', '6978095650018']) {
    assert.equal(gtinNorm(stored), stored, `${stored} must normalize to itself`);
  }
});

test('leading zeros are still stripped (OpticsPlanet 12-digit UPCs)', () => {
  assert.equal(gtinNorm('00612789319039'), '612789319039');
  assert.equal(gtinNorm('0850013536863'),  '850013536863');
});

test('non-digit characters inside the first token are still stripped', () => {
  assert.equal(gtinNorm('012-345-678'), '12345678');
});

test('OpticsPlanet-shaped values are unaffected by the whitespace split', () => {
  assert.equal(gtinNorm('850043707196'), '850043707196');
  assert.equal(gtinNorm('00850043707196'), '850043707196');
});

test('surrounding whitespace is trimmed, not treated as a separator', () => {
  assert.equal(gtinNorm('  6978095650162  '), '6978095650162');
  assert.equal(gtinNorm('\t6978095650162\n'), '6978095650162');
});

test('tab and multiple spaces split the same as a single space', () => {
  assert.equal(gtinNorm('6978095650162\t78'),   '6978095650162');
  assert.equal(gtinNorm('6978095650162    78'), '6978095650162');
});

test('empty and null-ish inputs return null, never an empty string', () => {
  assert.equal(gtinNorm(null), null);
  assert.equal(gtinNorm(undefined), null);
  assert.equal(gtinNorm(''), null);
  assert.equal(gtinNorm('   '), null);
  assert.equal(gtinNorm('abc'), null);
  assert.equal(gtinNorm('0'), null);       // all zeros strip to nothing
  assert.equal(gtinNorm('000'), null);
});

test('numeric input is accepted, not just strings', () => {
  assert.equal(gtinNorm(850043707196), '850043707196');
});

test('the old concatenating behaviour is gone', () => {
  // Guards against a regression back to String(v).replace(/[^0-9]/g,'').
  assert.notEqual(gtinNorm('6978095650162 78'), '697809565016278');
});

// ─── feedImage: placeholders never become product photos ────────────────────
// Awin serves images2.productserve.com/noimage.gif for a SKU the merchant
// never photographed, and the image backfill would otherwise store it as the
// variant's picture — which is exactly how two different products came to
// "share" one photo (2026-11-16). The whole productserve host is out: it is
// Awin's own CDN of low-res feed previews, never the merchant's photo.

test('feedImage rejects the noimage placeholder on either column', () => {
  assert.equal(feedImage({ merchant_image_url: 'https://images2.productserve.com/noimage.gif' }), null);
  assert.equal(feedImage({ merchant_image_url: '', aw_image_url: 'https://images2.productserve.com/noimage.gif' }), null);
  // any future noimage spelling, whatever the host
  assert.equal(feedImage({ merchant_image_url: 'https://cdn.example.com/NoImage_default.png' }), null);
});

test('feedImage rejects the productserve host whole, previews included', () => {
  assert.equal(feedImage({ aw_image_url: 'https://images.productserve.com/preview/1234/567890.jpg' }), null);
  assert.equal(feedImage({ aw_image_url: 'https://images3.productserve.com/anything.jpg' }), null);
});

test('feedImage passes a real merchant photo, trimmed, preferring merchant_image_url', () => {
  assert.equal(
    feedImage({ merchant_image_url: ' https://op1.0ps.us/640-640/opplanet-foo-main.jpg ' }),
    'https://op1.0ps.us/640-640/opplanet-foo-main.jpg');
  assert.equal(
    feedImage({ merchant_image_url: '', aw_image_url: 'https://www.tyrantcnc.com/media/foo.jpg' }),
    'https://www.tyrantcnc.com/media/foo.jpg');
  assert.equal(feedImage({}), null);
  assert.equal(feedImage({ merchant_image_url: '   ' }), null);
});
