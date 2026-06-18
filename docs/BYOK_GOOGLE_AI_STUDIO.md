# BYOK Google AI Studio / Gemini design

Ariadne supports BYOK alongside hosted paid usage: the user can supply their own Google AI Studio / Gemini API key in the frontend to bypass Ariadne credits. On the hosted Firebase app, BYOK users still sign in so their story repos are owned and private.

## Rules

1. The frontend never puts the key in a URL.
2. The hosted frontend sends the key to the Ariadne backend only in `x-ariadne-provider-key`. `Authorization: Bearer` is reserved for Firebase ID tokens.
3. The frontend sends the key only on provider-bearing routes: key validation, Live-token minting, normal story turns, streaming story turns, and Live-turn commit.
4. The backend rejects provider-key-shaped fields in query strings and JSON request bodies.
5. The backend rejects provider key headers on non-provider routes such as repo creation.
6. The backend uses the key for that request only.
7. The backend does not store the key in Firestore, object storage, analytics, telemetry, or logs.
8. The logger redacts provider key headers and key-like body fields.
9. The frontend stores the key only in browser `sessionStorage` for local convenience. A production app should offer an explicit "remember on this device" choice and explain the risk.
10. Production deployments must require HTTPS and a strict CORS allow-list.

## Why not call Gemini directly with a durable key from browser code?

Browser code is inspectable. Durable API keys can be extracted from client-side apps. BYOK means the user is choosing to enter their key, but the app should still minimize risk. For normal and streaming story turns, Ariadne proxies requests through its backend so it can keep prompts, reducers, auth policy, persistence, and logging policy server-side.

For realtime Gemini Live sessions, Ariadne exposes `/v1/provider/gemini/live-token`, which mints a short-lived Live API token. The browser connects to Gemini Live using that token, not the durable key. Local in-browser Whisper is used only to detect speech turn boundaries; Gemini Live supplies the user/model transcripts and model audio.

## Key lifecycle

```text
User pastes key into frontend
  -> frontend sends key over HTTPS to Ariadne backend provider route
  -> backend validates / generates / mints Live token
  -> backend discards key after request
  -> logs contain only a short SHA-256 fingerprint prefix for debugging
```

## Transcript-only frontend

After sign-in or key setup, the default web app deliberately avoids ongoing UI controls and shows only transcript lines.

## Production checklist

- Use AI Studio auth keys / restricted keys where available.
- Warn users that their key may incur Google API usage costs.
- Do not enable request-body logging for provider routes.
- Do not send provider keys to third-party analytics.
- Keep Firebase auth enabled for paid users and allow BYOK users to send their own key.
- Set rate limits per authenticated user and per IP.
- Keep `NODE_ENV=production` guardrails enabled.
- Provide a clear key-clearing flow if you add persistent key storage.

## Relevant official docs

- Gemini API docs: https://ai.google.dev/gemini-api/docs
- Google Gen AI JavaScript SDK: https://github.com/googleapis/js-genai
- Gemini Live API: https://ai.google.dev/gemini-api/docs/live-api
- Gemini Live ephemeral tokens: https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
- Gemini API key guidance: https://ai.google.dev/gemini-api/docs/api-key
