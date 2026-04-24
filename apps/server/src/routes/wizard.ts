import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { getDb, agents, cloneWizardSessions } from '@ethra-nexus/db'
import { createRegistryFromEnv, executeTask } from '@ethra-nexus/agents'
import { validateUUID } from '@ethra-nexus/core'

// ──────────────────────────────────────────────────────────────
// Clone Wizard — bootstrap de wiki via entrevista multi-etapa
//
// Fluxo:
//   POST   /agents/:id/wizard/sessions           → inicia sessão (gera perguntas)
//   GET    /agents/:id/wizard/sessions/:sid       → estado atual
//   PATCH  /agents/:id/wizard/sessions/:sid       → submete respostas (parcial ok)
//   POST   /agents/:id/wizard/sessions/:sid/finish→ sintetiza wiki via wiki:ingest
// ──────────────────────────────────────────────────────────────

const QUESTION_PROMPT = `Você é um especialista em transferência de conhecimento organizacional.
Dado o perfil de um agente de IA abaixo, gere exatamente 6 perguntas de entrevista que vão
extrair o máximo de conhecimento do especialista humano para popular a wiki do agente.

As perguntas devem cobrir:
1. Domínio central e contexto de negócio
2. Processos e procedimentos mais comuns
3. Casos e cenários frequentes
4. Terminologia e conceitos-chave do setor
5. Regras de escalação, exceções e restrições
6. Informações de contato, times e responsabilidades

Responda APENAS com um JSON array de objetos, sem markdown ao redor:
[
  {"index": 0, "text": "pergunta aqui"},
  ...
]`

interface QuestionItem {
  index: number
  text: string
}

interface AnswerItem {
  question_index: number
  answer: string
}

async function generateQuestions(
  agentName: string,
  agentRole: string,
  description: string | null,
  systemPrompt: string,
): Promise<QuestionItem[]> {
  const registry = createRegistryFromEnv()
  const agentProfile = [
    `Nome: ${agentName}`,
    `Papel: ${agentRole}`,
    description ? `Descrição: ${description}` : null,
    systemPrompt ? `System Prompt (trecho): ${systemPrompt.slice(0, 500)}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const completion = await registry.complete('wiki:lint', {
    messages: [
      { role: 'system', content: QUESTION_PROMPT },
      { role: 'user', content: agentProfile },
    ],
    max_tokens: 1000,
    sensitive_data: false,
  })

  const parsed = JSON.parse(completion.content) as unknown
  if (!Array.isArray(parsed)) throw new Error('LLM did not return an array')

  return (parsed as unknown[])
    .filter(
      (q): q is QuestionItem =>
        typeof q === 'object' &&
        q !== null &&
        typeof (q as Record<string, unknown>)['index'] === 'number' &&
        typeof (q as Record<string, unknown>)['text'] === 'string',
    )
    .slice(0, 6)
}

function buildInterviewMarkdown(
  agentName: string,
  agentRole: string,
  questions: QuestionItem[],
  answers: AnswerItem[],
): string {
  const answerMap = new Map(answers.map((a) => [a.question_index, a.answer]))
  const lines = [
    `# Entrevista de Onboarding — ${agentName}`,
    `**Papel:** ${agentRole}`,
    '',
  ]
  for (const q of questions) {
    const answer = answerMap.get(q.index) ?? ''
    lines.push(`## Pergunta ${q.index + 1}: ${q.text}`, '', answer.trim(), '')
  }
  return lines.join('\n')
}

export async function wizardRoutes(app: FastifyInstance) {
  // POST /agents/:id/wizard/sessions — inicia sessão e gera perguntas
  app.post<{ Params: { id: string } }>(
    '/agents/:id/wizard/sessions',
    async (request, reply) => {
      try {
        validateUUID(request.params.id, 'id')
      } catch {
        return reply.status(400).send({ error: 'Invalid agent id format' })
      }

      const db = getDb()
      const agentId = request.params.id

      const agentRows = await db
        .select({
          id: agents.id,
          name: agents.name,
          role: agents.role,
          description: agents.description,
          system_prompt: agents.system_prompt,
          status: agents.status,
        })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.tenant_id, request.tenantId)))
        .limit(1)

      const agent = agentRows[0]
      if (!agent || agent.status === 'archived') {
        return reply.status(404).send({ error: 'Agent not found' })
      }

      let questions: QuestionItem[]
      try {
        questions = await generateQuestions(
          agent.name,
          agent.role,
          agent.description,
          agent.system_prompt,
        )
      } catch {
        return reply.status(502).send({ error: 'Failed to generate interview questions' })
      }

      if (questions.length === 0) {
        return reply.status(502).send({ error: 'LLM returned no questions' })
      }

      const [session] = await db
        .insert(cloneWizardSessions)
        .values({
          tenant_id: request.tenantId,
          agent_id: agentId,
          questions,
          answers: [],
        })
        .returning()

      return reply.status(201).send({ data: session })
    },
  )

  // GET /agents/:id/wizard/sessions/:session_id — estado da sessão
  app.get<{ Params: { id: string; session_id: string } }>(
    '/agents/:id/wizard/sessions/:session_id',
    async (request, reply) => {
      try {
        validateUUID(request.params.id, 'id')
        validateUUID(request.params.session_id, 'session_id')
      } catch {
        return reply.status(400).send({ error: 'Invalid id format' })
      }

      const db = getDb()
      const rows = await db
        .select()
        .from(cloneWizardSessions)
        .where(
          and(
            eq(cloneWizardSessions.id, request.params.session_id),
            eq(cloneWizardSessions.agent_id, request.params.id),
            eq(cloneWizardSessions.tenant_id, request.tenantId),
          ),
        )
        .limit(1)

      if (!rows[0]) return reply.status(404).send({ error: 'Session not found' })
      return { data: rows[0] }
    },
  )

  // PATCH /agents/:id/wizard/sessions/:session_id — submete respostas (parcial ok)
  app.patch<{
    Params: { id: string; session_id: string }
    Body: { answers: AnswerItem[] }
  }>(
    '/agents/:id/wizard/sessions/:session_id',
    async (request, reply) => {
      try {
        validateUUID(request.params.id, 'id')
        validateUUID(request.params.session_id, 'session_id')
      } catch {
        return reply.status(400).send({ error: 'Invalid id format' })
      }

      const { answers } = request.body
      if (!Array.isArray(answers) || answers.length === 0) {
        return reply.status(400).send({ error: 'answers must be a non-empty array' })
      }
      for (const a of answers) {
        if (typeof a.question_index !== 'number' || typeof a.answer !== 'string') {
          return reply.status(400).send({ error: 'Each answer needs question_index (number) and answer (string)' })
        }
        if (a.answer.length > 5000) {
          return reply.status(400).send({ error: `Answer for question_index ${a.question_index} exceeds 5000 chars` })
        }
      }

      const db = getDb()
      const rows = await db
        .select()
        .from(cloneWizardSessions)
        .where(
          and(
            eq(cloneWizardSessions.id, request.params.session_id),
            eq(cloneWizardSessions.agent_id, request.params.id),
            eq(cloneWizardSessions.tenant_id, request.tenantId),
          ),
        )
        .limit(1)

      const session = rows[0]
      if (!session) return reply.status(404).send({ error: 'Session not found' })
      if (session.status !== 'active') {
        return reply.status(409).send({ error: `Session is already ${session.status}` })
      }

      // Merge: new answers overwrite existing ones with same question_index
      const existing = (session.answers as AnswerItem[]) ?? []
      const merged = new Map(existing.map((a) => [a.question_index, a]))
      for (const a of answers) merged.set(a.question_index, a)

      const [updated] = await db
        .update(cloneWizardSessions)
        .set({ answers: Array.from(merged.values()) })
        .where(eq(cloneWizardSessions.id, request.params.session_id))
        .returning()

      return { data: updated }
    },
  )

  // POST /agents/:id/wizard/sessions/:session_id/finish — sintetiza wiki
  app.post<{ Params: { id: string; session_id: string } }>(
    '/agents/:id/wizard/sessions/:session_id/finish',
    async (request, reply) => {
      try {
        validateUUID(request.params.id, 'id')
        validateUUID(request.params.session_id, 'session_id')
      } catch {
        return reply.status(400).send({ error: 'Invalid id format' })
      }

      const db = getDb()
      const agentId = request.params.id

      const [sessionRows, agentRows] = await Promise.all([
        db
          .select()
          .from(cloneWizardSessions)
          .where(
            and(
              eq(cloneWizardSessions.id, request.params.session_id),
              eq(cloneWizardSessions.agent_id, agentId),
              eq(cloneWizardSessions.tenant_id, request.tenantId),
            ),
          )
          .limit(1),
        db
          .select({ name: agents.name, role: agents.role })
          .from(agents)
          .where(and(eq(agents.id, agentId), eq(agents.tenant_id, request.tenantId)))
          .limit(1),
      ])

      const session = sessionRows[0]
      if (!session) return reply.status(404).send({ error: 'Session not found' })
      if (session.status !== 'active') {
        return reply.status(409).send({ error: `Session is already ${session.status}` })
      }

      const agent = agentRows[0]
      if (!agent) return reply.status(404).send({ error: 'Agent not found' })

      const questions = (session.questions as QuestionItem[]) ?? []
      const answers = (session.answers as AnswerItem[]) ?? []

      // Requer pelo menos metade das perguntas respondidas
      if (answers.length < Math.ceil(questions.length / 2)) {
        return reply.status(422).send({
          error: `At least ${Math.ceil(questions.length / 2)} of ${questions.length} questions must be answered before finishing`,
        })
      }

      const content = buildInterviewMarkdown(agent.name, agent.role, questions, answers)

      const result = await executeTask({
        tenant_id: request.tenantId,
        agent_id: agentId,
        skill_id: 'wiki:ingest',
        input: {
          content,
          source_name: `clone-wizard-${agentId.slice(0, 8)}`,
        },
        activation_mode: 'on_demand',
        activation_source: 'wizard',
      })

      const pagesCreated = result.ok
        ? parseInt(
            (result.data as { answer?: string })?.answer?.match(/(\d+) p[aá]ginas? persist/)?.[1] ?? '0',
            10,
          )
        : 0

      await db
        .update(cloneWizardSessions)
        .set({
          status: 'completed',
          pages_created: pagesCreated,
          completed_at: new Date(),
        })
        .where(eq(cloneWizardSessions.id, request.params.session_id))

      if (!result.ok) {
        return reply.status(502).send({
          error: 'Wiki ingest failed',
          detail: result.error.message,
        })
      }

      return {
        data: {
          session_id: session.id,
          pages_created: pagesCreated,
          summary: (result.data as { answer?: string })?.answer ?? '',
        },
      }
    },
  )
}
