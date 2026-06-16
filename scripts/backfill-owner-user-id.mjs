import { execFileSync } from 'node:child_process';

const project = process.argv[2] || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'ariadne-engine-rt';
const database = process.env.FIRESTORE_DATABASE || '(default)';
const token = getGcloudAccessToken();
const apiBase = `https://firestore.googleapis.com/v1/projects/${project}/databases/${encodeURIComponent(database)}`;

const collectionsWithRepoOwner = [
  'branches',
  'turns',
  'branchStates',
  'branchSnapshots',
  'eventPatches',
  'continuityWarnings',
  'branchMutationLocks'
];

const repos = await listCollection('storyRepos');
const repoOwners = new Map(
  repos
    .map(doc => [doc.id, stringFrom(doc.data.ownerUserId)]),
);

let updated = 0;
for (const collection of collectionsWithRepoOwner) {
  const docs = await listCollection(collection);
  for (const doc of docs) {
    const repoId = stringFrom(doc.data.repoId);
    const ownerUserId = repoOwners.get(repoId) || null;
    const fields = {};
    if ((doc.data.ownerUserId ?? null) !== ownerUserId) fields.ownerUserId = ownerUserId;
    if ((collection === 'eventPatches' || collection === 'continuityWarnings') && stringFrom(doc.data.id) !== doc.id) {
      fields.id = doc.id;
    }
    if (!Object.keys(fields).length) continue;
    await patchDocument(doc.name, fields);
    updated += 1;
    console.log(`updated ${doc.path}`);
  }
}

console.log(`Backfill complete. ${updated} document(s) updated in ${project}/${database}.`);

async function listCollection(collection) {
  const docs = [];
  let pageToken = '';
  do {
    const url = new URL(`${apiBase}/documents/${collection}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await firestoreFetch(url);
    for (const doc of response.documents ?? []) {
      docs.push({
        id: doc.name.split('/').pop(),
        name: doc.name,
        path: doc.name.split('/documents/')[1] ?? doc.name,
        data: decodeFields(doc.fields ?? {})
      });
    }
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return docs;
}

async function patchDocument(name, fields) {
  const url = new URL(`https://firestore.googleapis.com/v1/${name}`);
  for (const field of Object.keys(fields)) url.searchParams.append('updateMask.fieldPaths', field);
  await firestoreFetch(url, {
    method: 'PATCH',
    body: JSON.stringify({ fields: encodeFields(fields) })
  });
}

async function firestoreFetch(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: options.body
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

function decodeValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {});
  return undefined;
}

function encodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]));
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  return { mapValue: { fields: encodeFields(value) } };
}

function stringFrom(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getGcloudAccessToken() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    return execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud auth print-access-token'], { encoding: 'utf8' }).trim();
  }
}
