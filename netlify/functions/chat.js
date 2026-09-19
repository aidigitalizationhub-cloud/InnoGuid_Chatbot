const SOURCES = [
  "https://www.iast.ug.edu.gh/",
  "https://rid.ug.edu.gh/news",
  "https://orid1.ug.edu.gh/news/",
  "https://nmimr.ug.edu.gh/",
  "https://www.waccbip.org/news",
  "https://biotech.ug.edu.gh/",
  "https://dig.ug.edu.gh/",
  "https://www.ug.edu.gh/news-events",
  "https://www.ug.edu.gh/academics/centres-institutes",
  "https://www.ug.edu.gh/academics/departments",
  "https://www.ug.edu.gh/research/research-centres",
  "https://www.ug.edu.gh/academics/colleges",
  "https://www.ug.edu.gh/about-ug/overview",
  "https://ugms.ug.edu.gh/",
  "https://ugmedicalcentre.org/",
  "https://chs.ug.edu.gh/",
  "https://pharmacy.ug.edu.gh/",
  "https://sbahs.ug.edu.gh/",
  "https://rips.ug.edu.gh/",
  "https://isser.ug.edu.gh/",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "for",
  "from",
  "have",
  "into",
  "more",
  "that",
  "than",
  "their",
  "them",
  "they",
  "this",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);
// Keep the whole request below Netlify's synchronous-function time limit.
const SOURCE_FETCH_TIMEOUT_MS = 1800;
// URL-grounded Gemini requests can legitimately take longer than a plain-text
// response. Netlify synchronous functions have a tighter practical window;
// Vercel receives its own 50-second window and a 60-second function limit.
const GEMINI_TIMEOUT_MS = process.env.VERCEL ? 50000 : 20000;
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

function toContents(history, message) {
  const safeHistory = Array.isArray(history) ? history : [];
  const contents = safeHistory
    .filter((msg) => msg && typeof msg.content === "string" && msg.content.trim())
    .map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));
  contents.push({ role: "user", parts: [{ text: message }] });
  return contents;
}

function extractKeywords(message) {
  return [...new Set(
    String(message)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  )].slice(0, 8);
}

function dedupeUrls(urls) {
  return [...new Set(urls.map((u) => String(u || "").trim()).filter(Boolean))];
}

function scoreSource(url, keywords) {
  const haystack = url.toLowerCase();
  return keywords.reduce((score, keyword) => {
    if (!keyword) return score;
    if (haystack.includes(keyword)) return score + 2;
    return score;
  }, 0);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinksFromHtml(html, baseUrl) {
  const links = [];
  const regex = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html))) {
    try {
      const link = new URL(match[1], baseUrl).toString();
      if (link.startsWith("http://") || link.startsWith("https://")) {
        links.push(link);
      }
    } catch {}
  }
  return links;
}

async function fetchSourceSnippet(url, timeoutMs = SOURCE_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "InnoGuideBot/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const html = await response.text();
    const links = extractLinksFromHtml(html, url);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() || url;
    const text = stripHtml(html).slice(0, 2600);
    if (!text) return null;
    return { url, title, text, links };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildLiveContext(message) {
  const keywords = extractKeywords(message);
  const ranked = SOURCES
    .map((url) => ({ url, score: scoreSource(url, keywords) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.url);

  const shortlist = dedupeUrls([
    ...ranked.slice(0, 2),
    "https://www.iast.ug.edu.gh/",
  ]).slice(0, 3);

  const firstPass = (await Promise.all(shortlist.map((url) => fetchSourceSnippet(url))))
    .filter(Boolean);

  // A second crawl pass can consume the remaining function budget. The initial,
  // ranked pages are sufficient grounding for this synchronous endpoint.
  const snippets = firstPass.slice(0, 3);

  if (!snippets.length) {
    return "No live source snippets were available for this query.";
  }

  return snippets
    .map((snippet, idx) => {
      return `${idx + 1}. ${snippet.title}\nURL: ${snippet.url}\nExcerpt: ${snippet.text}`;
    })
    .join("\n\n");
}

async function callGemini({ apiKey, model, contents, liveContext, useTools = true }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents,
          systemInstruction: {
            parts: [
              {
            text: `You are InnoGuide, an expert assistant for the University of Ghana and the IAST Virtual Innovation Hub.
Use these approved sources as grounding references: ${SOURCES.join(", ")}

Live context for this request:
${liveContext}

Response rules:
1) Give a detailed, accurate answer with clear sections and bullet points.
2) Prioritize facts from the live context. If a fact is uncertain, state that explicitly.
3) End with a "Sources" section. Each source must be a Markdown link in the form - [Title or URL](https://example.com). Do not use naked URLs.
4) If the question asks for steps/processes, provide step-by-step guidance.
5) Do not invent UG programs, offices, names, or dates.
6) For external/current info, use web context tools and cite URLs.
7) Use Markdown.`,
          },
        ],
      },
      ...(useTools ? { tools: [{ urlContext: {} }, { googleSearch: {} }] } : {}),
      generationConfig: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 2048,
      },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || `Gemini request failed (${response.status})`;
      throw new Error(message);
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((p) => p?.text || "")
      .join("")
      .trim();

    return text || "";
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Gemini request timed out after ${GEMINI_TIMEOUT_MS / 1000} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGeminiWithRetry({ apiKey, contents, liveContext, models }) {
  let lastError = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= 1; attempt += 1) {
      try {
        // Live context is collected above; avoiding a second provider-side tool
        // call keeps this synchronous function within its time budget.
        const text = await callGemini({ apiKey, model, contents, liveContext, useTools: false });
        if (text) return { text, model };
        lastError = new Error(`Empty response from model ${model}`);
      } catch (error) {
        const message = String(error?.message || "");
        const unsupportedTool =
          /tools|googleSearch|urlContext|Unknown name|invalid argument/i.test(message);

        if (unsupportedTool) {
          try {
            const text = await callGemini({ apiKey, model, contents, liveContext, useTools: false });
            if (text) return { text, model };
          } catch (innerError) {
            lastError = innerError;
          }
        } else {
          lastError = error;
        }

        // Do not retry in this synchronous function: each Gemini call has a
        // bounded 7-second window and a retry would exceed Netlify's budget.
      }
    }
  }

  throw lastError || new Error("All Gemini fallback attempts failed.");
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Missing GEMINI_API_KEY in Netlify environment variables." }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const history = Array.isArray(body.history) ? body.history : [];
    const primaryModel = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    // If a paid/preview model has no allocation, keep the chat usable with the
    // stable Flash model instead of failing every request.
    const fallbackModels = [...new Set([primaryModel, DEFAULT_GEMINI_MODEL])];

    if (!message) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Message is required." }),
      };
    }

    const contents = toContents(history, message);
    const liveContext = await buildLiveContext(message);
    const { text, model } = await callGeminiWithRetry({
      apiKey,
      contents,
      liveContext,
      models: fallbackModels,
    });

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model }),
    };
  } catch (error) {
    const message = String(error?.message || "Internal Server Error");
    const isQuotaError = /quota exceeded|RESOURCE_EXHAUSTED/i.test(message);
    // This is also used by the Vercel adapter. Log the provider failure there
    // without ever logging credentials, so production failures are diagnosable.
    console.error("Chat API error:", message);
    return {
      statusCode: isQuotaError ? 429 : 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: isQuotaError
          ? "Gemini quota is unavailable for this project. Use GEMINI_MODEL=gemini-3.6-flash, wait for the stated reset time, or enable billing for the API project that owns this key."
          : message,
      }),
    };
  }
};
