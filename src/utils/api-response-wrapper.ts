import { Response } from 'express'

export default function sendAPIResponse(res: Response, result: any, updates: any = null, expiration: never | null = null, continuationToken: never | null = null) {
  res.send({
    result: result,
    updates: updates,
    expiration: expiration,
    continuationToken: continuationToken
  })
}