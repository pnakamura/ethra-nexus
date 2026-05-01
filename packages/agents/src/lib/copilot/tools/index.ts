import type { CopilotTool } from '../tool-registry'
import { listAgentsTool } from './list-agents'
import { getRecentEventsTool } from './get-recent-events'
import { explainEventTool } from './explain-event'
import { getBudgetStatusTool } from './get-budget-status'
import { costBreakdownTool } from './cost-breakdown'
import { agentHealthTool } from './agent-health'
import { listPendingApprovalsTool } from './list-pending-approvals'
import { wikiQueryTool } from './wiki-query'
import { listStorageAlertsTool } from './list-storage-alerts'

export const allCopilotTools: CopilotTool[] = [
  listAgentsTool,
  getRecentEventsTool,
  explainEventTool,
  getBudgetStatusTool,
  costBreakdownTool,
  agentHealthTool,
  listPendingApprovalsTool,
  wikiQueryTool,
  listStorageAlertsTool,
] as CopilotTool[]

// Anthropic returns tool_use.name with ':' transformed to '_' (see getToolsForAnthropic).
// Match either the original name or the Anthropic-normalized form.
export function findToolByName(name: string): CopilotTool | undefined {
  return allCopilotTools.find(t => t.name === name || t.name.replace(/:/g, '_') === name)
}
