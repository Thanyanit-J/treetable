/**
 * Minimal markdown for Note cards: headings (# ## ###), bullet lists (- or *),
 * **bold**, *italic*, `code`, [text](https://…) links, paragraphs with soft
 * line breaks. Input is HTML-escaped before any markup is applied, and the
 * output additionally passes through Angular's [innerHTML] sanitizer.
 */
export function renderMarkdown(source: string): string {
  const lines = source.split('\n');
  const html: string[] = [];
  let list: string[] | null = null;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      html.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list !== null) {
      html.push(`<ul>${list.join('')}</ul>`);
      list = null;
    }
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      html.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`);
    } else if (bullet) {
      flushParagraph();
      list = list ?? [];
      list.push(`<li>${inline(bullet[1] ?? '')}</li>`);
    } else if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return html.join('');
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(
      // Only http(s) URLs become links; anything else stays literal text.
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    );
}
