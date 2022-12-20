import Express from 'express'
const router = Express.Router()
import sendAPIResponse from '../utils/api-response-wrapper'

import config from '../config'

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

router.get('/api/v1.1/resourcepacks/2020.1217.02/default', (req, res) => {
  sendAPIResponse(res, [
    {
      order: 0,
      parsedResourcePackVersion: [2020, 1214, 4],
      relativePath: 'availableresourcepack/resourcepacks/dba38e59-091a-4826-b76a-a08d7de5a9e2-1301b0c257a311678123b9e7325d0d6c61db3c35',
      resourcePackId: 'dba38e59-091a-4826-b76a-a08d7de5a9e2',
      resourcePackVersion: '2020.1214.04'
    }
  ])
})

export = router