// Lightweight structured logger — compatible interface with pino.
// Uses console so no extra peer deps are needed in the agents package.

interface LogFields {
  event?: string
  [key: string]: unknown
}

function formatMsg(fields: LogFields): string {
  return JSON.stringify(fields)
}

export const logger = {
  info(fields: LogFields): void {
    console.log('[info]', formatMsg(fields))
  },
  error(fields: LogFields): void {
    console.error('[error]', formatMsg(fields))
  },
  warn(fields: LogFields): void {
    console.warn('[warn]', formatMsg(fields))
  },
  debug(fields: LogFields): void {
    if ((process.env['LOG_LEVEL'] ?? 'info') === 'debug') {
      console.debug('[debug]', formatMsg(fields))
    }
  },
}
