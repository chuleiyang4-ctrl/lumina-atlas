(() => {
  "use strict";

  const config = window.LEARNING_AUTH_CONFIG || window.MATH_AUTH_CONFIG || {};
  const HUB_ORIGIN = "https://luminaatlas.com";
  const TRUSTED_ORIGINS = new Set([
    HUB_ORIGIN,
    "https://www.luminaatlas.com",
    "https://math.luminaatlas.com",
    "https://english.luminaatlas.com",
    "https://lumina-atlas.pages.dev",
    "https://math-ek4.pages.dev",
    "https://english-chi.pages.dev"
  ]);
  const TRANSFER_ACCESS = "lumina_access_token";
  const TRANSFER_REFRESH = "lumina_refresh_token";
  let client = null;
  let modal = null;
  let currentSession = null;
  let returnHandled = false;
  let authMode = "signin";
  let recoveryMode = false;

  const refreshAuthStyles = () => {
    const versionedHref = "auth.css?v=20260812-password-auth";
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
      modal.querySelector(".auth-signed-out").hidden = recoveryMode || Boolean(currentSession);
      modal.querySelector(".auth-signed-in").hidden = recoveryMode || !currentSession;
      modal.querySelector(".auth-recovery").hidden = !recoveryMode;
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
    client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryMode = true;
        setOpen(true);
      }
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

  const callbackUrl = () => {
    const url = new URL(HUB_ORIGIN + "/");
    url.searchParams.set("return_to", `${location.origin}${location.pathname}${location.search}`);
    return url.href;
  };

  const submitCredentials = async (event) => {
    event.preventDefault();
    try {
      const supabase = await ensureClient();
      const email = modal.querySelector("#auth-email").value.trim();
      const password = modal.querySelector("#auth-password").value;
      setStatus(authMode === "signup" ? "Creating your account..." : "Signing you in...");
      const result = authMode === "signup"
        ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl() } })
        : await supabase.auth.signInWithPassword({ email, password });
      const { data, error } = result;
      if (error) throw error;
      if (authMode === "signup" && !data.session) setStatus("Account created. Check your email once to confirm your address, then sign in with your password.");
      else { updateSessionUI(data.session); setOpen(false); }
    } catch (error) { setStatus(error.message); }
  };

  const sendPasswordReset = async () => {
    try {
      const email = modal.querySelector("#auth-email").value.trim();
      if (!email) throw new Error("Enter your email address first.");
      const supabase = await ensureClient();
      setStatus("Sending password reset instructions...");
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl() });
      if (error) throw error;
      setStatus("Check your email for the password reset link.");
    } catch (error) { setStatus(error.message); }
  };

  const saveNewPassword = async (event) => {
    event.preventDefault();
    try {
      const password = modal.querySelector("#auth-new-password").value;
      const supabase = await ensureClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      recoveryMode = false;
      updateSessionUI(currentSession);
      setStatus("Password updated successfully.");
    } catch (error) { setStatus(error.message); }
  };

  const setAuthMode = (mode) => {
    authMode = mode;
    modal.querySelectorAll("[data-auth-mode]").forEach(button => button.classList.toggle("active", button.dataset.authMode === mode));
    modal.querySelector(".auth-submit").textContent = mode === "signup" ? "Create account" : "Sign in";
    modal.querySelector(".auth-mode-note").textContent = mode === "signup" ? "Use at least 8 characters. You may need to confirm your email once." : "Use the email and password for your Lumina Atlas account.";
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
      <div class="auth-signed-out"><h2 id="auth-title">Your Lumina Atlas account</h2><p>Courses are open to everyone. Sign in to use your shared Notebook and sync learning data across subjects.</p>
      <div class="auth-mode-switch"><button type="button" data-auth-mode="signin" class="active">Sign in</button><button type="button" data-auth-mode="signup">Create account</button></div>
      <form class="auth-email-form"><label for="auth-email">Email</label><input id="auth-email" type="email" autocomplete="email" required placeholder="you@example.com"><label for="auth-password">Password</label><input id="auth-password" type="password" autocomplete="current-password" minlength="8" required placeholder="At least 8 characters"><p class="auth-mode-note">Use the email and password for your Lumina Atlas account.</p><button class="auth-submit" type="submit">Sign in</button></form><button class="auth-forgot" type="button">Forgot password?</button><button class="auth-guest" type="button">Continue as guest</button></div>
      <div class="auth-signed-in" hidden><h2>You're signed in</h2><p class="auth-user-email"></p><p>Your Notebook and account are shared across Lumina Atlas subjects.</p><button class="auth-sign-out" type="button">Sign out</button></div>
      <div class="auth-recovery" hidden><h2>Choose a new password</h2><p>Use at least 8 characters.</p><form class="auth-recovery-form"><label for="auth-new-password">New password</label><input id="auth-new-password" type="password" autocomplete="new-password" minlength="8" required><button type="submit">Save new password</button></form></div><p class="auth-status" role="status"></p></section>`;
    document.body.append(modal);
    modal.querySelector(".auth-close").addEventListener("click", () => setOpen(false));
    modal.querySelector(".auth-guest").addEventListener("click", () => setOpen(false));
    modal.querySelector(".auth-sign-out").addEventListener("click", signOut);
    modal.addEventListener("click", (event) => { if (event.target === modal) setOpen(false); });
    modal.querySelector(".auth-email-form").addEventListener("submit", submitCredentials);
    modal.querySelector(".auth-recovery-form").addEventListener("submit", saveNewPassword);
    modal.querySelector(".auth-forgot").addEventListener("click", sendPasswordReset);
    modal.querySelectorAll("[data-auth-mode]").forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
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
