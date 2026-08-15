/**
 * Regression coverage for Ctrl+O (app.tools.expand) expansion of linear tool
 * output. Pi invokes each tool's renderResult with options.expanded, and the
 * renderer is expected to collapse long output when expanded is false and show
 * the full output when expanded is true (mirroring pi's built-in tools).
 */

import {
  renderMarkdownResult,
  truncateLineToColumns,
  COLLAPSED_PREVIEW_LINES,
  collapseToPreview,
} from '../extensions/pi-linear-tools.js';

const HINT = 'Ctrl+O to expand';

function plainTextFromComponent(component, width = 120) {
  return component.render(width).join('\n');
}

async function testDefaultPreviewLines() {
  if (!(COLLAPSED_PREVIEW_LINES > 0)) {
    throw new Error(`Expected COLLAPSED_PREVIEW_LINES to be positive, got ${COLLAPSED_PREVIEW_LINES}`);
  }
}

function testShortTextUnchanged() {
  const text = 'Short output\nwith two lines';
  const out = collapseToPreview(text);
  if (out !== text) {
    throw new Error(`Short text should be returned unchanged:\n---\n${out}\n---`);
  }
}

function testCollapseLongText() {
  const maxLines = 20;
  const body = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
  const out = collapseToPreview(body, maxLines);

  const lines = out.split('\n');
  const kept = lines.slice(0, maxLines);
  if (kept.join('\n') !== Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')) {
    throw new Error('Preview should keep the first 20 lines in order');
  }

  const remaining = 20;
  const hintLine = `... (${remaining} more lines, ${HINT})`;
  if (!out.includes(hintLine)) {
    throw new Error(`Missing collapse hint line "${hintLine}" in:\n---\n${out}\n---`);
  }

  if (out.includes('line 21')) {
    throw new Error('Collapsed output must not include content past the preview window');
  }

  // Text exactly at the limit is NOT collapsed.
  const atLimit = Array.from({ length: maxLines }, (_, i) => `line ${i + 1}`).join('\n');
  if (collapseToPreview(atLimit, maxLines) !== atLimit) {
    throw new Error('Text at the line limit should not be collapsed');
  }
}

function testFallbackRendererCollapsed() {
  const body = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
  // No Markdown/getMarkdownTheme -> plain-text fallback path.
  const renderer = { Markdown: null, Text: null, getMarkdownTheme: null };

  const collapsed = renderMarkdownResult({ content: [{ text: body }] }, { expanded: false }, undefined, undefined, renderer);
  const collapsedText = plainTextFromComponent(collapsed);

  if (collapsedText.includes('line 21')) {
    throw new Error(`Collapsed fallback must truncate past the preview window:\n${collapsedText}`);
  }
  if (!collapsedText.includes(`(${20} more lines, ${HINT})`)) {
    throw new Error(`Collapsed fallback missing hint:\n${collapsedText}`);
  }
}

function testFallbackRendererExpanded() {
  const body = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
  const renderer = { Markdown: null, Text: null, getMarkdownTheme: null };

  const expanded = renderMarkdownResult({ content: [{ text: body }] }, { expanded: true }, undefined, undefined, renderer);
  const expandedText = plainTextFromComponent(expanded);

  if (!expandedText.includes('line 40')) {
    throw new Error(`Expanded fallback should include full output, got:\n${expandedText}`);
  }
  if (expandedText.includes(`${HINT}`)) {
    throw new Error('Expanded output must not include the collapse hint');
  }
}

function testFallbackRendererDefaultCollapsed() {
  // No expanded flag -> treated as collapsed (matches built-in default).
  const body = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
  const renderer = { Markdown: null, Text: null, getMarkdownTheme: null };

  const out = plainTextFromComponent(renderMarkdownResult({ content: [{ text: body }] }, {}, undefined, undefined, renderer));
  if (out.includes('line 21')) {
    throw new Error(`Default (no expanded) should collapse output:\n${out}`);
  }
}

function testMockMarkdownRenderer() {
  // A minimal mock Markdown that records the text it was constructed with.
  let captured = null;
  function MockMarkdown(text) {
    captured = text;
  }
  const renderer = {
    Markdown: MockMarkdown,
    Text: null,
    getMarkdownTheme: () => ({}),
  };

  const body = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
  // Pi supplies ToolRenderContext as the fourth argument; test dependencies are fifth.
  const piRenderContext = {
    args: {},
    toolCallId: 'test-tool-call',
    invalidate: () => {},
    lastComponent: undefined,
    state: {},
    cwd: process.cwd(),
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: false,
    isError: false,
  };

  renderMarkdownResult({ content: [{ text: body }] }, { expanded: false }, undefined, piRenderContext, renderer);
  if (!captured || !captured.includes(`(${20} more lines, ${HINT})`)) {
    throw new Error(`Markdown path should receive collapsed text, got:\n${captured}`);
  }
  if (captured.includes('line 21')) {
    throw new Error(`Markdown path collapsed text must truncate past preview:\n${captured}`);
  }

  renderMarkdownResult({ content: [{ text: body }] }, { expanded: true }, undefined, piRenderContext, renderer);
  if (!captured || !captured.includes('line 40')) {
    throw new Error(`Markdown path expanded text should be full, got:\n${captured}`);
  }
}

function testTruncateLineToColumns() {
  const line = 'abcdef';
  const out = truncateLineToColumns(line, 3);
  if (out !== 'abc') {
    throw new Error(`Expected truncation to 3 columns, got "${out}"`);
  }
}

async function run() {
  console.log('Testing Ctrl+O collapse rendering...');

  testDefaultPreviewLines();
  console.log('✓ COLLAPSED_PREVIEW_LINES has a positive default');

  testShortTextUnchanged();
  console.log('✓ Short text is returned unchanged');

  testCollapseLongText();
  console.log('✓ Long text is collapsed to a bounded preview with a hint');

  testFallbackRendererCollapsed();
  console.log('✓ Plain-text fallback collapses when expanded=false');

  testFallbackRendererExpanded();
  console.log('✓ Plain-text fallback shows full output when expanded=true');

  testFallbackRendererDefaultCollapsed();
  console.log('✓ Default (no expanded) collapses output');

  testMockMarkdownRenderer();
  console.log('✓ Markdown path receives collapsed/expanded text');

  testTruncateLineToColumns();
  console.log('✓ truncateLineToColumns still truncates by display columns');

  console.log('\nAll tests passed!');
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
