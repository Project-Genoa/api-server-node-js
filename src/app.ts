import Express from 'express'

import config from './config'
import * as db from './db'

import ItemsCatalog from './catalog/items'
import RecipesCatalog from './catalog/recipes'
import JournalCatalog from './catalog/journal'
import NFCCatalog from './catalog/nfc'

const app = Express()

app.use('/', Express.json())
app.use('/', require('./middleware/log'))
app.use('/', require('./middleware/force-content-type-on-304')) // the Minecraft Earth HTTP client is broken, sending a 304 without a "Content-Type: application/json" header causes an "unable to load" error to be shown even though the HTTP spec allows this

app.use('/', require('./routes/locator'))
app.use('/', require('./routes/resourcepack'))
app.use('/', require('./routes/signin'))
app.use(config.authenticatedBasePath, require('./routes/authenticated'))

setImmediate(async () => {
  try {
    try {
      await Promise.all([
        ItemsCatalog.loadData(),
        RecipesCatalog.loadData(),
        JournalCatalog.loadData(),
        NFCCatalog.loadData()
      ])
      console.log('Loaded catelogs')
    }
    catch (err) {
      console.error(err)
      console.log('Failed to load catalogs')
      throw err
    }

    try {
      await db.connect()
      console.log('Connected to database')
    }
    catch (err) {
      console.error(err)
      console.log('Failed to connect to database')
      throw err
    }

    app.listen(config.port, () => {
      console.log(`Listening on port ${config.port}`)
    })
  }
  catch (err) {
    console.log('Server failed to start')
  }
})