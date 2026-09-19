import { handler as netlifyChatHandler } from "../netlify/functions/chat.js";

// Reuse the provider-agnostic chat logic already used by the Netlify function.
// Vercel exposes functions as Node request/response handlers instead.
export default async function handler(req, res) {
  let result;
  try {
    result = await netlifyChatHandler({
      httpMethod: req.method,
      body: req.body === undefined ? "" : JSON.stringify(req.body),
    });
  } catch (error) {
    console.error("Vercel chat adapter error:", error);
    return res.status(500).json({ error: "The chat service encountered an unexpected error." });
  }

  for (const [name, value] of Object.entries(result.headers || {})) {
    res.setHeader(name, value);
  }

  if (result.statusCode >= 500) {
    console.error(`Chat API returned ${result.statusCode}:`, result.body);
  }

  res.status(result.statusCode || 200).send(result.body || "");
}
