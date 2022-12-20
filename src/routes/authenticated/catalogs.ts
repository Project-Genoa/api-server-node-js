import Express from 'express'
const router = Express.Router()
import sendAPIResponse from '../../utils/api-response-wrapper'

import ItemsCatalog from '../../catalog/items'
import RecipesCatalog from '../../catalog/recipes'
import JournalCatalog from '../../catalog/journal'
import NFCCatalog from '../../catalog/nfc'

router.get('/api/v1.1/inventory/catalogv3', (req, res) => {
  sendAPIResponse(res, ItemsCatalog.getAPIResponse())
})

router.get('/api/v1.1/recipes', (req, res) => {
  sendAPIResponse(res, RecipesCatalog.getAPIResponse())
})

router.get('/api/v1.1/journal/catalog', (req, res) => {
  sendAPIResponse(res, JournalCatalog.getAPIResponse())
})

router.get('/api/v1.1/products/catalog', (req, res) => {
  sendAPIResponse(res, NFCCatalog.getAPIResponse())
})

module.exports = router