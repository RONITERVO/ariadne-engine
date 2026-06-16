import type { WorldState } from './types.js';

export function createInitialWorldState(
  branchId: string,
  options: { headTurnId?: string; tone?: string; style?: string } = {}
): WorldState {
  const locationId = 'location:opening_scene';
  const playerId = 'player';

  return {
    branchId,
    headTurnId: options.headTurnId ?? 'root',
    scene: {
      locationId,
      summary:
        'The story is ready to begin. The narrator should establish the first scene from the user\'s opening action.',
      presentEntityIds: [playerId],
      tone: options.tone ?? options.style ?? 'cinematic interactive fantasy'
    },
    entities: {
      [playerId]: {
        id: playerId,
        kind: 'player',
        name: 'The player',
        status: 'active',
        attributes: {}
      },
      [locationId]: {
        id: locationId,
        kind: 'location',
        name: 'Opening scene',
        status: 'available',
        attributes: {}
      }
    },
    facts: [],
    threads: []
  };
}
