(() => {
  "use strict";
  const refreshAuthStyles = () => {
    const versionedHref = "auth.css?v=20260808-mobile-2";
    const existing = document.querySelector('link[href^="auth.css"]');
    if (existing) {
      existing.setAttribute("href", versionedHref);
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = versionedHref;
    document.head.append(link);
  };
  refreshAuthStyles();
  const config = window.LEARNING_AUTH_CONFIG || window.MATH_AUTH_CONFIG || {};
  let client = null;
  let modal = null;
  let currentSession = null;
  const profileButtons = () => document.querySelectorAll(".course-profile-button, .profile-tool, .profile-button, [data-auth-open]");
  const setOpen = (open) => {
    if (!modal) return;
    modal.hidden = !open;
    modal.setAttribute("aria-hidden", String(!open));
    document.body.classList.toggle("auth-dialog-open", open);
    if (open && !currentSession) modal.querySelector("#auth-email")?.focus();
  };
  const setStatus = (text) => { const target = modal?.querySelector(".auth-status"); if (target) target.textContent = text; };
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
    window.dispatchEvent(new CustomEvent("learning-auth-change", { detail: { session: currentSession } }));
  };
  const ensureClient = async () => {
    if (client) return client;
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error("Account sign-in is being configured. You can continue as a guest.");
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    client.auth.onAuthStateChange((_event, session) => {
      updateSessionUI(session);
      if (session && location.hash.includes("access_token")) history.replaceState(null, "", `${location.pathname}${location.search}`);
    });
    return client;
  };
  const returnUrl = () => `${location.origin}${location.pathname}${location.search}`;
  const signInEmail = async (event) => {
    event.preventDefault();
    try {
      const supabase = await ensureClient();
      const email = modal.querySelector("#auth-email").value.trim();
      setStatus("Sending your secure sign-in link...");
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: returnUrl(), shouldCreateUser: true } });
      if (error) throw error;
      setStatus("Check your email for the sign-in link. You may close this window and keep browsing.");
    } catch (error) { setStatus(error.message); }
  };
  const signOut = async () => {
    try {
      const supabase = await ensureClient();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      updateSessionUI(null); setOpen(false);
    } catch (error) { setStatus(error.message); }
  };
  const createModal = () => {
    modal = document.createElement("div"); modal.className = "auth-modal"; modal.hidden = true; modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `<section class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button class="auth-close" type="button" aria-label="Close sign in">×</button><small>OPTIONAL ACCOUNT</small>
      <div class="auth-signed-out"><h2 id="auth-title">Sign in with Email</h2><p>Courses are open to everyone. Sign in to use your shared Notebook and sync learning data across subjects.</p>
      <form class="auth-email-form"><label for="auth-email">Email</label><input id="auth-email" type="email" autocomplete="email" required placeholder="you@example.com"><button type="submit">Email me a sign-in link</button></form><button class="auth-guest" type="button">Continue as guest</button></div>
      <div class="auth-signed-in" hidden><h2>You're signed in</h2><p class="auth-user-email"></p><p>Notebook is now available from the top navigation.</p><button class="auth-sign-out" type="button">Sign out</button></div><p class="auth-status" role="status"></p></section>`;
    document.body.append(modal);
    modal.querySelector(".auth-close").addEventListener("click", () => setOpen(false));
    modal.querySelector(".auth-guest").addEventListener("click", () => setOpen(false));
    modal.querySelector(".auth-sign-out").addEventListener("click", signOut);
    modal.addEventListener("click", (event) => { if (event.target === modal) setOpen(false); });
    modal.querySelector(".auth-email-form").addEventListener("submit", signInEmail);
  };
  const initialize = async () => {
    createModal();
    profileButtons().forEach((button) => button.addEventListener("click", () => setOpen(true)));
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.hidden) setOpen(false); });
    try { const supabase = await ensureClient(); const { data, error } = await supabase.auth.getSession(); if (error) throw error; updateSessionUI(data.session); }
    catch (error) { console.warn("Authentication status could not be loaded.", error); }
  };
  window.LearningAuth = { open: () => setOpen(true), close: () => setOpen(false), getClient: ensureClient,
    getSession: async () => { const supabase = await ensureClient(); const { data } = await supabase.auth.getSession(); return data.session; },
    isSignedIn: () => Boolean(currentSession) };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", initialize) : initialize();
})();
