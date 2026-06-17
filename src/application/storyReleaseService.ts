import type {
  AudioAsset,
  BranchRef,
  EntityState,
  FactPatch,
  StoryRepo,
  ThreadPatch,
  TurnCommit,
  WorldState
} from '../domain/types.js';
import type { StoryStore } from '../storage/storyStore.js';
import { StoreError } from '../storage/storyStore.js';

export interface StoryArchiveBranch {
  branch: BranchRef;
  timeline: TurnCommit[];
  state: WorldState | null;
  audioAssets: AudioAsset[];
}

export interface StoryArchive {
  schemaVersion: 'ariadne.offline-archive.v1';
  generatedAt: string;
  repo: StoryRepo;
  audioAssets: AudioAsset[];
  branches: StoryArchiveBranch[];
}

export interface StorySearchInput {
  query: string;
  repoIds: string[];
  branchId?: string;
  limit?: number;
}

export interface StorySearchResult {
  id: string;
  kind: 'repo' | 'branch' | 'turn' | 'scene' | 'entity' | 'thread' | 'fact';
  repoId: string;
  repoTitle: string;
  branchId?: string;
  branchName?: string;
  turnId?: string;
  turnIndex?: number;
  label: string;
  excerpt: string;
  score: number;
  matchedTerms: string[];
  rewindMode: 'before' | 'at';
  forkSourceTurnId?: string | null;
  forkLabel?: string;
  createdAt?: string | null;
}

export interface StorySearchResponse {
  query: string;
  generatedAt: string;
  results: StorySearchResult[];
}

export interface BranchCompareResponse {
  generatedAt: string;
  repoId: string;
  commonAncestorTurnId: string | null;
  commonAncestorTurnIndex: number | null;
  left: BranchCompareSide;
  right: BranchCompareSide;
  stateDiff: BranchStateDiff;
}

export interface BranchCompareSide {
  branch: BranchRef;
  totalTurns: number;
  uniqueTurns: TimelineTurnSummary[];
  headTurnId: string | null;
  sceneSummary?: string | null;
}

export interface TimelineTurnSummary {
  id: string;
  turnIndex: number;
  userTranscript: string;
  assistantTranscript: string;
  stateStatus: TurnCommit['stateStatus'];
  parentTurnId?: string | null;
  createdAt: string;
}

export interface BranchStateDiff {
  sceneChanged: boolean;
  leftScene?: WorldState['scene'];
  rightScene?: WorldState['scene'];
  entities: {
    leftOnly: string[];
    rightOnly: string[];
    changed: Array<{ id: string; left: EntityState; right: EntityState }>;
  };
  facts: {
    leftOnly: FactPatch[];
    rightOnly: FactPatch[];
  };
  threads: {
    leftOnly: ThreadPatch[];
    rightOnly: ThreadPatch[];
    changed: Array<{ id: string; left: ThreadPatch; right: ThreadPatch }>;
  };
}

export interface CanonDebugResponse {
  generatedAt: string;
  branch: BranchRef;
  state: WorldState | null;
  latestTurn: TimelineTurnSummary | null;
  stats: {
    turns: number;
    entities: number;
    facts: number;
    threads: number;
    openThreads: number;
    resolvedThreads: number;
    audioAssets: number;
  };
  openThreads: ThreadPatch[];
  audioAssets: AudioAsset[];
}

interface SearchDoc {
  id: string;
  kind: StorySearchResult['kind'];
  repo: StoryRepo;
  branch?: BranchRef;
  turn?: TurnCommit;
  label: string;
  text: string;
  tags: string[];
  createdAt?: string | null;
  forkSourceTurnId?: string | null;
}

const STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'before', 'after', 'back', 'take', 'where', 'when', 'then',
  'there', 'here', 'have', 'has', 'had', 'they', 'them', 'their', 'what', 'which', 'while', 'about', 'story', 'branch'
]);

const TERM_EXPANSIONS: Record<string, string[]> = {
  betrayal: ['betray', 'traitor', 'treason', 'doublecross', 'spy'],
  betrayed: ['betray', 'traitor', 'treason', 'doublecross', 'spy'],
  inn: ['tavern', 'alehouse', 'pub'],
  city: ['town', 'capital', 'harbor'],
  saved: ['save', 'rescue', 'protect', 'defend'],
  killed: ['kill', 'slay', 'dead', 'murder'],
  promise: ['vow', 'oath', 'pledge'],
  mystery: ['secret', 'clue', 'riddle'],
  artifact: ['relic', 'item', 'object']
};

export async function buildStoryArchive(store: StoryStore, repoId: string): Promise<StoryArchive> {
  const repo = await store.getRepo(repoId);
  if (!repo) throw new StoreError(`repo not found: ${repoId}`, 'not_found');
  const [branches, audioAssets] = await Promise.all([
    store.listBranches(repoId),
    store.listAudioAssets(repoId).catch(() => [] as AudioAsset[])
  ]);
  const archiveBranches: StoryArchiveBranch[] = [];
  for (const branch of branches) {
    const [timeline, state] = await Promise.all([
      store.getTimeline(branch.id).catch(() => [] as TurnCommit[]),
      store.getState(branch.id).catch(() => null)
    ]);
    archiveBranches.push({
      branch,
      timeline,
      state,
      audioAssets: audioAssets.filter(asset => asset.branchId === branch.id)
    });
  }

  return {
    schemaVersion: 'ariadne.offline-archive.v1',
    generatedAt: new Date().toISOString(),
    repo,
    audioAssets,
    branches: archiveBranches
  };
}

export function archiveToMarkdown(archive: StoryArchive): string {
  const lines: string[] = [];
  lines.push(`# ${archive.repo.title || archive.repo.id}`);
  lines.push('');
  if (archive.repo.description) {
    lines.push(archive.repo.description);
    lines.push('');
  }
  lines.push(`- Archive schema: ${archive.schemaVersion}`);
  lines.push(`- Generated: ${archive.generatedAt}`);
  lines.push(`- Repo id: ${archive.repo.id}`);
  lines.push(`- Branches: ${archive.branches.length}`);
  lines.push(`- Audio assets: ${archive.audioAssets.length}`);
  lines.push('');

  for (const branchArchive of archive.branches) {
    const { branch, timeline, state, audioAssets } = branchArchive;
    lines.push(`## Branch: ${branch.name || branch.id}`);
    lines.push('');
    lines.push(`- Branch id: ${branch.id}`);
    lines.push(`- Head turn: ${branch.headTurnId ?? 'none'}`);
    lines.push(`- Forked from: ${branch.forkedFromTurnId ?? 'root'}`);
    lines.push(`- Turns: ${timeline.length}`);
    lines.push(`- Audio assets: ${audioAssets.length}`);
    if (state?.scene?.summary) lines.push(`- Current scene: ${state.scene.summary}`);
    lines.push('');

    if (state) {
      lines.push('### Current canon');
      lines.push('');
      lines.push(`- Location: ${state.scene.locationId}`);
      lines.push(`- Present entities: ${state.scene.presentEntityIds.join(', ') || 'none'}`);
      lines.push(`- Open threads: ${state.threads.filter(thread => thread.status === 'open' || thread.status === 'advanced').length}`);
      lines.push('');
    }

    lines.push('### Timeline');
    lines.push('');
    if (!timeline.length) {
      lines.push('_No committed turns._');
      lines.push('');
      continue;
    }

    for (const turn of timeline) {
      lines.push(`#### Turn ${turn.turnIndex}`);
      lines.push('');
      lines.push(`- Turn id: ${turn.id}`);
      lines.push(`- Parent: ${turn.parentTurnId ?? 'root'}`);
      lines.push(`- State: ${turn.stateStatus}`);
      if (turn.userAudioAssetId || turn.assistantAudioAssetId) {
        lines.push(`- Audio: user=${turn.userAudioAssetId ?? 'none'}, assistant=${turn.assistantAudioAssetId ?? 'none'}`);
      }
      lines.push('');
      lines.push('**Player**');
      lines.push('');
      lines.push(turn.userTranscript || '_No player transcript._');
      lines.push('');
      lines.push('**Ariadne**');
      lines.push('');
      lines.push(turn.assistantTranscript || '_No assistant transcript._');
      lines.push('');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

export async function searchStory(store: StoryStore, input: StorySearchInput): Promise<StorySearchResponse> {
  const mode = inferRewindMode(input.query);
  const query = input.query.trim();
  const terms = expandedTerms(query);
  const docs: SearchDoc[] = [];

  for (const repoId of input.repoIds) {
    const repo = await store.getRepo(repoId);
    if (!repo) continue;
    docs.push({
      id: `repo:${repo.id}`,
      kind: 'repo',
      repo,
      label: repo.title,
      text: compactText(repo.title, repo.description, repo.defaultStyle, repo.safetyProfile),
      tags: compactArray(['repo', repo.defaultStyle, repo.safetyProfile]),
      createdAt: repo.createdAt
    });

    const branches = (await store.listBranches(repo.id)).filter(branch => !input.branchId || branch.id === input.branchId);
    for (const branch of branches) {
      docs.push({
        id: `branch:${branch.id}`,
        kind: 'branch',
        repo,
        branch,
        label: branch.name,
        text: compactText(branch.name, branch.forkedFromTurnId ? `forked from ${branch.forkedFromTurnId}` : 'mainline branch'),
        tags: compactArray(['branch', branch.forkedFromTurnId ? 'fork' : 'main']),
        createdAt: branch.createdAt,
        forkSourceTurnId: branch.headTurnId ?? null
      });

      const timeline = await store.getTimeline(branch.id).catch(() => [] as TurnCommit[]);
      for (const turn of timeline) {
        docs.push({
          id: `turn:${turn.id}`,
          kind: 'turn',
          repo,
          branch,
          turn,
          label: `Turn ${turn.turnIndex}`,
          text: compactText(turn.userTranscript, turn.assistantTranscript, turn.stateStatus),
          tags: compactArray(['turn', turn.stateStatus]),
          createdAt: turn.createdAt,
          forkSourceTurnId: mode === 'before' ? (turn.parentTurnId ?? turn.id) : turn.id
        });
      }

      const state = await store.getState(branch.id).catch(() => null);
      if (!state) continue;
      docs.push({
        id: `scene:${branch.id}`,
        kind: 'scene',
        repo,
        branch,
        label: 'Current scene',
        text: compactText(state.scene.summary, state.scene.locationId, state.scene.tone, state.scene.presentEntityIds.join(' ')),
        tags: compactArray(['scene', state.scene.tone]),
        createdAt: branch.updatedAt,
        forkSourceTurnId: branch.headTurnId ?? null
      });
      for (const entity of Object.values(state.entities)) {
        docs.push({
          id: `entity:${branch.id}:${entity.id}`,
          kind: 'entity',
          repo,
          branch,
          label: entity.name,
          text: compactText(entity.name, entity.kind, entity.status, stringify(entity.attributes)),
          tags: compactArray(['entity', entity.kind, entity.status]),
          createdAt: branch.updatedAt,
          forkSourceTurnId: branch.headTurnId ?? null
        });
      }
      for (const thread of state.threads) {
        docs.push({
          id: `thread:${branch.id}:${thread.threadId}`,
          kind: 'thread',
          repo,
          branch,
          label: thread.summary,
          text: compactText(thread.summary, thread.status, String(thread.priority ?? '')),
          tags: compactArray(['thread', thread.status, thread.priority ? `priority-${thread.priority}` : undefined]),
          createdAt: branch.updatedAt,
          forkSourceTurnId: branch.headTurnId ?? null
        });
      }
      for (const fact of state.facts) {
        docs.push({
          id: `fact:${branch.id}:${fact.subjectId}:${fact.predicate}`,
          kind: 'fact',
          repo,
          branch,
          label: `${fact.subjectId} · ${fact.predicate}`,
          text: compactText(fact.subjectId, fact.predicate, stringify(fact.value), fact.certainty, fact.knownBy?.join(' ')),
          tags: compactArray(['fact', fact.certainty, fact.predicate]),
          createdAt: branch.updatedAt,
          forkSourceTurnId: branch.headTurnId ?? null
        });
      }
    }
  }

  const results = docs
    .map(doc => rankDoc(doc, query, terms, mode))
    .filter((result): result is StorySearchResult => Boolean(result))
    .sort((a, b) => b.score - a.score || kindRank(a.kind) - kindRank(b.kind) || a.label.localeCompare(b.label))
    .slice(0, input.limit ?? 12);

  return { query, generatedAt: new Date().toISOString(), results };
}

export async function compareBranches(store: StoryStore, leftBranchId: string, rightBranchId: string): Promise<BranchCompareResponse> {
  const [leftBranch, rightBranch] = await Promise.all([store.getBranch(leftBranchId), store.getBranch(rightBranchId)]);
  if (!leftBranch) throw new StoreError(`branch not found: ${leftBranchId}`, 'not_found');
  if (!rightBranch) throw new StoreError(`branch not found: ${rightBranchId}`, 'not_found');
  if (leftBranch.repoId !== rightBranch.repoId) throw new StoreError('branches must belong to the same repo', 'invalid');

  const [leftTimeline, rightTimeline, leftState, rightState] = await Promise.all([
    store.getTimeline(leftBranch.id),
    store.getTimeline(rightBranch.id),
    store.getState(leftBranch.id),
    store.getState(rightBranch.id)
  ]);
  const rightIds = new Set(rightTimeline.map(turn => turn.id));
  const commonAncestor = [...leftTimeline].reverse().find(turn => rightIds.has(turn.id)) ?? null;
  const leftUnique = turnsAfter(leftTimeline, commonAncestor?.id ?? null);
  const rightUnique = turnsAfter(rightTimeline, commonAncestor?.id ?? null);

  return {
    generatedAt: new Date().toISOString(),
    repoId: leftBranch.repoId,
    commonAncestorTurnId: commonAncestor?.id ?? null,
    commonAncestorTurnIndex: commonAncestor?.turnIndex ?? null,
    left: compareSide(leftBranch, leftTimeline, leftUnique, leftState),
    right: compareSide(rightBranch, rightTimeline, rightUnique, rightState),
    stateDiff: diffStates(leftState, rightState)
  };
}

export async function buildCanonDebug(store: StoryStore, branchId: string): Promise<CanonDebugResponse> {
  const branch = await store.getBranch(branchId);
  if (!branch) throw new StoreError(`branch not found: ${branchId}`, 'not_found');
  const [timeline, state, audioAssets] = await Promise.all([
    store.getTimeline(branch.id),
    store.getState(branch.id),
    store.listAudioAssets(branch.repoId, branch.id).catch(() => [] as AudioAsset[])
  ]);
  const latest = timeline.at(-1) ?? null;
  const openThreads = state?.threads.filter(thread => thread.status === 'open' || thread.status === 'advanced') ?? [];
  return {
    generatedAt: new Date().toISOString(),
    branch,
    state,
    latestTurn: latest ? summarizeTurn(latest) : null,
    stats: {
      turns: timeline.length,
      entities: state ? Object.keys(state.entities).length : 0,
      facts: state?.facts.length ?? 0,
      threads: state?.threads.length ?? 0,
      openThreads: openThreads.length,
      resolvedThreads: state?.threads.filter(thread => thread.status === 'resolved').length ?? 0,
      audioAssets: audioAssets.length
    },
    openThreads,
    audioAssets
  };
}

function rankDoc(doc: SearchDoc, query: string, terms: string[], mode: StorySearchResult['rewindMode']): StorySearchResult | null {
  const normalizedQuery = normalize(query);
  const label = normalize(doc.label);
  const haystack = normalize(compactText(doc.label, doc.text, doc.tags.join(' ')));
  const matchedTerms = terms.filter(term => haystack.includes(term) || looseContains(haystack, term));
  let score = 0;
  if (normalizedQuery && haystack.includes(normalizedQuery)) score += 30;
  if (normalizedQuery && label.includes(normalizedQuery)) score += 12;
  for (const term of matchedTerms) {
    score += label.includes(term) ? 7 : 3;
    if (doc.tags.some(tag => normalize(tag).includes(term))) score += 2;
  }
  if (doc.kind === 'turn') score += 3;
  if (doc.kind === 'thread') score += 2;
  if (doc.turn?.stateStatus === 'canonized') score += 1;
  if (!score) return null;

  return {
    id: doc.id,
    kind: doc.kind,
    repoId: doc.repo.id,
    repoTitle: doc.repo.title,
    branchId: doc.branch?.id,
    branchName: doc.branch?.name,
    turnId: doc.turn?.id,
    turnIndex: doc.turn?.turnIndex,
    label: doc.label,
    excerpt: excerpt(doc.text, [normalizedQuery, ...matchedTerms].filter(Boolean)),
    score,
    matchedTerms: matchedTerms.slice(0, 8),
    rewindMode: mode,
    forkSourceTurnId: doc.forkSourceTurnId,
    forkLabel: doc.forkSourceTurnId ? (mode === 'before' ? 'Fork before this memory' : 'Fork from this memory') : undefined,
    createdAt: doc.createdAt ?? null
  };
}

function inferRewindMode(query: string): StorySearchResult['rewindMode'] {
  return /\b(before|prior|earlier|rewind|back to|take me back|pre-)\b/i.test(query) ? 'before' : 'at';
}

function expandedTerms(query: string): string[] {
  const terms = tokenize(query);
  const expanded = new Set<string>();
  for (const term of terms) {
    expanded.add(term);
    for (const value of TERM_EXPANSIONS[term] ?? []) expanded.add(normalize(value));
    if (term.endsWith('ed') && term.length > 4) expanded.add(term.slice(0, -2));
    if (term.endsWith('ing') && term.length > 5) expanded.add(term.slice(0, -3));
    if (term.endsWith('s') && term.length > 4) expanded.add(term.slice(0, -1));
  }
  return [...expanded].filter(Boolean);
}

function tokenize(query: string): string[] {
  return normalize(query)
    .split(/[^a-z0-9]+/)
    .filter(term => term.length > 1 && !STOPWORDS.has(term));
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function looseContains(haystack: string, term: string): boolean {
  if (term.length < 5) return false;
  const stem = term.slice(0, Math.max(4, term.length - 2));
  return haystack.split(/[^a-z0-9]+/).some(word => word.startsWith(stem));
}

function excerpt(text: string, needles: string[]): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const normalized = normalize(clean);
  const needle = needles.find(item => item && normalized.includes(item));
  if (!needle) return clip(clean, 240);
  const index = Math.max(0, normalized.indexOf(needle));
  const start = Math.max(0, index - 90);
  const end = Math.min(clean.length, index + needle.length + 150);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
}

function compareSide(branch: BranchRef, timeline: TurnCommit[], uniqueTurns: TurnCommit[], state: WorldState | null): BranchCompareSide {
  return {
    branch,
    totalTurns: timeline.length,
    uniqueTurns: uniqueTurns.map(summarizeTurn),
    headTurnId: branch.headTurnId ?? null,
    sceneSummary: state?.scene.summary ?? null
  };
}

function turnsAfter(timeline: TurnCommit[], turnId: string | null): TurnCommit[] {
  if (!turnId) return timeline;
  const index = timeline.findIndex(turn => turn.id === turnId);
  return index === -1 ? timeline : timeline.slice(index + 1);
}

function summarizeTurn(turn: TurnCommit): TimelineTurnSummary {
  return {
    id: turn.id,
    turnIndex: turn.turnIndex,
    userTranscript: turn.userTranscript,
    assistantTranscript: turn.assistantTranscript,
    stateStatus: turn.stateStatus,
    parentTurnId: turn.parentTurnId ?? null,
    createdAt: turn.createdAt
  };
}

function diffStates(left: WorldState | null, right: WorldState | null): BranchStateDiff {
  const leftEntities = left?.entities ?? {};
  const rightEntities = right?.entities ?? {};
  const leftEntityIds = Object.keys(leftEntities);
  const rightEntityIds = Object.keys(rightEntities);
  const commonEntityIds = leftEntityIds.filter(id => id in rightEntities);

  return {
    sceneChanged: stringify(left?.scene ?? null) !== stringify(right?.scene ?? null),
    leftScene: left?.scene,
    rightScene: right?.scene,
    entities: {
      leftOnly: leftEntityIds.filter(id => !(id in rightEntities)),
      rightOnly: rightEntityIds.filter(id => !(id in leftEntities)),
      changed: commonEntityIds
        .filter(id => stringify(leftEntities[id]) !== stringify(rightEntities[id]))
        .map(id => ({ id, left: leftEntities[id], right: rightEntities[id] }))
    },
    facts: diffByKey(left?.facts ?? [], right?.facts ?? [], factKey),
    threads: diffThreads(left?.threads ?? [], right?.threads ?? [])
  };
}

function diffByKey<T>(left: T[], right: T[], key: (item: T) => string): { leftOnly: T[]; rightOnly: T[] } {
  const leftMap = new Map(left.map(item => [key(item), item]));
  const rightMap = new Map(right.map(item => [key(item), item]));
  return {
    leftOnly: [...leftMap.entries()].filter(([itemKey]) => !rightMap.has(itemKey)).map(([, item]) => item),
    rightOnly: [...rightMap.entries()].filter(([itemKey]) => !leftMap.has(itemKey)).map(([, item]) => item)
  };
}

function diffThreads(left: ThreadPatch[], right: ThreadPatch[]): BranchStateDiff['threads'] {
  const leftMap = new Map(left.map(thread => [thread.threadId, thread]));
  const rightMap = new Map(right.map(thread => [thread.threadId, thread]));
  const common = [...leftMap.keys()].filter(id => rightMap.has(id));
  return {
    leftOnly: [...leftMap.entries()].filter(([id]) => !rightMap.has(id)).map(([, thread]) => thread),
    rightOnly: [...rightMap.entries()].filter(([id]) => !leftMap.has(id)).map(([, thread]) => thread),
    changed: common
      .filter(id => stringify(leftMap.get(id)) !== stringify(rightMap.get(id)))
      .map(id => ({ id, left: leftMap.get(id)!, right: rightMap.get(id)! }))
  };
}

function factKey(fact: FactPatch): string {
  return `${fact.subjectId}\u0000${fact.predicate}\u0000${stringify(fact.value)}\u0000${fact.certainty}`;
}

function kindRank(kind: StorySearchResult['kind']): number {
  const ranks: Record<StorySearchResult['kind'], number> = {
    turn: 0,
    thread: 1,
    scene: 2,
    entity: 3,
    fact: 4,
    branch: 5,
    repo: 6
  };
  return ranks[kind];
}

function compactText(...values: Array<string | null | undefined>): string {
  return values.map(value => value?.trim() ?? '').filter(Boolean).join(' · ');
}

function compactArray(values: Array<string | null | undefined>): string[] {
  return values.map(value => value?.trim() ?? '').filter(Boolean);
}

function clip(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
