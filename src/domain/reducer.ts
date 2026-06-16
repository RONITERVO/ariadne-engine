import type { EntityState, FactPatch, StoryEventPatch, ThreadPatch, WorldState } from './types.js';

export interface ReduceResult {
  state: WorldState;
  warnings: string[];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function ensureEntity(next: WorldState, id: string, fallback: Partial<EntityState> = {}): EntityState {
  const existing = next.entities[id];
  if (existing) return existing;

  const entity: EntityState = {
    id,
    kind: fallback.kind ?? 'concept',
    name: fallback.name ?? id.replace(/^[a-z]+:/, '').replaceAll('_', ' '),
    status: fallback.status ?? 'active',
    attributes: fallback.attributes ?? {}
  };
  next.entities[id] = entity;
  return entity;
}

function applyFactToEntity(next: WorldState, fact: FactPatch): void {
  const entity = next.entities[fact.subjectId];
  if (!entity) return;

  if (fact.predicate === 'name' && typeof fact.value === 'string') {
    entity.name = fact.value;
    return;
  }
  if (fact.predicate === 'status' && typeof fact.value === 'string') {
    entity.status = fact.value;
    return;
  }
  entity.attributes[fact.predicate] = fact.value;
}

function upsertThread(threads: ThreadPatch[], thread: ThreadPatch): void {
  const existingIndex = threads.findIndex(t => t.threadId === thread.threadId);
  if (existingIndex >= 0) {
    threads[existingIndex] = { ...threads[existingIndex], ...thread };
  } else {
    threads.push(thread);
  }
}

export function reducePatch(previous: WorldState, patch: StoryEventPatch): ReduceResult {
  const next: WorldState = structuredClone(previous);
  next.headTurnId = patch.turnId;

  const warnings: string[] = [];

  for (const event of patch.events) {
    for (const id of event.participants) {
      ensureEntity(next, id);
    }

    if (event.eventType === 'PLAYER_MOVED') {
      const toLocationId = asString(event.metadata?.toLocationId ?? event.locationId);
      if (toLocationId) {
        ensureEntity(next, toLocationId, { kind: 'location', status: 'known' });
        next.scene.locationId = toLocationId;
        const sceneSummary = asString(event.metadata?.sceneSummary);
        if (sceneSummary) next.scene.summary = sceneSummary;
      } else {
        warnings.push(`PLAYER_MOVED event missing metadata.toLocationId: ${event.summary}`);
      }
    }

    if (event.eventType === 'CHARACTER_APPEARED') {
      for (const id of event.participants.filter(id => id !== 'player')) {
        ensureEntity(next, id, { kind: 'character', status: 'present' });
        if (!next.scene.presentEntityIds.includes(id)) {
          next.scene.presentEntityIds.push(id);
        }
      }
    }

    if (event.eventType === 'CHARACTER_LEFT') {
      next.scene.presentEntityIds = next.scene.presentEntityIds.filter(
        id => !event.participants.includes(id) || id === 'player'
      );
    }

    if (event.eventType === 'THREAD_OPENED') {
      const threadId = asString(event.metadata?.threadId) ?? `thread:${slugify(event.summary).slice(0, 64)}`;
      upsertThread(next.threads, {
        threadId,
        status: 'open',
        summary: event.summary,
        priority: clampPriority(event.metadata?.priority)
      });
    }

    if (event.eventType === 'THREAD_RESOLVED') {
      const threadId = asString(event.metadata?.threadId);
      if (threadId) {
        upsertThread(next.threads, { threadId, status: 'resolved', summary: event.summary });
      }
    }

    const sceneSummary = asString(event.metadata?.sceneSummary);
    if (sceneSummary) next.scene.summary = sceneSummary;
  }

  for (const fact of patch.facts) {
    const existingIndex = next.facts.findIndex(
      f => f.subjectId === fact.subjectId && f.predicate === fact.predicate
    );

    if (existingIndex >= 0) {
      next.facts[existingIndex] = fact;
    } else {
      next.facts.push(fact);
    }

    applyFactToEntity(next, fact);
  }

  for (const thread of patch.threads) {
    upsertThread(next.threads, thread);
  }

  for (const warning of patch.warnings) {
    warnings.push(`${warning.severity}: ${warning.type}: ${warning.message}`);
  }

  return { state: next, warnings };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'event';
}

function clampPriority(value: unknown): 1 | 2 | 3 | 4 | 5 | undefined {
  if (typeof value !== 'number') return undefined;
  const rounded = Math.round(value);
  if (rounded < 1) return 1;
  if (rounded > 5) return 5;
  return rounded as 1 | 2 | 3 | 4 | 5;
}
