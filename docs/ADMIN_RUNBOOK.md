# Ariadne Admin Runbook

This runbook is for `ariadne-engine-rt`, the public Firebase/GCP project used by Ariadne Engine.

Use these commands from the repository root:

```powershell
cd D:\Projects\Games\ariadne-engine\ariadne-engine
```

## Current Public Targets

- App: https://ariadne-engine-rt.web.app
- Firebase project: `ariadne-engine-rt`
- Firebase Web App ID: `1:234362703129:web:8955fcac6bea60ee050988`
- Cloud Run service: `ariadne-api`
- Cloud Run region: `europe-west1`
- Artifact Registry repository: `europe-west1/ariadne`
- Firestore database: `(default)`, native mode, `eur3`

## Admin Links

- Firebase project overview: https://console.firebase.google.com/project/ariadne-engine-rt/overview
- Firebase Authentication users: https://console.firebase.google.com/project/ariadne-engine-rt/authentication/users
- Firebase sign-in providers: https://console.firebase.google.com/project/ariadne-engine-rt/authentication/providers
- Firebase Hosting: https://console.firebase.google.com/project/ariadne-engine-rt/hosting/sites
- Firebase Firestore data: https://console.firebase.google.com/project/ariadne-engine-rt/firestore/databases/-default-/data
- Firebase Firestore rules: https://console.firebase.google.com/project/ariadne-engine-rt/firestore/rules
- Firebase project settings: https://console.firebase.google.com/project/ariadne-engine-rt/settings/general
- Google Cloud dashboard: https://console.cloud.google.com/home/dashboard?project=ariadne-engine-rt
- Cloud Run service: https://console.cloud.google.com/run/detail/europe-west1/ariadne-api/metrics?project=ariadne-engine-rt
- Cloud Build history: https://console.cloud.google.com/cloud-build/builds?project=ariadne-engine-rt
- Artifact Registry images: https://console.cloud.google.com/artifacts?project=ariadne-engine-rt
- Secret Manager: https://console.cloud.google.com/security/secret-manager?project=ariadne-engine-rt
- Logs Explorer: https://console.cloud.google.com/logs/query?project=ariadne-engine-rt
- IAM: https://console.cloud.google.com/iam-admin/iam?project=ariadne-engine-rt
- Enabled APIs: https://console.cloud.google.com/apis/dashboard?project=ariadne-engine-rt
- Billing project link: https://console.cloud.google.com/billing/projects?project=ariadne-engine-rt
- Stripe Checkout sessions: https://dashboard.stripe.com/checkout/sessions
- Stripe Ariadne product: https://dashboard.stripe.com/products/prod_UiToQK6ecDGBRj
- Stripe webhooks: https://dashboard.stripe.com/webhooks
- Stripe customers: https://dashboard.stripe.com/customers
- Stripe payment method domains: https://dashboard.stripe.com/settings/payment_method_domains
- GitHub repository: https://github.com/RONITERVO/ariadne-engine
- GitHub pull requests: https://github.com/RONITERVO/ariadne-engine/pulls
- GitHub Actions: https://github.com/RONITERVO/ariadne-engine/actions

## Auth Policy

Production uses Firebase Google sign-in. Anonymous Firebase Auth must stay disabled for the public app.

Check Auth providers:

```powershell
$project = 'ariadne-engine-rt'
$token = gcloud auth print-access-token
$headers = @{ Authorization = "Bearer $token"; Accept = 'application/json'; 'x-goog-user-project' = $project }
Invoke-RestMethod -Method Get -Uri "https://identitytoolkit.googleapis.com/v2/projects/$project/config" -Headers $headers |
  Select-Object -ExpandProperty signIn
```

Disable anonymous Auth if it ever appears enabled:

```powershell
$project = 'ariadne-engine-rt'
$token = gcloud auth print-access-token
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json'; 'x-goog-user-project' = $project }
$body = @{ signIn = @{ anonymous = @{ enabled = $false } } } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Patch `
  -Uri "https://identitytoolkit.googleapis.com/v2/projects/$project/config?updateMask=signIn.anonymous.enabled" `
  -Headers $headers `
  -Body $body
```

Export Auth users for an admin audit. Do not commit the export file.

```powershell
firebase auth:export "$env:TEMP\ariadne-auth-export.json" --project ariadne-engine-rt --format=json --non-interactive
```

## First-Time CLI Setup

```powershell
firebase login
firebase login:use ronitervo.rt@gmail.com
gcloud auth login ronitervo.rt@gmail.com
gcloud config set project ariadne-engine-rt
gcloud config set run/region europe-west1
npm install
npm run check
```

Confirm the project:

```powershell
firebase projects:list
firebase use ariadne-engine-rt
gcloud config list
```

## Rebuild Or Repair The Project

Use these commands only when recreating infrastructure or repairing permissions.

Enable required APIs:

```powershell
gcloud services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  artifactregistry.googleapis.com `
  secretmanager.googleapis.com `
  firestore.googleapis.com `
  firebase.googleapis.com `
  identitytoolkit.googleapis.com `
  iamcredentials.googleapis.com `
  --project=ariadne-engine-rt
```

Create Firestore if the project is new:

```powershell
gcloud firestore databases create `
  --database='(default)' `
  --location=eur3 `
  --type=firestore-native `
  --project=ariadne-engine-rt
```

Create the Docker repository if missing:

```powershell
gcloud artifacts repositories create ariadne `
  --repository-format=docker `
  --location=europe-west1 `
  --project=ariadne-engine-rt
```

Grant runtime and build permissions:

```powershell
$projectNumber = '234362703129'
$runtimeSa = "$projectNumber-compute@developer.gserviceaccount.com"
$cloudBuildSa = "$projectNumber@cloudbuild.gserviceaccount.com"

gcloud projects add-iam-policy-binding ariadne-engine-rt `
  --member="serviceAccount:$runtimeSa" `
  --role=roles/secretmanager.secretAccessor

gcloud projects add-iam-policy-binding ariadne-engine-rt `
  --member="serviceAccount:$cloudBuildSa" `
  --role=roles/run.admin

gcloud projects add-iam-policy-binding ariadne-engine-rt `
  --member="serviceAccount:$cloudBuildSa" `
  --role=roles/artifactregistry.writer

gcloud projects add-iam-policy-binding ariadne-engine-rt `
  --member="serviceAccount:$cloudBuildSa" `
  --role=roles/iam.serviceAccountUser
```

Create secrets if missing:

```powershell
gcloud secrets create gemini-api-keys --replication-policy=automatic --project=ariadne-engine-rt
gcloud secrets create stripe-secret-key --replication-policy=automatic --project=ariadne-engine-rt
gcloud secrets create stripe-webhook-secret --replication-policy=automatic --project=ariadne-engine-rt
```

## Deploy

Run the full local gate before any deploy:

```powershell
npm run check
```

Deploy the API to Cloud Run:

```powershell
npm run deploy:api
```

If Cloud Build reports that the public invoker binding was not applied, reapply it:

```powershell
gcloud run services add-iam-policy-binding ariadne-api `
  --region=europe-west1 `
  --project=ariadne-engine-rt `
  --member=allUsers `
  --role=roles/run.invoker `
  --quiet
```

Deploy Firebase Hosting, Firestore rules, and Firestore indexes:

```powershell
npm run deploy:firebase
```

`npm run deploy:firebase` fetches the Firebase Web App config and builds `web/dist` with the required `VITE_FIREBASE_*` values. Do not replace it with a plain `npm run build:web` deploy for production.

## Smoke Tests

Health/config:

```powershell
$base = 'https://ariadne-engine-rt.web.app'
Invoke-RestMethod "$base/health"
Invoke-RestMethod "$base/v1/config"
```

Confirm anonymous sign-up is blocked. This must return an error, not an ID token:

```powershell
$configRaw = firebase apps:sdkconfig WEB 1:234362703129:web:8955fcac6bea60ee050988 --project ariadne-engine-rt --json
$apiKey = (($configRaw | ConvertFrom-Json).result.sdkConfig.apiKey)
try {
  Invoke-RestMethod -Method Post `
    -Uri "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$apiKey" `
    -ContentType 'application/json' `
    -Body '{"returnSecureToken":true}'
  throw 'Anonymous sign-up unexpectedly succeeded.'
} catch {
  'Anonymous sign-up is blocked as expected.'
}
```

Browser smoke:

1. Open https://ariadne-engine-rt.web.app.
2. Click `Sign in`.
3. Choose a Google account.
4. Confirm the app requests microphone permission only after sign-in and setup.
5. Do not use anonymous test accounts.

## Secrets

Production secrets live in Secret Manager:

- `gemini-api-keys`
- `stripe-secret-key`
- `stripe-webhook-secret`

List metadata only:

```powershell
gcloud secrets list --project=ariadne-engine-rt
gcloud secrets versions list gemini-api-keys --project=ariadne-engine-rt
```

Add a new version from a local file. Delete the local file afterwards:

```powershell
gcloud secrets versions add gemini-api-keys --project=ariadne-engine-rt --data-file=.\gemini-api-keys.txt
Remove-Item .\gemini-api-keys.txt
```

Never print secret values into terminal logs, GitHub issues, PRs, screenshots, or docs.

## Billing

Stripe webhook URL:

```text
https://ariadne-engine-rt.web.app/v1/webhooks/stripe
```

Use Stripe Dashboard to manage webhook endpoints, payment method domains, payments, customers, and Checkout sessions. The backend reads `STRIPE_WEBHOOK_SECRET` from Secret Manager; if the endpoint secret changes in Stripe, add a new Secret Manager version and redeploy the API.

Dashboard-managed Stripe product:

```text
prod_UiToQK6ecDGBRj
```

Cloud Run receives this as `STRIPE_PRODUCT_ID`. Checkout still creates per-session dynamic prices so users can buy different prepaid credit amounts, but every line item now belongs to the dashboard-managed Ariadne usage credits product instead of creating auto-generated products.

Promotion codes:

- Checkout sessions allow Stripe promotion codes.
- Create 10% off public/new-user codes in Stripe Dashboard when needed.
- Create 100% off friend codes with normal Stripe promotion-code restrictions. Fully-discounted checkouts still grant the requested Ariadne credits through the `checkout.session.completed` webhook path.

## Firestore

List indexes:

```powershell
firebase firestore:indexes --project ariadne-engine-rt
```

Deploy rules and indexes only:

```powershell
firebase deploy --project ariadne-engine-rt --only firestore
```

Export Firestore before risky data migrations. Replace the bucket with the team's backup bucket:

```powershell
gcloud firestore export gs://YOUR_BACKUP_BUCKET/ariadne/$(Get-Date -Format yyyyMMdd-HHmmss) `
  --database='(default)' `
  --project=ariadne-engine-rt
```

List backup schedules:

```powershell
firebase firestore:backups:schedules:list --project ariadne-engine-rt
```

Delete launch-test data only when the team intentionally wants a clean empty production project. Do not run this after real users exist:

```powershell
$project = 'ariadne-engine-rt'
foreach ($collection in 'storyRepos','branches','turns','branchStates','branchSnapshots','eventPatches','continuityWarnings','branchMutationLocks','users','entitlements','billingEvents','usage') {
  firebase firestore:delete $collection --project $project --recursive --yes
}
```

## Logs And Incidents

API logs:

```powershell
gcloud run services logs read ariadne-api --region=europe-west1 --project=ariadne-engine-rt --limit=100
```

Recent builds:

```powershell
gcloud builds list --project=ariadne-engine-rt --limit=10
```

Cloud Run revisions:

```powershell
gcloud run revisions list --service=ariadne-api --region=europe-west1 --project=ariadne-engine-rt
```

Roll back to a previous revision:

```powershell
gcloud run services update-traffic ariadne-api `
  --region=europe-west1 `
  --project=ariadne-engine-rt `
  --to-revisions=REVISION_NAME=100
```

Inspect deployed Cloud Run environment and secrets without printing secret values:

```powershell
gcloud run services describe ariadne-api `
  --region=europe-west1 `
  --project=ariadne-engine-rt `
  --format="yaml(spec.template.spec.containers[0].env,spec.template.spec.containers[0].resources,status.url)"
```

Create a temporary Hosting preview channel:

```powershell
npm run build:web:firebase
firebase hosting:channel:deploy preview-$(Get-Date -Format yyyyMMdd-HHmmss) `
  --project ariadne-engine-rt `
  --expires 7d
```

Emergency stop for Hosting. Use only if the public frontend must be taken offline:

```powershell
firebase hosting:disable --project ariadne-engine-rt
```

Emergency stop for API traffic. This removes public invocation until restored:

```powershell
gcloud run services remove-iam-policy-binding ariadne-api `
  --region=europe-west1 `
  --project=ariadne-engine-rt `
  --member=allUsers `
  --role=roles/run.invoker
```

Restore public API traffic:

```powershell
gcloud run services add-iam-policy-binding ariadne-api `
  --region=europe-west1 `
  --project=ariadne-engine-rt `
  --member=allUsers `
  --role=roles/run.invoker `
  --quiet
```

## Cost Controls

Check billing exports and project spend in Google Cloud Billing. For Gemini usage, update `ARIADNE_MODEL_CATALOG_JSON` and `GEMINI_API_KEYS` only through reviewed changes and Secret Manager. For Stripe credit pricing, update billing environment variables in `cloudbuild.api.yaml` or deployment substitutions, then redeploy the API.
