import { defineConfig, loadEnv } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { icons as lucide } from 'lucide';

/* `virtual:icons` exports only the Lucide icons the source actually names, as inline SVG markup,
   so the bundle carries ~170 icons instead of the full set. Any quoted kebab-case token in src/
   that matches a Lucide icon name is included. */
function lucideSubset() {
  const id = 'virtual:icons',
    resolved = '\0' + id;
  const walk = dir =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : /\.js$/.test(e.name) ? [p] : [];
    });
  const pascal = n =>
    n
      .split('-')
      .map(p => p[0].toUpperCase() + p.slice(1))
      .join('');
  return {
    name: 'lucide-subset',
    resolveId: s => (s === id ? resolved : null),
    load(s) {
      if (s !== resolved) return null;
      const text = walk(path.resolve('src'))
        .map(f => fs.readFileSync(f, 'utf8'))
        .join('\n');
      const names = [...new Set([...text.matchAll(/['"`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*)['"`]/g)].map(m => m[1]))].filter(n => lucide[pascal(n)]).sort();
      const out = {};
      for (const n of names) {
        let node = lucide[pascal(n)];
        if (node[0] === 'svg') node = node[2];
        out[n] = node
          .map(
            ([t, a]) =>
              `<${t} ${Object.entries(a)
                .filter(([k]) => k !== 'key')
                .map(([k, v]) => `${k}="${v}"`)
                .join(' ')}/>`,
          )
          .join('');
      }
      return `export const ICONS = ${JSON.stringify(out)};`;
    },
  };
}

/* Supabase settings: VITE_* names locally (.env.local), or the names the Vercel Supabase
   integration sets. Only the public anon/publishable key belongs here, never the service role key. */
function supabaseEnv(mode) {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const pick = (...names) => names.map(n => env[n]).find(Boolean) || '';
  return {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(pick('VITE_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL')),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(
      pick(
        'VITE_SUPABASE_ANON_KEY',
        'VITE_SUPABASE_PUBLISHABLE_KEY',
        'SUPABASE_ANON_KEY',
        'SUPABASE_PUBLISHABLE_KEY',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      ),
    ),
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [lucideSubset()],
  define: supabaseEnv(mode),
  server: { port: 5173 },
}));
