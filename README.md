# UG InnoGuide

UG InnoGuide is a chatbot for the University of Ghana IAST Virtual Innovation Hub.

## Local development

1. Install dependencies:
   `npm install`
2. Create `.env` from `.env.example` and set `GEMINI_API_KEY`.
3. Start locally:
   `npm run dev`
4. Open:
   `http://localhost:3000`

## Quality checks before push

Run:

`npm run check`

This executes TypeScript checks and production build.

## Netlify deployment

This project includes:
- `netlify.toml` for build + redirects
- `netlify/functions/chat.js` for `/api/chat`

In Netlify dashboard, set these environment variables:
- `GEMINI_API_KEY` (required)
- `GEMINI_MODEL` (optional, default `gemini-3.6-flash`)

Deploy command: `npm run build`  
Publish directory: `dist`

## Embed in the Virtual Innovation Hub index page

After deploying InnoGuide (example: `https://innoguide.netlify.app`), embed it in your platform:

```html
<section class="chatbot-panel">
  <h2>Ask InnoGuide</h2>
  <iframe
    src="https://innoguide.netlify.app"
    title="InnoGuide Chatbot"
    width="100%"
    height="760"
    style="border:0;border-radius:12px;background:#fff"
    loading="lazy"
    allow="clipboard-write"
  ></iframe>
</section>
```

If you prefer opening in a new tab instead of iframe:

```html
<a href="https://innoguide.netlify.app" target="_blank" rel="noopener noreferrer">
  Open InnoGuide
</a>
```
