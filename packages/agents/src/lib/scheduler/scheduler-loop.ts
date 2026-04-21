import { eq, and, lte } from 'drizzle-orm'
import { getDb, agentSchedules } from '@ethra-nexus/db'
import type { SkillId } from '@ethra-nexus/core'
import { executeTask } from '../aios/aios-master'
import { dispatchOutput } from './output-dispatcher'
import { calcNextRun } from './cron-utils'
import { drainEventQueue } from './event-bus'

export function startSchedulerLoop(intervalMs = 60_000): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void runTick()
  }, intervalMs)
}

async function runTick(): Promise<void> {
  await Promise.allSettled([
    runDueSchedules(),
    processEventQueue(),
  ])
}

async function runDueSchedules(): Promise<void> {
  const db = getDb()
  const now = new Date()

  const due = await db
    .select()
    .from(agentSchedules)
    .where(and(
      eq(agentSchedules.enabled, true),
      lte(agentSchedules.next_run_at, now),
    ))

  await Promise.allSettled(due.map(runSchedule))
}

async function runSchedule(
  schedule: typeof agentSchedules.$inferSelect,
): Promise<void> {
  const db = getDb()
  const runAt = new Date()

  const result = await executeTask({
    tenant_id: schedule.tenant_id,
    agent_id: schedule.agent_id,
    skill_id: schedule.skill_id as SkillId,
    input: (schedule.input ?? {}) as Record<string, unknown>,
    activation_mode: 'scheduled',
    activation_source: schedule.id,
    triggered_by: 'scheduler',
  })

  await dispatchOutput(result, {
    tenant_id: schedule.tenant_id,
    agent_id: schedule.agent_id,
    skill_id: schedule.skill_id,
    output_channel: schedule.output_channel,
    schedule_id: schedule.id,
  })

  await db
    .update(agentSchedules)
    .set({
      last_run_at: runAt,
      next_run_at: calcNextRun(schedule.cron_expression, schedule.timezone),
      updated_at: new Date(),
    })
    .where(eq(agentSchedules.id, schedule.id))
}

async function processEventQueue(): Promise<void> {
  const pending = drainEventQueue()

  await Promise.allSettled(
    pending.map(async ({ subscription, payload }) => {
      const callDepth =
        typeof payload['__call_depth'] === 'number' ? payload['__call_depth'] : 0
      const result = await executeTask({
        tenant_id: subscription.tenant_id,
        agent_id: subscription.agent_id,
        skill_id: subscription.skill_id as SkillId,
        input: { ...subscription.input, ...payload },
        activation_mode: 'event',
        activation_source: 'event-bus',
        triggered_by: 'event-bus',
        call_depth: callDepth,
      })
      await dispatchOutput(result, {
        tenant_id: subscription.tenant_id,
        agent_id: subscription.agent_id,
        skill_id: subscription.skill_id,
        output_channel: subscription.output_channel,
      })
    }),
  )
}
