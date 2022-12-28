import assert, { AssertionError } from 'assert'

import Express from 'express'
const router = Express.Router()
import sendAPIResponse from '../../utils/api-response-wrapper'

import { Transaction } from '../../db'
import GUIDUtils from '../../utils/guid'

import ItemsCatalog from '../../catalog/items'

import { RequestSession } from '../../model/sessions'
import Player from '../../model/player'

router.get('/api/v1.1/locations/:lat/:lon', async (req, res) => {
  const result = await Transaction.runWithTransaction(async transaction => {
    // TODO
    const now = new Date()
    return [
      {
        "id": await GUIDUtils.generateGUID(),
        "tileId": "0",
        "coordinate": {
          "latitude": Number.parseFloat(req.params.lat as string) + 0.00025,
          "longitude": Number.parseFloat(req.params.lon as string) + 0.00025
        },
        "spawnTime": new Date(now.getTime() - 60000),
        "expirationTime": new Date(now.getTime() + 30000),
        "type": "Tappable",
        "icon": "genoa:stone_mound_c_tappable_map",
        "metadata": {
          "rewardId": await GUIDUtils.generateGUID(),
          "rarity": "Common"
        },
        "encounterMetadata": null,
        "tappableMetadata": {
          "rarity": "Common"
        }
      },
      {
        "id": await GUIDUtils.generateGUID(),
        "tileId": "0",
        "coordinate": {
          "latitude": Number.parseFloat(req.params.lat as string) - 0.00025,
          "longitude": Number.parseFloat(req.params.lon as string) - 0.00025
        },
        "spawnTime": new Date(now.getTime() - 60000),
        "expirationTime": new Date(now.getTime() + 30000),
        "type": "Tappable",
        "icon": "genoa:tree_birch_a_tappable_map",
        "metadata": {
          "rewardId": await GUIDUtils.generateGUID(),
          "rarity": "Common"
        },
        "encounterMetadata": null,
        "tappableMetadata": {
          "rarity": "Common"
        }
      },
      {
        "id": await GUIDUtils.generateGUID(),
        "tileId": "0",
        "coordinate": {
          "latitude": Number.parseFloat(req.params.lat as string),
          "longitude": Number.parseFloat(req.params.lon as string) + 0.0005
        },
        "spawnTime": new Date(now.getTime() - 60000),
        "expirationTime": new Date(now.getTime() + 30000),
        "type": "Tappable",
        "icon": "genoa:grass_mound_c_tappable_map",
        "metadata": {
          "rewardId": await GUIDUtils.generateGUID(),
          "rarity": "Common"
        },
        "encounterMetadata": null,
        "tappableMetadata": {
          "rarity": "Common"
        }
      }
    ]
  })
  sendAPIResponse(res, {
    killSwitchedTileIds: [], // TODO: what does this do?
    activeLocations: result
  })
})

const testItems = ['planks_0', 'planks_1', 'planks_2', 'log_0', 'log_1', 'log_2']
router.post('/api/v1.1/tappables/:tileId', (req, res) => {
  (res.locals.session as RequestSession).queue(async session => {
    const result = await Transaction.runWithTransaction(async transaction => {
      try {
        assert(typeof req.body == 'object')
        assert(GUIDUtils.validateGUID(req.body.id))
        assert(typeof req.body.playerCoordinate == 'object')
        assert(typeof req.body.playerCoordinate.latitude == 'number')
        assert(typeof req.body.playerCoordinate.longitude == 'number')
      }
      catch (err) {
        if (err instanceof AssertionError) {
          return
        }
        else {
          throw err
        }
      }
      const tappableId = req.body.id as string
      const lat = req.body.playerCoordinate.latitude as number
      const lon = req.body.playerCoordinate.longitude as number

      const player = new Player(session.userId, transaction)

      // TODO
      for (const name of testItems) {
        const guid = (ItemsCatalog.getAPIResponse().items as any[]).find(item => item.item.name == name.split('_')[0] && item.item.aux == (name.split('_')[1] ?? 0)).id
        await player.inventory.addItemsToInventory(guid, 4, true)
      }

      session.invalidateSequence('profile')
      session.invalidateSequence('inventory')
      session.invalidateSequence('journal')

      return {
        "token": {
          "lifetime": "Persistent",
          "clientType": "redeemtappable",
          "clientProperties": {},
          "rewards": {
            "experiencePoints": 40,
            "inventory": testItems.map(name => ({ id: (ItemsCatalog.getAPIResponse().items as any[]).find(item => item.item.name == name.split('_')[0] && item.item.aux == (name.split('_')[1] ?? 0)).id, amount: 4 })),
            "rubies": 1,
            "buildplates": [],
            "challenges": [],
            "personaItems": [],
            "utilityBlocks": []
          }
        },
        "updates": null // TODO: why is there an updates field here and what is it used for? it is null even when the global updates field is not null
      }
    })
    if (result !== undefined) {
      sendAPIResponse(res, result, await session.commitInvalidatedSequencesAndGetUpdateResponse())
    }
    else {
      res.status(400).end()
    }
  })
})

export = router