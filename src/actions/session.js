/* =====================================================================
   SESSION: sign-in by emailed link when a Supabase backend is configured.
   Access is invite-only: links go only to people who already have an account.
   ===================================================================== */
import { $ } from '../core/utils.js';
import { S } from '../core/store.js';
import { connect, sb } from '../core/supabase.js';
import { ROUTE_NAMES, render, go } from '../shell/render.js';
import { loadWorkspace } from '../shell/sync.js';
import { A, EMAIL_RE } from './actions.js';

let started = false;

async function enter(user, route) {
  S.ui.auth = 'boot';
  S.ui.bootErr = null;
  render();
  try {
    await loadWorkspace(user);
  } catch (e) {
    console.error('[session] load failed', e);
    S.ui.bootErr = e?.message || String(e);
    render();
    return;
  }
  started = true;
  S.ui.auth = null;
  S.ui.errors = {};
  go(route && ROUTE_NAMES[route] ? route : S.prefs.home || 'home');
}

/* boot: resolve the session (including one arriving in a sign-in link), then load or ask to sign in */
export async function startSession(route) {
  S.ui.auth = 'boot';
  render();
  try {
    await connect();
  } catch (e) {
    S.ui.bootErr = 'Check your connection and try again.';
    console.error('[session] client failed to load', e);
    render();
    return;
  }
  // An expired or reused link comes back as #error=…&error_description=…
  const h = new URLSearchParams(location.hash.slice(1));
  const linkErr = h.get('error_description');
  if (h.has('access_token') || h.has('error')) history.replaceState(null, '', location.pathname + location.search);
  const { data } = await sb.auth.getSession();
  if (data.session) return enter(data.session.user, route);
  S.ui.auth = 'login';
  if (linkErr) S.ui.errors = { login: 'That sign-in link has expired or was already used. Request a new one below.' };
  render();
  // signing in from a link opened in another tab
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'SIGNED_IN' && session && !started) enter(session.user, route);
  });
}

A.retryBoot = () => location.reload();

A.doLogin = async () => {
  const e = (S.ui.errors = {});
  const em = $('#l-email').value.trim();
  S.ui.af.email = em;
  if (!em) e.email = 'Enter your email address';
  else if (!EMAIL_RE.test(em)) e.email = 'Enter a valid email, like name@company.com';
  if (Object.keys(e).length) {
    render();
    $('#l-email')?.focus();
    return;
  }
  const btn = $('#login-btn');
  btn?.classList.add('is-loading');
  const { error } = await sb.auth.signInWithOtp({
    email: em,
    options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
  });
  btn?.classList.remove('is-loading');
  if (error) {
    e.login = /signup|not allowed|not found/i.test(error.message)
      ? "This email doesn't have access yet. Ask the workspace owner to invite you."
      : error.status === 429
        ? 'Too many sign-in emails. Wait a minute and try again.'
        : `Couldn't send the link: ${error.message}`;
    render();
    return;
  }
  S.ui.auth = 'link-sent';
  render();
};

A.signOut = async () => {
  S.ui.pop = null;
  S.ui.palette = null;
  await sb?.auth.signOut();
  location.hash = '';
  location.reload();
};
