import Express from 'express'
const router = Express.Router()

router.use('/', require('../middleware/auth'))

router.use('/', require('./authenticated/flags'))
router.use('/', require('./authenticated/catalogs'))
router.use('/', require('./authenticated/player'))
router.use('/', require('./authenticated/tappables'))

export = router