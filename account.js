(() => {
  "use strict";

  const config = window.LEARNING_AUTH_CONFIG || window.MATH_AUTH_CONFIG || {};
  const HUB_ORIGIN = "https://lumina-atlas.pages.dev";
  const TRUSTED_ORIGINS = new Set([
    HUB_ORIGIN,
    "https://math-ek4.pages.dev",
    "https://english-chi.pages.dev"
  ]);
  const TRANSFER_ACCESS = "lumina_access_token";
  const TRANSFER_REFRESH = "lumina_refresh_token";
  let client = null;
  let modal = null;
  let currentSession = null;
  let returnHandled = false;

  const refreshAuthStyles = () => {
    const versionedHref = "auth.css?v=20260809-unified-auth";
    const existing = document.querySelector('link[href^="auth.css"]');
    if (existing) existing.href = versionedHref;
    else {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = versionedHref;
      document.head.append(link);
    }
  };
  refreshAuthStyles();

  const profileButtons = () => document.querySelectorAll(".course-profile-button, .profile-tool, .profile-button, [data-auth-open]");
  const isTrustedUrl = (value) => {
    try { return TRUSTED_ORIGINS.has(new URL(value, location.href).origin); }
    catch { return false; }
  };
  const cleanAuthUrl = () => history.replaceState(null, "", `${location.pathname}${location.search}`);
  const setStatus = (text) => { const target = modal?.querySelector(".auth-status"); if (target) target.textContent = text; };
  const setOpen = (open) => {
    if (!modal) return;
    modal.hidden = !open;
    modal.setAttribute("aria-hidden", String(!open));
    document.body.classList.toggle("auth-dialog-open", open);
    if (open && !currentSession) modal.querySelector("#auth-email")?.focus();
  };
  const updateSessionUI = (session) => {
    currentSession = session || null;
    profileButtons().forEach((button) => {
      button.textContent = currentSession ? "Account" : "Profile";
      button.classList.toggle("is-signed-in", Boolean(currentSession));
    });
    if (modal) {
      modal.querySelector(".auth-signed-out").hidden = Boolean(currentSession);
      modal.querySelector(".auth-signed-in").hidden = !currentSession;
      modal.querySelector(".auth-user-email").textContent = currentSession?.user?.email || "Signed in";
      setStatus("");
    }
    document.documentElement.classList.remove("auth-loading");
    window.dispatchEvent(new CustomEvent("learning-auth-change", { detail: { session: currentSession } }));
  };

  const ensureClient = async () => {
    if (client) return client;
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error("Account sign-in is being configured. You can continue as a guest.");
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    client.auth.onAuthStateChange((_event, session) => {
      updateSessionUI(session);
      if (session && location.hash.includes("access_token")) cleanAuthUrl();
    });
    return client;
  };

  const importTransferredSession = async (supabase) => {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const accessToken = hash.get(TRANSFER_ACCESS);
    const refreshToken = hash.get(TRANSFER_REFRESH);
    if (!accessToken || !refreshToken) return null;
    const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    cleanAuthUrl();
    if (error) throw error;
    return data.session;
  };

  const goWithSession = async (target) => {
    const url = new URL(target, location.href);
    if (!TRUSTED_ORIGINS.has(url.origin)) return location.assign(url.href);
    const session = currentSession || await window.LearningAuth.getSession();
    if (session?.access_token && session?.refresh_token) {
      url.hash = new URLSearchParams({
        [TRANSFER_ACCESS]: session.access_token,
        [TRANSFER_REFRESH]: session.refresh_token
      }).toString();
    }
    location.assign(url.href);
  };

  const installCrossSiteLinks = () => {
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (!link || event.defaultPrevented || event.button !== 0 || link.target === "_blank") return;
      const destination = new URL(link.href, location.href);
      if (destination.origin === location.origin || !TRUSTED_ORIGINS.has(destination.origin)) return;
      event.preventDefault();
      goWithSession(destination.href);
    });
  };

  const handleReturnTo = async (session) => {
    if (returnHandled || location.origin !== HUB_ORIGIN || !session) return;
    const params = new URLSearchParams(location.search);
    const returnTo = params.get("return_to");
    if (!returnTo || !isTrustedUrl(returnTo) || new URL(returnTo).origin === HUB_ORIGIN) return;
    returnHandled = true;
    await goWithSession(returnTo);
  };

  const signInEmail = async (event) => {
    event.preventDefault();
    try {
      const supabase = await ensureClient();
      const email = modal.querySelector("#auth-email").value.trim();
      const hubCallback = new URL(HUB_ORIGIN + "/");
      hubCallback.searchParams.set("return_to", `${location.origin}${location.pathname}${location.search}`);
      setStatus("Sending your secure sign-in link...");
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: hubCallback.href, shouldCreateUser: true } });
      if (error) throw error;
      setStatus("Check your email. The link will sign you in across Lumina Atlas and return you here.");
    } catch (error) { setStatus(error.message); }
  };

  const signOut = async () => {
    try {
      const supabase = await ensureClient();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      updateSessionUI(null);
      setOpen(false);
    } catch (error) { setStatus(error.message); }
  };

  const createModal = () => {
    modal = document.createElement("div");
    modal.className = "auth-modal";
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `<section class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button class="auth-close" type="button" aria-label="Close sign in">×</button><small>OPTIONAL ACCOUNT</small>
      <div class="auth-signed-out"><h2 id="auth-title">Sign in with Email</h2><p>Courses are open to everyone. Sign in to use your shared Notebook and sync learning data across subjects.</p>
      <form class="auth-email-form"><label for="auth-email">Email</label><input id="auth-email" type="email" autocomplete="email" required placeholder="you@example.com"><button type="submit">Email me a sign-in link</button></form><button class="auth-guest" type="button">Continue as guest</button></div>
      <div class="auth-signed-in" hidden><h2>You're signed in</h2><p class="auth-user-email"></p><p>Your Notebook and account are shared across Lumina Atlas subjects.</p><button class="auth-sign-out" type="button">Sign out</button></div><p class="auth-status" role="status"></p></section>`;
    document.body.append(modal);
    modal.querySelector(".auth-close").addEventListener("click", () => setOpen(false));
    modal.querySelector(".auth-guest").addEventListener("click", () => setOpen(false));
    modal.querySelector(".auth-sign-out").addEventListener("click", signOut);
    modal.addEventListener("click", (event) => { if (event.target === modal) setOpen(false); });
    modal.querySelector(".auth-email-form").addEventListener("submit", signInEmail);
  };

  const initialize = async () => {
    document.documentElement.classList.add("auth-loading");
    createModal();
    installCrossSiteLinks();
    profileButtons().forEach((button) => button.addEventListener("click", () => setOpen(true)));
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.hidden) setOpen(false); });
    try {
      const supabase = await ensureClient();
      const transferred = await importTransferredSession(supabase);
      const session = transferred || (await supabase.auth.getSession()).data.session;
      updateSessionUI(session);
      await handleReturnTo(session);
    } catch (error) {
      console.warn("Authentication status could not be loaded.", error);
      updateSessionUI(null);
    }
  };

  window.LearningAuth = {
    open: () => setOpen(true),
    close: () => setOpen(false),
    getClient: ensureClient,
    getSession: async () => { const supabase = await ensureClient(); return (await supabase.auth.getSession()).data.session; },
    isSignedIn: () => Boolean(currentSession),
    goWithSession
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", initialize) : initialize();
})();
