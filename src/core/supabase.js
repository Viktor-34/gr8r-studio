/* ---------- supabase client ----------
   The backend is optional: without a URL and key the app runs as a local prototype on
   localStorage. vite.config.js maps the Vercel/Supabase integration variables onto these.
   The client library loads as its own chunk, only when a backend is configured. */
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const REMOTE = !!(URL && KEY);
export let sb = null;
export async function connect() {
  if (!sb) {
    const { createClient } = await import('@supabase/supabase-js');
    sb = createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  }
  return sb;
}
