const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

async function authenticatedUser(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization, apikey: env.SUPABASE_ANON_KEY }
  });
  return response.ok ? response.json() : null;
}

export async function onRequestPost({ request, env }) {
  try {
    const user = await authenticatedUser(request, env);
    if (!user) return json({ error: "Sign in before upgrading." }, 401);

    const { plan, billing } = await request.json();
    const key = `${String(plan).toUpperCase()}_${String(billing).toUpperCase()}_PRODUCT_ID`;
    const productId = env[`CREEM_${key}`];
    if (!productId || !env.CREEM_API_KEY) {
      return json({ error: "Paid plans are awaiting merchant activation. Free courses remain available." }, 503);
    }

    const response = await fetch("https://api.creem.io/v1/checkouts", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.CREEM_API_KEY },
      body: JSON.stringify({
        product_id: productId,
        success_url: "https://luminaatlas.com/billing-success.html",
        request_id: user.id,
        customer: { email: user.email },
        metadata: { referenceId: user.id, plan, billing }
      })
    });
    const data = await response.json();
    if (!response.ok) return json({ error: data.message || "Unable to open checkout." }, response.status);
    return json({ url: data.checkout_url || data.checkoutUrl });
  } catch (error) {
    return json({ error: error.message || "Unable to open checkout." }, 500);
  }
}
