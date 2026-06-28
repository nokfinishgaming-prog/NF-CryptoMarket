// Netlify serverless function: crypto news via CryptoPanic.
//
// Your CryptoPanic auth token is read from the CRYPTOPANIC_TOKEN environment
// variable (set in Netlify → Site configuration → Environment variables). It
// never reaches the browser. CryptoPanic's API has no CORS and must be called
// server-side, which is why this lives here.
//
// Get a free token at https://cryptopanic.com/developers/api/keys

export async function handler(event) {
  const TOKEN = process.env.CRYPTOPANIC_TOKEN;
  if (!TOKEN) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "not configured — set CRYPTOPANIC_TOKEN in Netlify environment variables." }),
    };
  }

  const q = (event.queryStringParameters || {});
  const allowedFilters = ["rising", "hot", "bullish", "bearish", "important"];
  const params = new URLSearchParams({ auth_token: TOKEN, public: "true" });
  if (q.filter && allowedFilters.includes(q.filter)) params.set("filter", q.filter);
  if (q.currencies && /^[A-Za-z0-9,]{1,60}$/.test(q.currencies)) params.set("currencies", q.currencies.toUpperCase());

  try {
    const r = await fetch("https://cryptopanic.com/api/v1/posts/?" + params.toString());
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const msg = (data && (data.info || data.error)) || ("CryptoPanic returned " + r.status);
      return { statusCode: r.status, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: String(msg) }) };
    }

    const results = Array.isArray(data.results) ? data.results : [];
    const posts = results.slice(0, 40).map((p) => {
      const src = p.source || {};
      const coins = (p.currencies || p.instruments || []).map((c) => c.code).filter(Boolean).slice(0, 5);
      return {
        title: p.title || "(untitled)",
        url: p.url || p.original_url || "",
        source: src.title || src.domain || p.domain || "",
        domain: src.domain || p.domain || "",
        published_at: p.published_at || p.created_at || "",
        kind: p.kind || "news",
        coins,
      };
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=120" },
      body: JSON.stringify({ posts }),
    };
  } catch (e) {
    return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Could not reach the news service." }) };
  }
}
