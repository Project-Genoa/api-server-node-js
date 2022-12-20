import Express from 'express'
const router = Express.Router()
import sendAPIResponse from '../utils/api-response-wrapper'

import Sessions from '../model/sessions'

import config from '../config'

router.post('/api/v1.1/player/profile/signin', async (req, res) => {
  const session = await Sessions.signIn(req)
  if (session != null) {
    console.log(`New session for ${session.userId} with ID ${session.sessionId}`);

    sendAPIResponse(res, {
      basePath: config.authenticatedBasePath,
      authenticationToken: session.sessionToken,
      clientProperties: {},
      mixedReality: null,
      mrToken: null,
      streams: null,
      tokens: {},
      updates: {}
    }, {})
  }
  else {
    console.log(`Bad signin attempt`)
    res.status(403).end()
  }
})

export = router