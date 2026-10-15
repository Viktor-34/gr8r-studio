# Gr8r Studio

A calm, structured project management workspace: home dashboard, inbox, my tasks, projects with
board / list / table / calendar / timeline / files views, members, teams, activity and settings.

Built with plain JavaScript ES modules and CSS, bundled by [Vite](https://vite.dev). There is no
UI framework. The only runtime dependency is the optional [Supabase](https://supabase.com) client.

Without a backend the app is a local prototype: demo data in this browser's `localStorage`. With
Supabase configured it becomes a shared, invite-only workspace (see [Backend](#backend-supabase)).

![Gr8r Studio home dashboard](docs/preview.png)

## Getting started

Requires Node.js 18 or newer (`.nvmrc` pins 22).

```bash
npm install
npm run dev       # http://localhost:5173 with hot reload
npm run build     # production build in dist/
npm run preview   # serve the production build locally
npm run lint      # ESLint
npm run format    # Prettier
```

## Project structure

```
index.html              HTML entry; loads src/main.js
public/favicon.svg      brand mark
vite.config.js          Vite config, including the Lucide icon-subset plugin
eslint.config.js        lint rules (ESLint flat config); formatting by Prettier (.prettierrc.json)
.github/workflows/      CI: lint, format check, build
docs/preview.png        README screenshot
supabase/schema.sql     database table, access rules and Realtime for the Supabase backend
src/
  main.js               entry: imports styles and modules, then boots the app
  styles/
    index.css           imports every stylesheet in cascade order
    tokens.css          colours, spacing, type, radius, the shared --gutter
    base.css  components.css  shell.css  panels.css  overlays.css  states.css  motion.css  responsive.css
    views/              list, board, table, calendar, timeline, projects & files
    pages/              settings, auth & onboarding
  core/                 utilities, constants, icons, store (state + lookups), theme, Supabase client
  data/seed.js          demo workspace data
  ui/                   shared render helpers, toasts, the select dropdown
  shell/                render loop and router, sidebar/topbar layout, skeletons, view engine, sync
  components/           task list renderer
  pages/                one module per route
  views/                project views: board, table, calendar, timeline, files, overview
  overlays/             task drawer, modals, popovers, context menu, command palette
  features/             teams, subtasks, archive (rendering)
  actions/              user actions, event wiring, keyboard shortcuts, drag and drop, sign-in
```

### Layers

Dependencies point downward:

1. `core/` and `data/` depend on nothing else in the app.
2. `ui/`, `shell/`, `components/`, `pages/`, `views/`, `overlays/` and `features/` render HTML from state.
3. `actions/` change state and re-render. Each action module registers its handlers on the
   shared action table (`A`) when it loads, so `main.js` imports them after `actions/actions.js`.

## Conventions

- **Rendering:** each page or view is a function that returns an HTML string from the store
  (`S`). `render()` rebuilds the shell and keeps focus and scroll positions.
- **Interactions:** elements declare `data-a="actionName"`. `actions/events.js` delegates the
  click to `A.actionName`. Inputs use `data-in`, blur handlers use `data-blur`.
- **Layout:** every page edge uses `var(--gutter)`, so the breadcrumb, page header, toolbar,
  list, table and board start on the same line.
- **Dropdowns:** write a normal `<select class="select">`. `ui/select.js` renders it as the
  design-system menu and keeps the native element as the source of truth.
- **Icons:** call `ic('name')` with any [Lucide](https://lucide.dev) icon name. The
  `virtual:icons` plugin bundles only the icons the source uses.

## Backend (Supabase)

With Supabase configured, people sign in with a link sent to their email (no passwords), see the
same workspace, and get each other's changes live.

**One-time setup**

1. In Vercel: project → **Storage** (or **Integrations**) → add **Supabase**. It creates the
   Supabase project and adds its URL and anon/publishable key to the project's environment
   variables; the build picks them up (`vite.config.js`). Redeploy afterwards.
2. In Supabase: **SQL Editor** → paste [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. In Supabase: **Authentication → Sign In / Providers** → turn off **Allow new users to sign up**,
   so only people you invite can get in. Keep the **Email** provider on.
4. In Supabase: **Authentication → URL Configuration** → set **Site URL** to the production URL
   (e.g. `https://gr8r-studio.vercel.app`) and add it to **Redirect URLs**, plus
   `http://localhost:5173` for local development.
5. Sign in yourself first: on an empty database, the first person to sign in gets the sample
   workspace as its owner.

**Giving someone access:** Supabase → **Authentication → Users** → **Invite user** (or **Add user**
with _Auto confirm_). They then open the site, enter that email and use the link they receive.
Their member profile is created on first sign-in. To revoke access, delete the user there.

**Local development against Supabase:** create `.env.local` with

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon or publishable key>
```

**How data is stored:** `src/shell/sync.js` keeps `S.data` in step with one table, `records`.
Every task, comment, member, project and so on is one row (`collection`, `id`, `data` as JSON);
other workspace settings are `meta` rows. After each `save()` only the rows that changed are
written, so people editing different items never overwrite each other (the same item: last write
wins). Changes from others arrive over Supabase Realtime. Every signed-in person can read and
write everything; private projects are hidden in the interface but not enforced by the database.
Your theme and view preferences stay in your browser.

## Continuous integration

Every push and pull request runs lint, the format check and a production build
(`.github/workflows/ci.yml`).

## Deploy

`vercel.json` builds with Vite and serves `dist/`.
