import Express from 'express'
const router = Express.Router()

router.use('/', require('./player/rubies'))
router.use('/', require('./player/inventory'))
router.use('/', require('./player/workshop'))
router.use('/', require('./player/unimplemented'))

export = router