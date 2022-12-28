import Express from 'express'
const router = Express.Router()
import { wrap } from './wrap'

wrap(router, 'get', '/api/v1.1/player/tokens', false, (req, res, session, player) => {
  // TODO: figure out what tokens are
  return {
    tokens: {}
  }
})

wrap(router, 'get', '/api/v1.1/player/profile/:userId', false, (req, res, session, player) => {
  // TODO: must we enforce only being able to look up your own profile?
  return {
    levelDistribution: {
      2: {
        experienceRequired: 500,
        rewards: {
          inventory: [
            {
              id: '730573d1-ba59-4fd4-89e0-85d4647466c2',
              amount: 1
            },
            {
              id: '20dbd5fc-06b7-1aa1-5943-7ddaa2061e6a',
              amount: 8
            },
            {
              id: '1eaa0d8c-2d89-2b84-aa1f-b75ccc85faff',
              amount: 64
            }
          ],
          rubies: 15,
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      3: {
        experienceRequired: 1500,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      4: {
        experienceRequired: 2800,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      5: {
        experienceRequired: 4600,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      6: {
        experienceRequired: 6100,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      7: {
        experienceRequired: 7800,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      8: {
        experienceRequired: 10100,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      9: {
        experienceRequired: 13300,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      10: {
        experienceRequired: 17800,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      11: {
        experienceRequired: 21400,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      12: {
        experienceRequired: 25700,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      13: {
        experienceRequired: 31300,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      14: {
        experienceRequired: 39100,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      15: {
        experienceRequired: 50000,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      16: {
        experienceRequired: 58700,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      17: {
        experienceRequired: 68700,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      18: {
        experienceRequired: 82700,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      19: {
        experienceRequired: 101700,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      20: {
        experienceRequired: 128700,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      21: {
        experienceRequired: 137400,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      22: {
        experienceRequired: 147000,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      23: {
        experienceRequired: 157000,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      24: {
        experienceRequired: 169000,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      25: {
        experienceRequired: 185000,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      }
    },
    totalExperience: 0,
    level: 1,
    currentLevelExperience: 0,
    experienceRemaining: 500,
    health: 20,
    healthPercentage: 100
  }
})

wrap(router, 'get', '/api/v1.1/player/challenges', false, (req, res, session, player) => {
  return {
    challenges: {
      'f0532069-a70a-4a01-8611-f770bb46d9cd': {
        referenceId: 'a7ac0df7-4239-491d-9dc4-8691d053ebf4',
        duration: 'Season',
        type: 'Regular',
        endTimeUtc: '2023-09-24T01:00:00Z',
        rewards: {
          inventory: [
            {
              id: 'd9bbd707-8a7a-4edb-a85c-f8ec0c78a1f9',
              amount: 1
            }
          ],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        },
        percentComplete: 0,
        isComplete: false,
        state: 'Active',
        category: 'season_17',
        currentCount: 0,
        totalThreshold: 1,
        parentId: '3d82b9c1-f4e0-4a20-b87e-9a11734bcb6a',
        order: 1,
        rarity: null,
        prerequisiteLogicalCondition: 'And',
        prerequisiteIds: [],
        groupId: 'cc456b52-1586-4e75-b7e9-aa811f609567',
        clientProperties: {}
      },
      'cc456b52-1586-4e75-b7e9-aa811f609567': {
        referenceId: 'a46e0e1e-51cd-4fbc-b3b2-f6d33c78532c',
        duration: 'Season',
        type: 'Regular',
        endTimeUtc: '2023-09-24T01:00:00Z',
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        },
        percentComplete: 0,
        isComplete: false,
        state: 'Active',
        category: 'season_17',
        currentCount: 0,
        totalThreshold: 1,
        parentId: null,
        order: 0,
        rarity: null,
        prerequisiteLogicalCondition: 'And',
        prerequisiteIds: [],
        groupId: 'cc456b52-1586-4e75-b7e9-aa811f609567',
        clientProperties: {}
      },
      '3d82b9c1-f4e0-4a20-b87e-9a11734bcb6a': {
        referenceId: '87ded7ff-f837-4a20-bedd-77aa3d60c060',
        duration: 'Season',
        type: 'Regular',
        endTimeUtc: '2023-09-24T01:00:00Z',
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        },
        percentComplete: 0,
        isComplete: false,
        state: 'Active',
        category: 'season_17',
        currentCount: 0,
        totalThreshold: 1,
        parentId: 'cc456b52-1586-4e75-b7e9-aa811f609567',
        order: 0,
        rarity: null,
        prerequisiteLogicalCondition: 'And',
        prerequisiteIds: [],
        groupId: 'cc456b52-1586-4e75-b7e9-aa811f609567',
        clientProperties: {}
      }
    },
    activeSeasonChallenge: 'f0532069-a70a-4a01-8611-f770bb46d9cd'
  }
})

wrap(router, 'get', '/api/v1.1/adventures/scrolls', false, (req, res, session, player) => {
  // TODO: does this belong in player or catalogs?
  return null
})

wrap(router, 'get', '/api/v1.1/boosts', true, (req, res, session, player) => {
  return {
    potions: [
      null,
      null,
      null,
      null,
      null
    ],
    miniFigs: [
      null,
      null,
      null,
      null,
      null
    ],
    miniFigRecords: {},
    activeEffects: [],
    statusEffects: {
      tappableInteractionRadius: null,
      experiencePointRate: null,
      itemExperiencePointRates: null,
      attackDamageRate: null,
      playerDefenseRate: null,
      blockDamageRate: null,
      maximumPlayerHealth: 20,
      craftingSpeed: null,
      smeltingFuelIntensity: null,
      foodHealthRate: null
    },
    scenarioBoosts: {},
    expiration: null
  }
})

export = router