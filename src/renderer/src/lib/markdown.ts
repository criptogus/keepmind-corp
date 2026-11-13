// Minimal markdown → HTML for previews (escaped first, no raw HTML).
export function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  // Fenced code blocks first — protect contents from inline transforms.
  const blocks: string[] = []
  const src = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    blocks.push(`<pre class="md-pre"><code>${esc(code.replace(/\n$/, ''))}</code></pre>`)
    return `\u0000${blocks.length - 1}\u0000`
  })
  return esc(src)
    .replace(/\u0000(\d+)\u0000/g, (_m, i) => `\u0001${i}\u0001`)
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // links: [text](url) or bare https?:// URLs — single pass so the URL
    // inside a labeled link isn't re-matched as a bare one
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>"')\]]+)/g,
      (_m, label, labeled, bare) =>
        `<a href="${labeled ?? bare}" target="_blank" rel="noopener noreferrer">${label ?? bare}</a>`)
    .replace(/^- \[ \] (.*)$/gm, '<div class="md-todo">☐ $1</div>')
    .replace(/^- \[x\] (.*)$/gm, '<div class="md-todo md-todo--done">☑ $1</div>')
    .replace(/^- (.*)$/gm, '<div class="md-li">• $1</div>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>')
    .replace(/<p><\/(h[123]|div)>/g, '</$1>')
    .replace(/<\/(h[123]|div)><p>/g, '</$1><p>')
    .replace(/\u0001(\d+)\u0001/g, (_m, i) => blocks[Number(i)])
}
