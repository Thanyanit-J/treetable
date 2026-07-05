import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('escapes HTML so raw tags never pass through', () => {
    const html = renderMarkdown('<script>alert(1)</script> & <b>x</b>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('renders headings by level', () => {
    expect(renderMarkdown('# Title')).toBe('<h1>Title</h1>');
    expect(renderMarkdown('## Sub')).toBe('<h2>Sub</h2>');
    expect(renderMarkdown('### Deep')).toBe('<h3>Deep</h3>');
  });

  it('renders inline bold, italic and code', () => {
    expect(renderMarkdown('a **b** *c* `d`')).toBe(
      '<p>a <strong>b</strong> <em>c</em> <code>d</code></p>',
    );
  });

  it('groups bullets into one list and splits paragraphs on blank lines', () => {
    expect(renderMarkdown('- one\n- two\n\nafter')).toBe(
      '<ul><li>one</li><li>two</li></ul><p>after</p>',
    );
  });

  it('joins consecutive lines with soft breaks', () => {
    expect(renderMarkdown('line1\nline2')).toBe('<p>line1<br>line2</p>');
  });

  it('links only http(s) URLs', () => {
    expect(renderMarkdown('[ok](https://example.com)')).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer">ok</a>',
    );
    expect(renderMarkdown('[bad](javascript:alert(1))')).not.toContain('<a ');
  });
});
