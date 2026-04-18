import { mkdir } from 'fs/promises'
import { resolve, join } from 'path'
import { eq, and } from 'drizzle-orm'
import { getDb, wikiStrategicPages } from '@ethra-nexus/db'
import { WikiFsAdapter } from './wiki-fs.adapter'

export async function syncWikiToFilesystem(
  tenantId: string,
  tenantSlug: string,
  basePath?: string,
): Promise<{ synced: number; failed: number; dir: string }> {
  const db = getDb()
  const adapter = new WikiFsAdapter(basePath)

  const pages = await db
    .select()
    .from(wikiStrategicPages)
    .where(
      and(
        eq(wikiStrategicPages.tenant_id, tenantId),
        eq(wikiStrategicPages.status, 'ativo'),
      ),
    )

  const wikiDir = join(tenantSlug, 'wiki')
  const fullDir = resolve(
    basePath ?? process.env['WIKIS_BASE_PATH'] ?? './wikis',
    tenantSlug,
    'wiki',
  )
  await mkdir(fullDir, { recursive: true })

  let synced = 0
  let failed = 0

  for (const page of pages) {
    try {
      const tags = Array.isArray(page.tags) ? (page.tags as unknown[]) : []
      const sources = Array.isArray(page.sources) ? (page.sources as unknown[]) : []

      const frontmatter = [
        '---',
        `title: "${page.title.replace(/"/g, '\\"')}"`,
        `type: ${page.type}`,
        `confidence: ${page.confidence}`,
        `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`,
        `sources: [${sources.map((s) => JSON.stringify(s)).join(', ')}]`,
        `updated_at: ${page.updated_at.toISOString()}`,
        '---',
        '',
        `# ${page.title}`,
        '',
        page.content,
      ].join('\n')

      await adapter.writeFile(join(wikiDir, `${page.slug}.md`), frontmatter)
      synced++
    } catch {
      failed++
    }
  }

  return { synced, failed, dir: wikiDir }
}
