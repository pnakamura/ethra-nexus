# ============================================================
# Ethra Nexus — Dockerfile multi-stage
# Stage 1: deps   — instala dependências
# Stage 2: build  — compila o projeto
# Stage 3: runner — imagem final mínima
#
# Pós-migração para Fastify + Drizzle ORM.
# Entry point: apps/server/dist/index.js
# ============================================================

FROM node:20-alpine AS deps
WORKDIR /app

# Copia manifests de todas as workspaces
COPY package.json turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/agents/package.json ./packages/agents/
COPY packages/wiki/package.json ./packages/wiki/

RUN npm install --legacy-peer-deps

# ---

FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build todos os packages e o app
RUN npm run build

# ---

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Cria usuário não-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nexus

# Copia node_modules (workspace packages precisam de @ethra-nexus/* resolvidos)
COPY --from=deps /app/node_modules ./node_modules

# Copia package.json raiz (workspaces config)
COPY --from=builder /app/package.json ./

# Copia dist + package.json de cada package
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/wiki/dist ./packages/wiki/dist
COPY --from=builder /app/packages/wiki/package.json ./packages/wiki/package.json
COPY --from=builder /app/packages/agents/dist ./packages/agents/dist
COPY --from=builder /app/packages/agents/package.json ./packages/agents/package.json

# Copia apps
COPY --from=builder /app/apps/web/dist ./public
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json

# Health check endpoint (usa node fetch nativo, não precisa wget/curl)
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER nexus

EXPOSE 3000

CMD ["node", "apps/server/dist/index.js"]
