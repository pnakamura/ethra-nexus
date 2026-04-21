// apps/server/src/__tests__/setup.ts
// Executa antes de cada suite E2E — configura variáveis de ambiente

// Redireciona DATABASE_URL para o banco de teste
const testDb = process.env['DATABASE_URL_TEST']
if (testDb) {
  process.env['DATABASE_URL'] = testDb
}

// Força mock de LLM — zero custo em CI
process.env['NEXUS_MOCK_LLM'] = 'true'

// JWT secret previsível para testes
process.env['JWT_SECRET'] = 'dev-secret-change-in-production'
