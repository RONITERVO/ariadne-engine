import { execFileSync } from 'node:child_process';

const project = process.argv.find(arg => !arg.startsWith('--') && arg !== process.argv[1] && arg !== process.argv[0])
  || process.env.GOOGLE_CLOUD_PROJECT
  || process.env.GCLOUD_PROJECT
  || 'ariadne-engine-rt';
const database = process.env.FIRESTORE_DATABASE || '(default)';
const dryRun = !process.argv.includes('--yes');
const token = getGcloudAccessToken();
const apiBase = `https://firestore.googleapis.com/v1/projects/${project}/databases/${encodeURIComponent(database)}`;

const rootCollections = [
  // Current production root collections. Deleting `users` recurses into storyRepos, billingAccounts,
  // turns, branchState, stateSnapshots, canonPatches, warnings, locks, and usage ledgers.
  'users',
  'storyRepoIndex',
  'storyBranchIndex',
  'storyTurnIndex',
  'billingEventIndex',

  // Older tester/experimental schemas; kept here so a clean reset really removes old data.
  'storyRepos',
  'branches',
  'turns',
  'branchStates',
  'branchSnapshots',
  'eventPatches',
  'continuityWarnings',
  'branchMutationLocks',
  'entitlements',
  'usage',
  'billingEvents',
  'repos',
  'repoIndex',
  'branchIndex',
  'turnIndex',
  '_repoLookup',
  '_branchLookup',
  '_turnLookup'
];

let deleted = 0;
let visited = 0;
console.log(`${dryRun ? 'Dry run' : 'Deleting'} Firestore documents in ${project}/${database}`);
for (const collectionPath of rootCollections) {
  await deleteCollection(collectionPath);
}
console.log(`${dryRun ? 'Would delete' : 'Deleted'} ${deleted} document(s); visited ${visited} document(s).`);
if (dryRun) {
  console.log('Run with --yes to actually delete. Example: node scripts/clear-firestore-data.mjs ariadne-engine-rt --yes');
}

async function deleteCollection(collectionPath) {
  const docs = await listDocuments(collectionPath);
  if (!docs.length) return;
  console.log(`${collectionPath}: ${docs.length} document(s)`);
  for (const doc of docs) {
    visited += 1;
    const relativePath = relativeDocumentPath(doc.name);
    for (const childCollectionId of await listCollectionIds(relativePath)) {
      await deleteCollection(`${relativePath}/${childCollectionId}`);
    }
    if (dryRun) {
      console.log(`would delete ${relativePath}`);
    } else {
      await firestoreFetch(`https://firestore.googleapis.com/v1/${doc.name}`, { method: 'DELETE' });
      console.log(`deleted ${relativePath}`);
    }
    deleted += 1;
  }
}

async function listDocuments(collectionPath) {
  const docs = [];
  let pageToken = '';
  do {
    const url = new URL(`${apiBase}/documents/${collectionPath}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await firestoreFetch(url);
    docs.push(...(response.documents ?? []));
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return docs;
}

async function listCollectionIds(documentPath) {
  const ids = [];
  let pageToken = '';
  do {
    const url = new URL(`${apiBase}/documents/${documentPath}:listCollectionIds`);
    const response = await firestoreFetch(url, {
      method: 'POST',
      body: JSON.stringify({ pageSize: 300, ...(pageToken ? { pageToken } : {}) })
    });
    ids.push(...(response.collectionIds ?? []));
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return ids;
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
  if (!response.ok && response.status !== 404) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function relativeDocumentPath(fullName) {
  return fullName.split('/documents/')[1] ?? fullName;
}

function getGcloudAccessToken() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    return execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud auth print-access-token'], { encoding: 'utf8' }).trim();
  }
}
