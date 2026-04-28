import { sql } from 'drizzle-orm'
import { getDb } from '@ethra-nexus/db'
import { embed } from '@ethra-nexus/wiki'
import { createRegistryFromEnv } from '../../provider'
import type { CopilotTool } from '../tool-registry'

interface WikiQueryInput {
  question: string
  agent_scope?: string  // slug do agente para incluir wiki dele
}

interface WikiSource {
  title: string
  slug: string
  similarity: number
  scope: 'strategic' | 'agent'
}

interface WikiQueryOutput {
  answer: string
  sources: WikiSource[]
}

export const wikiQueryTool: CopilotTool<WikiQueryInput, WikiQueryOutput> = {
  name: 'system:wiki_query',
  description: 'Busca semântica na wiki estratégica do tenant (e opcionalmente na wiki de um agente específico via slug). Retorna resposta sintetizada com sources citados. Use para perguntas sobre conhecimento, processos, políticas, decisões.',
  input_schema: {
    type: 'object',
    properties: {
      question:    { type: 'string', minLength: 3, description: 'Pergunta em linguagem natural, mínimo 3 caracteres.' },
      agent_scope: { type: 'string', description: 'Slug do agente para incluir sua wiki individual. Omitir para só wiki estratégica.' },
    },
    required: ['question'],
  },
  permission: 'all_members',
  handler: async (input, ctx) => {
    if (!input.question || input.question.length < 3) {
      throw new Error('question must be at least 3 chars')
    }

    const db = getDb()
    const queryEmbedding = await embed(input.question)
    const vectorStr = `[${queryEmbedding.join(',')}]`

    const strategicRows = await db.execute(sql`
      SELECT title, slug, content, 1 - (embedding <=> ${vectorStr}::vector) AS similarity
      FROM wiki_strategic_pages
      WHERE tenant_id = ${ctx.tenant_id} AND status = 'ativo' AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT 5
    `)

    interface WikiRow {
      title: string
      slug: string
      content: string
      similarity: number
    }

    const sources: Array<WikiSource & { content: string }> = []
    for (const r of strategicRows.rows as WikiRow[]) {
      if (r.similarity > 0.4) {
        sources.push({ title: r.title, slug: r.slug, similarity: Number(r.similarity), scope: 'strategic', content: r.content })
      }
    }

    if (input.agent_scope) {
      const agentRows = await db.execute(sql`
        SELECT wap.title, wap.slug, wap.content,
               1 - (wap.embedding <=> ${vectorStr}::vector) AS similarity
        FROM wiki_agent_pages wap
        JOIN agents a ON a.id = wap.agent_id
        WHERE a.tenant_id = ${ctx.tenant_id} AND a.slug = ${input.agent_scope}
          AND wap.status = 'ativo' AND wap.embedding IS NOT NULL
        ORDER BY wap.embedding <=> ${vectorStr}::vector
        LIMIT 3
      `)
      for (const r of agentRows.rows as WikiRow[]) {
        if (r.similarity > 0.4) {
          sources.push({ title: r.title, slug: r.slug, similarity: Number(r.similarity), scope: 'agent', content: r.content })
        }
      }
    }

    sources.sort((a, b) => b.similarity - a.similarity)
    const top = sources.slice(0, 5)
    const wikiContext = top.map(s => `## ${s.title}\n${s.content}`).join('\n\n---\n\n')

    const registry = createRegistryFromEnv()
    const completion = await registry.complete('wiki:query', {
      messages: [
        { role: 'system', content: `Responda usando APENAS o conteúdo da wiki abaixo. Cite títulos de páginas. Se não houver match, diga "não encontrei na wiki".\n\n${wikiContext}` },
        { role: 'user', content: input.question },
      ],
      max_tokens: 800,
      sensitive_data: true,
    })

    return {
      answer: completion.content,
      sources: top.map(s => ({ title: s.title, slug: s.slug, similarity: s.similarity, scope: s.scope })),
    }
  },
}
