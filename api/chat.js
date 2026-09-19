import { handler as netlifyChatHandler } from "../netlify/functions/chat.js";

// Reuse the provider-agnostic chat logic already used by the Netlify function.
// Vercel exposes functions as Node request/response handlers instead.
export default async function handler(req, res) {
  const result = await netlifyChatHandler({
    httpMethod: req.method,
    body: req.body === undefined ? "" : JSON.stringify(req.body),
  });

  for (const [name, value] of Object.entries(result.headers || {})) {
    res.setHeader(name, value);
  }

  res.status(result.statusCode || 200).send(result.body || "");
}
