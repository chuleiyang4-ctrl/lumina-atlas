const SUPABASE_URL = "https://ggeldamqouoaovfxkdlu.supabase.co";
const SUPABASE_KEY = "sb_publishable_fm6efSncDCutpl2Y67uqgA_BeFI5rIh";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});

const candidateText = payload => (payload.candidates?.[0]?.content?.parts || []).map(part => part.text || "").join("").trim();

export async function onRequestPost({ request, env }) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in to use Notebook AI." }, 401);

  const authHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: authHeaders });
  if (!userResponse.ok) return json({ error: "Your session has expired. Please sign in again." }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const question = String(body.question || "").trim();
  const materials = Array.isArray(body.materials) ? body.materials.slice(0, 12) : [];
  if (!question || question.length > 2000) return json({ error: "Enter a question under 2,000 characters." }, 400);
  if (!materials.length) return json({ error: "Select at least one source." }, 400);

  const quotaResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_notebook_ai_quota`, { method: "POST", headers: authHeaders, body: "{}" });
  const quotaAllowed = quotaResponse.ok ? await quotaResponse.json() : false;
  if (!quotaAllowed) return json({ error: "You have reached today's 20-question Notebook AI limit." }, 429);
  if (!env.GEMINI_API_KEY) return json({ error: "Notebook AI is not configured yet." }, 503);

  const sourceText = materials.map((item, index) => `[${index + 1}] ${String(item.title || "Source").slice(0, 180)}\n${String(item.text || "").slice(0, 14000)}`).join("\n\n").slice(0, 60000);
  const geminiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: "You are Lumina Atlas Notebook AI. Answer using only the supplied sources. Cite factual claims with source numbers such as [1] or [2]. If the sources do not contain enough information, say so clearly. Be concise, accurate, and educational. Preserve useful mathematical notation in plain-text LaTeX delimiters." }] },
      contents: [{ role: "user", parts: [{ text: `SOURCES\n${sourceText}\n\nQUESTION\n${question}` }] }],
      generationConfig: { maxOutputTokens: 1400 }
    })
  });
  const payload = await geminiResponse.json();
  if (!geminiResponse.ok) return json({ error: "Notebook AI could not answer right now." }, 502);
  const answer = candidateText(payload);
  return answer ? json({ answer }) : json({ error: "Notebook AI returned an empty answer." }, 502);
}

export function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ error: "Method not allowed." }, 405);
}
