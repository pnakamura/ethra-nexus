// ============================================================
// Index Generator — gera index.md sintético da wiki estratégica
//
// Saída: Markdown agrupado por tipo, listando slug + título + confidence.
// O LLM lê este index para decidir quais páginas carregar para uma tarefa.
// ============================================================

export interface PageSummary {
  slug: string
  title: string
  type: string
  confidence: string
}

export function generateStrategicIndex(pages: PageSummary[]): string {
  if (pages.length === 0) {
    return '# Wiki Estratégica\n\n_Sem páginas cadastradas ainda._\n'
  }

  const byType = new Map<string, PageSummary[]>()
  for (const page of pages) {
    const list = byType.get(page.type) ?? []
    list.push(page)
    byType.set(page.type, list)
  }

  const lines: string[] = ['# Wiki Estratégica', '']
  for (const [type, list] of [...byType.entries()].sort()) {
    lines.push(`## ${type}`, '')
    for (const page of list.sort((a, b) => a.slug.localeCompare(b.slug))) {
      lines.push(`- [[${page.slug}]] — ${page.title} _(${page.confidence})_`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
