#!/usr/bin/env node

import assert from 'node:assert/strict';

import { createPlainTextFallbackRenderer, renderMarkdownResult } from '../extensions/pi-linear-tools.js';

function fallbackVisibleWidth(text) {
  let width = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    width += codePoint === 0x09 ? 3 : codePoint >= 0x20 && codePoint <= 0x7e ? 1 : 2;
  }
  return width;
}

function assertLinesFit(renderer, width) {
  for (const line of renderer.render(width)) {
    assert.ok(fallbackVisibleWidth(line) <= width, `Rendered line exceeds width ${width}: ${JSON.stringify(line)}`);
  }
}

function testCjkLineIsTruncatedEvenWhenItsStringLengthFits() {
  const cjkLine = '漢'.repeat(100);
  assert.ok(cjkLine.length < 156, 'Regression requires a line whose UTF-16 length fits the terminal');

  const renderer = createPlainTextFallbackRenderer(cjkLine);
  const [line] = renderer.render(156);

  assert.equal(line, '漢'.repeat(78));
  assert.equal(fallbackVisibleWidth(line), 156);
  assertLinesFit(renderer, 156);
}

function testTabsUsePiTuiColumnWidth() {
  const source = '\t\t\t\tab';
  assert.ok(source.length < 10, 'Regression requires a line whose string length fits the terminal');

  const renderer = createPlainTextFallbackRenderer(source);
  const [line] = renderer.render(10);

  assert.equal(line, '\t\t\t');
  assert.equal(fallbackVisibleWidth(line), 9);
  assertLinesFit(renderer, 10);
}

function testMissingMarkdownDependenciesUseSafeFallback() {
  const renderer = renderMarkdownResult(
    { content: [{ text: '漢'.repeat(100) }] },
    null,
    null,
    { Markdown: null, Text: null, getMarkdownTheme: null }
  );

  assertLinesFit(renderer, 156);
  assert.equal(renderer.render(156)[0], '漢'.repeat(78));
}

function testMarkdownConstructionFailureUsesSafeFallback() {
  class BrokenMarkdown {
    constructor() {
      throw new Error('intentional test failure');
    }
  }

  const renderer = renderMarkdownResult(
    { content: [{ text: '漢'.repeat(100) }] },
    null,
    null,
    { Markdown: BrokenMarkdown, Text: null, getMarkdownTheme: () => ({}) }
  );

  const lines = renderer.render(156);
  assert.match(lines[0], /Markdown render failed: intentional test failure/);
  assert.equal(lines[2], '漢'.repeat(78));
  assertLinesFit(renderer, 156);
}

function main() {
  testCjkLineIsTruncatedEvenWhenItsStringLengthFits();
  testTabsUsePiTuiColumnWidth();
  testMissingMarkdownDependenciesUseSafeFallback();
  testMarkdownConstructionFailureUsesSafeFallback();
  console.log('✓ tests/test-render-fallback.js passed');
}

main();
