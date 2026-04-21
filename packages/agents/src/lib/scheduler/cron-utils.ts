import { parseExpression } from 'cron-parser'

export function validateCron(expression: string): boolean {
  if (!expression.trim()) return false
  try {
    parseExpression(expression)
    return true
  } catch {
    return false
  }
}

export function calcNextRun(expression: string, timezone = 'UTC'): Date {
  const interval = parseExpression(expression, {
    currentDate: new Date(),
    tz: timezone,
  })
  return interval.next().toDate()
}
