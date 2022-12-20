import Express from 'express'
import Sessions from '../model/sessions'

async function auth(req: Express.Request, res: Express.Response, next: Express.NextFunction) {
  const session = await Sessions.getSession(req)
  if (session != null) {
    res.locals.session = session
    next()
  }
  else {
    console.log(`Bad auth in request for ${req.originalUrl}`)
    res.status(403).end()
  }
}

export = auth