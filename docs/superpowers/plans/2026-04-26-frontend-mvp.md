# Frontend MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a primeira versão funcional do `apps/web` (ETHRA APERTURE) com 3 telas (Login, Mission Control, Agentes CRUD) integradas ao backend Ethra Nexus.

**Architecture:** SPA React 18 + Vite, organizada em camadas: `components/ui` (shadcn primitivos) + `components/aperture` (compostos APERTURE) + `pages` (rotas) + `hooks` (server state via TanStack Query) + `providers` (auth + query + theme) + `lib` (api client + zod schemas + utils). Auth via JWT em localStorage com interceptor; routing via react-router-dom data routers; theme via next-themes (light + dark APERTURE-aligned).

**Tech Stack:** React 18.3, Vite 5, TypeScript strict, Tailwind 3.4, shadcn/ui, Radix UI, Framer Motion, TanStack Query 5, react-router-dom 6.30, react-hook-form 7, zod 3, next-themes, sonner. Tests via vitest + @testing-library/react + msw.

**Reference docs:**
- Design system: `docs/design-system.md`
- Spec: `docs/superpowers/specs/2026-04-26-frontend-mvp-design.md`
- Project constitution: `CLAUDE.md`

---

## File Structure (mapa completo)

Files criados ao longo deste plano:

```
apps/web/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── tailwind.config.ts
├── postcss.config.js
├── components.json
├── eslint.config.js
├── index.html
├── public/
│   └── favicon.svg
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── routes.tsx
    ├── index.css
    ├── env.d.ts
    ├── components/
    │   ├── ui/                              # 47 primitivos shadcn (copy)
    │   └── aperture/
    │       ├── sidebar.tsx
    │       ├── page-header.tsx
    │       ├── kpi-card.tsx
    │       ├── agent-roster-card.tsx
    │       ├── activity-feed.tsx
    │       ├── status-pill.tsx
    │       ├── theme-toggle.tsx
    │       └── app-shell.tsx
    ├── pages/
    │   ├── login.tsx
    │   ├── mission-control.tsx
    │   ├── not-found.tsx
    │   └── agents/
    │       ├── list.tsx
    │       ├── detail.tsx
    │       └── tabs/
    │           ├── identity.tsx
    │           ├── skills.tsx
    │           ├── channels.tsx
    │           ├── budget.tsx
    │           ├── wiki.tsx
    │           └── a2a.tsx
    ├── hooks/
    │   ├── use-mobile.ts
    │   ├── use-auth.ts
    │   ├── use-agents.ts
    │   ├── use-agent-budget.ts
    │   ├── use-aios-events.ts
    │   └── use-a2a-keys.ts
    ├── providers/
    │   ├── auth-provider.tsx
    │   ├── query-provider.tsx
    │   └── theme-provider.tsx
    ├── lib/
    │   ├── api.ts
    │   ├── utils.ts
    │   ├── env.ts
    │   ├── skills-built-in.ts
    │   └── schemas/
    │       ├── auth.ts
    │       ├── agent.ts
    │       ├── aios-event.ts
    │       ├── budget.ts
    │       └── a2a.ts
    └── __tests__/
        ├── setup.ts
        ├── mocks/
        │   ├── server.ts
        │   ├── handlers.ts
        │   └── data.ts
        └── (test files co-located com source via *.test.ts)
```

Files modified ao longo deste plano:

```
package.json                          # add apps/web workspace
.github/workflows/ci.yml              # add apps/web jobs
infra/docker/Dockerfile               # add web-builder stage
infra/docker/nginx.conf               # add SPA fallback + API proxy
turbo.json                            # add web tasks (se necessário)
```

---

# Phase 1 — Bootstrap

Cria o esqueleto de `apps/web` rodando `vite dev` com uma página em branco styled. Sem features, com fundação sólida.

## Task 1: Inicializar `apps/web` package + Vite config

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Modify: `package.json` (root, adicionar `apps/web` em workspaces)

- [ ] **Step 1: Criar `apps/web/package.json`**

```json
{
  "name": "@ethra-nexus/web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings 0",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react-swc": "^3.11.0",
    "typescript": "^5.8.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Criar `apps/web/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 3: Criar `apps/web/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>ETHRA APERTURE — AI Orchestration Console</title>
    <meta name="description" content="ETHRA APERTURE: console de orquestração de agentes de IA do Ethra Nexus." />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Criar `apps/web/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 5: Criar `apps/web/src/App.tsx` (smoke test)**

```tsx
export default function App() {
  return <h1>ETHRA APERTURE</h1>
}
```

- [ ] **Step 6: Adicionar workspace no `package.json` raiz**

Verificar se já existe campo `workspaces`. Se sim, adicionar `apps/web` à lista. Se não, criar:

```json
"workspaces": ["apps/*", "packages/*"]
```

- [ ] **Step 7: Instalar dependencies**

Run: `npm install` (na raiz)
Expected: instala deps do `apps/web` no node_modules raiz.

- [ ] **Step 8: Smoke test**

Run: `cd apps/web && npm run dev`
Expected: Vite sobe em `http://localhost:5173`, abrir no browser mostra "ETHRA APERTURE" em texto puro (sem CSS ainda).

Run: `Ctrl+C` para parar.

- [ ] **Step 9: Commit**

```bash
git add apps/web/ package.json package-lock.json
git commit -m "feat(web): bootstrap apps/web with Vite + React 18"
```

## Task 2: TypeScript strict configuration

**Files:**
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.app.json`
- Create: `apps/web/tsconfig.node.json`
- Create: `apps/web/src/env.d.ts`

- [ ] **Step 1: Criar `apps/web/tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] }
  }
}
```

- [ ] **Step 2: Criar `apps/web/tsconfig.app.json` (strict)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    "types": ["vitest/globals"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Criar `apps/web/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Criar `apps/web/src/env.d.ts`**

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [ ] **Step 5: Adicionar typescript ao package.json (já feito na Task 1)**

Verificar `apps/web/package.json` tem `typescript` em devDependencies.

- [ ] **Step 6: Run typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: PASS sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/web/tsconfig*.json apps/web/src/env.d.ts
git commit -m "feat(web): TypeScript strict config"
```

## Task 3: Tailwind + PostCSS + design system foundation

**Files:**
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.js`
- Create: `apps/web/components.json`
- Create: `apps/web/src/index.css`
- Modify: `apps/web/src/main.tsx` (importar index.css)
- Modify: `apps/web/package.json` (adicionar tailwindcss, autoprefixer, postcss, etc.)

- [ ] **Step 1: Adicionar deps ao `apps/web/package.json`**

Em `dependencies`, adicionar:
```json
"class-variance-authority": "^0.7.1",
"clsx": "^2.1.1",
"tailwind-merge": "^2.6.0",
"tailwindcss-animate": "^1.0.7"
```

Em `devDependencies`, adicionar:
```json
"autoprefixer": "^10.4.21",
"postcss": "^8.5.6",
"tailwindcss": "^3.4.17",
"@tailwindcss/typography": "^0.5.16"
```

Run: `npm install` (na raiz).

- [ ] **Step 2: Criar `apps/web/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 3: Criar `apps/web/tailwind.config.ts`**

Copiar exatamente o `tailwind.config.ts` do design-system spec (§3 de `docs/design-system.md`). Conteúdo principal:

```ts
import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
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
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: { lg: '0px', md: '0px', sm: '0px' },
      borderWidth: { hairline: '0.5px' },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
} satisfies Config
```

- [ ] **Step 4: Criar `apps/web/components.json`**

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
  }
}
```

- [ ] **Step 5: Criar `apps/web/src/index.css` com tokens APERTURE light + dark refeito**

Arquivo completo (light + dark Aperture-aligned conforme §3.2 do design-system.md):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=Inter:wght@300;400;500;600;700&display=swap');

/* ETHRA APERTURE — Swiss / Brutalist Minimalist Design System */

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 0%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 0%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 0%;
    --primary: 240 100% 50%;
    --primary-foreground: 0 0% 100%;
    --secondary: 0 0% 96%;
    --secondary-foreground: 0 0% 0%;
    --muted: 0 0% 96%;
    --muted-foreground: 0 0% 45%;
    --accent: 240 100% 50%;
    --accent-foreground: 0 0% 100%;
    --destructive: 0 84% 50%;
    --destructive-foreground: 0 0% 100%;
    --border: 0 0% 90%;
    --input: 0 0% 90%;
    --ring: 240 100% 50%;
    --radius: 0px;

    --status-busy: 0 84% 50%;
    --status-idle: 0 0% 60%;
    --status-active: 142 70% 40%;

    --hairline: 0 0% 90%;
    --ink: 0 0% 0%;
    --paper: 0 0% 100%;

    --sidebar-background: 0 0% 100%;
    --sidebar-foreground: 0 0% 0%;
    --sidebar-primary: 240 100% 50%;
    --sidebar-primary-foreground: 0 0% 100%;
    --sidebar-accent: 0 0% 96%;
    --sidebar-accent-foreground: 0 0% 0%;
    --sidebar-border: 0 0% 90%;
    --sidebar-ring: 240 100% 50%;
  }

  .dark {
    --background: 0 0% 0%;
    --foreground: 0 0% 100%;
    --card: 0 0% 4%;
    --card-foreground: 0 0% 100%;
    --popover: 0 0% 4%;
    --popover-foreground: 0 0% 100%;
    --primary: 240 100% 60%;
    --primary-foreground: 0 0% 100%;
    --secondary: 0 0% 10%;
    --secondary-foreground: 0 0% 100%;
    --muted: 0 0% 10%;
    --muted-foreground: 0 0% 60%;
    --accent: 240 100% 60%;
    --accent-foreground: 0 0% 100%;
    --destructive: 0 84% 50%;
    --destructive-foreground: 0 0% 100%;
    --border: 0 0% 18%;
    --input: 0 0% 18%;
    --ring: 240 100% 60%;

    --status-busy: 0 84% 50%;
    --status-idle: 0 0% 50%;
    --status-active: 142 70% 50%;

    --hairline: 0 0% 18%;
    --ink: 0 0% 100%;
    --paper: 0 0% 0%;

    --sidebar-background: 0 0% 0%;
    --sidebar-foreground: 0 0% 100%;
    --sidebar-primary: 240 100% 60%;
    --sidebar-primary-foreground: 0 0% 100%;
    --sidebar-accent: 0 0% 10%;
    --sidebar-accent-foreground: 0 0% 100%;
    --sidebar-border: 0 0% 18%;
    --sidebar-ring: 240 100% 60%;
  }
}

@layer base {
  * {
    @apply border-border;
    border-width: 0;
  }

  html, body, #root { height: 100%; }

  body {
    @apply bg-background text-foreground;
    font-family: 'Inter', system-ui, sans-serif;
    font-feature-settings: "ss01", "cv11";
    -webkit-font-smoothing: antialiased;
    letter-spacing: -0.01em;
  }

  ::selection {
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }
}

@layer utilities {
  .font-mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }

  .border-hairline { border-width: 0.5px; border-style: solid; border-color: hsl(var(--hairline)); }
  .border-r-hairline { border-right: 0.5px solid hsl(var(--hairline)); }
  .border-l-hairline { border-left: 0.5px solid hsl(var(--hairline)); }
  .border-t-hairline { border-top: 0.5px solid hsl(var(--hairline)); }
  .border-b-hairline { border-bottom: 0.5px solid hsl(var(--hairline)); }

  .terminal-cursor::after {
    content: '';
    display: inline-block;
    width: 0.6em;
    height: 1em;
    background: hsl(var(--ink));
    vertical-align: -0.15em;
    margin-left: 2px;
    animation: cursor-blink 1.05s steps(1) infinite;
  }

  @keyframes cursor-blink { 50% { background: transparent; } }

  @keyframes filament-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.6); opacity: 0.6; }
  }
  .filament-pulse { animation: filament-pulse 2.4s ease-in-out infinite; }

  .scrollbar-minimal::-webkit-scrollbar { width: 4px; height: 4px; }
  .scrollbar-minimal::-webkit-scrollbar-track { background: transparent; }
  .scrollbar-minimal::-webkit-scrollbar-thumb { background: hsl(var(--hairline)); }
}
```

- [ ] **Step 6: Atualizar `apps/web/src/main.tsx` para importar CSS**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 7: Atualizar `apps/web/src/App.tsx` para validar tokens**

```tsx
export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <h1 className="font-mono text-2xl uppercase tracking-[0.2em]">
        ETHRA APERTURE
      </h1>
      <p className="text-muted-foreground mt-2">Console de Orquestração</p>
      <div className="mt-8 border-hairline w-32"></div>
      <p className="font-mono text-sm text-primary mt-4">
        cobalto ativo
      </p>
    </div>
  )
}
```

- [ ] **Step 8: Smoke test**

Run: `cd apps/web && npm run dev`
Expected: página com "ETHRA APERTURE" em mono uppercase, subtitle, hairline divider, "cobalto ativo" em azul cobalto. Branco dominante. Sem rounded corners.

Run: typecheck `cd apps/web && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/
git commit -m "feat(web): Tailwind + design tokens APERTURE (light + dark)"
```

## Task 4: Utilities + path alias resolution

**Files:**
- Create: `apps/web/src/lib/utils.ts`

- [ ] **Step 1: Criar `apps/web/src/lib/utils.ts`**

```ts
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 2: Smoke test**

Run: `cd apps/web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/utils.ts
git commit -m "feat(web): cn() helper for className merging"
```

## Task 5: ESLint config

**Files:**
- Create: `apps/web/eslint.config.js`
- Modify: `apps/web/package.json` (deps de eslint)

- [ ] **Step 1: Adicionar deps ao `apps/web/package.json`**

Em `devDependencies`:
```json
"@eslint/js": "^9.32.0",
"eslint": "^9.32.0",
"eslint-plugin-react-hooks": "^5.2.0",
"eslint-plugin-react-refresh": "^0.4.20",
"globals": "^15.15.0",
"typescript-eslint": "^8.38.0"
```

Run: `npm install`.

- [ ] **Step 2: Criar `apps/web/eslint.config.js`**

```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
```

- [ ] **Step 3: Run lint**

Run: `cd apps/web && npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add apps/web/eslint.config.js apps/web/package.json
git commit -m "feat(web): ESLint config with TypeScript and React rules"
```

## Task 6: Vitest setup

**Files:**
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/__tests__/setup.ts`
- Modify: `apps/web/package.json` (deps vitest + testing-library)

- [ ] **Step 1: Adicionar deps**

Em `devDependencies`:
```json
"@testing-library/jest-dom": "^6.6.0",
"@testing-library/react": "^16.0.0",
"jsdom": "^25.0.0",
"vitest": "^3.2.0"
```

Run: `npm install`.

- [ ] **Step 2: Criar `apps/web/vitest.config.ts`**

```ts
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/__tests__/setup.ts'],
      coverage: {
        reporter: ['text', 'html'],
        thresholds: { lines: 60, functions: 60, branches: 50, statements: 60 },
      },
    },
  }),
)
```

- [ ] **Step 3: Criar `apps/web/src/__tests__/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
```

- [ ] **Step 4: Smoke test — criar teste trivial**

Create: `apps/web/src/lib/utils.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('deduplicates conflicting tailwind classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })
})
```

- [ ] **Step 5: Run tests**

Run: `cd apps/web && npm run test`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/vitest.config.ts apps/web/src/__tests__/ apps/web/src/lib/utils.test.ts apps/web/package.json
git commit -m "feat(web): Vitest setup with testing-library and coverage thresholds"
```

## Task 7: CI integration

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Verificar CI já cobre apps/web automaticamente**

A CI atual usa `npx turbo run typecheck` e `npm run lint`/`test`/`build` na raiz. Como `apps/web` agora é workspace, deve ser pego automaticamente.

Run localmente para validar:
```bash
npx turbo run typecheck --filter=@ethra-nexus/web
npm run lint --workspace=@ethra-nexus/web
npm run test --workspace=@ethra-nexus/web
npm run build --workspace=@ethra-nexus/web
```

Expected: todos passam (build vai falhar — sem todos os arquivos ainda).

- [ ] **Step 2: Se algum não estiver pego, ajustar `turbo.json`**

Verificar `turbo.json` na raiz tem pipelines para `typecheck`, `lint`, `test`, `build`. Se não tiver, adicionar.

- [ ] **Step 3: Push e validar CI verde**

```bash
git push
```
Expected: CI passa em todos os jobs (security, ci, e2e). Build pode pular `apps/web` se não tiver deps full ainda — verificar logs.

- [ ] **Step 4: Commit (se houver ajustes em turbo.json)**

Se ajustou:
```bash
git add turbo.json
git commit -m "chore: include apps/web in turbo pipelines"
```

---

# Phase 2 — Auth + Shell

Adiciona autenticação via JWT, app shell com sidebar, theme toggle, e routing protegido. Login funcional contra backend real.

## Task 8: Adicionar deps de Auth/Routing/Forms

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Adicionar deps**

Em `dependencies`:
```json
"@hookform/resolvers": "^3.10.0",
"@radix-ui/react-slot": "^1.2.3",
"@radix-ui/react-label": "^2.1.7",
"@tanstack/react-query": "^5.83.0",
"jwt-decode": "^4.0.0",
"lucide-react": "^0.462.0",
"next-themes": "^0.3.0",
"react-hook-form": "^7.61.1",
"react-router-dom": "^6.30.1",
"sonner": "^1.7.4",
"zod": "^3.25.76"
```

Run: `npm install`.

- [ ] **Step 2: Validate**

Run: `cd apps/web && npm run typecheck`
Expected: PASS (sem uso ainda das deps, só instalação).

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json package-lock.json
git commit -m "feat(web): add auth/routing/forms dependencies"
```

## Task 9: API client (`lib/api.ts`)

**Files:**
- Create: `apps/web/src/lib/env.ts`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/api.test.ts`

- [ ] **Step 1: Criar `apps/web/src/lib/env.ts`**

```ts
import { z } from 'zod'

const EnvSchema = z.object({
  VITE_API_URL: z.string().min(1).default('/api/v1'),
})

export const env = EnvSchema.parse(import.meta.env)
```

- [ ] **Step 2: Escrever teste falho `apps/web/src/lib/api.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, ApiError } from './api'

describe('api client', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GET retorna data on 200', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const result = await api.get<{ ok: boolean }>('/test')
    expect(result).toEqual({ ok: true })
  })

  it('adiciona Authorization header quando token existe', async () => {
    localStorage.setItem('ethra.token', 'abc123')
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await api.get('/test')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer abc123',
        }),
      }),
    )
  })

  it('throw ApiError on 4xx with backend message', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'inválido' }), { status: 400 }))
    await expect(api.get('/test')).rejects.toThrow(ApiError)
    await expect(api.get('/test')).rejects.toThrow('inválido')
  })

  it('dispatch ethra:unauthorized event on 401', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    const handler = vi.fn()
    window.addEventListener('ethra:unauthorized', handler)
    await expect(api.get('/test')).rejects.toThrow(ApiError)
    expect(handler).toHaveBeenCalled()
    window.removeEventListener('ethra:unauthorized', handler)
  })

  it('returns undefined on 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const result = await api.delete('/test')
    expect(result).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run test (fail)**

Run: `cd apps/web && npm run test src/lib/api.test.ts`
Expected: FAIL (api.ts não existe).

- [ ] **Step 4: Implementar `apps/web/src/lib/api.ts`**

```ts
import { env } from './env'

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

const BASE = env.VITE_API_URL

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('ethra.token')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...init, headers })

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('ethra:unauthorized'))
    throw new ApiError('Sessão expirada', 401)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status)
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
```

- [ ] **Step 5: Run tests (pass)**

Run: `cd apps/web && npm run test src/lib/api.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/env.ts apps/web/src/lib/api.ts apps/web/src/lib/api.test.ts
git commit -m "feat(web): API client with JWT interceptor and 401 handler"
```

## Task 10: Zod schemas — Auth + Agent

**Files:**
- Create: `apps/web/src/lib/schemas/auth.ts`
- Create: `apps/web/src/lib/schemas/agent.ts`
- Create: `apps/web/src/lib/schemas/aios-event.ts`
- Create: `apps/web/src/lib/schemas/budget.ts`
- Create: `apps/web/src/lib/schemas/a2a.ts`

- [ ] **Step 1: Criar `apps/web/src/lib/schemas/auth.ts`**

```ts
import { z } from 'zod'

export const LoginSchema = z.object({
  slug: z
    .string()
    .min(1, 'obrigatório')
    .regex(/^[a-z0-9-]+$/, 'apenas letras minúsculas, números e hífen'),
  password: z.string().min(1, 'obrigatório'),
})
export type LoginInput = z.infer<typeof LoginSchema>

export const TenantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
})
export type Tenant = z.infer<typeof TenantSchema>

export const LoginResponseSchema = z.object({
  token: z.string(),
  tenant: TenantSchema,
})
export type LoginResponse = z.infer<typeof LoginResponseSchema>

export const JwtPayloadSchema = z.object({
  tenantId: z.string().uuid(),
  slug: z.string().optional(),
  email: z.string().optional(),
  role: z.string().default('admin'),
  exp: z.number(),
})
export type JwtPayload = z.infer<typeof JwtPayloadSchema>
```

- [ ] **Step 2: Criar `apps/web/src/lib/schemas/agent.ts`**

```ts
import { z } from 'zod'

export const AgentSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  role: z.string(),
  model: z.string(),
  system_prompt: z.string(),
  status: z.enum(['active', 'archived']),
  budget_monthly: z.string(), // numeric vem como string
  description: z.string().nullable(),
  avatar_url: z.string().nullable(),
  tags: z.array(z.string()),
  system_prompt_extra: z.string().nullable(),
  response_language: z.string(),
  tone: z.string(),
  restrictions: z.array(z.string()),
  wiki_enabled: z.boolean(),
  wiki_top_k: z.number(),
  wiki_min_score: z.string(), // numeric vem como string
  wiki_write_mode: z.enum(['manual', 'supervised', 'auto']),
  a2a_enabled: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  skills: z.array(z.object({
    id: z.string().uuid(),
    skill_name: z.string(),
    skill_config: z.record(z.unknown()),
    enabled: z.boolean(),
  })).optional(),
  channels: z.array(z.object({
    id: z.string().uuid(),
    channel_type: z.enum(['whatsapp', 'webchat', 'email']),
    config: z.record(z.unknown()),
    enabled: z.boolean(),
  })).optional(),
})
export type Agent = z.infer<typeof AgentSchema>

export const CreateAgentInputSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
  role: z.string().min(1).max(50),
})
export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>
```

- [ ] **Step 3: Criar `apps/web/src/lib/schemas/aios-event.ts`**

```ts
import { z } from 'zod'

export const AiosEventSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  agent_id: z.string().uuid().nullable(),
  skill_id: z.string(),
  status: z.enum(['pending', 'running', 'ok', 'error']),
  activation_mode: z.string(),
  payload: z.record(z.unknown()).nullable(),
  result: z.record(z.unknown()).nullable(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
})
export type AiosEvent = z.infer<typeof AiosEventSchema>
```

- [ ] **Step 4: Criar `apps/web/src/lib/schemas/budget.ts`**

```ts
import { z } from 'zod'

export const BudgetStatusSchema = z.object({
  month: z.string(),
  limit_usd: z.number(),
  spent_usd: z.number(),
  tokens_used: z.number(),
  percent_used: z.number(),
  throttled_at: z.string().nullable(),
  alerts_fired: z.array(z.number()),
})
export type BudgetStatus = z.infer<typeof BudgetStatusSchema>
```

- [ ] **Step 5: Criar `apps/web/src/lib/schemas/a2a.ts`**

```ts
import { z } from 'zod'

export const A2AKeySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  key_prefix: z.string(),
  agent_id: z.string().uuid(),
  last_used_at: z.string().nullable(),
  created_at: z.string(),
})
export type A2AKey = z.infer<typeof A2AKeySchema>

export const A2AKeyCreateResponseSchema = z.object({
  data: z.object({
    id: z.string().uuid(),
    key: z.string(), // mostrada apenas uma vez
    prefix: z.string(),
  }),
})
```

- [ ] **Step 6: Validate**

Run: `cd apps/web && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/schemas/
git commit -m "feat(web): zod schemas for auth, agent, events, budget, a2a"
```

## Task 11: AuthProvider (Context + useReducer)

**Files:**
- Create: `apps/web/src/providers/auth-provider.tsx`
- Create: `apps/web/src/providers/auth-provider.test.tsx`
- Create: `apps/web/src/hooks/use-auth.ts`

- [ ] **Step 1: Escrever teste falho `auth-provider.test.tsx`**

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { AuthProvider } from './auth-provider'
import { useAuth } from '../hooks/use-auth'

function TestConsumer() {
  const { isAuthenticated, tenant, login, logout } = useAuth()
  return (
    <div>
      <div data-testid="auth">{isAuthenticated ? 'authed' : 'anon'}</div>
      <div data-testid="tenant">{tenant?.slug ?? 'none'}</div>
      <button onClick={() => login('token123', { id: 't1', name: 'Test', slug: 'test' })}>
        login
      </button>
      <button onClick={() => logout()}>logout</button>
    </div>
  )
}

describe('AuthProvider', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('starts unauthenticated when no token in localStorage', () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    expect(screen.getByTestId('auth').textContent).toBe('anon')
    expect(screen.getByTestId('tenant').textContent).toBe('none')
  })

  it('hydrates from localStorage', () => {
    localStorage.setItem('ethra.token', 'tok')
    localStorage.setItem('ethra.tenant', JSON.stringify({ id: 't1', name: 'X', slug: 'x' }))
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    expect(screen.getByTestId('auth').textContent).toBe('authed')
    expect(screen.getByTestId('tenant').textContent).toBe('x')
  })

  it('login() persists token + tenant', () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    act(() => {
      screen.getByText('login').click()
    })
    expect(localStorage.getItem('ethra.token')).toBe('token123')
    expect(screen.getByTestId('auth').textContent).toBe('authed')
  })

  it('logout() clears storage', () => {
    localStorage.setItem('ethra.token', 'tok')
    localStorage.setItem('ethra.tenant', JSON.stringify({ id: 't1', name: 'X', slug: 'x' }))
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    act(() => {
      screen.getByText('logout').click()
    })
    expect(localStorage.getItem('ethra.token')).toBeNull()
    expect(screen.getByTestId('auth').textContent).toBe('anon')
  })

  it('responds to ethra:unauthorized event', () => {
    localStorage.setItem('ethra.token', 'tok')
    localStorage.setItem('ethra.tenant', JSON.stringify({ id: 't1', name: 'X', slug: 'x' }))
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    expect(screen.getByTestId('auth').textContent).toBe('authed')
    act(() => {
      window.dispatchEvent(new CustomEvent('ethra:unauthorized'))
    })
    expect(screen.getByTestId('auth').textContent).toBe('anon')
    expect(localStorage.getItem('ethra.token')).toBeNull()
  })
})
```

- [ ] **Step 2: Run (fail)**

Run: `cd apps/web && npm run test src/providers/auth-provider.test.tsx`
Expected: FAIL (não existe).

- [ ] **Step 3: Implementar `apps/web/src/providers/auth-provider.tsx`**

```tsx
import { createContext, useReducer, useEffect, type ReactNode } from 'react'
import type { Tenant } from '@/lib/schemas/auth'

export type AuthState = {
  token: string | null
  tenant: Tenant | null
  isAuthenticated: boolean
}

type Action =
  | { type: 'LOGIN'; payload: { token: string; tenant: Tenant } }
  | { type: 'LOGOUT' }
  | { type: 'HYDRATE'; payload: { token: string; tenant: Tenant } | null }

const initialState: AuthState = {
  token: null,
  tenant: null,
  isAuthenticated: false,
}

function reducer(state: AuthState, action: Action): AuthState {
  switch (action.type) {
    case 'LOGIN':
    case 'HYDRATE':
      if (!action.payload) return initialState
      return {
        token: action.payload.token,
        tenant: action.payload.tenant,
        isAuthenticated: true,
      }
    case 'LOGOUT':
      return initialState
  }
}

export type AuthContextValue = AuthState & {
  login: (token: string, tenant: Tenant) => void
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // Hydrate from localStorage on mount
  useEffect(() => {
    const token = localStorage.getItem('ethra.token')
    const tenantRaw = localStorage.getItem('ethra.tenant')
    if (token && tenantRaw) {
      try {
        const tenant = JSON.parse(tenantRaw) as Tenant
        dispatch({ type: 'HYDRATE', payload: { token, tenant } })
      } catch {
        localStorage.removeItem('ethra.token')
        localStorage.removeItem('ethra.tenant')
      }
    }
  }, [])

  // Listen for global 401 events
  useEffect(() => {
    const handler = () => {
      localStorage.removeItem('ethra.token')
      localStorage.removeItem('ethra.tenant')
      dispatch({ type: 'LOGOUT' })
    }
    window.addEventListener('ethra:unauthorized', handler)
    return () => window.removeEventListener('ethra:unauthorized', handler)
  }, [])

  const login = (token: string, tenant: Tenant) => {
    localStorage.setItem('ethra.token', token)
    localStorage.setItem('ethra.tenant', JSON.stringify(tenant))
    dispatch({ type: 'LOGIN', payload: { token, tenant } })
  }

  const logout = () => {
    localStorage.removeItem('ethra.token')
    localStorage.removeItem('ethra.tenant')
    dispatch({ type: 'LOGOUT' })
  }

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
```

- [ ] **Step 4: Implementar `apps/web/src/hooks/use-auth.ts`**

```ts
import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from '@/providers/auth-provider'

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
```

- [ ] **Step 5: Run tests (pass)**

Run: `cd apps/web && npm run test src/providers/`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/providers/ apps/web/src/hooks/use-auth.ts
git commit -m "feat(web): AuthProvider with localStorage persistence + 401 listener"
```

## Task 12: ThemeProvider + QueryProvider wrappers

**Files:**
- Create: `apps/web/src/providers/theme-provider.tsx`
- Create: `apps/web/src/providers/query-provider.tsx`

- [ ] **Step 1: Criar `apps/web/src/providers/theme-provider.tsx`**

```tsx
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ReactNode } from 'react'

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  )
}
```

- [ ] **Step 2: Criar `apps/web/src/providers/query-provider.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
```

- [ ] **Step 3: Validate**

Run: `cd apps/web && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/providers/theme-provider.tsx apps/web/src/providers/query-provider.tsx
git commit -m "feat(web): theme and query providers"
```

## Task 13: Routes skeleton + ProtectedRoute

**Files:**
- Create: `apps/web/src/routes.tsx`
- Create: `apps/web/src/pages/login.tsx` (placeholder)
- Create: `apps/web/src/pages/mission-control.tsx` (placeholder)
- Create: `apps/web/src/pages/not-found.tsx`
- Create: `apps/web/src/pages/agents/list.tsx` (placeholder)
- Create: `apps/web/src/pages/agents/detail.tsx` (placeholder)
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Criar placeholders das pages**

`apps/web/src/pages/login.tsx`:
```tsx
export default function LoginPage() {
  return <div className="p-8">Login (placeholder)</div>
}
```

`apps/web/src/pages/mission-control.tsx`:
```tsx
export default function MissionControlPage() {
  return <div className="p-8">Mission Control (placeholder)</div>
}
```

`apps/web/src/pages/not-found.tsx`:
```tsx
import { useNavigate } from 'react-router-dom'

export default function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background">
      <h1 className="font-mono text-9xl">404</h1>
      <p className="text-muted-foreground mt-4">Página não encontrada</p>
      <button
        onClick={() => navigate(-1)}
        className="mt-8 font-mono uppercase tracking-[0.18em] text-sm text-primary"
      >
        ← VOLTAR
      </button>
    </div>
  )
}
```

`apps/web/src/pages/agents/list.tsx`:
```tsx
export default function AgentsListPage() {
  return <div className="p-8">Agents List (placeholder)</div>
}
```

`apps/web/src/pages/agents/detail.tsx`:
```tsx
import { Outlet, useParams } from 'react-router-dom'

export default function AgentDetailPage() {
  const { id } = useParams()
  return (
    <div className="p-8">
      <h1 className="font-mono">Agent: {id}</h1>
      <div className="mt-4">
        <Outlet />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Criar placeholder de tab Identity**

`apps/web/src/pages/agents/tabs/identity.tsx`:
```tsx
export default function IdentityTab() {
  return <div>Identity tab (placeholder)</div>
}
```

- [ ] **Step 3: Criar `apps/web/src/components/aperture/protected-route.tsx`**

```tsx
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import type { ReactNode } from 'react'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
```

- [ ] **Step 4: Criar `apps/web/src/routes.tsx`**

```tsx
import { createBrowserRouter, Navigate } from 'react-router-dom'
import LoginPage from '@/pages/login'
import MissionControlPage from '@/pages/mission-control'
import NotFoundPage from '@/pages/not-found'
import AgentsListPage from '@/pages/agents/list'
import AgentDetailPage from '@/pages/agents/detail'
import IdentityTab from '@/pages/agents/tabs/identity'
import { ProtectedRoute } from '@/components/aperture/protected-route'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <Navigate to="/mission-control" replace />
      </ProtectedRoute>
    ),
  },
  {
    path: '/mission-control',
    element: (
      <ProtectedRoute>
        <MissionControlPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/agents',
    element: (
      <ProtectedRoute>
        <AgentsListPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/agents/:id',
    element: (
      <ProtectedRoute>
        <AgentDetailPage />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="identity" replace /> },
      { path: 'identity', element: <IdentityTab /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])
```

- [ ] **Step 5: Atualizar `apps/web/src/App.tsx`**

```tsx
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import { router } from './routes'
import { ThemeProvider } from './providers/theme-provider'
import { QueryProvider } from './providers/query-provider'
import { AuthProvider } from './providers/auth-provider'

export default function App() {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <RouterProvider router={router} />
          <Toaster richColors position="bottom-right" />
        </AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  )
}
```

- [ ] **Step 6: Smoke test**

Run: `cd apps/web && npm run dev`
Expected:
- `http://localhost:5173/` → redireciona para `/login` (não autenticado)
- `http://localhost:5173/login` → mostra placeholder
- `http://localhost:5173/qualquer-coisa` → 404 page (com link VOLTAR funcional)

Run: `npm run typecheck && npm run lint && npm run test`
Expected: tudo PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): routing skeleton with ProtectedRoute and placeholders"
```

## Task 14: shadcn primitives — Button, Input, Label, Form

**Files:**
- Create: `apps/web/src/components/ui/button.tsx`
- Create: `apps/web/src/components/ui/input.tsx`
- Create: `apps/web/src/components/ui/label.tsx`
- Create: `apps/web/src/components/ui/form.tsx`

> Estes componentes vêm do export shadcn original (boilerplate Lovable). Conteúdo idêntico ao reference design (`docs/design-system.md` §7).

- [ ] **Step 1: Adicionar deps**

Em `apps/web/package.json` dependencies:
```json
"@radix-ui/react-slot": "^1.2.3",
"@radix-ui/react-label": "^2.1.7"
```

(Já adicionados na Task 8 — verificar.)

- [ ] **Step 2: Criar `apps/web/src/components/ui/button.tsx`**

Copiar do export original (já documentado em §8.1 do design-system.md). Conteúdo:

```tsx
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
```

- [ ] **Step 3: Criar `input.tsx`, `label.tsx`, `form.tsx` (copy do export shadcn)**

Conteúdo idêntico aos arquivos do export Lovable já documentados. Para brevidade, copiar conforme:
- `input.tsx`: ver §8.1 design-system.md (Input com h-10 e classes shadcn padrão)
- `label.tsx`: Radix Label wrapper
- `form.tsx`: react-hook-form integration com Slot e Context

- [ ] **Step 4: Validate**

Run: `cd apps/web && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/
git commit -m "feat(web): shadcn primitives (Button, Input, Label, Form)"
```

## Task 15: shadcn primitives restantes (Card, Dialog, Tabs, etc.)

**Files:**
- Create: `apps/web/src/components/ui/card.tsx`
- Create: `apps/web/src/components/ui/dialog.tsx`
- Create: `apps/web/src/components/ui/tabs.tsx`
- Create: `apps/web/src/components/ui/table.tsx`
- Create: `apps/web/src/components/ui/select.tsx`
- Create: `apps/web/src/components/ui/textarea.tsx`
- Create: `apps/web/src/components/ui/switch.tsx`
- Create: `apps/web/src/components/ui/slider.tsx`
- Create: `apps/web/src/components/ui/checkbox.tsx`
- Create: `apps/web/src/components/ui/radio-group.tsx`
- Create: `apps/web/src/components/ui/popover.tsx`
- Create: `apps/web/src/components/ui/skeleton.tsx`
- Create: `apps/web/src/components/ui/alert-dialog.tsx`
- Create: `apps/web/src/components/ui/badge.tsx`
- Create: `apps/web/src/components/ui/separator.tsx`
- Create: `apps/web/src/components/ui/dropdown-menu.tsx`
- Create: `apps/web/src/components/ui/collapsible.tsx`
- Create: `apps/web/src/components/ui/sidebar.tsx` (usado pela ApertureSidebar)
- Create: `apps/web/src/hooks/use-mobile.ts`
- Modify: `apps/web/package.json` (deps Radix)

> Estes 17 primitivos shadcn vêm do export Lovable. Conteúdo é o documentado em `docs/design-system.md` §8.1.

- [ ] **Step 1: Adicionar deps Radix**

Em `apps/web/package.json` dependencies, adicionar:

```json
"@radix-ui/react-alert-dialog": "^1.1.14",
"@radix-ui/react-checkbox": "^1.3.2",
"@radix-ui/react-collapsible": "^1.1.11",
"@radix-ui/react-dialog": "^1.1.14",
"@radix-ui/react-dropdown-menu": "^2.1.15",
"@radix-ui/react-popover": "^1.1.14",
"@radix-ui/react-radio-group": "^1.3.7",
"@radix-ui/react-select": "^2.2.5",
"@radix-ui/react-separator": "^1.1.7",
"@radix-ui/react-slider": "^1.3.5",
"@radix-ui/react-switch": "^1.2.5",
"@radix-ui/react-tabs": "^1.1.12",
"@radix-ui/react-tooltip": "^1.2.7"
```

Run: `npm install`.

- [ ] **Step 2: Copiar primitivos do export Lovable**

Para cada arquivo da lista acima, copiar conteúdo do export Lovable (documentado em §8.1 do design-system.md) ajustando para TS strict (esperado: zero ou poucos ajustes — primitivos shadcn são strict-friendly por design).

- [ ] **Step 3: Validate**

Run: `cd apps/web && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/ apps/web/src/hooks/use-mobile.ts apps/web/package.json
git commit -m "feat(web): copy 17 shadcn primitives from Lovable export (TS strict)"
```

## Task 16: Login page (form + submit + redirect)

**Files:**
- Create: `apps/web/src/pages/login.tsx` (substituir placeholder)
- Create: `apps/web/src/pages/login.test.tsx`
- Create: `apps/web/src/__tests__/mocks/server.ts`
- Create: `apps/web/src/__tests__/mocks/handlers.ts`
- Modify: `apps/web/src/__tests__/setup.ts` (registrar MSW)
- Modify: `apps/web/package.json` (adicionar msw)

- [ ] **Step 1: Adicionar MSW**

Em `apps/web/package.json` devDependencies:
```json
"msw": "^2.7.0"
```

Run: `npm install`.

- [ ] **Step 2: Criar `apps/web/src/__tests__/mocks/handlers.ts`**

```ts
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.post('*/auth/login', async ({ request }) => {
    const body = (await request.json()) as { slug: string; password: string }
    if (body.slug === 'test' && body.password === 'test123') {
      return HttpResponse.json({
        token: 'mock-jwt-token',
        tenant: { id: '00000000-0000-0000-0000-000000000001', name: 'Test', slug: 'test' },
      })
    }
    return HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }),
]
```

- [ ] **Step 3: Criar `apps/web/src/__tests__/mocks/server.ts`**

```ts
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
```

- [ ] **Step 4: Modificar `apps/web/src/__tests__/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, afterAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './mocks/server'

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  localStorage.clear()
})
afterAll(() => server.close())
```

- [ ] **Step 5: Escrever teste falho `apps/web/src/pages/login.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import LoginPage from './login'
import { AuthProvider } from '@/providers/auth-provider'
import { QueryProvider } from '@/providers/query-provider'

function renderLogin() {
  return render(
    <MemoryRouter>
      <QueryProvider>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </QueryProvider>
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  it('renderiza form com slug + password', () => {
    renderLogin()
    expect(screen.getByLabelText(/slug/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument()
  })

  it('mostra erro de validação com slug inválido', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByLabelText(/slug/i), 'INVALID UPPER')
    await user.click(screen.getByRole('button', { name: /entrar/i }))
    await waitFor(() => {
      expect(screen.getByText(/letras minúsculas/i)).toBeInTheDocument()
    })
  })

  it('autentica com credenciais válidas', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.type(screen.getByLabelText(/slug/i), 'test')
    await user.type(screen.getByLabelText(/password/i), 'test123')
    await user.click(screen.getByRole('button', { name: /entrar/i }))
    await waitFor(() => {
      expect(localStorage.getItem('ethra.token')).toBe('mock-jwt-token')
    })
  })
})
```

- [ ] **Step 6: Run (fail)**

Run: `cd apps/web && npm run test src/pages/login.test.tsx`
Expected: FAIL.

- [ ] **Step 7: Implementar `apps/web/src/pages/login.tsx`**

```tsx
import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoginSchema, type LoginInput, type LoginResponse } from '@/lib/schemas/auth'
import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/hooks/use-auth'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, isAuthenticated } = useAuth()
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { slug: '', password: '' },
  })

  // Already authenticated? Redirect.
  if (isAuthenticated) {
    return null // o effect/router cuida
  }

  const onSubmit = async (data: LoginInput) => {
    setSubmitting(true)
    try {
      const res = await api.post<LoginResponse>('/auth/login', data)
      login(res.token, res.tenant)
      const from = (location.state as { from?: string } | null)?.from ?? '/mission-control'
      navigate(from, { replace: true })
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erro ao fazer login'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm border-hairline bg-card p-8">
        <div className="text-center mb-8">
          <h1 className="font-mono text-xl uppercase tracking-[0.2em] text-foreground">
            ETHRA APERTURE
          </h1>
          <p className="text-muted-foreground text-sm mt-2">Console de Orquestração</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="slug" className="font-mono uppercase tracking-[0.12em] text-xs">
              Slug
            </Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted-foreground text-sm">
                @
              </span>
              <Input
                id="slug"
                {...register('slug')}
                className="pl-7 font-mono"
                autoComplete="username"
                autoFocus
              />
            </div>
            {errors.slug && (
              <p className="text-destructive text-xs mt-1">{errors.slug.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="password" className="font-mono uppercase tracking-[0.12em] text-xs">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              {...register('password')}
              className="mt-1"
              autoComplete="current-password"
            />
            {errors.password && (
              <p className="text-destructive text-xs mt-1">{errors.password.message}</p>
            )}
          </div>

          <Button
            type="submit"
            disabled={submitting}
            className="w-full font-mono uppercase tracking-[0.12em]"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Entrar
          </Button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Run tests (pass)**

Run: `cd apps/web && npm run test src/pages/login.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 9: Smoke test manual**

Run: `cd apps/web && npm run dev`. Acessar `/login`. Conferir form aparece com prefix `@`, focus automático, validação inline.

- [ ] **Step 10: Commit**

```bash
git add apps/web/
git commit -m "feat(web): Login page with validation, MSW mocks, and 3 passing tests"
```

## Task 17: ApertureSidebar component

**Files:**
- Create: `apps/web/src/components/aperture/sidebar.tsx`
- Create: `apps/web/src/components/aperture/sidebar.test.tsx`

> A sidebar usa o primitivo `@/components/ui/sidebar.tsx` (já copiado na Task 15) como base, mas adapta para o padrão APERTURE: 60px rail ↔ 220px expandido, atalho Cmd/Ctrl+B, persistência via cookie (já feita pelo primitive), 2 itens MVP (Mission Control, Agentes).

- [ ] **Step 1: Implementar `apps/web/src/components/aperture/sidebar.tsx`**

```tsx
import { LayoutDashboard, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { ThemeToggle } from './theme-toggle'

const navItems = [
  { to: '/mission-control', label: 'Mission Control', icon: LayoutDashboard },
  { to: '/agents', label: 'Agentes', icon: Users },
]

export function ApertureSidebar() {
  return (
    <Sidebar collapsible="icon" className="border-r-hairline">
      <SidebarHeader className="p-4">
        <div className="font-mono uppercase tracking-[0.2em] text-sm">
          ETHRA APERTURE
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono uppercase tracking-[0.14em] text-[9px] text-muted-foreground">
            SISTEMA
          </SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map(({ to, label, icon: Icon }) => (
              <SidebarMenuItem key={to}>
                <NavLink to={to}>
                  {({ isActive }) => (
                    <SidebarMenuButton isActive={isActive}>
                      <Icon className="size-4" />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  )}
                </NavLink>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        <div className="flex items-center justify-between">
          <ThemeToggle />
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-status-active filament-pulse" style={{ background: 'hsl(var(--status-active))' }} />
            <span className="font-mono uppercase tracking-[0.1em] text-[9px] text-muted-foreground">
              SYS OPERATIONAL
            </span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

export { SidebarProvider }
```

- [ ] **Step 2: Smoke test (sem teste unit detalhado — é layout)**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/aperture/sidebar.tsx
git commit -m "feat(web): ApertureSidebar with 2 MVP items + theme toggle"
```

## Task 18: ThemeToggle component

**Files:**
- Create: `apps/web/src/components/aperture/theme-toggle.tsx`

- [ ] **Step 1: Implementar**

```tsx
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Trocar para tema claro' : 'Trocar para tema escuro'}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}
```

- [ ] **Step 2: Validate**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/aperture/theme-toggle.tsx
git commit -m "feat(web): ThemeToggle button (Sun/Moon)"
```

## Task 19: AppShell layout

**Files:**
- Create: `apps/web/src/components/aperture/app-shell.tsx`
- Modify: `apps/web/src/routes.tsx` (usar AppShell em rotas protegidas)

- [ ] **Step 1: Criar `apps/web/src/components/aperture/app-shell.tsx`**

```tsx
import { Outlet } from 'react-router-dom'
import { ApertureSidebar, SidebarProvider } from './sidebar'

export function AppShell() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <ApertureSidebar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </SidebarProvider>
  )
}
```

- [ ] **Step 2: Atualizar `apps/web/src/routes.tsx` para usar AppShell**

Substituir as rotas protegidas individuais por uma rota pai com AppShell:

```tsx
import { createBrowserRouter, Navigate } from 'react-router-dom'
import LoginPage from '@/pages/login'
import MissionControlPage from '@/pages/mission-control'
import NotFoundPage from '@/pages/not-found'
import AgentsListPage from '@/pages/agents/list'
import AgentDetailPage from '@/pages/agents/detail'
import IdentityTab from '@/pages/agents/tabs/identity'
import { ProtectedRoute } from '@/components/aperture/protected-route'
import { AppShell } from '@/components/aperture/app-shell'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { path: '/', element: <Navigate to="/mission-control" replace /> },
      { path: '/mission-control', element: <MissionControlPage /> },
      { path: '/agents', element: <AgentsListPage /> },
      {
        path: '/agents/:id',
        element: <AgentDetailPage />,
        children: [
          { index: true, element: <Navigate to="identity" replace /> },
          { path: 'identity', element: <IdentityTab /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])
```

- [ ] **Step 3: Smoke test**

Run: `npm run dev`. Login (slug `test`, password `test123` se MSW estiver ativo em dev) — não, MSW só em testes. Login real contra backend será integration test posterior. Por ora, verificar:
- `/login` mostra apenas o form (sem sidebar)
- Manualmente setar `localStorage.setItem('ethra.token', 'fake')` e `localStorage.setItem('ethra.tenant', '{"id":"x","name":"X","slug":"x"}')`, recarregar
- Acessar `/mission-control` → sidebar aparece à esquerda + Mission Control placeholder à direita
- Toggle theme (dark/light) funciona
- Atalho Cmd/Ctrl+B colapsa/expande sidebar

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/aperture/app-shell.tsx apps/web/src/routes.tsx
git commit -m "feat(web): AppShell with sidebar + outlet for protected routes"
```

---

# Phase 3 — Mission Control

## Task 20: useAgents hook

**Files:**
- Create: `apps/web/src/hooks/use-agents.ts`
- Create: `apps/web/src/hooks/use-agents.test.ts`

- [ ] **Step 1: Adicionar handler MSW para `GET /agents`**

Em `apps/web/src/__tests__/mocks/handlers.ts`, adicionar:

```ts
http.get('*/agents', () => {
  return HttpResponse.json({
    data: [
      {
        id: '00000000-0000-0000-0001-000000000001',
        tenant_id: '00000000-0000-0000-0000-000000000001',
        name: 'Atendimento',
        slug: 'atendimento',
        role: 'support',
        model: 'claude-sonnet-4-6',
        system_prompt: 'You are an assistant.',
        status: 'active',
        budget_monthly: '50.00',
        description: null,
        avatar_url: null,
        tags: [],
        system_prompt_extra: null,
        response_language: 'pt-BR',
        tone: 'professional',
        restrictions: [],
        wiki_enabled: true,
        wiki_top_k: 5,
        wiki_min_score: '0.72',
        wiki_write_mode: 'supervised',
        a2a_enabled: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        skills: [],
        channels: [],
      },
    ],
  })
}),
```

- [ ] **Step 2: Escrever teste falho `apps/web/src/hooks/use-agents.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryProvider } from '@/providers/query-provider'
import { useAgents } from './use-agents'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryProvider>{children}</QueryProvider>
)

describe('useAgents', () => {
  it('retorna lista de agentes', async () => {
    const { result } = renderHook(() => useAgents(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0]?.slug).toBe('atendimento')
  })
})
```

- [ ] **Step 3: Implementar `apps/web/src/hooks/use-agents.ts`**

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Agent, CreateAgentInput } from '@/lib/schemas/agent'

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const res = await api.get<{ data: Agent[] }>('/agents')
      return res.data
    },
  })
}

export function useAgent(id: string) {
  return useQuery({
    queryKey: ['agent', id],
    queryFn: async () => {
      const res = await api.get<{ data: Agent }>(`/agents/${id}`)
      return res.data
    },
    enabled: !!id,
  })
}

export function useCreateAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateAgentInput) => {
      const res = await api.post<{ data: Agent }>('/agents', input)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}

export function useUpdateAgent(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<Agent>) => {
      const res = await api.patch<{ data: Agent }>(`/agents/${id}`, patch)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', id] })
      qc.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}

export function useArchiveAgent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/agents/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}
```

- [ ] **Step 4: Run test (pass)**

Run: `cd apps/web && npm run test src/hooks/use-agents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/use-agents.ts apps/web/src/hooks/use-agents.test.ts apps/web/src/__tests__/mocks/handlers.ts
git commit -m "feat(web): useAgents hooks (list, get, create, update, archive)"
```

## Task 21: useAgentBudget + useAiosEvents

**Files:**
- Create: `apps/web/src/hooks/use-agent-budget.ts`
- Create: `apps/web/src/hooks/use-aios-events.ts`

- [ ] **Step 1: Implementar `apps/web/src/hooks/use-agent-budget.ts`**

```ts
import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { BudgetStatus } from '@/lib/schemas/budget'

export function useAgentBudget(agentId: string) {
  return useQuery({
    queryKey: ['agent', agentId, 'budget'],
    queryFn: async () => {
      const res = await api.get<{ data: BudgetStatus }>(`/agents/${agentId}/budget`)
      return res.data
    },
    enabled: !!agentId,
  })
}

export function useAgentBudgets(agentIds: string[]) {
  return useQueries({
    queries: agentIds.map((id) => ({
      queryKey: ['agent', id, 'budget'] as const,
      queryFn: async () => {
        const res = await api.get<{ data: BudgetStatus }>(`/agents/${id}/budget`)
        return res.data
      },
    })),
  })
}

export function useUpdateAgentBudget(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (monthly_limit_usd: number) => {
      const res = await api.patch<{ data: BudgetStatus }>(`/agents/${agentId}/budget`, {
        monthly_limit_usd,
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', agentId, 'budget'] })
    },
  })
}
```

- [ ] **Step 2: Implementar `apps/web/src/hooks/use-aios-events.ts`**

```ts
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AiosEvent } from '@/lib/schemas/aios-event'

export function useAiosEvents(limit = 10) {
  return useQuery({
    queryKey: ['aios-events', limit],
    queryFn: async () => {
      const res = await api.get<{ data: AiosEvent[] }>(`/aios/events?limit=${limit}`)
      return res.data
    },
    refetchInterval: 10_000,
  })
}
```

- [ ] **Step 3: Validate**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/use-agent-budget.ts apps/web/src/hooks/use-aios-events.ts
git commit -m "feat(web): useAgentBudget(s) and useAiosEvents with polling"
```

## Task 22: KpiCard, StatusPill, PageHeader components

**Files:**
- Create: `apps/web/src/components/aperture/kpi-card.tsx`
- Create: `apps/web/src/components/aperture/status-pill.tsx`
- Create: `apps/web/src/components/aperture/page-header.tsx`

- [ ] **Step 1: Criar `apps/web/src/components/aperture/kpi-card.tsx`**

```tsx
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface KpiCardProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  alert?: boolean
  loading?: boolean
}

export function KpiCard({ label, value, sub, alert, loading }: KpiCardProps) {
  return (
    <div className={cn('border-hairline bg-card p-4', alert && 'border-l-2 border-l-destructive')}>
      <div className="font-mono uppercase tracking-[0.12em] text-[9px] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'font-mono text-3xl mt-2 tabular-nums tracking-[-0.02em]',
          alert ? 'text-destructive' : 'text-foreground',
          loading && 'opacity-50',
        )}
      >
        {loading ? '—' : value}
      </div>
      {sub && (
        <div className="text-xs text-muted-foreground mt-2">{sub}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Criar `apps/web/src/components/aperture/status-pill.tsx`**

```tsx
import { cn } from '@/lib/utils'

type Status = 'active' | 'busy' | 'idle' | 'archived' | 'error'

const colors: Record<Status, string> = {
  active: 'hsl(var(--status-active))',
  busy: 'hsl(var(--status-busy))',
  idle: 'hsl(var(--status-idle))',
  archived: 'hsl(var(--muted-foreground))',
  error: 'hsl(var(--destructive))',
}

const labels: Record<Status, string> = {
  active: 'ACTIVE',
  busy: 'BUSY',
  idle: 'IDLE',
  archived: 'ARCHIVED',
  error: 'ERROR',
}

export function StatusPill({ status, pulse }: { status: Status; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn('size-1.5 rounded-full', pulse && 'filament-pulse')}
        style={{ background: colors[status] }}
      />
      <span className="font-mono uppercase tracking-[0.18em] text-[9px]" style={{ color: colors[status] }}>
        {labels[status]}
      </span>
    </span>
  )
}
```

- [ ] **Step 3: Criar `apps/web/src/components/aperture/page-header.tsx`**

```tsx
import { useEffect, useState, type ReactNode } from 'react'

interface PageHeaderProps {
  breadcrumb: string
  title: string
  subtitle?: ReactNode
  showLive?: boolean
  actions?: ReactNode
}

export function PageHeader({ breadcrumb, title, subtitle, showLive, actions }: PageHeaderProps) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    if (!showLive) return
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [showLive])

  return (
    <div className="flex items-end justify-between mb-6">
      <div>
        <div className="font-mono uppercase tracking-[0.15em] text-[9px] text-muted-foreground mb-1">
          {breadcrumb}
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">{title}</h1>
        {subtitle && <div className="text-sm text-muted-foreground mt-1">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-3">
        {showLive && (
          <div className="flex items-center gap-2 font-mono text-xs">
            <span
              className="size-1.5 rounded-full filament-pulse"
              style={{ background: 'hsl(var(--primary))' }}
            />
            <span className="text-muted-foreground">LIVE</span>
            <span className="text-muted-foreground">
              {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        )}
        {actions}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Validate**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/aperture/
git commit -m "feat(web): KpiCard, StatusPill, PageHeader compostos APERTURE"
```

## Task 23: AgentRosterCard + ActivityFeed

**Files:**
- Create: `apps/web/src/components/aperture/agent-roster-card.tsx`
- Create: `apps/web/src/components/aperture/activity-feed.tsx`

- [ ] **Step 1: Criar `agent-roster-card.tsx`**

```tsx
import { Link } from 'react-router-dom'
import type { Agent } from '@/lib/schemas/agent'
import type { BudgetStatus } from '@/lib/schemas/budget'
import { StatusPill } from './status-pill'

interface Props {
  agent: Agent
  budget?: BudgetStatus | undefined
}

export function AgentRosterCard({ agent, budget }: Props) {
  const status = agent.status === 'active' ? 'active' : 'archived'
  const percent = budget?.percent_used ?? 0

  return (
    <Link
      to={`/agents/${agent.id}/identity`}
      className="block p-3 border-b-hairline hover:bg-secondary transition-colors"
    >
      <div className="flex items-center gap-3 mb-2">
        <span className="font-medium text-sm">{agent.name}</span>
        <StatusPill status={status} />
      </div>
      <div className="font-mono text-[10px] text-muted-foreground mb-2">{agent.model}</div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-0.5 bg-secondary overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
        <span className="font-mono text-[9px] text-muted-foreground tabular-nums">
          {budget ? `$${budget.spent_usd.toFixed(2)}/${budget.limit_usd.toFixed(0)}` : '—'}
        </span>
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Criar `activity-feed.tsx`**

```tsx
import type { AiosEvent } from '@/lib/schemas/aios-event'
import { cn } from '@/lib/utils'

const colors: Record<AiosEvent['status'], string> = {
  pending: 'hsl(var(--muted-foreground))',
  running: 'hsl(var(--primary))',
  ok: 'hsl(var(--status-active))',
  error: 'hsl(var(--destructive))',
}

interface Props {
  events: AiosEvent[]
}

export function ActivityFeed({ events }: Props) {
  if (events.length === 0) {
    return (
      <div className="p-4 text-center font-mono text-xs text-muted-foreground">
        Nenhuma atividade recente.
      </div>
    )
  }

  return (
    <div className="divide-y-hairline">
      {events.map((event) => (
        <div key={event.id} className="flex items-start gap-3 p-3 text-sm">
          <span className="font-mono text-[10px] text-muted-foreground w-12 flex-shrink-0 mt-0.5">
            {new Date(event.started_at).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span className="flex-1">
            <span className="font-mono text-[10px] text-muted-foreground mr-2">
              {event.skill_id}
            </span>
            <span className={cn('font-mono text-[10px]', event.status === 'error' && 'text-destructive')}>
              {event.status}
            </span>
          </span>
          <span
            className="size-1.5 rounded-full mt-1.5"
            style={{ background: colors[event.status] }}
          />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Validate**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/aperture/agent-roster-card.tsx apps/web/src/components/aperture/activity-feed.tsx
git commit -m "feat(web): AgentRosterCard and ActivityFeed components"
```

## Task 24: Mission Control page (assembly)

**Files:**
- Modify: `apps/web/src/pages/mission-control.tsx` (substituir placeholder)

- [ ] **Step 1: Adicionar handler MSW para `/agents/:id/budget` e `/aios/events`**

Em `apps/web/src/__tests__/mocks/handlers.ts`:

```ts
http.get('*/agents/:id/budget', () => {
  return HttpResponse.json({
    data: {
      month: '2026-04',
      limit_usd: 50,
      spent_usd: 6,
      tokens_used: 1234,
      percent_used: 12,
      throttled_at: null,
      alerts_fired: [],
    },
  })
}),
http.get('*/aios/events', () => {
  return HttpResponse.json({
    data: [
      {
        id: '00000000-0000-0000-0000-000000000001',
        tenant_id: '00000000-0000-0000-0000-000000000001',
        agent_id: '00000000-0000-0000-0001-000000000001',
        skill_id: 'wiki:lint',
        status: 'ok',
        activation_mode: 'on_demand',
        payload: null,
        result: null,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      },
    ],
  })
}),
```

- [ ] **Step 2: Implementar `apps/web/src/pages/mission-control.tsx`**

```tsx
import { useAgents } from '@/hooks/use-agents'
import { useAgentBudgets } from '@/hooks/use-agent-budget'
import { useAiosEvents } from '@/hooks/use-aios-events'
import { useAuth } from '@/hooks/use-auth'
import { PageHeader } from '@/components/aperture/page-header'
import { KpiCard } from '@/components/aperture/kpi-card'
import { AgentRosterCard } from '@/components/aperture/agent-roster-card'
import { ActivityFeed } from '@/components/aperture/activity-feed'
import { Skeleton } from '@/components/ui/skeleton'
import { Link } from 'react-router-dom'

export default function MissionControlPage() {
  const { tenant } = useAuth()
  const agents = useAgents()
  const aiosEvents = useAiosEvents(10)

  const activeAgents = agents.data?.filter((a) => a.status === 'active') ?? []
  const budgets = useAgentBudgets(activeAgents.map((a) => a.id))
  const totalSpend = budgets.reduce((sum, q) => sum + (q.data?.spent_usd ?? 0), 0)
  const allBudgetsLoaded = budgets.every((q) => q.isSuccess)

  const today = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <div className="p-6">
      <PageHeader
        breadcrumb="ETHRA NEXUS · MISSION CONTROL"
        title="Dashboard Operacional"
        subtitle={`Tenant ${tenant?.name ?? '...'} · ${today}`}
        showLive
      />

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <KpiCard
          label="TOTAL DE AGENTES"
          value={agents.data?.length ?? 0}
          loading={agents.isLoading}
        />
        <KpiCard
          label="AGENTES ATIVOS"
          value={activeAgents.length}
          loading={agents.isLoading}
        />
        <KpiCard
          label="GASTO MENSAL TOTAL"
          value={`R$ ${totalSpend.toFixed(2)}`}
          loading={!allBudgetsLoaded || agents.isLoading}
        />
      </div>

      {/* Roster + Feed */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="border-hairline bg-card">
          <div className="p-3 border-b-hairline">
            <span className="font-mono uppercase tracking-[0.12em] text-xs text-muted-foreground">
              AGENT ROSTER
            </span>
          </div>
          {agents.isLoading ? (
            <div className="p-3 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : activeAgents.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-muted-foreground mb-2">Nenhum agente cadastrado</p>
              <Link
                to="/agents"
                className="font-mono uppercase tracking-[0.12em] text-xs text-primary"
              >
                Criar primeiro agente →
              </Link>
            </div>
          ) : (
            activeAgents.slice(0, 10).map((agent, i) => (
              <AgentRosterCard
                key={agent.id}
                agent={agent}
                budget={budgets[i]?.data}
              />
            ))
          )}
        </div>

        <div className="border-hairline bg-card">
          <div className="p-3 border-b-hairline">
            <span className="font-mono uppercase tracking-[0.12em] text-xs text-muted-foreground">
              ACTIVITY FEED
            </span>
          </div>
          {aiosEvents.isLoading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <ActivityFeed events={aiosEvents.data ?? []} />
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Smoke test manual**

Run: `npm run dev`. Após login (manual via localStorage), `/mission-control` mostra:
- 3 KPI cards com skeleton → dados reais
- Agent Roster com 1+ cards
- Activity Feed com eventos
- LIVE badge animado + timestamp
- Polling 10s no feed (verificar via DevTools Network)

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/mission-control.tsx apps/web/src/__tests__/mocks/handlers.ts
git commit -m "feat(web): Mission Control page with KPIs, Roster, ActivityFeed"
```

---

# Phase 4 — Agentes (Lista + Modal)

## Task 25: Agentes Lista — tabela com filtros

**Files:**
- Modify: `apps/web/src/pages/agents/list.tsx` (substituir placeholder)

- [ ] **Step 1: Implementar list page completa**

```tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAgents } from '@/hooks/use-agents'
import { PageHeader } from '@/components/aperture/page-header'
import { StatusPill } from '@/components/aperture/status-pill'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { NewAgentModal } from './new-agent-modal'

type StatusFilter = 'all' | 'active' | 'archived'

export default function AgentsListPage() {
  const { data, isLoading } = useAgents()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [modalOpen, setModalOpen] = useState(false)

  const filtered = (data ?? []).filter((agent) => {
    if (statusFilter !== 'all' && agent.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return agent.name.toLowerCase().includes(q) || agent.slug.toLowerCase().includes(q)
    }
    return true
  })

  const activeCount = (data ?? []).filter((a) => a.status === 'active').length

  return (
    <div className="p-6">
      <PageHeader
        breadcrumb="ETHRA NEXUS · AGENTES"
        title="Agentes"
        subtitle={`${data?.length ?? 0} agentes (${activeCount} ativos)`}
        actions={
          <Button onClick={() => setModalOpen(true)} className="font-mono uppercase tracking-[0.1em]">
            + NOVO AGENTE
          </Button>
        }
      />

      <div className="flex gap-3 mb-4">
        <Input
          placeholder="Buscar por nome ou slug..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs font-mono"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="archived">Arquivados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border-hairline bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead>Skills</TableHead>
              <TableHead>Channels</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-10" />
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Nenhum agente encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((agent) => (
                <TableRow key={agent.id} className="cursor-pointer">
                  <TableCell>
                    <Link to={`/agents/${agent.id}/identity`} className="hover:underline">
                      {agent.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{agent.slug}</TableCell>
                  <TableCell>{agent.role}</TableCell>
                  <TableCell>
                    <StatusPill status={agent.status === 'active' ? 'active' : 'archived'} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{agent.model}</TableCell>
                  <TableCell>{agent.skills?.length ?? 0}</TableCell>
                  <TableCell>{agent.channels?.length ?? 0}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <NewAgentModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  )
}
```

- [ ] **Step 2: Validate**

Run: `npm run typecheck`
Expected: PASS (vai falhar pq NewAgentModal não existe ainda — implementar a seguir).

## Task 26: Modal "Novo Agente"

**Files:**
- Create: `apps/web/src/pages/agents/new-agent-modal.tsx`

- [ ] **Step 1: Implementar**

```tsx
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CreateAgentInputSchema, type CreateAgentInput } from '@/lib/schemas/agent'
import { useCreateAgent } from '@/hooks/use-agents'
import { ApiError } from '@/lib/api'

export function NewAgentModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const createAgent = useCreateAgent()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<CreateAgentInput>({
    resolver: zodResolver(CreateAgentInputSchema),
    defaultValues: { name: '', slug: '', role: 'support' },
  })

  const onSubmit = async (data: CreateAgentInput) => {
    try {
      const agent = await createAgent.mutateAsync(data)
      toast.success('Agente criado')
      onOpenChange(false)
      reset()
      navigate(`/agents/${agent.id}/identity`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao criar agente')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-[0.1em]">Novo Agente</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="name">Nome</Label>
            <Input id="name" {...register('name')} />
            {errors.name && <p className="text-destructive text-xs mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" {...register('slug')} className="font-mono" />
            {errors.slug && <p className="text-destructive text-xs mt-1">{errors.slug.message}</p>}
            <p className="text-xs text-muted-foreground mt-1">
              Identificador único, lowercase, sem espaços. Ex: <code className="font-mono">atendimento</code>.
            </p>
          </div>
          <div>
            <Label htmlFor="role">Role</Label>
            <Select value={watch('role')} onValueChange={(v) => setValue('role', v)}>
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="support">Support</SelectItem>
                <SelectItem value="sales">Sales</SelectItem>
                <SelectItem value="monitor">Monitor</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createAgent.isPending}>
              {createAgent.isPending && <Loader2 className="size-4 animate-spin" />}
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Adicionar handler MSW para `POST /agents`**

```ts
http.post('*/agents', async ({ request }) => {
  const body = (await request.json()) as { name: string; slug: string; role: string }
  return HttpResponse.json({
    data: {
      id: '00000000-0000-0000-0001-000000000099',
      tenant_id: '00000000-0000-0000-0000-000000000001',
      ...body,
      model: 'claude-sonnet-4-6',
      system_prompt: '',
      status: 'active',
      budget_monthly: '50.00',
      description: null,
      avatar_url: null,
      tags: [],
      system_prompt_extra: null,
      response_language: 'pt-BR',
      tone: 'professional',
      restrictions: [],
      wiki_enabled: true,
      wiki_top_k: 5,
      wiki_min_score: '0.72',
      wiki_write_mode: 'supervised',
      a2a_enabled: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      skills: [],
      channels: [],
    },
  }, { status: 201 })
}),
```

- [ ] **Step 3: Smoke test**

Run: `npm run dev`. Acessar `/agents`. Click "+ NOVO AGENTE" → modal abre. Preencher e submit → modal fecha + redireciona para `/agents/:id/identity`.

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/agents/
git commit -m "feat(web): Agents list with filters + New Agent modal"
```

---

# Phase 5 — Agentes Detail (6 tabs)

## Task 27: Agent Detail layout

**Files:**
- Modify: `apps/web/src/pages/agents/detail.tsx`
- Modify: `apps/web/src/routes.tsx` (adicionar rotas das 5 tabs restantes)
- Create: `apps/web/src/pages/agents/tabs/skills.tsx` (placeholder)
- Create: `apps/web/src/pages/agents/tabs/channels.tsx` (placeholder)
- Create: `apps/web/src/pages/agents/tabs/budget.tsx` (placeholder)
- Create: `apps/web/src/pages/agents/tabs/wiki.tsx` (placeholder)
- Create: `apps/web/src/pages/agents/tabs/a2a.tsx` (placeholder)

- [ ] **Step 1: Atualizar `apps/web/src/pages/agents/detail.tsx`**

```tsx
import { useParams, useNavigate, useLocation, Outlet, NavLink } from 'react-router-dom'
import { useAgent } from '@/hooks/use-agents'
import { PageHeader } from '@/components/aperture/page-header'
import { StatusPill } from '@/components/aperture/status-pill'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const tabs = [
  { path: 'identity', label: 'Identidade' },
  { path: 'skills', label: 'Skills' },
  { path: 'channels', label: 'Channels' },
  { path: 'budget', label: 'Budget' },
  { path: 'wiki', label: 'Wiki' },
  { path: 'a2a', label: 'A2A' },
]

export default function AgentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: agent, isLoading } = useAgent(id!)

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-12 w-64 mb-4" />
        <Skeleton className="h-10 w-full mb-6" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="p-6">
        <PageHeader breadcrumb="AGENTES" title="Agente não encontrado" />
        <Button onClick={() => navigate('/agents')}>Voltar à lista</Button>
      </div>
    )
  }

  return (
    <div className="p-6">
      <PageHeader
        breadcrumb={`AGENTES · ${agent.name}`}
        title={agent.name}
        subtitle={
          <span className="flex items-center gap-3">
            <span className="font-mono">{agent.slug}</span>
            <StatusPill status={agent.status === 'active' ? 'active' : 'archived'} />
            <span className="font-mono text-xs">{agent.model}</span>
          </span>
        }
      />

      {/* Tabs nav */}
      <div className="flex gap-1 border-b-hairline mb-6">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={`/agents/${id}/${tab.path}`}
            className={({ isActive }) =>
              cn(
                'px-4 py-2 font-mono uppercase tracking-[0.1em] text-xs border-b-2 -mb-[1px] transition-colors',
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  )
}
```

- [ ] **Step 2: Criar placeholders das 5 tabs restantes**

Cada arquivo: `apps/web/src/pages/agents/tabs/{tab}.tsx`:

```tsx
export default function SkillsTab() {
  return <div className="text-muted-foreground">Skills tab — TODO</div>
}
```

(Repetir para channels, budget, wiki, a2a com seus nomes.)

- [ ] **Step 3: Atualizar `apps/web/src/routes.tsx` para incluir as 5 tabs**

```tsx
{
  path: '/agents/:id',
  element: <AgentDetailPage />,
  children: [
    { index: true, element: <Navigate to="identity" replace /> },
    { path: 'identity', element: <IdentityTab /> },
    { path: 'skills', element: <SkillsTab /> },
    { path: 'channels', element: <ChannelsTab /> },
    { path: 'budget', element: <BudgetTab /> },
    { path: 'wiki', element: <WikiTab /> },
    { path: 'a2a', element: <A2ATab /> },
  ],
},
```

(Adicionar imports respectivos.)

- [ ] **Step 4: Smoke test**

Run: `npm run dev`. Acessar `/agents/:id` → redireciona para `identity`. Click em outras tabs → URL muda + placeholder aparece.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/agents/
git commit -m "feat(web): agent detail layout with 6 tabs nav"
```

## Task 28: Tab Identity (form completo)

**Files:**
- Modify: `apps/web/src/pages/agents/tabs/identity.tsx`
- Modify: `apps/web/src/__tests__/mocks/handlers.ts` (handler PATCH `/agents/:id` + GET `/agents/:id`)

- [ ] **Step 1: Adicionar handlers MSW**

```ts
http.get('*/agents/:id', ({ params }) => {
  return HttpResponse.json({ data: { /* same as list with id from params */ ...{}, id: params.id } })
}),
http.patch('*/agents/:id', async ({ request, params }) => {
  const patch = await request.json()
  return HttpResponse.json({ data: { ...{}, id: params.id, ...(patch as object) } })
}),
```

- [ ] **Step 2: Implementar tab Identity**

```tsx
import { useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAgent, useUpdateAgent } from '@/hooks/use-agents'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { Agent } from '@/lib/schemas/agent'
import { ApiError } from '@/lib/api'

type IdentityFormValues = Pick<
  Agent,
  | 'name'
  | 'role'
  | 'model'
  | 'system_prompt'
  | 'system_prompt_extra'
  | 'response_language'
  | 'tone'
  | 'description'
  | 'avatar_url'
>

export default function IdentityTab() {
  const { id } = useParams()
  const { data: agent, isLoading } = useAgent(id!)
  const updateAgent = useUpdateAgent(id!)

  const { register, handleSubmit, setValue, watch, reset, formState: { isDirty } } = useForm<IdentityFormValues>()

  // Sync form when agent loads
  if (agent && !isDirty && watch('name') !== agent.name) {
    reset({
      name: agent.name,
      role: agent.role,
      model: agent.model,
      system_prompt: agent.system_prompt,
      system_prompt_extra: agent.system_prompt_extra,
      response_language: agent.response_language,
      tone: agent.tone,
      description: agent.description,
      avatar_url: agent.avatar_url,
    })
  }

  const onSubmit = async (data: IdentityFormValues) => {
    try {
      await updateAgent.mutateAsync(data)
      toast.success('Identidade atualizada')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao salvar')
    }
  }

  if (isLoading) return <Skeleton className="h-96" />
  if (!agent) return null

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
      <div>
        <Label htmlFor="name">Nome</Label>
        <Input id="name" {...register('name')} />
      </div>

      <div>
        <Label>Slug</Label>
        <Input value={agent.slug} disabled className="font-mono" />
        <p className="text-xs text-muted-foreground mt-1">Slug é imutável após criação.</p>
      </div>

      <div>
        <Label htmlFor="role">Role</Label>
        <Input id="role" {...register('role')} />
      </div>

      <div>
        <Label htmlFor="model">Model</Label>
        <Select value={watch('model')} onValueChange={(v) => setValue('model', v, { shouldDirty: true })}>
          <SelectTrigger id="model"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="claude-sonnet-4-6">claude-sonnet-4-6</SelectItem>
            <SelectItem value="claude-opus-4-7">claude-opus-4-7</SelectItem>
            <SelectItem value="claude-haiku-4-5-20251001">claude-haiku-4-5</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="system_prompt">System Prompt</Label>
        <Textarea id="system_prompt" {...register('system_prompt')} rows={6} />
      </div>

      <div>
        <Label htmlFor="system_prompt_extra">System Prompt Extra</Label>
        <Textarea id="system_prompt_extra" {...register('system_prompt_extra')} rows={3} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="response_language">Idioma</Label>
          <Select value={watch('response_language')} onValueChange={(v) => setValue('response_language', v, { shouldDirty: true })}>
            <SelectTrigger id="response_language"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pt-BR">Português (BR)</SelectItem>
              <SelectItem value="en-US">English (US)</SelectItem>
              <SelectItem value="es-ES">Español</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="tone">Tom</Label>
          <Select value={watch('tone')} onValueChange={(v) => setValue('tone', v, { shouldDirty: true })}>
            <SelectTrigger id="tone"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="formal">Formal</SelectItem>
              <SelectItem value="professional">Professional</SelectItem>
              <SelectItem value="friendly">Friendly</SelectItem>
              <SelectItem value="technical">Technical</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="description">Descrição</Label>
        <Textarea id="description" {...register('description')} rows={2} />
      </div>

      <div>
        <Label htmlFor="avatar_url">Avatar URL</Label>
        <Input id="avatar_url" {...register('avatar_url')} type="url" />
      </div>

      <Button type="submit" disabled={updateAgent.isPending || !isDirty}>
        {updateAgent.isPending && <Loader2 className="size-4 animate-spin" />}
        Salvar
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Validate + commit**

Run: `npm run typecheck && npm run test`
Expected: PASS.

```bash
git add apps/web/src/pages/agents/tabs/identity.tsx apps/web/src/__tests__/mocks/handlers.ts
git commit -m "feat(web): Agent Identity tab with full edit form"
```

## Task 29: Tab Skills

**Files:**
- Create: `apps/web/src/lib/skills-built-in.ts`
- Modify: `apps/web/src/pages/agents/tabs/skills.tsx`

- [ ] **Step 1: Criar `skills-built-in.ts`**

```ts
export const BUILT_IN_SKILLS = [
  'wiki:query',
  'wiki:ingest',
  'wiki:lint',
  'channel:respond',
  'channel:proactive',
  'report:generate',
  'monitor:health',
  'monitor:alert',
  'data:analyze',
  'data:extract',
] as const

export type BuiltInSkill = (typeof BUILT_IN_SKILLS)[number]
```

- [ ] **Step 2: Implementar tab Skills**

(Padrão similar ao Identity: lista, switch enabled, delete com confirm AlertDialog, popover de adicionar.)

```tsx
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash } from 'lucide-react'
import { toast } from 'sonner'
import { useAgent } from '@/hooks/use-agents'
import { api, ApiError } from '@/lib/api'
import { BUILT_IN_SKILLS } from '@/lib/skills-built-in'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'

export default function SkillsTab() {
  const { id } = useParams()
  const { data: agent, isLoading } = useAgent(id!)
  const qc = useQueryClient()
  const [skillToAdd, setSkillToAdd] = useState<string>('')

  const addSkill = useMutation({
    mutationFn: (skill_id: string) => api.post(`/agents/${id}/skills`, { skill_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', id] })
      toast.success('Skill adicionada')
      setSkillToAdd('')
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Erro'),
  })

  const toggleSkill = useMutation({
    mutationFn: ({ skill_name, enabled }: { skill_name: string; enabled: boolean }) =>
      api.patch(`/agents/${id}/skills/${encodeURIComponent(skill_name)}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', id] }),
  })

  const deleteSkill = useMutation({
    mutationFn: (skill_name: string) => api.delete(`/agents/${id}/skills/${encodeURIComponent(skill_name)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', id] })
      toast.success('Skill removida')
    },
  })

  if (isLoading) return <Skeleton className="h-96" />
  if (!agent) return null

  const skills = agent.skills ?? []
  const usedNames = new Set(skills.map((s) => s.skill_name))
  const available = BUILT_IN_SKILLS.filter((s) => !usedNames.has(s))

  return (
    <div className="max-w-2xl">
      <div className="flex justify-between items-center mb-4">
        <span className="font-mono uppercase tracking-[0.1em] text-xs text-muted-foreground">
          {skills.length} SKILL(S)
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" /> Adicionar
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            <div className="space-y-3">
              <Select value={skillToAdd} onValueChange={setSkillToAdd}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione skill..." />
                </SelectTrigger>
                <SelectContent>
                  {available.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() => skillToAdd && addSkill.mutate(skillToAdd)}
                disabled={!skillToAdd || addSkill.isPending}
                className="w-full"
              >
                Adicionar
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="border-hairline">
        {skills.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            Nenhuma skill atribuída.
          </div>
        ) : (
          skills.map((skill) => (
            <div key={skill.id} className="flex items-center gap-3 p-3 border-b-hairline">
              <span className="font-mono text-sm flex-1">{skill.skill_name}</span>
              <Switch
                checked={skill.enabled}
                onCheckedChange={(enabled) =>
                  toggleSkill.mutate({ skill_name: skill.skill_name, enabled })
                }
              />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="icon" variant="ghost">
                    <Trash className="size-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remover skill?</AlertDialogTitle>
                    <AlertDialogDescription>
                      A skill <code className="font-mono">{skill.skill_name}</code> será removida deste agente.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteSkill.mutate(skill.skill_name)}>
                      Remover
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Validate + commit**

```bash
git add apps/web/src/lib/skills-built-in.ts apps/web/src/pages/agents/tabs/skills.tsx
git commit -m "feat(web): Skills tab with add/toggle/delete + AlertDialog confirm"
```

## Task 30: Tab Channels

**Files:**
- Modify: `apps/web/src/pages/agents/tabs/channels.tsx`

Estrutura paralela à de Skills (Task 29), mas com form condicional ao `channel_type` (whatsapp pede `evolution_instance`, email pede `address`, webhook pede `endpoint_url` https://).

- [ ] **Step 1: Implementar `apps/web/src/pages/agents/tabs/channels.tsx`**

```tsx
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Plus, Trash } from 'lucide-react'
import { toast } from 'sonner'
import { useAgent } from '@/hooks/use-agents'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'

type ChannelType = 'whatsapp' | 'webchat' | 'email'

type AddChannelForm = {
  channel_type: ChannelType
  evolution_instance?: string
  address?: string
  endpoint_url?: string
}

export default function ChannelsTab() {
  const { id } = useParams()
  const { data: agent, isLoading } = useAgent(id!)
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)

  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<AddChannelForm>({
    defaultValues: { channel_type: 'whatsapp' },
  })
  const channelType = watch('channel_type')

  const addChannel = useMutation({
    mutationFn: (input: AddChannelForm) => {
      const config: Record<string, string> = {}
      if (input.channel_type === 'whatsapp' && input.evolution_instance) {
        config.evolution_instance = input.evolution_instance
      }
      if (input.channel_type === 'email' && input.address) {
        config.address = input.address
      }
      if (input.channel_type === 'webchat' && input.endpoint_url) {
        config.endpoint_url = input.endpoint_url
      }
      return api.post(`/agents/${id}/channels`, { channel_type: input.channel_type, config })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', id] })
      toast.success('Channel adicionado')
      setModalOpen(false)
      reset()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Erro'),
  })

  const toggleChannel = useMutation({
    mutationFn: ({ channel_type, enabled }: { channel_type: string; enabled: boolean }) =>
      api.patch(`/agents/${id}/channels/${channel_type}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', id] }),
  })

  const deleteChannel = useMutation({
    mutationFn: (channel_type: string) => api.delete(`/agents/${id}/channels/${channel_type}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', id] })
      toast.success('Channel removido')
    },
  })

  if (isLoading) return <Skeleton className="h-96" />
  if (!agent) return null

  const channels = agent.channels ?? []
  const usedTypes = new Set(channels.map((c) => c.channel_type))

  return (
    <div className="max-w-2xl">
      <div className="flex justify-between items-center mb-4">
        <span className="font-mono uppercase tracking-[0.1em] text-xs text-muted-foreground">
          {channels.length} CHANNEL(S)
        </span>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="size-4" /> Adicionar
        </Button>
      </div>

      <div className="border-hairline">
        {channels.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Nenhum channel.</div>
        ) : (
          channels.map((ch) => (
            <div key={ch.id} className="flex items-center gap-3 p-3 border-b-hairline">
              <span className="font-mono text-sm flex-1">
                {ch.channel_type}
                <span className="text-muted-foreground ml-2 text-xs">
                  {Object.entries(ch.config).map(([k, v]) => `${k}=${String(v)}`).join(' · ')}
                </span>
              </span>
              <Switch
                checked={ch.enabled}
                onCheckedChange={(enabled) => toggleChannel.mutate({ channel_type: ch.channel_type, enabled })}
              />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="icon" variant="ghost"><Trash className="size-4" /></Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remover channel?</AlertDialogTitle>
                    <AlertDialogDescription>
                      O channel <code className="font-mono">{ch.channel_type}</code> será removido.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteChannel.mutate(ch.channel_type)}>
                      Remover
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))
        )}
      </div>

      {/* Add modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo channel</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((data) => addChannel.mutate(data))} className="space-y-4">
            <div>
              <Label>Tipo</Label>
              <Select
                value={channelType}
                onValueChange={(v) => reset({ channel_type: v as ChannelType })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['whatsapp', 'webchat', 'email'] as ChannelType[])
                    .filter((t) => !usedTypes.has(t))
                    .map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {channelType === 'whatsapp' && (
              <div>
                <Label htmlFor="evolution_instance">Evolution instance</Label>
                <Input
                  id="evolution_instance"
                  {...register('evolution_instance', { required: 'obrigatório' })}
                  placeholder="nexus-wa"
                />
                {errors.evolution_instance && (
                  <p className="text-destructive text-xs mt-1">{errors.evolution_instance.message}</p>
                )}
              </div>
            )}

            {channelType === 'email' && (
              <div>
                <Label htmlFor="address">Endereço</Label>
                <Input
                  id="address"
                  type="email"
                  {...register('address', { required: 'obrigatório', pattern: { value: /@/, message: 'precisa ter @' } })}
                  placeholder="atendimento@empresa.com"
                />
                {errors.address && <p className="text-destructive text-xs mt-1">{errors.address.message}</p>}
              </div>
            )}

            {channelType === 'webchat' && (
              <div>
                <Label htmlFor="endpoint_url">Webhook URL (opcional)</Label>
                <Input
                  id="endpoint_url"
                  type="url"
                  {...register('endpoint_url', { pattern: { value: /^https:\/\//, message: 'deve começar com https://' } })}
                  placeholder="https://meusite.com/hook"
                />
                {errors.endpoint_url && (
                  <p className="text-destructive text-xs mt-1">{errors.endpoint_url.message}</p>
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={addChannel.isPending}>Criar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Validate**

Run: `cd apps/web && npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/agents/tabs/channels.tsx
git commit -m "feat(web): Channels tab with conditional config form per type"
```

## Task 31: Tab Budget

**Files:**
- Modify: `apps/web/src/pages/agents/tabs/budget.tsx`

- [ ] **Step 1: Implementar**

```tsx
import { useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAgentBudget, useUpdateAgentBudget } from '@/hooks/use-agent-budget'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'

export default function BudgetTab() {
  const { id } = useParams()
  const { data: budget, isLoading } = useAgentBudget(id!)
  const updateBudget = useUpdateAgentBudget(id!)

  const { register, handleSubmit, formState: { isDirty } } = useForm<{ monthly_limit_usd: number }>({
    defaultValues: { monthly_limit_usd: budget?.limit_usd ?? 50 },
  })

  const onSubmit = async ({ monthly_limit_usd }: { monthly_limit_usd: number }) => {
    try {
      await updateBudget.mutateAsync(Number(monthly_limit_usd))
      toast.success('Limite atualizado')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro')
    }
  }

  if (isLoading) return <Skeleton className="h-64" />
  if (!budget) return null

  return (
    <div className="max-w-md space-y-6">
      <div className="border-hairline p-6">
        <div className="font-mono uppercase tracking-[0.1em] text-xs text-muted-foreground mb-2">
          GASTO ESTE MÊS
        </div>
        <div className="font-mono text-3xl tabular-nums mb-3">
          ${budget.spent_usd.toFixed(4)}
        </div>
        <div className="h-1 bg-secondary mb-2">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.min(budget.percent_used, 100)}%` }}
          />
        </div>
        <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>{budget.percent_used.toFixed(1)}% usado</span>
          <span>limite ${budget.limit_usd.toFixed(2)}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <Label htmlFor="monthly_limit_usd">Limite mensal (USD)</Label>
          <Input
            id="monthly_limit_usd"
            type="number"
            step="0.01"
            min="0"
            {...register('monthly_limit_usd', { valueAsNumber: true })}
          />
        </div>
        <Button type="submit" disabled={updateBudget.isPending || !isDirty}>
          {updateBudget.isPending && <Loader2 className="size-4 animate-spin" />}
          Atualizar limite
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/agents/tabs/budget.tsx
git commit -m "feat(web): Budget tab with status card and limit edit form"
```

## Task 32: Tab Wiki

**Files:**
- Modify: `apps/web/src/pages/agents/tabs/wiki.tsx`

- [ ] **Step 1: Implementar**

```tsx
import { useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { useAgent, useUpdateAgent } from '@/hooks/use-agents'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'

type WikiFormValues = {
  wiki_enabled: boolean
  wiki_top_k: number
  wiki_min_score: number
  wiki_write_mode: 'manual' | 'supervised' | 'auto'
}

export default function WikiTab() {
  const { id } = useParams()
  const { data: agent, isLoading } = useAgent(id!)
  const updateAgent = useUpdateAgent(id!)

  const { handleSubmit, watch, setValue, formState: { isDirty } } = useForm<WikiFormValues>({
    defaultValues: {
      wiki_enabled: agent?.wiki_enabled ?? true,
      wiki_top_k: agent?.wiki_top_k ?? 5,
      wiki_min_score: parseFloat(agent?.wiki_min_score ?? '0.72'),
      wiki_write_mode: agent?.wiki_write_mode ?? 'supervised',
    },
  })

  const onSubmit = async (data: WikiFormValues) => {
    await updateAgent.mutateAsync({
      wiki_enabled: data.wiki_enabled,
      wiki_top_k: data.wiki_top_k,
      wiki_min_score: data.wiki_min_score.toFixed(2),
      wiki_write_mode: data.wiki_write_mode,
    })
    toast.success('Wiki config atualizada')
  }

  if (isLoading) return <Skeleton className="h-96" />
  if (!agent) return null

  const enabled = watch('wiki_enabled')
  const topK = watch('wiki_top_k')
  const minScore = watch('wiki_min_score')
  const writeMode = watch('wiki_write_mode')

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-md space-y-6">
      <div className="flex items-center justify-between">
        <Label>Wiki habilitada</Label>
        <Switch checked={enabled} onCheckedChange={(v) => setValue('wiki_enabled', v, { shouldDirty: true })} />
      </div>

      <div>
        <div className="flex justify-between mb-2">
          <Label>Top K</Label>
          <span className="font-mono text-sm tabular-nums">{topK}</span>
        </div>
        <Slider
          value={[topK]}
          onValueChange={([v]) => setValue('wiki_top_k', v ?? 5, { shouldDirty: true })}
          min={1}
          max={20}
          step={1}
          disabled={!enabled}
        />
      </div>

      <div>
        <div className="flex justify-between mb-2">
          <Label>Min Score</Label>
          <span className="font-mono text-sm tabular-nums">{minScore.toFixed(2)}</span>
        </div>
        <Slider
          value={[minScore]}
          onValueChange={([v]) => setValue('wiki_min_score', v ?? 0.72, { shouldDirty: true })}
          min={0}
          max={1}
          step={0.01}
          disabled={!enabled}
        />
      </div>

      <div>
        <Label className="block mb-3">Write mode</Label>
        <RadioGroup
          value={writeMode}
          onValueChange={(v) => setValue('wiki_write_mode', v as 'manual' | 'supervised' | 'auto', { shouldDirty: true })}
          disabled={!enabled}
        >
          {(['manual', 'supervised', 'auto'] as const).map((mode) => (
            <div key={mode} className="flex items-center gap-2">
              <RadioGroupItem value={mode} id={mode} />
              <Label htmlFor={mode} className="font-mono uppercase">{mode}</Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      <Button type="submit" disabled={updateAgent.isPending || !isDirty}>Salvar</Button>
    </form>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/agents/tabs/wiki.tsx
git commit -m "feat(web): Wiki tab with sliders and write_mode radio"
```

## Task 33: Tab A2A

**Files:**
- Modify: `apps/web/src/pages/agents/tabs/a2a.tsx`
- Create: `apps/web/src/hooks/use-a2a-keys.ts`

- [ ] **Step 1: Criar `use-a2a-keys.ts`**

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { A2AKey } from '@/lib/schemas/a2a'

export function useA2AKeys(agentId: string) {
  return useQuery({
    queryKey: ['a2a', 'keys', agentId],
    queryFn: async () => {
      const res = await api.get<{ data: A2AKey[] }>(`/a2a/keys`)
      return res.data.filter((k) => k.agent_id === agentId)
    },
    enabled: !!agentId,
  })
}

export function useCreateA2AKey(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await api.post<{ data: { id: string; key: string; prefix: string } }>(`/a2a/keys`, {
        name,
        agent_id: agentId,
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['a2a', 'keys', agentId] })
    },
  })
}

export function useDeleteA2AKey() {
  return useMutation({
    mutationFn: (keyId: string) => api.delete(`/a2a/keys/${keyId}`),
  })
}
```

- [ ] **Step 2: Implementar tab A2A**

(Estrutura: switch a2a_enabled; quando ON: card com Agent Card preview link + lista de keys + botão + nova key. Modal de nova key mostra a key uma vez com botão copy.)

```tsx
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ExternalLink, Copy, Plus, Trash } from 'lucide-react'
import { toast } from 'sonner'
import { useAgent, useUpdateAgent } from '@/hooks/use-agents'
import { useA2AKeys, useCreateA2AKey, useDeleteA2AKey } from '@/hooks/use-a2a-keys'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

export default function A2ATab() {
  const { id } = useParams()
  const { tenant } = useAuth()
  const { data: agent, isLoading } = useAgent(id!)
  const updateAgent = useUpdateAgent(id!)
  const { data: keys } = useA2AKeys(id!)
  const createKey = useCreateA2AKey(id!)
  const deleteKey = useDeleteA2AKey()

  const [newKeyName, setNewKeyName] = useState('')
  const [revealedKey, setRevealedKey] = useState<string | null>(null)

  if (isLoading) return <Skeleton className="h-96" />
  if (!agent) return null

  const enabled = agent.a2a_enabled

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <Label>A2A habilitado</Label>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => updateAgent.mutate({ a2a_enabled: v })}
        />
      </div>

      {enabled && (
        <>
          <div className="border-hairline p-4">
            <div className="font-mono uppercase tracking-[0.1em] text-xs text-muted-foreground mb-2">
              AGENT CARD
            </div>
            <a
              href={`/.well-known/agent.json?tenant_slug=${tenant?.slug ?? ''}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary text-sm flex items-center gap-2 hover:underline"
            >
              /.well-known/agent.json <ExternalLink className="size-3" />
            </a>
          </div>

          <div>
            <div className="flex justify-between items-center mb-3">
              <span className="font-mono uppercase tracking-[0.1em] text-xs text-muted-foreground">
                API KEYS
              </span>
              <div className="flex gap-2">
                <Input
                  placeholder="Nome da key..."
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="w-48"
                />
                <Button
                  size="sm"
                  onClick={async () => {
                    if (!newKeyName.trim()) return
                    const result = await createKey.mutateAsync(newKeyName.trim())
                    setRevealedKey(result.key)
                    setNewKeyName('')
                  }}
                  disabled={createKey.isPending || !newKeyName.trim()}
                >
                  <Plus className="size-4" /> Criar
                </Button>
              </div>
            </div>

            <div className="border-hairline">
              {(keys ?? []).length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  Nenhuma key criada.
                </div>
              ) : (
                (keys ?? []).map((key) => (
                  <div key={key.id} className="flex items-center gap-3 p-3 border-b-hairline">
                    <div className="flex-1">
                      <div className="text-sm">{key.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {key.key_prefix}*** · criada em {new Date(key.created_at).toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={async () => {
                        await deleteKey.mutateAsync(key.id)
                        toast.success('Key revogada')
                      }}
                    >
                      <Trash className="size-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* Reveal key dialog */}
      <Dialog open={!!revealedKey} onOpenChange={() => setRevealedKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key criada</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Esta chave não será mostrada de novo. Copie agora.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-xs bg-secondary p-3 break-all">
                {revealedKey}
              </code>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  navigator.clipboard.writeText(revealedKey ?? '')
                  toast.success('Copiada')
                }}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/agents/tabs/a2a.tsx apps/web/src/hooks/use-a2a-keys.ts
git commit -m "feat(web): A2A tab with key management and reveal-once dialog"
```

---

# Phase 6 — Polish + Deploy

## Task 34: Archive agent action

**Files:**
- Modify: `apps/web/src/pages/agents/list.tsx` (adicionar action menu)
- Modify: `apps/web/src/pages/agents/detail.tsx` (adicionar botão arquivar/restaurar no header)

- [ ] **Step 1: Adicionar DropdownMenu de ações na lista**

(Padrão: ⋯ menu com Editar, Arquivar/Restaurar, AlertDialog de confirmação.)

- [ ] **Step 2: Adicionar botões no header do detail**

(Botão "Arquivar" / "Restaurar" baseado em `agent.status`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/agents/
git commit -m "feat(web): archive/restore agent actions with confirm"
```

## Task 35: Test coverage check + missing tests

- [ ] **Step 1: Run coverage**

```bash
cd apps/web && npm run test -- --coverage
```

- [ ] **Step 2: Identificar gaps abaixo de 60%**

Adicionar testes para hooks e componentes não cobertos.

- [ ] **Step 3: Re-run + commit (se aplicável)**

```bash
git add apps/web/
git commit -m "test(web): add coverage to hit 60% threshold"
```

## Task 36: Dockerfile + nginx config

**Files:**
- Modify: `infra/docker/Dockerfile` (adicionar stage `web-builder`)
- Modify: `infra/docker/nginx.conf` (adicionar SPA fallback + proxy `/api/*`)

- [ ] **Step 1: Adicionar stage web-builder no `infra/docker/Dockerfile`**

```dockerfile
# ── Web builder ─────────────────────────────────
FROM node:20-alpine AS web-builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/ ./packages/
RUN npm install --legacy-peer-deps
COPY apps/web ./apps/web
COPY tsconfig.base.json ./
RUN cd apps/web && npm run build

# ── Final stage ─────────────────────────────────
# (existing API stage continues, then add web copy)
FROM ... AS final
# ... existing api copy ...
COPY --from=web-builder /app/apps/web/dist /usr/share/nginx/html
```

- [ ] **Step 2: Atualizar `infra/docker/nginx.conf`**

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location /api/v1/ {
        proxy_pass http://127.0.0.1:3000/api/v1/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|svg|woff2?|ttf|eot|ico|png|jpg|jpeg|gif|webp)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

- [ ] **Step 3: Test build local**

```bash
docker build -f infra/docker/Dockerfile -t test-web . --target final
```

Expected: build succeeds, dist/index.html é incluso na imagem.

- [ ] **Step 4: Commit**

```bash
git add infra/docker/
git commit -m "feat(infra): integrate web build into Docker stack with nginx SPA fallback"
```

## Task 37: Final smoke test em prod-like + merge

- [ ] **Step 1: Push + monitorar CI**

```bash
git push origin main
```

Expected: 5 jobs verdes (ci, security, e2e, docker, deploy).

- [ ] **Step 2: Smoke test em prod (após deploy)**

Acessar URL pública. Login com tenant real → mission control → agente → editar identity → salvar → ver mudança.

- [ ] **Step 3: Documentar bugs encontrados (se houver)**

Criar issues separadas para fase de polimento pós-MVP.

- [ ] **Step 4: Tag de release**

```bash
git tag -a v1.0.0-mvp-frontend -m "MVP frontend release"
git push origin v1.0.0-mvp-frontend
```

---

## Notas finais

**Total estimado:** 37 tasks, ~30-50 horas de trabalho focado para um engenheiro com a stack na cabeça.

**Recomendação de execução:**
- Phase 1 + 2 podem ser uma PR só (foundation + auth + shell)
- Phase 3 (Mission Control) é uma PR
- Phase 4 (Agentes Lista) é uma PR
- Phase 5 (cada tab) pode ser PR individual ou agrupar 2-3 tabs por PR
- Phase 6 (polish + deploy) é uma PR

**Sub-skill recomendada para execução:** `superpowers:subagent-driven-development` (mantém contexto na sessão atual, fresh subagent por task com two-stage review).

**Alternativa:** `superpowers:executing-plans` se preferir checkpoints manuais entre batches.
