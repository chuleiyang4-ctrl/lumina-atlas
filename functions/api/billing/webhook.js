const reply = (text, status = 200) => new Response(text, { status });
const encoder = new TextEncoder();

async function validSignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const expected = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return difference === 0;
}

async function saveSubscription(env, record) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/billing_subscriptions?on_conflict=user_id`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(record)
  });
  if (!response.ok) throw new Error(`Subscription sync failed: ${response.status}`);
}

export async function onRequestPost({ request, env }) {
  const rawBody = await request.text();
  if (!await validSignature(rawBody, request.headers.get("creem-signature"), env.CREEM_WEBHOOK_SECRET)) {
    return reply("Invalid signature", 401);
  }

  const event = JSON.parse(rawBody);
  const object = event.object || {};
  const metadata = object.metadata || object.checkout?.metadata || {};
  const userId = metadata.referenceId || object.request_id || object.checkout?.request_id;
  if (!userId) return reply("Accepted");

  const subscription = object.subscription || object;
  const product = object.product || {};
  const activeEvents = new Set(["checkout.completed", "subscription.active", "subscription.paid", "subscription.trialing", "subscription.update"]);
  const inactiveEvents = new Set(["subscription.canceled", "subscription.expired", "refund.created", "dispute.created"]);
  if (!activeEvents.has(event.eventType) && !inactiveEvents.has(event.eventType)) return reply("Accepted");

  await saveSubscription(env, {
    user_id: userId,
    provider: "creem",
    provider_customer_id: object.customer?.id || object.customer || null,
    provider_subscription_id: subscription.id || null,
    product_id: product.id || object.order?.product || null,
    plan: metadata.plan || product.name?.toLowerCase() || "free",
    status: inactiveEvents.has(event.eventType) ? "inactive" : (subscription.status || "active"),
    current_period_end: subscription.current_period_end_date || subscription.current_period_end || null,
    updated_at: new Date().toISOString()
  });
  return reply("OK");
}
