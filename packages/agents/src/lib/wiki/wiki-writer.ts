import { createRegistryFromEnv } from '../provider'
import { embed } from '@ethra-nexus/wiki'
import { getDb, wikiAgentWrites, wikiAgentPages } from '@ethra-nexus/db'
import { sql } from 'drizzle-orm'

export interface WikiLessonInput {
  agent_id: string
  tenant_id: string
  aios_event_id: string
  question: string
  answer: string
  write_mode: 'manual' | 'supervised' | 'auto'
}

interface SynthesizedLesson {
  title: string
  type: string
  content: string
}

const SYNTHESIS_PROMPT = `Você é um sintetizador de conhecimento organizacional.
Dada a interação abaixo, gere uma página de conhecimento reutilizável em JSON com:
- title: string (título conciso da lição aprendida, máximo 80 chars)
- type: "padrao" | "procedimento" | "conceito" | "referencia"
- content: string (conteúdo em Markdown, 3-8 parágrafos, sem dados pessoais)

Capture o conhecimento reutilizável, não o contexto específico da conversa.
Responda APENAS com o JSON, sem markdown ao redor.`

const VALID_TYPES = ['padrao', 'procedimento', 'conceito', 'referencia']

const registry = createRegistryFromEnv()

function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

async function synthesizeLesson(question: string, answer: string): Promise<SynthesizedLesson | null> {
  try {
    const completion = await registry.complete('wiki:lint', {
      messages: [
        { role: 'system', content: SYNTHESIS_PROMPT },
        { role: 'user', content: `PERGUNTA: ${question}\n\nRESPOSTA: ${answer}` },
      ],
      max_tokens: 800,
      sensitive_data: false,
    })

    const parsed = JSON.parse(completion.content) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['title'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['type'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['content'] === 'string'
    ) {
      return parsed as SynthesizedLesson
    }
    return null
  } catch {
    return null
  }
}

export async function writeLesson(input: WikiLessonInput): Promise<void> {
  if (input.write_mode === 'manual') return

  const lesson = await synthesizeLesson(input.question, input.answer)
  if (!lesson) return

  const timestamp = Date.now()
  const slug = `lesson-${timestamp}-${titleToSlug(lesson.title)}`
  const type = VALID_TYPES.includes(lesson.type) ? lesson.type : 'padrao'

  let embedding: number[] | null = null
  try {
    embedding = await embed(`${lesson.title}\n${lesson.content}`)
  } catch {
    // embedding failure é non-fatal
  }

  const db = getDb()
  const status = input.write_mode === 'auto' ? 'approved' : 'draft'

  await db.transaction(async (tx) => {
    await tx.insert(wikiAgentWrites).values({
      tenant_id: input.tenant_id,
      agent_id: input.agent_id,
      target_wiki: 'agent',
      slug,
      title: lesson.title,
      content: lesson.content,
      type,
      status,
      aios_event_id: input.aios_event_id,
      metadata: { question_preview: input.question.slice(0, 200) },
    })

    if (input.write_mode === 'auto') {
      await tx.insert(wikiAgentPages).values({
        agent_id: input.agent_id,
        tenant_id: input.tenant_id,
        slug,
        title: lesson.title,
        type,
        content: lesson.content,
        origin: `aios_event:${input.aios_event_id}`,
        confidence: 'media',
        status: 'ativo',
      })

      if (embedding) {
        const vectorStr = `[${embedding.join(',')}]`
        await tx.execute(
          sql`UPDATE wiki_agent_pages SET embedding = ${vectorStr}::vector
              WHERE agent_id = ${input.agent_id} AND slug = ${slug}`,
        )
      }
    }
  })
}
