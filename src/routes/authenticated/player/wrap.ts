import Express from 'express'

import { Transaction } from '../../../db'
import sendAPIResponse from '../../../utils/api-response-wrapper'

import { RequestSession, ModifiableSession } from '../../../model/sessions'
import Player from '../../../model/player'

const router = Express.Router()
export function wrap(router: Express.Router, method: 'get' | 'post' | 'put' | 'delete', path: string, sendUpdates: boolean | null, callback: (req: Express.Request, res: Express.Response, session: ModifiableSession, player: Player) => any): void {
  router[method](path, async (req, res) => {
    (res.locals.session as RequestSession).queue(async session => {
      const result = await Transaction.runWithTransaction(async transaction => {
        const player = new Player(session.userId, transaction)
        return await callback(req, res, session, player)
      })
      if (result !== undefined) {
        if (sendUpdates == null) {
          res.send(result)
        }
        else {
          sendAPIResponse(res, result, sendUpdates ? await session.commitInvalidatedSequencesAndGetUpdateResponse() : null)
        }
      }
      else {
        res.status(400).end()
      }
    })
  })
}