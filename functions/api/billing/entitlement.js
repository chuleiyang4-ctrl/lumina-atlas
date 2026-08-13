const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export async function onRequestGet({ request, env }) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ plan: "free", status: "guest" });
  const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { authorization, apikey: env.SUPABASE_ANON_KEY } });
  if (!userResponse.ok) return json({ plan: "free", status: "guest" });
  const user = await userResponse.json();
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/billing_subscriptions?user_id=eq.${encodeURIComponent(user.id)}&select=plan,status,current_period_end&limit=1`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  const rows = response.ok ? await response.json() : [];
  const subscription = rows[0];
  return json(subscription && ["active", "trialing"].includes(subscription.status)
    ? subscription
    : { plan: "free", status: "active" });
}
