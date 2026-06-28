// Netlify serverless function: NF AI assistant, powered by Google Gemini.
//
// Your Gemini API key is read from the GEMINI_API_KEY environment variable
// (set in Netlify → Site configuration → Environment variables). It NEVER
// reaches the browser or the site code — it lives only here, on the server.
//
// Uses Gemini's NATIVE REST API (required for AQ. "auth" keys, which 401 on
// OpenAI-compatible endpoints).

const MODEL = "gemini-2.5-flash"; // free-tier model; change here if needed

const SYSTEM_PROMPT =
  "You are NF AI, an educational assistant inside a PRACTICE crypto trading and market-research tool called NF CryptoMarket. " +
  "Explain concepts, indicators, and how markets work in clear, plain, friendly language. " +
  "You must NEVER predict prices, give buy/sell or financial/investment advice, or say what a specific coin will do. " +
  "If asked for predictions or advice, briefly explain that no one can reliably predict crypto prices and that this tool is for learning and practice, then teach the underlying concept instead. " +
  "Keep answers concise (a few short paragraphs at most).";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "not configured — set GEMINI_API_KEY in Netlify environment variables." }),
    };
  }

  let messages = [];
  try {
    messages = (JSON.parse(event.body || "{}").messages || []).slice(-12); // keep last 12 turns
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Bad request" }) };
  }

  // Gemini uses roles "user" and "model" (not "assistant").
  const contents = messages
    .filter((m) => m && m.text)
    .map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: String(m.text).slice(0, 4000) }],
    }));

  if (!contents.length) {
    return { statusCode: 400, body: JSON.stringify({ error: "No message provided" }) };
  }

  try {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      MODEL +
      ":generateContent?key=" +
      encodeURIComponent(KEY);

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { maxOutputTokens: 800, temperature: 0.6 },
        safetySettings: [],
      }),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ("Gemini returned " + r.status);
      return { statusCode: r.status, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: msg }) };
    }

    const cand = data.candidates && data.candidates[0];
    const text =
      (cand && cand.content && cand.content.parts && cand.content.parts.map((p) => p.text || "").join("").trim()) ||
      "I couldn't generate an answer for that — try rephrasing.";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    };
  } catch (e) {
    return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Could not reach the AI service." }) };
  }
}
