# Ethra Nexus Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Ethra Nexus React frontend — auth, dashboard, agent CRUD, agent detail with all 5 sections — using the "Surface of Consciousness" design system adapted from nexus-whisper.

**Architecture:** React 18 + TypeScript strict + Vite; TanStack Query for server state; AuthContext + localStorage for JWT; shadcn/ui components on top of Tailwind v3; Paper/Ink/Cobalt design tokens from nexus-whisper.

**Tech Stack:** React 18, React Router v6, TanStack Query v5, Axios, React Hook Form + Zod, shadcn/ui, Tailwind CSS v3, Lucide React, Sonner, next-themes

---

## Task 1: Backend — POST /api/v1/auth/signup

**Files:**
- Modify: `apps/server/src/routes/auth.ts`
- Modify: `apps/server/src/app.ts` (if needed — check registration)

- [ ] **Step 1: Add signup endpoint to auth.ts**

Replace the entire `apps/server/src/routes/auth.ts` with:

```typescript
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { getDb, tenants } from '@ethra-nexus/db'
import bcrypt from 'bcryptjs'

interface LoginBody { slug: string; password: string }
interface SignupBody { name: string; slug: string; password: string }

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
    const { slug, password } = request.body
    if (!slug || !password) {
      return reply.status(400).send({ error: 'slug and password are required' })
    }
    const db = getDb()
    const result = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1)
    const tenant = result[0]
    if (!tenant || !tenant.password_hash) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }
    const valid = await bcrypt.compare(password, tenant.password_hash)
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }
    const token = app.jwt.sign(
      { tenantId: tenant.id, slug: tenant.slug, role: 'admin' },
      { expiresIn: '24h' },
    )
    return { token, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } }
  })

  app.post<{ Body: SignupBody }>('/auth/signup', async (request, reply) => {
    const { name, slug, password } = request.body
    if (!name || !slug || !password) {
      return reply.status(400).send({ error: 'name, slug and password are required' })
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return reply.status(400).send({ error: 'slug must be lowercase letters, numbers and hyphens only' })
    }
    if (password.length < 8) {
      return reply.status(400).send({ error: 'password must be at least 8 characters' })
    }
    const db = getDb()
    const existing = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1)
    if (existing[0]) {
      return reply.status(409).send({ error: 'slug already taken' })
    }
    const password_hash = await bcrypt.hash(password, 12)
    const inserted = await db.insert(tenants).values({ name, slug, password_hash }).returning()
    const tenant = inserted[0]
    if (!tenant) {
      return reply.status(500).send({ error: 'Failed to create tenant' })
    }
    const token = app.jwt.sign(
      { tenantId: tenant.id, slug: tenant.slug, role: 'admin' },
      { expiresIn: '24h' },
    )
    return reply.status(201).send({
      token,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    })
  })
}
```

- [ ] **Step 2: Verify auth routes are registered in app.ts**

Run:
```bash
grep -n "authRoutes\|/auth" apps/server/src/app.ts
```
Expected: a line like `app.register(authRoutes, { prefix: '/api/v1' })`. If missing, add it.

- [ ] **Step 3: Run typecheck**

```bash
cd apps/server && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/auth.ts
git commit -m "feat(server): add POST /auth/signup endpoint"
```

---

## Task 2: Backend — GET /api/v1/dashboard

**Files:**
- Create: `apps/server/src/routes/dashboard.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Create dashboard route**

Create `apps/server/src/routes/dashboard.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import { eq, and, gte, sum, count } from 'drizzle-orm'
import { getDb, agents, aiosEvents, agentSkills } from '@ethra-nexus/db'
import { sql } from 'drizzle-orm'

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard', async (request) => {
    const db = getDb()
    const tenantId = request.tenantId

    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [activeAgents, eventStats, recentAgents] = await Promise.all([
      db
        .select({ count: count() })
        .from(agents)
        .where(and(eq(agents.tenant_id, tenantId), eq(agents.status, 'active'))),

      db
        .select({
          executions: count(),
          cost_usd: sum(aiosEvents.cost_usd),
        })
        .from(aiosEvents)
        .where(
          and(
            eq(aiosEvents.tenant_id, tenantId),
            gte(aiosEvents.started_at, monthStart),
          ),
        ),

      db
        .select({
          id: agents.id,
          name: agents.name,
          role: agents.role,
          status: agents.status,
          created_at: agents.created_at,
        })
        .from(agents)
        .where(
          and(eq(agents.tenant_id, tenantId), sql`${agents.status} != 'archived'`),
        )
        .orderBy(sql`${agents.created_at} desc`)
        .limit(5),
    ])

    const agentIds = recentAgents.map((a) => a.id)
    let skillsByAgent: Record<string, string[]> = {}

    if (agentIds.length > 0) {
      const skills = await db
        .select({ agent_id: agentSkills.agent_id, skill_name: agentSkills.skill_name })
        .from(agentSkills)
        .where(sql`${agentSkills.agent_id} = ANY(${sql.raw(`ARRAY['${agentIds.join("','")}']::uuid[]`)})`)

      for (const s of skills) {
        if (!skillsByAgent[s.agent_id]) skillsByAgent[s.agent_id] = []
        skillsByAgent[s.agent_id]!.push(s.skill_name)
      }
    }

    return {
      data: {
        agents_active: activeAgents[0]?.count ?? 0,
        executions_month: eventStats[0]?.executions ?? 0,
        cost_usd_month: parseFloat(String(eventStats[0]?.cost_usd ?? '0')),
        recent_agents: recentAgents.map((a) => ({
          ...a,
          skills: skillsByAgent[a.id] ?? [],
        })),
      },
    }
  })
}
```

- [ ] **Step 2: Register in app.ts**

In `apps/server/src/app.ts`, add after the other route imports:

```typescript
import { dashboardRoutes } from './routes/dashboard'
```

And register:
```typescript
await app.register(dashboardRoutes, { prefix: '/api/v1' })
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/server && npx tsc --noEmit
git add apps/server/src/routes/dashboard.ts apps/server/src/app.ts
git commit -m "feat(server): add GET /dashboard endpoint"
```

---

## Task 3: Frontend — Install dependencies + Tailwind + shadcn/ui

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.js`
- Modify: `apps/web/vite.config.ts`
- Create: `apps/web/components.json` (shadcn config)

- [ ] **Step 1: Install all dependencies**

```bash
cd apps/web
npm install @tanstack/react-query axios react-hook-form @hookform/resolvers zod next-themes sonner lucide-react clsx tailwind-merge class-variance-authority tailwindcss-animate
npm install -D tailwindcss postcss autoprefixer
```

- [ ] **Step 2: Initialize Tailwind**

```bash
cd apps/web && npx tailwindcss init -p --ts
```

This creates `tailwind.config.ts` and `postcss.config.js`.

- [ ] **Step 3: Initialize shadcn/ui**

```bash
cd apps/web && npx shadcn@latest init --yes
```

When prompted (if interactive), choose: TypeScript, default style, slate base color, `src/styles/globals.css` for CSS file, CSS variables for colors, `@/` for import alias.

If non-interactive fails, create `components.json` manually:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 4: Install shadcn components**

```bash
cd apps/web
npx shadcn@latest add button card badge tabs dialog tooltip skeleton separator avatar input textarea select switch slider progress
```

- [ ] **Step 5: Create lib/utils.ts** (if shadcn init didn't create it)

```typescript
// apps/web/src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 6: Verify shadcn components exist**

```bash
ls apps/web/src/components/ui/
```
Expected: `button.tsx`, `card.tsx`, `badge.tsx`, `tabs.tsx`, `input.tsx`, etc.

- [ ] **Step 7: Commit**

```bash
cd apps/web
git add package.json tailwind.config.ts postcss.config.js components.json src/components/ui/ src/lib/utils.ts
git commit -m "feat(web): install Tailwind v3 + shadcn/ui + dependencies"
```

---

## Task 4: Design tokens — globals.css + tailwind.config.ts

**Files:**
- Modify: `apps/web/src/index.css`
- Modify: `apps/web/tailwind.config.ts`
- Modify: `apps/web/vite.config.ts` (add Google Fonts via html plugin or index.html)
- Modify: `apps/web/index.html`

- [ ] **Step 1: Replace index.css with design tokens**

Replace the entire `apps/web/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 45 33% 97%;
    --foreground: 0 0% 20%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 20%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 20%;
    --primary: 218 90% 45%;
    --primary-foreground: 0 0% 100%;
    --secondary: 45 20% 93%;
    --secondary-foreground: 0 0% 20%;
    --muted: 45 20% 93%;
    --muted-foreground: 0 0% 55%;
    --accent: 218 90% 45%;
    --accent-foreground: 0 0% 100%;
    --accent-glow: 218 90% 45%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 100%;
    --border: 45 33% 88%;
    --input: 45 33% 88%;
    --ring: 218 90% 45%;
    --radius: 0.5rem;
    --status-active: 142 71% 45%;
    --status-warning: 45 93% 47%;
    --status-error: 0 84% 60%;
  }

  .dark {
    --background: 0 0% 8%;
    --foreground: 45 33% 92%;
    --card: 0 0% 11%;
    --card-foreground: 45 33% 92%;
    --popover: 0 0% 11%;
    --popover-foreground: 45 33% 92%;
    --primary: 218 80% 60%;
    --primary-foreground: 0 0% 100%;
    --secondary: 0 0% 15%;
    --secondary-foreground: 45 33% 92%;
    --muted: 0 0% 15%;
    --muted-foreground: 0 0% 55%;
    --accent: 218 80% 60%;
    --accent-foreground: 0 0% 100%;
    --accent-glow: 218 80% 60%;
    --destructive: 0 62% 50%;
    --destructive-foreground: 0 0% 100%;
    --border: 0 0% 18%;
    --input: 0 0% 18%;
    --ring: 218 80% 60%;
  }
}

@layer base {
  * { @apply border-border; }
  body {
    @apply bg-background text-foreground;
    font-family: 'Inter', system-ui, sans-serif;
    font-weight: 300;
  }
  h1, h2, h3 {
    font-family: 'Playfair Display', Georgia, serif;
  }
}

/* Paper grain overlay */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(circle at 1px 1px, rgba(0,0,0,0.018) 1px, transparent 0),
    radial-gradient(circle at 3px 3px, rgba(0,0,0,0.009) 1px, transparent 0);
  background-size: 3px 3px, 7px 7px;
  z-index: 9999;
}

/* Animations */
@keyframes halo-pulse {
  0%, 100% { box-shadow: 0 0 0 0 hsl(var(--accent-glow) / 0.22); }
  50%       { box-shadow: 0 0 0 5px hsl(var(--accent-glow) / 0.22); }
}
@keyframes mist-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes phantom {
  from { opacity: 0; filter: blur(6px); }
  to   { opacity: 1; filter: blur(0); }
}

.halo-pulse  { animation: halo-pulse 5s ease-in-out infinite; }
.mist-in     { animation: mist-in 0.45s ease forwards; }
.phantom     { animation: phantom 1.4s ease forwards; }

/* Staggered list entrance */
.mist-item:nth-child(1) { animation: mist-in 0.4s 0.05s ease both; }
.mist-item:nth-child(2) { animation: mist-in 0.4s 0.10s ease both; }
.mist-item:nth-child(3) { animation: mist-in 0.4s 0.15s ease both; }
.mist-item:nth-child(4) { animation: mist-in 0.4s 0.20s ease both; }
.mist-item:nth-child(5) { animation: mist-in 0.4s 0.25s ease both; }

/* Cobalt underline for active nav */
.cobalt-underline { position: relative; }
.cobalt-underline::after {
  content: '';
  position: absolute;
  left: 8px; right: 8px; bottom: 6px;
  height: 2px;
  background: hsl(var(--accent));
  box-shadow: 0 0 8px hsl(var(--accent-glow) / 0.4);
  border-radius: 1px;
}

/* Scrollbar */
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 3px; }
```

- [ ] **Step 2: Update tailwind.config.ts**

Replace `apps/web/tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss'
import { fontFamily } from 'tailwindcss/defaultTheme'
import animate from 'tailwindcss-animate'

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', ...fontFamily.sans],
        serif: ['Playfair Display', ...fontFamily.serif],
      },
    },
  },
  plugins: [animate],
}

export default config
```

- [ ] **Step 3: Add Google Fonts to index.html**

In `apps/web/index.html`, add inside `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd apps/web && npx tsc --noEmit
git add src/index.css tailwind.config.ts index.html
git commit -m "feat(web): add Surface of Consciousness design tokens"
```

---

## Task 5: AuthContext + api.ts + queryClient + main.tsx

**Files:**
- Create: `apps/web/src/contexts/AuthContext.tsx`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/queryClient.ts`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 1: Write AuthContext test**

Create `apps/web/src/contexts/__tests__/AuthContext.test.tsx`:

```typescript
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AuthProvider, useAuth } from '../AuthContext'

function TestComponent() {
  const { token, isAuthenticated, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="auth">{isAuthenticated ? 'yes' : 'no'}</span>
      <span data-testid="token">{token ?? 'none'}</span>
      <button onClick={() => login('test-token')}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  )
}

describe('AuthContext', () => {
  beforeEach(() => localStorage.clear())

  it('starts unauthenticated when localStorage empty', () => {
    render(<AuthProvider><TestComponent /></AuthProvider>)
    expect(screen.getByTestId('auth').textContent).toBe('no')
  })

  it('login sets token and isAuthenticated', () => {
    render(<AuthProvider><TestComponent /></AuthProvider>)
    act(() => screen.getByText('login').click())
    expect(screen.getByTestId('auth').textContent).toBe('yes')
    expect(screen.getByTestId('token').textContent).toBe('test-token')
    expect(localStorage.getItem('ethra_token')).toBe('test-token')
  })

  it('logout clears token', () => {
    localStorage.setItem('ethra_token', 'existing')
    render(<AuthProvider><TestComponent /></AuthProvider>)
    act(() => screen.getByText('logout').click())
    expect(screen.getByTestId('auth').textContent).toBe('no')
    expect(localStorage.getItem('ethra_token')).toBeNull()
  })

  it('reads existing token from localStorage on mount', () => {
    localStorage.setItem('ethra_token', 'persisted')
    render(<AuthProvider><TestComponent /></AuthProvider>)
    expect(screen.getByTestId('auth').textContent).toBe('yes')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && npx vitest run src/contexts/__tests__/AuthContext.test.tsx
```
Expected: FAIL — `AuthContext` not found.

- [ ] **Step 3: Create AuthContext**

Create `apps/web/src/contexts/AuthContext.tsx`:

```typescript
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface AuthContextValue {
  token: string | null
  isAuthenticated: boolean
  login: (token: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const STORAGE_KEY = 'ethra_token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY))

  const login = useCallback((t: string) => {
    localStorage.setItem(STORAGE_KEY, t)
    setToken(t)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setToken(null)
  }, [])

  return (
    <AuthContext.Provider value={{ token, isAuthenticated: token !== null, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web && npx vitest run src/contexts/__tests__/AuthContext.test.tsx
```
Expected: 4 tests PASS.

- [ ] **Step 5: Create api.ts**

Create `apps/web/src/lib/api.ts`:

```typescript
import axios from 'axios'

const STORAGE_KEY = 'ethra_token'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(STORAGE_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(STORAGE_KEY)
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)
```

- [ ] **Step 6: Create queryClient.ts**

Create `apps/web/src/lib/queryClient.ts`:

```typescript
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})
```

- [ ] **Step 7: Update main.tsx**

Replace `apps/web/src/main.tsx`:

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/contexts/AuthContext'
import { queryClient } from '@/lib/queryClient'
import App from './App'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="light">
          <AuthProvider>
            <App />
            <Toaster richColors position="top-right" />
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 8: Typecheck + commit**

```bash
cd apps/web && npx tsc --noEmit
git add src/contexts/ src/lib/api.ts src/lib/queryClient.ts src/main.tsx
git commit -m "feat(web): add AuthContext, axios client, QueryClient, providers"
```

---

## Task 6: PrivateRoute + AppLayout + Sidebar

**Files:**
- Create: `apps/web/src/components/auth/PrivateRoute.tsx`
- Create: `apps/web/src/components/layout/AppLayout.tsx`
- Create: `apps/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Write PrivateRoute test**

Create `apps/web/src/components/auth/__tests__/PrivateRoute.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '@/contexts/AuthContext'
import { PrivateRoute } from '../PrivateRoute'

describe('PrivateRoute', () => {
  it('renders children when authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, token: 't', login: vi.fn(), logout: vi.fn() })
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<PrivateRoute />}>
            <Route path="/dashboard" element={<div>Protected</div>} />
          </Route>
          <Route path="/login" element={<div>Login</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('Protected')).toBeTruthy()
  })

  it('redirects to /login when not authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false, token: null, login: vi.fn(), logout: vi.fn() })
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<PrivateRoute />}>
            <Route path="/dashboard" element={<div>Protected</div>} />
          </Route>
          <Route path="/login" element={<div>Login</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('Login')).toBeTruthy()
    expect(screen.queryByText('Protected')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && npx vitest run src/components/auth/__tests__/PrivateRoute.test.tsx
```

- [ ] **Step 3: Create PrivateRoute**

Create `apps/web/src/components/auth/PrivateRoute.tsx`:

```typescript
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

export function PrivateRoute() {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/web && npx vitest run src/components/auth/__tests__/PrivateRoute.test.tsx
```

- [ ] **Step 5: Create Sidebar**

Create `apps/web/src/components/layout/Sidebar.tsx`:

```typescript
import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Bot, BookOpen, Settings, LogOut, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useAuth } from '@/contexts/AuthContext'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/agents',    icon: Bot,             label: 'Agentes'   },
  { to: '/wiki',      icon: BookOpen,        label: 'Wiki'      },
  { to: '/settings',  icon: Settings,        label: 'Configurações' },
]

export function Sidebar() {
  const [expanded, setExpanded] = useState(false)
  const { logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          'fixed left-0 top-0 h-screen flex flex-col bg-card border-r border-border z-40',
          'transition-[width] duration-200 ease-in-out overflow-hidden',
          expanded ? 'w-[200px]' : 'w-[56px]',
        )}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-[14px] py-4 min-h-[60px] border-b border-border">
          <div className="w-7 h-7 min-w-[28px] bg-accent rounded-lg flex items-center justify-center">
            <span className="text-accent-foreground text-xs font-bold">EN</span>
          </div>
          {expanded && (
            <span className="font-serif text-[15px] font-semibold text-foreground whitespace-nowrap phantom">
              Ethra Nexus
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 flex flex-col gap-0.5 p-2 pt-3">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <Tooltip key={to}>
              <TooltipTrigger asChild>
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-2 py-2.5 rounded-md transition-colors relative',
                      'text-muted-foreground hover:text-foreground hover:bg-accent/8',
                      isActive && 'text-accent bg-accent/10 cobalt-underline font-medium',
                    )
                  }
                >
                  <Icon size={18} className="min-w-[18px]" />
                  {expanded && <span className="text-[13px] whitespace-nowrap">{label}</span>}
                </NavLink>
              </TooltipTrigger>
              {!expanded && <TooltipContent side="right">{label}</TooltipContent>}
            </Tooltip>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-2 flex flex-col gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="flex items-center gap-3 px-2 py-2.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/8 w-full transition-colors"
              >
                {theme === 'dark' ? <Sun size={18} className="min-w-[18px]" /> : <Moon size={18} className="min-w-[18px]" />}
                {expanded && <span className="text-[13px] whitespace-nowrap">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
              </button>
            </TooltipTrigger>
            {!expanded && <TooltipContent side="right">Alternar tema</TooltipContent>}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-2 py-2.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/8 w-full transition-colors"
              >
                <LogOut size={18} className="min-w-[18px]" />
                {expanded && <span className="text-[13px] whitespace-nowrap">Sair</span>}
              </button>
            </TooltipTrigger>
            {!expanded && <TooltipContent side="right">Sair</TooltipContent>}
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  )
}
```

- [ ] **Step 6: Create AppLayout**

Create `apps/web/src/components/layout/AppLayout.tsx`:

```typescript
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function AppLayout() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 ml-[56px] p-8 min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 7: Typecheck + commit**

```bash
cd apps/web && npx tsc --noEmit
git add src/components/
git commit -m "feat(web): add PrivateRoute, AppLayout, Sidebar"
```

---

## Task 7: Auth schemas + LoginPage + SignupPage

**Files:**
- Create: `apps/web/src/lib/schemas/auth.schema.ts`
- Create: `apps/web/src/pages/LoginPage.tsx`
- Create: `apps/web/src/pages/SignupPage.tsx`

- [ ] **Step 1: Write schema tests**

Create `apps/web/src/lib/schemas/__tests__/auth.schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { loginSchema, signupSchema } from '../auth.schema'

describe('loginSchema', () => {
  it('accepts valid slug + password', () => {
    const result = loginSchema.safeParse({ slug: 'minha-empresa', password: 'secret123' })
    expect(result.success).toBe(true)
  })
  it('rejects empty slug', () => {
    const result = loginSchema.safeParse({ slug: '', password: 'secret123' })
    expect(result.success).toBe(false)
  })
})

describe('signupSchema', () => {
  it('accepts valid data', () => {
    const result = signupSchema.safeParse({ name: 'Minha Empresa', slug: 'minha-empresa', password: 'secret123', confirmPassword: 'secret123' })
    expect(result.success).toBe(true)
  })
  it('rejects invalid slug chars', () => {
    const result = signupSchema.safeParse({ name: 'X', slug: 'Empresa XYZ', password: 'secret123', confirmPassword: 'secret123' })
    expect(result.success).toBe(false)
  })
  it('rejects password mismatch', () => {
    const result = signupSchema.safeParse({ name: 'X', slug: 'x', password: 'aaa', confirmPassword: 'bbb' })
    expect(result.success).toBe(false)
  })
  it('rejects password shorter than 8 chars', () => {
    const result = signupSchema.safeParse({ name: 'X', slug: 'x', password: 'short', confirmPassword: 'short' })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run schema tests — expect FAIL**

```bash
cd apps/web && npx vitest run src/lib/schemas/__tests__/auth.schema.test.ts
```

- [ ] **Step 3: Create auth.schema.ts**

Create `apps/web/src/lib/schemas/auth.schema.ts`:

```typescript
import { z } from 'zod'

export const loginSchema = z.object({
  slug: z.string().min(1, 'Slug obrigatório'),
  password: z.string().min(1, 'Senha obrigatória'),
})

export const signupSchema = z
  .object({
    name: z.string().min(2, 'Nome mínimo 2 caracteres'),
    slug: z
      .string()
      .min(2, 'Slug mínimo 2 caracteres')
      .regex(/^[a-z0-9-]+$/, 'Apenas letras minúsculas, números e hífens'),
    password: z.string().min(8, 'Senha mínima 8 caracteres'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Senhas não coincidem',
    path: ['confirmPassword'],
  })

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
```

- [ ] **Step 4: Run schema tests — expect PASS**

```bash
cd apps/web && npx vitest run src/lib/schemas/__tests__/auth.schema.test.ts
```

- [ ] **Step 5: Create LoginPage**

Create `apps/web/src/pages/LoginPage.tsx`:

```typescript
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { loginSchema, type LoginInput } from '@/lib/schemas/auth.schema'

export function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginInput) => {
    try {
      const res = await api.post<{ token: string }>('/auth/login', data)
      login(res.data.token)
      navigate('/dashboard')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Erro ao fazer login'
      toast.error(msg)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-[400px]">
        <CardHeader className="text-center pb-2">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
              <span className="text-accent-foreground text-sm font-bold">EN</span>
            </div>
            <span className="font-serif text-xl font-semibold text-foreground phantom">Ethra Nexus</span>
          </div>
          <p className="text-sm text-muted-foreground">Entre na sua conta</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
                Slug da workspace
              </label>
              <Input {...register('slug')} placeholder="minha-empresa" autoFocus />
              {errors.slug && <p className="text-xs text-destructive mt-1">{errors.slug.message}</p>}
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
                Senha
              </label>
              <Input {...register('password')} type="password" placeholder="••••••••" />
              {errors.password && <p className="text-xs text-destructive mt-1">{errors.password.message}</p>}
            </div>
            <Button type="submit" className="w-full mt-1" disabled={isSubmitting}>
              {isSubmitting ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
          <p className="text-xs text-center text-muted-foreground mt-4">
            Não tem conta?{' '}
            <Link to="/signup" className="text-accent hover:underline font-medium">
              Criar conta
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 6: Create SignupPage**

Create `apps/web/src/pages/SignupPage.tsx`:

```typescript
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { signupSchema, type SignupInput } from '@/lib/schemas/auth.schema'

export function SignupPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
  })

  const onSubmit = async ({ name, slug, password }: SignupInput) => {
    try {
      const res = await api.post<{ token: string }>('/auth/signup', { name, slug, password })
      login(res.data.token)
      navigate('/dashboard')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Erro ao criar conta'
      toast.error(msg)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-[400px]">
        <CardHeader className="text-center pb-2">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
              <span className="text-accent-foreground text-sm font-bold">EN</span>
            </div>
            <span className="font-serif text-xl font-semibold text-foreground phantom">Ethra Nexus</span>
          </div>
          <p className="text-sm text-muted-foreground">Criar nova conta</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Nome da organização</label>
              <Input {...register('name')} placeholder="Minha Empresa" autoFocus />
              {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Slug (URL)</label>
              <Input {...register('slug')} placeholder="minha-empresa" />
              <p className="text-[11px] text-muted-foreground mt-1">Apenas minúsculas, números e hífens</p>
              {errors.slug && <p className="text-xs text-destructive mt-1">{errors.slug.message}</p>}
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Senha</label>
              <Input {...register('password')} type="password" placeholder="Mínimo 8 caracteres" />
              {errors.password && <p className="text-xs text-destructive mt-1">{errors.password.message}</p>}
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Confirmar senha</label>
              <Input {...register('confirmPassword')} type="password" placeholder="••••••••" />
              {errors.confirmPassword && <p className="text-xs text-destructive mt-1">{errors.confirmPassword.message}</p>}
            </div>
            <Button type="submit" className="w-full mt-1" disabled={isSubmitting}>
              {isSubmitting ? 'Criando...' : 'Criar conta'}
            </Button>
          </form>
          <p className="text-xs text-center text-muted-foreground mt-4">
            Já tem conta?{' '}
            <Link to="/login" className="text-accent hover:underline font-medium">Entrar</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 7: Typecheck + commit**

```bash
cd apps/web && npx tsc --noEmit
git add src/lib/schemas/ src/pages/LoginPage.tsx src/pages/SignupPage.tsx
git commit -m "feat(web): add auth schemas, LoginPage, SignupPage"
```

---

## Task 8: DashboardPage + KpiCard + AgentActivityList

**Files:**
- Create: `apps/web/src/components/dashboard/KpiCard.tsx`
- Create: `apps/web/src/components/dashboard/AgentActivityList.tsx`
- Create: `apps/web/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Create KpiCard**

Create `apps/web/src/components/dashboard/KpiCard.tsx`:

```typescript
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface KpiCardProps {
  label: string
  value: string | number
  subtitle?: string
  accent?: boolean
  loading?: boolean
}

export function KpiCard({ label, value, subtitle, accent, loading }: KpiCardProps) {
  if (loading) {
    return (
      <Card className="p-5">
        <Skeleton className="h-3 w-24 mb-3" />
        <Skeleton className="h-8 w-16 mb-2" />
        <Skeleton className="h-3 w-20" />
      </Card>
    )
  }
  return (
    <Card className="p-5">
      <CardContent className="p-0">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">{label}</p>
        <p className={cn('font-serif text-3xl font-semibold leading-none mb-1.5', accent ? 'text-accent' : 'text-foreground')}>
          {value}
        </p>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Create AgentActivityList**

Create `apps/web/src/components/dashboard/AgentActivityList.tsx`:

```typescript
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface RecentAgent {
  id: string
  name: string
  role: string
  status: string
  skills: string[]
}

interface AgentActivityListProps {
  agents: RecentAgent[]
  loading?: boolean
}

export function AgentActivityList({ agents, loading }: AgentActivityListProps) {
  const navigate = useNavigate()

  return (
    <Card>
      <CardHeader className="pb-3">
        <h2 className="font-serif text-base font-semibold text-foreground">Agentes recentes</h2>
      </CardHeader>
      <CardContent className="p-0">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3 border-t border-border first:border-t-0">
                <Skeleton className="w-9 h-9 rounded-lg" />
                <div className="flex-1">
                  <Skeleton className="h-3.5 w-36 mb-1.5" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
            ))
          : agents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-3 px-5 py-3 border-t border-border first:border-t-0 cursor-pointer hover:bg-accent/5 transition-colors mist-item"
                onClick={() => navigate(`/agents/${agent.id}`)}
              >
                <div className="w-9 h-9 bg-accent/12 rounded-lg flex items-center justify-center text-base">
                  🤖
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-serif text-sm font-medium text-foreground truncate">{agent.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{agent.skills.slice(0, 2).join(' · ')}</p>
                </div>
                <span className={cn(
                  'inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full',
                  agent.status === 'active'
                    ? 'bg-green-500/10 text-green-700 border border-green-500/20 halo-pulse'
                    : 'bg-yellow-500/10 text-yellow-700 border border-yellow-500/20',
                )}>
                  {agent.status === 'active' && <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />}
                  {agent.status === 'active' ? 'Ativo' : 'Pausado'}
                </span>
              </div>
            ))}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: Create DashboardPage**

Create `apps/web/src/pages/DashboardPage.tsx`:

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { AgentActivityList } from '@/components/dashboard/AgentActivityList'

interface DashboardData {
  agents_active: number
  executions_month: number
  cost_usd_month: number
  recent_agents: Array<{ id: string; name: string; role: string; status: string; skills: string[] }>
}

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<{ data: DashboardData }>('/dashboard').then((r) => r.data.data),
  })

  const month = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  return (
    <div className="mist-in">
      <div className="mb-7">
        <h1 className="font-serif text-2xl font-semibold text-foreground mb-1">Dashboard</h1>
        <p className="text-sm text-muted-foreground capitalize">{month}</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <KpiCard
          label="Agentes ativos"
          value={data?.agents_active ?? 0}
          accent
          loading={isLoading}
        />
        <KpiCard
          label="Execuções"
          value={data?.executions_month.toLocaleString('pt-BR') ?? 0}
          subtitle="Este mês"
          loading={isLoading}
        />
        <KpiCard
          label="Custo USD"
          value={`$${(data?.cost_usd_month ?? 0).toFixed(2)}`}
          subtitle="Este mês"
          loading={isLoading}
        />
      </div>

      <AgentActivityList agents={data?.recent_agents ?? []} loading={isLoading} />
    </div>
  )
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd apps/web && npx tsc --noEmit
git add src/components/dashboard/ src/pages/DashboardPage.tsx
git commit -m "feat(web): add DashboardPage with KPI cards and agent list"
```

---

## Task 9: Agent hooks + schemas + AgentsPage + AgentNewPage

**Files:**
- Create: `apps/web/src/lib/schemas/agent.schema.ts`
- Create: `apps/web/src/hooks/useAgents.ts`
- Create: `apps/web/src/components/agents/AgentStatusBadge.tsx`
- Create: `apps/web/src/pages/AgentsPage.tsx`
- Create: `apps/web/src/pages/AgentNewPage.tsx`

- [ ] **Step 1: Create agent schema**

Create `apps/web/src/lib/schemas/agent.schema.ts`:

```typescript
import { z } from 'zod'

export const createAgentSchema = z.object({
  name: z.string().min(2, 'Nome mínimo 2 caracteres'),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Apenas minúsculas, números e hífens'),
  role: z.string().min(2, 'Papel obrigatório'),
  system_prompt: z.string().optional(),
  model: z.string().optional(),
  tone: z.enum(['formal', 'informal', 'tecnico', 'amigavel']).optional(),
  budget_monthly: z.string().optional(),
})

export type CreateAgentInput = z.infer<typeof createAgentSchema>

export interface Agent {
  id: string
  name: string
  slug: string
  role: string
  status: string
  system_prompt: string | null
  model: string | null
  tone: string | null
  budget_monthly: string | null
  created_at: string
  skills: Array<{ id: string; skill_name: string; enabled: boolean }>
  channels: Array<{ id: string; channel_type: string; enabled: boolean }>
}
```

- [ ] **Step 2: Create useAgents hook**

Create `apps/web/src/hooks/useAgents.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Agent, CreateAgentInput } from '@/lib/schemas/agent.schema'

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<{ data: Agent[] }>('/agents').then((r) => r.data.data),
  })
}

export function useCreateAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateAgentInput) =>
      api.post<{ data: Agent }>('/agents', body).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Agente criado com sucesso')
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Erro ao criar agente'
      toast.error(msg)
    },
  })
}

export function useDeleteAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/agents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Agente removido')
    },
    onError: () => toast.error('Erro ao remover agente'),
  })
}
```

- [ ] **Step 3: Create AgentStatusBadge**

Create `apps/web/src/components/agents/AgentStatusBadge.tsx`:

```typescript
import { cn } from '@/lib/utils'

interface AgentStatusBadgeProps { status: string }

export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  const isActive = status === 'active'
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border',
      isActive
        ? 'bg-green-500/10 text-green-700 border-green-500/20 halo-pulse'
        : 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20',
    )}>
      {isActive && <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />}
      {isActive ? 'Ativo' : 'Pausado'}
    </span>
  )
}
```

- [ ] **Step 4: Create AgentsPage**

Create `apps/web/src/pages/AgentsPage.tsx`:

```typescript
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { AgentStatusBadge } from '@/components/agents/AgentStatusBadge'
import { useAgents, useDeleteAgent } from '@/hooks/useAgents'

export function AgentsPage() {
  const navigate = useNavigate()
  const { data: agents = [], isLoading } = useAgents()
  const deleteAgent = useDeleteAgent()
  const [search, setSearch] = useState('')

  const filtered = agents.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.role.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="mist-in">
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-foreground mb-1">Agentes</h1>
          <p className="text-sm text-muted-foreground">{agents.length} agente{agents.length !== 1 ? 's' : ''} configurado{agents.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={() => navigate('/agents/new')}>
          <Plus size={16} className="mr-1.5" /> Novo agente
        </Button>
      </div>

      <div className="mb-5">
        <Input
          placeholder="Buscar por nome ou papel..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <div className="border border-border rounded-xl overflow-hidden bg-card">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-border last:border-b-0">
                <Skeleton className="w-9 h-9 rounded-lg" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-20 ml-auto" />
              </div>
            ))
          : filtered.length === 0
          ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                {search ? 'Nenhum agente encontrado.' : 'Nenhum agente criado ainda.'}
              </div>
            )
          : filtered.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-4 px-5 py-4 border-b border-border last:border-b-0 hover:bg-accent/5 transition-colors cursor-pointer mist-item"
                onClick={() => navigate(`/agents/${agent.id}`)}
              >
                <div className="w-9 h-9 bg-accent/12 rounded-lg flex items-center justify-center text-base flex-shrink-0">
                  🤖
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-serif text-sm font-medium text-foreground">{agent.name}</p>
                  <p className="text-xs text-muted-foreground">{agent.role}</p>
                </div>
                <AgentStatusBadge status={agent.status} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive ml-2"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`Remover "${agent.name}"?`)) deleteAgent.mutate(agent.id)
                  }}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create AgentNewPage**

Create `apps/web/src/pages/AgentNewPage.tsx`:

```typescript
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { useCreateAgent } from '@/hooks/useAgents'
import { createAgentSchema, type CreateAgentInput } from '@/lib/schemas/agent.schema'

export function AgentNewPage() {
  const navigate = useNavigate()
  const createAgent = useCreateAgent()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreateAgentInput>({
    resolver: zodResolver(createAgentSchema),
  })

  const onSubmit = async (data: CreateAgentInput) => {
    const agent = await createAgent.mutateAsync(data)
    navigate(`/agents/${agent.id}`)
  }

  return (
    <div className="mist-in max-w-2xl">
      <button onClick={() => navigate('/agents')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft size={14} /> Voltar para agentes
      </button>
      <h1 className="font-serif text-2xl font-semibold text-foreground mb-6">Novo agente</h1>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Nome</label>
                <Input {...register('name')} placeholder="Suporte ao Cliente" autoFocus />
                {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Slug</label>
                <Input {...register('slug')} placeholder="suporte-ao-cliente" />
                {errors.slug && <p className="text-xs text-destructive mt-1">{errors.slug.message}</p>}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Papel (role)</label>
              <Input {...register('role')} placeholder="support" />
              {errors.role && <p className="text-xs text-destructive mt-1">{errors.role.message}</p>}
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">System Prompt</label>
              <Textarea {...register('system_prompt')} rows={4} placeholder="Você é um assistente de suporte..." />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate('/agents')}>Cancelar</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Criando...' : 'Criar agente'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 6: Typecheck + commit**

```bash
cd apps/web && npx tsc --noEmit
git add src/lib/schemas/agent.schema.ts src/hooks/useAgents.ts src/components/agents/ src/pages/AgentsPage.tsx src/pages/AgentNewPage.tsx
git commit -m "feat(web): add agent list, create agent pages and hooks"
```

---

## Task 10: AgentDetailPage + IdentitySection + SkillsSection

**Files:**
- Create: `apps/web/src/hooks/useAgent.ts`
- Create: `apps/web/src/components/agents/sections/IdentitySection.tsx`
- Create: `apps/web/src/components/agents/sections/SkillsSection.tsx`
- Create: `apps/web/src/pages/AgentDetailPage.tsx`

- [ ] **Step 1: Create useAgent hook**

Create `apps/web/src/hooks/useAgent.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Agent } from '@/lib/schemas/agent.schema'

export function useAgent(id: string) {
  return useQuery({
    queryKey: ['agents', id],
    queryFn: () => api.get<{ data: Agent }>(`/agents/${id}`).then((r) => r.data.data),
    enabled: !!id,
  })
}

export function useUpdateAgent(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<Agent>) => api.patch(`/agents/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', id] })
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Salvo')
    },
    onError: () => toast.error('Erro ao salvar'),
  })
}

export function useAgentSkills(id: string) {
  return useQuery({
    queryKey: ['agents', id, 'skills'],
    queryFn: () =>
      api.get<{ data: Array<{ id: string; skill_name: string; enabled: boolean }> }>(`/agents/${id}/skills`)
        .then((r) => r.data.data),
    enabled: !!id,
  })
}

export function useUpdateAgentSkill(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ skillId, enabled }: { skillId: string; enabled: boolean }) =>
      api.patch(`/agents/${agentId}/skills/${skillId}`, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', agentId, 'skills'] })
      toast.success('Skill atualizada')
    },
    onError: () => toast.error('Erro ao atualizar skill'),
  })
}

export function useAddAgentSkill(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (skill_name: string) =>
      api.post(`/agents/${agentId}/skills`, { skill_name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', agentId, 'skills'] })
      toast.success('Skill adicionada')
    },
    onError: () => toast.error('Erro ao adicionar skill'),
  })
}
```

- [ ] **Step 2: Create IdentitySection**

Create `apps/web/src/components/agents/sections/IdentitySection.tsx`:

```typescript
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { useUpdateAgent } from '@/hooks/useAgent'
import type { Agent } from '@/lib/schemas/agent.schema'

const identitySchema = z.object({
  name: z.string().min(2),
  role: z.string().min(1),
  system_prompt: z.string().optional(),
})
type IdentityInput = z.infer<typeof identitySchema>

interface IdentitySectionProps { agent: Agent; loading?: boolean }

export function IdentitySection({ agent, loading }: IdentitySectionProps) {
  const updateAgent = useUpdateAgent(agent.id)
  const { register, handleSubmit, formState: { isDirty, isSubmitting } } = useForm<IdentityInput>({
    resolver: zodResolver(identitySchema),
    defaultValues: { name: agent.name, role: agent.role, system_prompt: agent.system_prompt ?? '' },
  })

  const onSubmit = async (data: IdentityInput) => {
    await updateAgent.mutateAsync(data)
  }

  const toggleStatus = () => {
    updateAgent.mutate({ status: agent.status === 'active' ? 'inactive' : 'active' })
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-4 w-32" /><Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-28" /><Skeleton className="h-24 w-full" />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
        <div>
          <p className="text-sm font-medium text-foreground">Status do agente</p>
          <p className="text-xs text-muted-foreground">{agent.status === 'active' ? 'Ativo — processando tarefas' : 'Inativo — não processa tarefas'}</p>
        </div>
        <Switch checked={agent.status === 'active'} onCheckedChange={toggleStatus} />
      </div>
      <div>
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Nome</label>
        <Input {...register('name')} />
      </div>
      <div>
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Papel (role)</label>
        <Input {...register('role')} placeholder="support, analyst, monitor..." />
      </div>
      <div>
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">System Prompt</label>
        <Textarea {...register('system_prompt')} rows={5} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!isDirty || isSubmitting}>
          {isSubmitting ? 'Salvando...' : 'Salvar identidade'}
        </Button>
      </div>
    </form>
  )
}
```

- [ ] **Step 3: Create SkillsSection**

Create `apps/web/src/components/agents/sections/SkillsSection.tsx`:

```typescript
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { useAgentSkills, useUpdateAgentSkill, useAddAgentSkill } from '@/hooks/useAgent'

const AVAILABLE_SKILLS = [
  'wiki:query', 'wiki:ingest', 'wiki:lint',
  'channel:respond', 'channel:proactive',
  'report:generate', 'monitor:health', 'monitor:alert',
  'data:analyze', 'data:extract',
]

interface SkillsSectionProps { agentId: string }

export function SkillsSection({ agentId }: SkillsSectionProps) {
  const { data: skills = [], isLoading } = useAgentSkills(agentId)
  const updateSkill = useUpdateAgentSkill(agentId)
  const addSkill = useAddAgentSkill(agentId)
  const [newSkill, setNewSkill] = useState('')

  const existingSkillNames = new Set(skills.map((s) => s.skill_name))
  const available = AVAILABLE_SKILLS.filter((s) => !existingSkillNames.has(s))

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col gap-2 mb-5">
        {skills.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma skill atribuída.</p>
        )}
        {skills.map((skill) => (
          <div key={skill.id} className="flex items-center justify-between p-3 border border-border rounded-lg bg-card">
            <div>
              <p className="text-sm font-medium text-foreground font-mono">{skill.skill_name}</p>
            </div>
            <Switch
              checked={skill.enabled}
              onCheckedChange={(enabled) => updateSkill.mutate({ skillId: skill.id, enabled })}
            />
          </div>
        ))}
      </div>

      {available.length > 0 && (
        <div className="flex gap-2">
          <Select value={newSkill} onValueChange={setNewSkill}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Adicionar skill..." />
            </SelectTrigger>
            <SelectContent>
              {available.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => { if (newSkill) { addSkill.mutate(newSkill); setNewSkill('') } }}
            disabled={!newSkill || addSkill.isPending}
          >
            <Plus size={16} className="mr-1" /> Adicionar
          </Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create AgentDetailPage**

Create `apps/web/src/pages/AgentDetailPage.tsx`:

```typescript
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, User, Code2, BookOpen, DollarSign, Star } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { AgentStatusBadge } from '@/components/agents/AgentStatusBadge'
import { IdentitySection } from '@/components/agents/sections/IdentitySection'
import { SkillsSection } from '@/components/agents/sections/SkillsSection'
import { useAgent } from '@/hooks/useAgent'
import { cn } from '@/lib/utils'

const SECTIONS = [
  { id: 'identity', label: 'Identidade', icon: User },
  { id: 'skills',   label: 'Skills',     icon: Code2 },
  { id: 'wiki',     label: 'Wiki',       icon: BookOpen },
  { id: 'budget',   label: 'Budget',     icon: DollarSign },
  { id: 'feedback', label: 'Feedback',   icon: Star },
]

export function AgentDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: agent, isLoading } = useAgent(id)

  const activeSection = location.hash.replace('#', '') || 'identity'
  const setSection = (s: string) => navigate({ hash: s }, { replace: true })

  return (
    <div className="mist-in">
      <button onClick={() => navigate('/agents')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors">
        <ArrowLeft size={14} /> Voltar para agentes
      </button>

      {/* Agent header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-accent/12 rounded-xl flex items-center justify-center text-lg flex-shrink-0">
          🤖
        </div>
        <div className="flex-1">
          {isLoading
            ? <><Skeleton className="h-5 w-44 mb-1.5" /><Skeleton className="h-3.5 w-24" /></>
            : <>
                <h1 className="font-serif text-xl font-semibold text-foreground">{agent?.name}</h1>
                <p className="text-xs text-muted-foreground">{agent?.role}</p>
              </>
          }
        </div>
        {agent && <AgentStatusBadge status={agent.status} />}
      </div>

      {/* Split layout */}
      <div className="border border-border rounded-xl bg-card overflow-hidden flex min-h-[480px]">
        {/* Section nav */}
        <nav className="w-[160px] min-w-[160px] border-r border-border p-2 flex flex-col gap-0.5">
          {SECTIONS.map(({ id: sid, label, icon: Icon }) => (
            <button
              key={sid}
              onClick={() => setSection(sid)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-colors text-left',
                activeSection === sid
                  ? 'bg-accent/10 text-accent font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/6',
              )}
            >
              <Icon size={14} className="flex-shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* Section content */}
        <div className="flex-1 p-6 overflow-y-auto">
          {isLoading && !agent
            ? <div className="flex flex-col gap-4"><Skeleton className="h-4 w-32" /><Skeleton className="h-10 w-full" /><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
            : agent
            ? <>
                {activeSection === 'identity' && <IdentitySection agent={agent} />}
                {activeSection === 'skills' && <SkillsSection agentId={agent.id} />}
                {activeSection === 'wiki' && (
                  <div className="text-sm text-muted-foreground py-4">
                    <p className="font-medium text-foreground mb-2">Wiki do agente</p>
                    <p>Acesse a interface do SilverBullet para gerenciar o conhecimento deste agente.</p>
                  </div>
                )}
                {activeSection === 'budget' && <BudgetSectionPlaceholder agentId={agent.id} />}
                {activeSection === 'feedback' && <FeedbackSectionPlaceholder agentId={agent.id} />}
              </>
            : null
          }
        </div>
      </div>
    </div>
  )
}

function BudgetSectionPlaceholder({ agentId }: { agentId: string }) {
  return <div className="text-sm text-muted-foreground">Budget — implementado na Task 11 (agentId: {agentId})</div>
}
function FeedbackSectionPlaceholder({ agentId }: { agentId: string }) {
  return <div className="text-sm text-muted-foreground">Feedback — implementado na Task 11 (agentId: {agentId})</div>
}
```

- [ ] **Step 5: Typecheck + commit**

```bash
cd apps/web && npx tsc --noEmit
git add src/hooks/useAgent.ts src/components/agents/sections/ src/pages/AgentDetailPage.tsx
git commit -m "feat(web): add AgentDetailPage with Identity and Skills sections"
```

---

## Task 11: BudgetSection + FeedbackSection

**Files:**
- Create: `apps/web/src/hooks/useBudget.ts`
- Create: `apps/web/src/hooks/useFeedback.ts`
- Create: `apps/web/src/components/agents/sections/BudgetSection.tsx`
- Create: `apps/web/src/components/agents/sections/FeedbackSection.tsx`
- Modify: `apps/web/src/pages/AgentDetailPage.tsx` (replace placeholders)

- [ ] **Step 1: Create useBudget hook**

Create `apps/web/src/hooks/useBudget.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface BudgetData {
  limit_usd: number
  spent_usd: number
  tokens_used: number
  percent_used: number
  throttled_at: string | null
  alerts_fired: string[]
}

export function useBudget(agentId: string) {
  return useQuery({
    queryKey: ['agents', agentId, 'budget'],
    queryFn: () => api.get<{ data: BudgetData }>(`/agents/${agentId}/budget`).then((r) => r.data.data),
    enabled: !!agentId,
  })
}

export function useUpdateBudget(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (monthly_limit_usd: number) =>
      api.patch<{ data: BudgetData }>(`/agents/${agentId}/budget`, { monthly_limit_usd }).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', agentId, 'budget'] })
      toast.success('Budget atualizado')
    },
    onError: () => toast.error('Erro ao atualizar budget'),
  })
}
```

- [ ] **Step 2: Create useFeedback hook**

Create `apps/web/src/hooks/useFeedback.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface FeedbackItem {
  id: string
  rating: number
  comment: string | null
  created_by: string | null
  created_at: string
  aios_event_id: string
}

interface FeedbackMeta {
  total: number
  avg_rating: number
  count_by_rating: Record<string, number>
}

export function useFeedback(agentId: string) {
  return useQuery({
    queryKey: ['agents', agentId, 'feedback'],
    queryFn: () =>
      api.get<{ data: FeedbackItem[]; meta: FeedbackMeta }>(`/agents/${agentId}/feedback?limit=20`)
        .then((r) => r.data),
    enabled: !!agentId,
  })
}

export function usePostFeedback(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { aios_event_id: string; rating: number; comment?: string }) =>
      api.post(`/agents/${agentId}/feedback`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', agentId, 'feedback'] })
      toast.success('Feedback salvo')
    },
    onError: () => toast.error('Erro ao salvar feedback'),
  })
}
```

- [ ] **Step 3: Create BudgetSection**

Create `apps/web/src/components/agents/sections/BudgetSection.tsx`:

```typescript
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useBudget, useUpdateBudget } from '@/hooks/useBudget'
import { cn } from '@/lib/utils'

interface BudgetSectionProps { agentId: string }

export function BudgetSection({ agentId }: BudgetSectionProps) {
  const { data: budget, isLoading } = useBudget(agentId)
  const updateBudget = useUpdateBudget(agentId)
  const [limitInput, setLimitInput] = useState<string>('')
  const [editing, setEditing] = useState(false)

  if (isLoading) {
    return <div className="flex flex-col gap-4"><Skeleton className="h-6 w-48" /><Skeleton className="h-3 w-full" /><Skeleton className="h-10 w-32" /></div>
  }

  const pct = budget?.percent_used ?? 0
  const progressColor = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-accent'

  const handleSave = () => {
    const val = parseFloat(limitInput)
    if (!isNaN(val) && val >= 0) {
      updateBudget.mutate(val)
      setEditing(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex justify-between items-baseline mb-2">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Gasto este mês</p>
          <p className="font-serif text-lg font-semibold text-accent">
            ${budget?.spent_usd.toFixed(2)}{' '}
            <span className="text-sm font-sans font-normal text-muted-foreground">
              / ${budget?.limit_usd === 0 ? '∞' : budget?.limit_usd.toFixed(2)}
            </span>
          </p>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden mb-1.5">
          <div className={cn('h-full rounded-full transition-all duration-700', progressColor)} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <p className="text-xs text-muted-foreground text-right">{pct.toFixed(1)}% utilizado</p>
      </div>

      <div className="p-3 border border-border rounded-lg text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Tokens:</span>{' '}
        {budget?.tokens_used.toLocaleString('pt-BR')} este mês
      </div>

      {budget?.throttled_at && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
          Budget esgotado em {new Date(budget.throttled_at).toLocaleDateString('pt-BR')}
        </div>
      )}

      <div>
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Limite mensal (USD)</label>
        {editing
          ? (
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                className="w-32"
                autoFocus
              />
              <Button onClick={handleSave} disabled={updateBudget.isPending}>Salvar</Button>
              <Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
            </div>
          )
          : (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">${budget?.limit_usd === 0 ? 'Sem limite' : budget?.limit_usd.toFixed(2)}</span>
              <Button variant="outline" size="sm" onClick={() => { setLimitInput(String(budget?.limit_usd ?? 0)); setEditing(true) }}>
                Alterar
              </Button>
            </div>
          )
        }
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create FeedbackSection**

Create `apps/web/src/components/agents/sections/FeedbackSection.tsx`:

```typescript
import { Star } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useFeedback } from '@/hooks/useFeedback'
import { cn } from '@/lib/utils'

interface FeedbackSectionProps { agentId: string }

export function FeedbackSection({ agentId }: FeedbackSectionProps) {
  const { data, isLoading } = useFeedback(agentId)

  if (isLoading) {
    return <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
  }

  const avg = data?.meta.avg_rating ?? 0

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <div className="flex items-center gap-4 p-4 bg-secondary/50 rounded-lg">
        <div className="text-center">
          <p className="font-serif text-3xl font-semibold text-foreground">{avg.toFixed(1)}</p>
          <p className="text-xs text-muted-foreground">média</p>
        </div>
        <div className="flex-1">
          <div className="flex gap-0.5 mb-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} size={16} className={cn('fill-current', n <= Math.round(avg) ? 'text-yellow-400' : 'text-muted-foreground/30')} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{data?.meta.total ?? 0} avaliações</p>
        </div>
      </div>

      {/* List */}
      {(data?.data.length ?? 0) === 0
        ? <p className="text-sm text-muted-foreground text-center py-4">Nenhum feedback ainda.</p>
        : data?.data.map((fb) => (
          <div key={fb.id} className="border border-border rounded-lg p-4 mist-item">
            <div className="flex items-center justify-between mb-2">
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} size={13} className={cn('fill-current', n <= fb.rating ? 'text-yellow-400' : 'text-muted-foreground/30')} />
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{new Date(fb.created_at).toLocaleDateString('pt-BR')}</p>
            </div>
            {fb.comment && <p className="text-sm text-foreground">{fb.comment}</p>}
          </div>
        ))
      }
    </div>
  )
}
```

- [ ] **Step 5: Wire Budget + Feedback into AgentDetailPage**

In `apps/web/src/pages/AgentDetailPage.tsx`, replace the placeholder functions and add imports:

```typescript
// Add at top:
import { BudgetSection } from '@/components/agents/sections/BudgetSection'
import { FeedbackSection } from '@/components/agents/sections/FeedbackSection'

// Replace:
// {activeSection === 'budget' && <BudgetSectionPlaceholder agentId={agent.id} />}
// {activeSection === 'feedback' && <FeedbackSectionPlaceholder agentId={agent.id} />}
// With:
// {activeSection === 'budget' && <BudgetSection agentId={agent.id} />}
// {activeSection === 'feedback' && <FeedbackSection agentId={agent.id} />}

// Remove BudgetSectionPlaceholder and FeedbackSectionPlaceholder functions.
```

- [ ] **Step 6: Typecheck + commit**

```bash
cd apps/web && npx tsc --noEmit
git add src/hooks/useBudget.ts src/hooks/useFeedback.ts src/components/agents/sections/BudgetSection.tsx src/components/agents/sections/FeedbackSection.tsx src/pages/AgentDetailPage.tsx
git commit -m "feat(web): add Budget and Feedback sections to agent detail"
```

---

## Task 12: Final App.tsx wiring + stub pages + VITE_API_URL

**Files:**
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/WikiPage.tsx`
- Create: `apps/web/src/pages/SettingsPage.tsx`
- Create: `apps/web/.env.example`

- [ ] **Step 1: Replace App.tsx with full router**

Replace `apps/web/src/App.tsx`:

```typescript
import { Routes, Route, Navigate } from 'react-router-dom'
import { PrivateRoute } from '@/components/auth/PrivateRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage } from '@/pages/LoginPage'
import { SignupPage } from '@/pages/SignupPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { AgentsPage } from '@/pages/AgentsPage'
import { AgentNewPage } from '@/pages/AgentNewPage'
import { AgentDetailPage } from '@/pages/AgentDetailPage'
import { WikiPage } from '@/pages/WikiPage'
import { SettingsPage } from '@/pages/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      <Route element={<PrivateRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/new" element={<AgentNewPage />} />
          <Route path="/agents/:id" element={<AgentDetailPage />} />
          <Route path="/wiki" element={<WikiPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
```

- [ ] **Step 2: Create WikiPage stub**

Create `apps/web/src/pages/WikiPage.tsx`:

```typescript
export function WikiPage() {
  return (
    <div className="mist-in">
      <h1 className="font-serif text-2xl font-semibold text-foreground mb-2">Wiki</h1>
      <p className="text-sm text-muted-foreground">Gestão de conhecimento — em breve.</p>
    </div>
  )
}
```

- [ ] **Step 3: Create SettingsPage stub**

Create `apps/web/src/pages/SettingsPage.tsx`:

```typescript
export function SettingsPage() {
  return (
    <div className="mist-in">
      <h1 className="font-serif text-2xl font-semibold text-foreground mb-2">Configurações</h1>
      <p className="text-sm text-muted-foreground">Configurações da plataforma — em breve.</p>
    </div>
  )
}
```

- [ ] **Step 4: Create .env.example**

Create `apps/web/.env.example`:

```
VITE_API_URL=http://localhost:3001/api/v1
```

- [ ] **Step 5: Final typecheck + build check**

```bash
cd apps/web && npx tsc --noEmit
npm run build
```
Expected: TypeScript zero errors, build succeeds.

- [ ] **Step 6: Run all tests**

```bash
cd apps/web && npx vitest run
```
Expected: all tests pass.

- [ ] **Step 7: Start dev server and verify visually**

```bash
cd apps/web && npm run dev
```

Open `http://localhost:3000`. Verify:
- Redirects to `/login` when not authenticated
- Login form renders with Paper/Ink design and Playfair title
- Dark mode toggle works (sidebar footer)

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/pages/WikiPage.tsx src/pages/SettingsPage.tsx .env.example
git commit -m "feat(web): wire all routes, complete frontend implementation"
```

---

## Self-Review Checklist

- [x] All 9 spec pages implemented (login, signup, dashboard, agents, agent/new, agent/:id, wiki stub, settings stub)
- [x] Auth flow: login → JWT → localStorage → interceptors → 401 redirect
- [x] Design tokens: Paper/Ink/Cobalt palette, Playfair headings, `.halo-pulse`, `.mist-in`, `.cobalt-underline`
- [x] All 5 agent sections: identity, skills, wiki, budget, feedback
- [x] TanStack Query with proper invalidation on mutations
- [x] Zod schemas with tests for auth + agent
- [x] shadcn/ui components throughout
- [x] Dark mode via next-themes
- [x] Backend prerequisites: `/auth/signup` + `/dashboard`
