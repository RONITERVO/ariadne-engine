import type { BranchRef, FactPatch, StoryRepo, ThreadPatch, TurnCommit, WorldState } from '../domain/types.js';
import type { StoryStore } from '../storage/storyStore.js';

export type StoryMapNodeKind = 'library' | 'repo' | 'branch' | 'turn' | 'scene' | 'entity' | 'thread' | 'fact';
export type StoryMapLinkKind = 'contains' | 'timeline' | 'head' | 'fork' | 'state' | 'present' | 'mentions';

export interface StoryMapNode {
  id: string;
  kind: StoryMapNodeKind;
  label: string;
  summary?: string;
  parentId?: string | null;
  repoId?: string | null;
  branchId?: string | null;
  turnId?: string | null;
  weight: number;
  tags: string[];
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  meta?: Record<string, string | number | boolean | null>;
}

export interface StoryMapLink {
  id: string;
  source: string;
  target: string;
  kind: StoryMapLinkKind;
  weight: number;
}

export interface StoryMapRepoSummary {
  id: string;
  title: string;
  branchCount: number;
  turnCount: number;
  entityCount: number;
  threadCount: number;
  updatedAt: string;
}

export interface StoryMapStats {
  repos: number;
  branches: number;
  turns: number;
  entities: number;
  threads: number;
  facts: number;
  warnings: number;
  nodes: number;
  links: number;
}

export interface StoryMapResponse {
  generatedAt: string;
  rootId: string;
  nodes: StoryMapNode[];
  links: StoryMapLink[];
  repos: StoryMapRepoSummary[];
  stats: StoryMapStats;
  warnings: string[];
}

const ROOT_ID = 'library:ariadne';
const MAX_REPOS = 80;
const MAX_BRANCHES_PER_REPO = 80;
const MAX_TURNS_PER_BRANCH = 320;
const MAX_ENTITIES_PER_BRANCH = 80;
const MAX_THREADS_PER_BRANCH = 50;
const MAX_FACTS_PER_BRANCH = 40;

export async function buildStoryMap(store: StoryStore, ownerUserId?: string): Promise<StoryMapResponse> {
  const builder = new StoryMapBuilder();
  builder.upsertNode({
    id: ROOT_ID,
    kind: 'library',
    label: 'Story Library',
    summary: 'Every saved story repo, branch, timeline turn, and current world-state landmark.',
    weight: 8,
    tags: ['library', 'galaxy'],
    meta: { owner: ownerUserId ?? 'local-dev-or-public' }
  });

  const allRepos = await store.listRepos(ownerUserId);
  const repos = allRepos.slice(0, MAX_REPOS);
  if (allRepos.length > repos.length) {
    builder.warn(`Atlas is showing ${repos.length} of ${allRepos.length} repos. Add pagination before increasing this cap.`);
  }

  const repoSummaries: StoryMapRepoSummary[] = [];
  for (const repo of repos) {
    const summary = await addRepoToMap(builder, store, repo);
    repoSummaries.push(summary);
  }

  const nodes = builder.nodes();
  const links = builder.links();
  const stats: StoryMapStats = {
    repos: repoSummaries.length,
    branches: nodes.filter(node => node.kind === 'branch').length,
    turns: nodes.filter(node => node.kind === 'turn').length,
    entities: nodes.filter(node => node.kind === 'entity').length,
    threads: nodes.filter(node => node.kind === 'thread').length,
    facts: nodes.filter(node => node.kind === 'fact').length,
    warnings: builder.warningCount(),
    nodes: nodes.length,
    links: links.length
  };

  return {
    generatedAt: new Date().toISOString(),
    rootId: ROOT_ID,
    nodes,
    links,
    repos: repoSummaries,
    stats,
    warnings: builder.warnings()
  };
}

async function addRepoToMap(builder: StoryMapBuilder, store: StoryStore, repo: StoryRepo): Promise<StoryMapRepoSummary> {
  const repoNodeId = repoNodeIdFrom(repo.id);
  builder.upsertNode({
    id: repoNodeId,
    kind: 'repo',
    label: repo.title || shortId(repo.id),
    summary: compact([repo.description ?? '', repo.defaultStyle ?? '']).join(' · ') || 'Story world',
    parentId: ROOT_ID,
    repoId: repo.id,
    weight: 5,
    tags: compact(['repo', repo.defaultStyle ?? '', repo.safetyProfile ?? '']),
    status: repo.safetyProfile ?? null,
    createdAt: repo.createdAt,
    updatedAt: repo.updatedAt,
    meta: {
      repoId: repo.id,
      style: repo.defaultStyle ?? null,
      safety: repo.safetyProfile ?? null
    }
  });
  builder.link(ROOT_ID, repoNodeId, 'contains', 3);

  const allBranches = await store.listBranches(repo.id);
  const branches = allBranches.slice(0, MAX_BRANCHES_PER_REPO);
  if (allBranches.length > branches.length) {
    builder.warn(`${repo.title || shortId(repo.id)}: showing ${branches.length} of ${allBranches.length} branches.`);
  }

  let repoTurnCount = 0;
  let repoEntityCount = 0;
  let repoThreadCount = 0;
  for (const branch of branches) {
    const branchCounts = await addBranchToMap(builder, store, repo, branch);
    repoTurnCount += branchCounts.turns;
    repoEntityCount += branchCounts.entities;
    repoThreadCount += branchCounts.threads;
  }

  return {
    id: repo.id,
    title: repo.title,
    branchCount: branches.length,
    turnCount: repoTurnCount,
    entityCount: repoEntityCount,
    threadCount: repoThreadCount,
    updatedAt: repo.updatedAt
  };
}

async function addBranchToMap(
  builder: StoryMapBuilder,
  store: StoryStore,
  repo: StoryRepo,
  branch: BranchRef
): Promise<{ turns: number; entities: number; threads: number }> {
  const repoNodeId = repoNodeIdFrom(repo.id);
  const branchNodeId = branchNodeIdFrom(branch.id);
  builder.upsertNode({
    id: branchNodeId,
    kind: 'branch',
    label: branch.name || shortId(branch.id),
    summary: branch.forkedFromTurnId ? `Forked from turn ${shortId(branch.forkedFromTurnId)}.` : 'Mainline branch.',
    parentId: repoNodeId,
    repoId: repo.id,
    branchId: branch.id,
    weight: branch.headTurnId ? 3.2 : 2.4,
    tags: compact(['branch', branch.headTurnId ? 'has head' : 'empty', branch.forkedFromTurnId ? 'fork' : 'root']),
    status: branch.headTurnId ? 'active' : 'empty',
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
    meta: {
      branchId: branch.id,
      headTurnId: branch.headTurnId ?? null,
      forkedFromTurnId: branch.forkedFromTurnId ?? null
    }
  });
  builder.link(repoNodeId, branchNodeId, 'contains', 2);

  let timeline: TurnCommit[] = [];
  try {
    timeline = (await store.getTimeline(branch.id)).slice(-MAX_TURNS_PER_BRANCH);
  } catch (error) {
    builder.warn(`${repo.title}/${branch.name}: timeline unavailable: ${messageFrom(error)}`);
  }

  if (branch.forkedFromTurnId) {
    builder.link(turnNodeIdFrom(branch.forkedFromTurnId), branchNodeId, 'fork', 2.2);
  }

  for (const turn of timeline) addTurnToMap(builder, branch, turn);
  if (branch.headTurnId) builder.link(branchNodeId, turnNodeIdFrom(branch.headTurnId), 'head', 2.8);

  let entityCount = 0;
  let threadCount = 0;
  try {
    const state = await store.getState(branch.id);
    if (state) {
      const counts = addStateToMap(builder, branch, state);
      entityCount = counts.entities;
      threadCount = counts.threads;
    }
  } catch (error) {
    builder.warn(`${repo.title}/${branch.name}: world state unavailable: ${messageFrom(error)}`);
  }

  return { turns: timeline.length, entities: entityCount, threads: threadCount };
}

function addTurnToMap(builder: StoryMapBuilder, branch: BranchRef, turn: TurnCommit): void {
  const nodeId = turnNodeIdFrom(turn.id);
  const transcript = compact([turn.userTranscript, turn.assistantTranscript]).join(' → ');
  builder.upsertNode({
    id: nodeId,
    kind: 'turn',
    label: `Turn ${turn.turnIndex}`,
    summary: clip(transcript, 260),
    repoId: turn.repoId,
    branchId: turn.branchId,
    turnId: turn.id,
    weight: turn.id === branch.headTurnId ? 2.3 : 1.5,
    tags: compact(['turn', turn.stateStatus, turn.id === branch.headTurnId ? 'head' : '']),
    status: turn.stateStatus,
    createdAt: turn.createdAt,
    updatedAt: turn.committedAt ?? turn.createdAt,
    meta: {
      turnId: turn.id,
      turnIndex: turn.turnIndex,
      parentTurnId: turn.parentTurnId ?? null,
      user: clip(turn.userTranscript, 140),
      assistant: clip(turn.assistantTranscript, 140)
    }
  });

  if (turn.parentTurnId) {
    builder.link(turnNodeIdFrom(turn.parentTurnId), nodeId, 'timeline', 1.4);
  } else {
    builder.link(branchNodeIdFrom(branch.id), nodeId, 'timeline', 1.4);
  }
}

function addStateToMap(builder: StoryMapBuilder, branch: BranchRef, state: WorldState): { entities: number; threads: number } {
  const branchNodeId = branchNodeIdFrom(branch.id);
  const scene = state.scene;
  const sceneNodeId = `scene:${branch.id}`;
  builder.upsertNode({
    id: sceneNodeId,
    kind: 'scene',
    label: scene.summary ? 'Current scene' : 'Scene',
    summary: scene.summary || 'No current scene summary recorded.',
    parentId: branchNodeId,
    repoId: branch.repoId,
    branchId: branch.id,
    turnId: state.headTurnId === 'root' ? null : state.headTurnId,
    weight: 2.7,
    tags: compact(['scene', scene.tone ?? '', scene.locationId ? `location:${shortId(scene.locationId)}` : '']),
    status: scene.tone ?? null,
    meta: {
      locationId: scene.locationId,
      present: scene.presentEntityIds.length,
      tone: scene.tone ?? null
    }
  });
  builder.link(branchNodeId, sceneNodeId, 'state', 2.2);

  const present = new Set(scene.presentEntityIds);
  const entities = Object.values(state.entities)
    .sort((a, b) => entityRank(a.kind) - entityRank(b.kind) || a.name.localeCompare(b.name))
    .slice(0, MAX_ENTITIES_PER_BRANCH);
  if (Object.keys(state.entities).length > entities.length) {
    builder.warn(`${branch.name}: showing ${entities.length} of ${Object.keys(state.entities).length} entities.`);
  }

  for (const entity of entities) {
    const entityNodeId = entityNodeIdFrom(branch.id, entity.id);
    const isPresent = present.has(entity.id);
    builder.upsertNode({
      id: entityNodeId,
      kind: 'entity',
      label: entity.name || shortId(entity.id),
      summary: compact([entity.kind, entity.status, valueToShortText(entity.attributes)]).join(' · '),
      parentId: isPresent ? sceneNodeId : branchNodeId,
      repoId: branch.repoId,
      branchId: branch.id,
      weight: isPresent ? 2.4 : 1.8,
      tags: compact(['entity', entity.kind, entity.status, isPresent ? 'present' : 'known']),
      status: entity.status,
      meta: {
        entityId: entity.id,
        kind: entity.kind,
        status: entity.status,
        present: isPresent,
        attributes: valueToShortText(entity.attributes)
      }
    });
    builder.link(isPresent ? sceneNodeId : branchNodeId, entityNodeId, isPresent ? 'present' : 'state', isPresent ? 1.8 : 1.1);
  }

  const threads = state.threads.slice(0, MAX_THREADS_PER_BRANCH);
  if (state.threads.length > threads.length) {
    builder.warn(`${branch.name}: showing ${threads.length} of ${state.threads.length} threads.`);
  }
  for (const thread of threads) addThreadToMap(builder, branch, branchNodeId, thread);

  const facts = state.facts.slice(0, MAX_FACTS_PER_BRANCH);
  if (state.facts.length > facts.length) {
    builder.warn(`${branch.name}: showing ${facts.length} of ${state.facts.length} facts.`);
  }
  for (const fact of facts) addFactToMap(builder, branch, branchNodeId, fact);

  return { entities: entities.length, threads: threads.length };
}

function addThreadToMap(builder: StoryMapBuilder, branch: BranchRef, branchNodeId: string, thread: ThreadPatch): void {
  const nodeId = `thread:${branch.id}:${safeId(thread.threadId)}`;
  builder.upsertNode({
    id: nodeId,
    kind: 'thread',
    label: thread.summary || shortId(thread.threadId),
    summary: thread.summary,
    parentId: branchNodeId,
    repoId: branch.repoId,
    branchId: branch.id,
    weight: 1.6 + (thread.priority ?? 1) / 4,
    tags: compact(['thread', thread.status, thread.priority ? `priority ${thread.priority}` : '']),
    status: thread.status,
    meta: {
      threadId: thread.threadId,
      status: thread.status,
      priority: thread.priority ?? null
    }
  });
  builder.link(branchNodeId, nodeId, 'state', 1.1);
}

function addFactToMap(builder: StoryMapBuilder, branch: BranchRef, branchNodeId: string, fact: FactPatch): void {
  const nodeId = `fact:${branch.id}:${safeId(fact.subjectId)}:${safeId(fact.predicate)}`;
  builder.upsertNode({
    id: nodeId,
    kind: 'fact',
    label: `${shortId(fact.subjectId)} · ${fact.predicate}`,
    summary: valueToShortText(fact.value),
    parentId: branchNodeId,
    repoId: branch.repoId,
    branchId: branch.id,
    weight: 1.1,
    tags: compact(['fact', fact.certainty, fact.predicate]),
    status: fact.certainty,
    meta: {
      subjectId: fact.subjectId,
      predicate: fact.predicate,
      value: valueToShortText(fact.value),
      certainty: fact.certainty
    }
  });
  builder.link(branchNodeId, nodeId, 'mentions', 0.8);
}

class StoryMapBuilder {
  private readonly nodeMap = new Map<string, StoryMapNode>();
  private readonly linkMap = new Map<string, StoryMapLink>();
  private readonly warningMessages: string[] = [];

  upsertNode(node: StoryMapNode): void {
    const existing = this.nodeMap.get(node.id);
    if (!existing) {
      this.nodeMap.set(node.id, normalizeNode(node));
      return;
    }
    this.nodeMap.set(node.id, {
      ...existing,
      ...normalizeNode(node),
      weight: Math.max(existing.weight, node.weight),
      tags: unique([...existing.tags, ...node.tags]),
      meta: { ...(existing.meta ?? {}), ...(node.meta ?? {}) }
    });
  }

  link(source: string, target: string, kind: StoryMapLinkKind, weight: number): void {
    if (!source || !target || source === target) return;
    const id = `${kind}:${source}->${target}`;
    if (this.linkMap.has(id)) return;
    this.linkMap.set(id, { id, source, target, kind, weight });
  }

  warn(message: string): void {
    if (!this.warningMessages.includes(message)) this.warningMessages.push(message);
  }

  warnings(): string[] {
    return [...this.warningMessages];
  }

  warningCount(): number {
    return this.warningMessages.length;
  }

  nodes(): StoryMapNode[] {
    return [...this.nodeMap.values()].sort((a, b) => nodeSortScore(a) - nodeSortScore(b) || a.label.localeCompare(b.label));
  }

  links(): StoryMapLink[] {
    return [...this.linkMap.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  }
}

function normalizeNode(node: StoryMapNode): StoryMapNode {
  return {
    ...node,
    label: clip(node.label || node.kind, 120),
    summary: node.summary ? clip(node.summary, 600) : undefined,
    tags: unique(node.tags.map(tag => clip(tag, 48)).filter(Boolean)).slice(0, 12),
    weight: Math.max(0.8, Math.min(10, node.weight))
  };
}

function nodeSortScore(node: StoryMapNode): number {
  const order: Record<StoryMapNodeKind, number> = {
    library: 0,
    repo: 1,
    branch: 2,
    turn: 3,
    scene: 4,
    entity: 5,
    thread: 6,
    fact: 7
  };
  return order[node.kind];
}

function repoNodeIdFrom(repoId: string): string {
  return `repo:${repoId}`;
}

function branchNodeIdFrom(branchId: string): string {
  return `branch:${branchId}`;
}

function turnNodeIdFrom(turnId: string): string {
  return `turn:${turnId}`;
}

function entityNodeIdFrom(branchId: string, entityId: string): string {
  return `entity:${branchId}:${safeId(entityId)}`;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 96) || 'item';
}

function entityRank(kind: string): number {
  const ranks: Record<string, number> = {
    player: 0,
    location: 1,
    character: 2,
    faction: 3,
    item: 4,
    concept: 5
  };
  return ranks[kind] ?? 9;
}

function compact(values: Array<string | null | undefined | false>): string[] {
  return values.map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function clip(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function valueToShortText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return clip(value, 180);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return clip(JSON.stringify(value), 180);
  } catch {
    return clip(String(value), 180);
  }
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message);
  return String(error);
}
