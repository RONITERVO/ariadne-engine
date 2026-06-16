# Security policy

## Supported versions

This starter is pre-1.0. Security fixes should target `main` until a stable release branch exists.

## Reporting a vulnerability

Open a private security advisory on GitHub or contact the maintainers through the project's published security channel. Do not file public issues for exploitable vulnerabilities.

## Provider-key policy

Ariadne is BYOK. User provider keys must be treated as secrets:

- never store provider keys server-side
- never put provider keys in URLs
- never accept provider keys in JSON request bodies
- never log provider keys
- redact `authorization` and `x-ariadne-provider-key`
- send provider keys only on provider validation, Live-token, and story turn routes
- use HTTPS in production
- use short-lived Gemini Live ephemeral tokens for direct browser Live API connections

Implemented controls:

- provider key headers are accepted only on provider/story routes
- provider-key-shaped fields in request bodies and query strings are rejected before route validation
- provider key headers and known secret-like fields are redacted from logs
- production config rejects memory storage, wildcard CORS, disabled Firebase auth/billing, missing server Gemini keys, and mock provider
- tests cover header extraction, secret-field rejection, and route-level provider-key rejection

## Deployment requirements

Public deployments must use Firebase authentication, Firestore persistence, paid usage accounting, server Gemini keys, HTTPS, and a strict CORS allow-list before accepting real users.
