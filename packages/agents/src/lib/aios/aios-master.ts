import type { AgentResult, SkillId, AgentContext } from '@ethra-nexus/core'
import { eq, and } from 'drizzle-orm'
import { getDb, agents } from '@ethra-nexus/db'
import { createAgentsDb } from '../db/db-agents'
import { executeSkill, type SkillInput, type SkillOutput } from '../skills/skill-executor'

export interface AiosTaskRequest {
  tenant_id: string
  agent_id: string
  skill_id: SkillId
  input: SkillInput
  activation_mode?: 'on_demand' | 'scheduled' | 'event'
  activation_source?: string     // canal de origem: 'api', 'whatsapp', schedule_id, etc.
  triggered_by?: string | null   // JWT userId string, 'system', ou null
  user_ip?: string | null
  user_agent?: string | null
}

// Ciclo de vida AIOS Master:
// 1. Carrega agente + valida tenant
// 2. Pre-check: status ativo + budget permite
// 3. Registra aios_event (status: running)
// 4. Executa skill via SkillExecutor
// 5. Loga provider usage + atualiza budget
// 6. Atualiza aios_event (status: ok/error, tokens, cost)
// 7. Post-check: limiar de budget (log — notificação em fase futura)
// 8. Retorna AgentResult<SkillOutput>
export async function executeTask(
  task: AiosTaskRequest,
): Promise<AgentResult<SkillOutput>> {
  const agentsDb = createAgentsDb()
  const db = getDb()
  const month = new Date().toISOString().slice(0, 7)
  const ts = new Date().toISOString()
  const activationMode = task.activation_mode ?? 'on_demand'

  // 1. Carrega agente — verifica que pertence ao tenant
  const agentRows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, task.agent_id), eq(agents.tenant_id, task.tenant_id)))
    .limit(1)
  const agent = agentRows[0]

  if (!agent) {
    return {
      ok: false,
      error: { code: 'SKILL_NOT_FOUND', message: 'Agent not found', retryable: false },
      agent_id: task.agent_id,
      skill_id: task.skill_id,
      timestamp: ts,
    }
  }

  // 2. Pre-check: status
  if (agent.status !== 'active') {
    return {
      ok: false,
      error: { code: 'AGENT_PAUSED', message: `Agent is ${agent.status}`, retryable: false },
      agent_id: task.agent_id,
      skill_id: task.skill_id,
      timestamp: ts,
    }
  }

  // 2. Pre-check: budget
  const budgetCheck = await agentsDb.canExecute(task.agent_id, month, 0.02)
  if (!budgetCheck.allowed) {
    return {
      ok: false,
      error: {
        code: 'BUDGET_EXCEEDED',
        message: budgetCheck.reason ?? 'Budget exceeded',
        retryable: false,
      },
      agent_id: task.agent_id,
      skill_id: task.skill_id,
      timestamp: ts,
    }
  }

  // 3. Registra aios_event (status: running)
  const eventId = await agentsDb.insertAiosEvent({
    tenant_id: task.tenant_id,
    agent_id: task.agent_id,
    skill_id: task.skill_id,
    activation_mode: activationMode,
    payload: task.input as Record<string, unknown>,
    triggered_by: task.triggered_by ?? null,
    user_ip: task.user_ip ?? null,
    user_agent: task.user_agent ?? null,
  })

  // 4. Executa skill
  const context: AgentContext = {
    tenant_id: task.tenant_id,
    agent_id: task.agent_id,
    session_id: eventId,
    wiki_scope: `agent-${agent.slug}`,
    timestamp: ts,
    budget_remaining_usd: Number(agent.budget_monthly),
    tokens_remaining: 0,
  }

  let skillResult: AgentResult<SkillOutput>
  try {
    skillResult = await executeSkill(task.skill_id, context, task.input, {
      system_prompt: agent.system_prompt,
      model: agent.model,
    })
  } catch (err) {
    await agentsDb.updateAiosEvent(eventId, {
      status: 'error',
      error_code: 'AI_ERROR',
      retryable: true,
    })
    return {
      ok: false,
      error: {
        code: 'AI_ERROR',
        message: err instanceof Error ? err.message : 'Unknown AI error',
        retryable: true,
      },
      agent_id: task.agent_id,
      skill_id: task.skill_id,
      timestamp: ts,
    }
  }

  // 5 + 6. Contabiliza e atualiza evento
  if (skillResult.ok) {
    const { tokens_in, tokens_out, cost_usd, provider, model, is_fallback } = skillResult.data
    const totalTokens = tokens_in + tokens_out

    await agentsDb.logProviderUsage({
      tenant_id: task.tenant_id,
      agent_id: task.agent_id,
      skill_id: task.skill_id,
      provider,
      model,
      tokens_in,
      tokens_out,
      cost_usd,
      latency_ms: 0,
      is_fallback,
      is_sensitive: true,
    })

    await agentsDb.upsertBudget(task.agent_id, task.tenant_id, month, cost_usd, totalTokens)

    await agentsDb.updateAiosEvent(eventId, {
      status: 'ok',
      result: { answer: skillResult.data.answer, cost_usd, tokens: totalTokens },
      tokens_used: totalTokens,
      cost_usd,
    })

    // 7. Post-check: limiar de budget (log apenas — notificação em fase 7b)
    const budgetRow = await agentsDb.getBudget(task.agent_id, month)
    const spentUsd = budgetRow != null ? Number(budgetRow.spent_usd) : 0
    const limitUsd = Number(agent.budget_monthly)
    if (limitUsd > 0 && spentUsd / limitUsd >= 0.9) {
      // TODO fase 7b: disparar AlertThreshold (notify_dashboard, notify_email)
    }
  } else {
    await agentsDb.updateAiosEvent(eventId, {
      status: 'error',
      error_code: skillResult.error.code,
      retryable: skillResult.error.retryable,
    })
  }

  return skillResult
}
