import type { Pool, PoolClient } from 'pg';
import { createInitialWorldState } from '../domain/initialState.js';
import { sha256Json } from '../domain/stateHash.js';
import type { BranchRef, CreateRepoInput, ForkBranchInput, StoryRepo, TurnCommit, WorldState } from '../domain/types.js';
import type { ApplyCanonPatchInput, CommitTurnInput, CreateRepoResult, StoryStore } from './storyStore.js';
import { StoreError } from './storyStore.js';

export async function createPostgresStoryStore(connectionString: string): Promise<PostgresStoryStore> {
  const pg = await import('pg');
  const pool = new pg.Pool({ connectionString });
  return new PostgresStoryStore(pool);
}

export class PostgresStoryStore implements StoryStore {
  constructor(private readonly pool: Pool) {}

  async createRepo(input: CreateRepoInput): Promise<CreateRepoResult> {
    return this.tx(async client => {
      const repoRow = await one(
        client,
        `INSERT INTO story_repos (owner_user_id, title, description, default_style, safety_profile)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [input.ownerUserId ?? null, input.title, input.description ?? null, input.defaultStyle ?? null, input.safetyProfile ?? 'general']
      );

      const branchRow = await one(
        client,
        `INSERT INTO branches (repo_id, name)
         VALUES ($1, 'main')
         RETURNING *`,
        [repoRow.id]
      );

      const state = createInitialWorldState(String(branchRow.id), { style: input.defaultStyle });
      await client.query(
        `INSERT INTO branch_current_states (repo_id, branch_id, head_turn_id, state_json, state_hash)
         VALUES ($1, $2, NULL, $3, $4)`,
        [repoRow.id, branchRow.id, state, sha256Json(state)]
      );

      return {
        repo: mapRepo(repoRow),
        branch: mapBranch(branchRow),
        state
      };
    });
  }

  async getRepo(repoId: string): Promise<StoryRepo | null> {
    const result = await this.pool.query('SELECT * FROM story_repos WHERE id = $1', [repoId]);
    return result.rowCount ? mapRepo(result.rows[0]) : null;
  }

  async listRepos(ownerUserId?: string): Promise<StoryRepo[]> {
    const result = ownerUserId === undefined
      ? await this.pool.query('SELECT * FROM story_repos ORDER BY created_at ASC')
      : await this.pool.query('SELECT * FROM story_repos WHERE owner_user_id = $1 ORDER BY created_at ASC', [ownerUserId]);
    return result.rows.map(mapRepo);
  }

  async getBranch(branchId: string): Promise<BranchRef | null> {
    const result = await this.pool.query('SELECT * FROM branches WHERE id = $1', [branchId]);
    return result.rowCount ? mapBranch(result.rows[0]) : null;
  }

  async listBranches(repoId: string): Promise<BranchRef[]> {
    const result = await this.pool.query('SELECT * FROM branches WHERE repo_id = $1 ORDER BY created_at ASC', [repoId]);
    return result.rows.map(mapBranch);
  }

  async forkBranch(input: ForkBranchInput): Promise<{ branch: BranchRef; state: WorldState }> {
    return this.tx(async client => {
      const repo = await maybeOne(client, 'SELECT * FROM story_repos WHERE id = $1', [input.repoId]);
      if (!repo) throw new StoreError(`repo not found: ${input.repoId}`, 'not_found');

      const duplicate = await maybeOne(client, 'SELECT id FROM branches WHERE repo_id = $1 AND name = $2', [input.repoId, input.name]);
      if (duplicate) throw new StoreError(`branch already exists: ${input.name}`, 'conflict');

      let state: WorldState;
      if (input.sourceTurnId) {
        const snapshot = await maybeOne(
          client,
          'SELECT state_json FROM branch_snapshots WHERE turn_id = $1 ORDER BY created_at DESC LIMIT 1',
          [input.sourceTurnId]
        );
        if (!snapshot) {
          throw new StoreError(
            `cannot fork from ${input.sourceTurnId}; no compiled state snapshot exists for that turn`,
            'not_found'
          );
        }
        state = snapshot.state_json as WorldState;
      } else {
        state = createInitialWorldState('pending', { style: typeof repo.default_style === 'string' ? repo.default_style : undefined });
      }

      const branchRow = await one(
        client,
        `INSERT INTO branches (repo_id, name, head_turn_id, forked_from_turn_id)
         VALUES ($1, $2, $3, $3)
         RETURNING *`,
        [input.repoId, input.name, input.sourceTurnId ?? null]
      );

      state = structuredClone(state);
      state.branchId = String(branchRow.id);
      state.headTurnId = input.sourceTurnId ?? 'root';

      await client.query(
        `INSERT INTO branch_current_states (repo_id, branch_id, head_turn_id, state_json, state_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.repoId, branchRow.id, input.sourceTurnId ?? null, state, sha256Json(state)]
      );

      return { branch: mapBranch(branchRow), state };
    });
  }

  async commitTurn(input: CommitTurnInput): Promise<TurnCommit> {
    return this.tx(async client => {
      const branch = await maybeOne(client, 'SELECT * FROM branches WHERE id = $1 FOR UPDATE', [input.branchId]);
      if (!branch) throw new StoreError(`branch not found: ${input.branchId}`, 'not_found');
      if (branch.repo_id !== input.repoId) throw new StoreError('branch does not belong to repo', 'invalid');

      const parentTurnId = branch.head_turn_id as string | null;
      const parent = parentTurnId ? await maybeOne(client, 'SELECT turn_index FROM turns WHERE id = $1', [parentTurnId]) : null;
      const turnIndex = parent ? Number(parent.turn_index) + 1 : 1;

      const turnRow = await one(
        client,
        `INSERT INTO turns (
           repo_id,
           branch_id,
           parent_turn_id,
           turn_index,
           user_audio_asset_id,
           assistant_audio_asset_id,
           user_transcript,
           assistant_transcript,
           state_status,
           committed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', now())
         RETURNING *`,
        [
          input.repoId,
          input.branchId,
          parentTurnId,
          turnIndex,
          input.userAudioAssetId ?? null,
          input.assistantAudioAssetId ?? null,
          input.userTranscript,
          input.assistantTranscript
        ]
      );

      await client.query('UPDATE branches SET head_turn_id = $1, updated_at = now() WHERE id = $2', [turnRow.id, input.branchId]);
      await client.query('UPDATE story_repos SET updated_at = now() WHERE id = $1', [input.repoId]);

      for (const metadata of input.modelMetadata ?? []) {
        await client.query(
          `INSERT INTO model_invocations (
             turn_id, purpose, provider, model, prompt_version, context_hash, request_hash, usage_json, started_at, completed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()), COALESCE($10, now()))`,
          [
            turnRow.id,
            metadata.purpose,
            metadata.provider,
            metadata.model,
            metadata.promptVersion ?? null,
            metadata.contextHash ?? null,
            metadata.requestHash ?? null,
            metadata.usage ?? null,
            metadata.startedAt ?? null,
            metadata.completedAt ?? null
          ]
        );
      }

      return mapTurn(turnRow, input.modelMetadata ?? []);
    });
  }

  async getTimeline(branchId: string): Promise<TurnCommit[]> {
    const branch = await this.getBranch(branchId);
    if (!branch) throw new StoreError(`branch not found: ${branchId}`, 'not_found');
    if (!branch.headTurnId) return [];

    const result = await this.pool.query(
      `WITH RECURSIVE timeline AS (
         SELECT t.*, 0 AS depth
         FROM turns t
         WHERE t.id = $1
         UNION ALL
         SELECT p.*, timeline.depth + 1 AS depth
         FROM turns p
         JOIN timeline ON timeline.parent_turn_id = p.id
       )
       SELECT * FROM timeline ORDER BY turn_index ASC, created_at ASC`,
      [branch.headTurnId]
    );
    return result.rows.map(row => mapTurn(row));
  }

  async getState(branchId: string): Promise<WorldState | null> {
    const result = await this.pool.query('SELECT state_json FROM branch_current_states WHERE branch_id = $1', [branchId]);
    return result.rowCount ? (result.rows[0].state_json as WorldState) : null;
  }

  async applyCanonPatch(input: ApplyCanonPatchInput): Promise<void> {
    await this.tx(async client => {
      const stateHash = sha256Json(input.state);
      const status = input.patch.warnings.some(w => w.severity === 'high') ? 'needs_review' : 'canonized';

      await client.query(
        `INSERT INTO event_patches (repo_id, branch_id, turn_id, patch_json, status, applied_at)
         VALUES ($1, $2, $3, $4, 'applied', now())`,
        [input.repoId, input.branchId, input.turnId, input.patch]
      );

      await client.query(
        `INSERT INTO branch_snapshots (repo_id, branch_id, turn_id, state_json, state_hash)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (branch_id, turn_id) DO UPDATE SET state_json = EXCLUDED.state_json, state_hash = EXCLUDED.state_hash`,
        [input.repoId, input.branchId, input.turnId, input.state, stateHash]
      );

      await client.query(
        `UPDATE branch_current_states
         SET head_turn_id = $1, state_json = $2, state_hash = $3, updated_at = now()
         WHERE branch_id = $4`,
        [input.turnId, input.state, stateHash, input.branchId]
      );

      await client.query('UPDATE turns SET state_status = $1 WHERE id = $2', [status, input.turnId]);

      for (const metadata of input.modelMetadata ?? []) {
        await client.query(
          `INSERT INTO model_invocations (
             turn_id, purpose, provider, model, prompt_version, context_hash, request_hash, usage_json, started_at, completed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()), COALESCE($10, now()))`,
          [
            input.turnId,
            metadata.purpose,
            metadata.provider,
            metadata.model,
            metadata.promptVersion ?? null,
            metadata.contextHash ?? null,
            metadata.requestHash ?? null,
            metadata.usage ?? null,
            metadata.startedAt ?? null,
            metadata.completedAt ?? null
          ]
        );
      }

      for (const warning of input.patch.warnings) {
        await client.query(
          `INSERT INTO continuity_warnings (repo_id, branch_id, turn_id, severity, warning_type, message, repair_strategy)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            input.repoId,
            input.branchId,
            input.turnId,
            warning.severity,
            warning.type,
            warning.message,
            warning.repairStrategy ?? null
          ]
        );
      }
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function one(client: Pool | PoolClient, query: string, params: unknown[]): Promise<Record<string, unknown>> {
  const result = await client.query(query, params);
  if (!result.rowCount) throw new StoreError('expected one row, got none', 'not_found');
  return result.rows[0] as Record<string, unknown>;
}

async function maybeOne(client: Pool | PoolClient, query: string, params: unknown[]): Promise<Record<string, unknown> | null> {
  const result = await client.query(query, params);
  return result.rowCount ? (result.rows[0] as Record<string, unknown>) : null;
}

function mapRepo(row: Record<string, unknown>): StoryRepo {
  return {
    id: String(row.id),
    ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    defaultStyle: row.default_style ? String(row.default_style) : null,
    safetyProfile: row.safety_profile ? String(row.safety_profile) : 'general',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapBranch(row: Record<string, unknown>): BranchRef {
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    name: String(row.name),
    headTurnId: row.head_turn_id ? String(row.head_turn_id) : null,
    forkedFromTurnId: row.forked_from_turn_id ? String(row.forked_from_turn_id) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapTurn(row: Record<string, unknown>, metadata = [] as TurnCommit['modelMetadata']): TurnCommit {
  return {
    id: String(row.id),
    repoId: String(row.repo_id),
    branchId: String(row.branch_id),
    parentTurnId: row.parent_turn_id ? String(row.parent_turn_id) : null,
    turnIndex: Number(row.turn_index),
    userAudioAssetId: row.user_audio_asset_id ? String(row.user_audio_asset_id) : null,
    assistantAudioAssetId: row.assistant_audio_asset_id ? String(row.assistant_audio_asset_id) : null,
    userTranscript: String(row.user_transcript ?? ''),
    assistantTranscript: String(row.assistant_transcript ?? ''),
    stateStatus: String(row.state_status) as TurnCommit['stateStatus'],
    modelMetadata: metadata,
    createdAt: toIso(row.created_at),
    committedAt: row.committed_at ? toIso(row.committed_at) : null
  };
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  return new Date().toISOString();
}
