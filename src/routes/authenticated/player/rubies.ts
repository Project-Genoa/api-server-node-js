import Express from 'express'
const router = Express.Router()
import { wrap } from './wrap'

wrap(router, 'get', '/api/v1.1/player/rubies', false, async (req, res, session, player) => {
  const rubies = await player.rubies.getRubies()
  return rubies.purchased + rubies.earned
})

wrap(router, 'get', '/api/v1.1/player/splitRubies', false, async (req, res, session, player) => {
  const rubies = await player.rubies.getRubies()
  return {
    purchased: rubies.purchased,
    earned: rubies.earned
  }
})

export = router