import Express from 'express'
const router = Express.Router()
import sendAPIResponse from '../utils/api-response-wrapper'

import config from '../config'
import { route } from './authenticated'

router.get('/player/environment', (req, res) => {
  sendAPIResponse(res, {
    serviceEnvironments: {
      production: {
        serviceUri: 'http://' + config.hostname + ':' + config.port,
        cdnUri: 'http://' + config.hostname + ':' + config.port + config.cdnBasePath,
        playfabTitleId: config.playfabId
      }
    },
    supportedEnvironments: {
      '2020.1217.02': ['production']
    }
  })
})

export = router