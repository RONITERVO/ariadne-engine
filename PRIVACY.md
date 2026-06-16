# Privacy notes

Ariadne stores story data so that branches can be replayed, forked, and remembered. Depending on enabled features, stored data may include:

- story titles and descriptions
- user transcripts
- assistant transcripts
- generated canon events/facts/threads
- model invocation metadata
- audio asset metadata
- audio files in object storage when enabled

The starter does not persist Google AI Studio / Gemini API keys server-side. The transcript-only frontend keeps the pasted key in browser `sessionStorage` for the current tab session, sends it only on provider-bearing routes, and the backend discards it after each request.

Production apps should provide:

- account-level data export
- account-level data deletion
- clear retention periods
- explicit consent before storing microphone audio
- clear warning that BYOK Gemini usage may bill the user's Google project
