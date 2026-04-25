declare module '@fastify/static' {
  import type { FastifyPluginCallback } from 'fastify'
  interface FastifyStaticOptions {
    root: string
    prefix?: string
    decorateReply?: boolean
  }
  const plugin: FastifyPluginCallback<FastifyStaticOptions>
  export default plugin
}
