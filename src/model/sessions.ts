import crypto from 'crypto'
import type Express from 'express'

import * as db from '../db'
import Queue from '../utils/queue'

import config from '../config'

interface SessionDbRecord {
  userId: string,
  sessionId: string,
  sessionToken: string,

  sequenceNumbers: {
    profile: number,
    inventory: number,
    crafting: number,
    smelting: number,
    boosts: number,
    buildplates: number,
    journal: number,
    challenges: number,
    tokens: number
  }
}

export default class Sessions {
  static async getSession(req: Express.Request): Promise<RequestSession | null> {
    const sessionId = req.header('Session-Id')
    if (sessionId === undefined) {
      return null
    }

    const authHeader = req.header('Authorization')
    if (authHeader === undefined) {
      return null
    }
    var parts = authHeader.split(' ')
    if (parts.length != 2 || parts[0] != 'Genoa') {
      return null
    }
    const sessionToken = parts[1]

    const session = await db.Transaction.runWithTransaction(async transaction => {
      const sessionRecord = await transaction.get('session', sessionId) as SessionDbRecord | null
      if (sessionRecord != null) {
        // TODO: implement expiry for MongoDB
        /*try {
          const multi = db.multi()
          multi.expire(key, config.sessionExpiryDuration)
          await multi.exec()
        }
        catch (err) {
          if (err instanceof db.ConflictError) {
            // empty
          }
          else {
            throw err
          }
        }*/
        return sessionRecord
      }
      else {
        return
      }
    })
    if (session == null) {
      return null
    }

    if (sessionToken != session.sessionToken) {
      return null
    }

    return new RequestSession(session)
  }

  static async signIn(req: Express.Request): Promise<RequestSession | null> {
    const sessionId = req.get('Session-Id')
    if (sessionId == undefined) {
      return null
    }

    if (req.body == null || typeof req.body.sessionTicket != 'string') {
      return null
    }
    var parts = req.body.sessionTicket.split('-')
    if (parts.length < 2) {
      return null
    }
    const userId = parts[0]
    if (!userId.match(/^[0-9A-F]{16}$/)) {
      return null
    }

    // TODO: check credentials

    const sessionToken = await generateSessionToken()
    const session: SessionDbRecord = {
      userId: userId,
      sessionId: sessionId,
      sessionToken: sessionToken,

      sequenceNumbers: {
        profile: 1,
        inventory: 1,
        crafting: 1,
        smelting: 1,
        boosts: 1,
        buildplates: 1,
        journal: 1,
        challenges: 1,
        tokens: 1
      }
    }

    const alreadyExists = !await db.Transaction.runWithTransaction(async transaction => {
      if (await transaction.get('session', session.sessionId) != null) {
        return false
      }
      await transaction.set('session', session.sessionId, null, session)
      // TODO: implement expiry for MongoDB
      //multi.expire(key, config.sessionExpiryDuration)
      //await multi.exec()
      return true
    })
    if (alreadyExists) {
      return null
    }

    return new RequestSession(session)
  }
}

async function generateSessionToken(): Promise<string> {
  const bytes = await crypto.randomBytes(16)
  const token = bytes.toString('hex')
  return token
}

/**
 * A description of a session intended to be used in the handling of a single HTTP/API request. A new instance is created for each request and each instance is intended to be used only one.
 */
export class RequestSession {
  private sessionRecord: SessionDbRecord

  constructor(sessionRecord: SessionDbRecord) {
    this.sessionRecord = sessionRecord
  }

  get userId(): string { return this.sessionRecord.userId }
  get sessionId(): string { return this.sessionRecord.sessionId }
  get sessionToken(): string { return this.sessionRecord.sessionToken }

  /**
   * @param {@function} callback A function to be added to the FIFO queue for this session. It will be called with a single parameter, that being a ModifiableSession instance.
   */
  async queue<ReturnType>(callback: (session: ModifiableSession) => ReturnType): Promise<ReturnType> {
    const modifiableSession = new ModifiableSession(this.sessionRecord)
    const queue = getQueueForSessionId(this.sessionRecord.sessionId)
    return await queue.addToQueue(() => callback(modifiableSession))
  }
}

type SequenceField = 'profile' | 'inventory' | 'crafting' | 'smelting' | 'boosts' | 'buildplates' | 'journal' | 'challenges' | 'tokens'

export class ModifiableSession extends RequestSession {
  private sequences: { [field in SequenceField]: { value: number, invalidated: boolean } }

  constructor(sessionRecord: SessionDbRecord) {
    super(sessionRecord)
    this.sequences = {
      profile: { value: sessionRecord.sequenceNumbers.profile, invalidated: false },
      inventory: { value: sessionRecord.sequenceNumbers.inventory, invalidated: false },
      crafting: { value: sessionRecord.sequenceNumbers.crafting, invalidated: false },
      smelting: { value: sessionRecord.sequenceNumbers.smelting, invalidated: false },
      boosts: { value: sessionRecord.sequenceNumbers.boosts, invalidated: false },
      buildplates: { value: sessionRecord.sequenceNumbers.buildplates, invalidated: false },
      journal: { value: sessionRecord.sequenceNumbers.journal, invalidated: false },
      challenges: { value: sessionRecord.sequenceNumbers.challenges, invalidated: false },
      tokens: { value: sessionRecord.sequenceNumbers.tokens, invalidated: false }
    }
  }

  getSequenceNumber(field: SequenceField): number {
    return this.sequences[field].invalidated ? this.sequences[field].value + 1 : this.sequences[field].value
  }

  invalidateSequence(field: SequenceField): void {
    this.sequences[field].invalidated = true
  }

  async commitInvalidatedSequencesAndGetUpdateResponse(): Promise<object> {
    while (true) {
      try {
        const results = await db.Transaction.runWithTransaction(async transaction => {
          const initialValues = await transaction.get('session', this.sessionId, 'sequenceNumbers')
          if (initialValues == null) {
            return null
          }

          var updatedValues: any = {}
          for (const field in this.sequences) {
            if (this.sequences[field as SequenceField].invalidated) {
              await transaction.increment('session', this.sessionId, 'sequenceNumbers.' + field, 1)
              updatedValues[field] = initialValues[field] + 1
            }
          }
          return updatedValues
        })

        if (results == null) {
          return {}
        }

        var resultIndex = 0
        const updatedFields: { [field: string]: number | undefined } = {}
        for (const field in this.sequences) {
          if (this.sequences[field as SequenceField].invalidated) {
            const value = results[resultIndex] as number
            resultIndex++

            this.sequences[field as SequenceField].value = value
            this.sequences[field as SequenceField].invalidated = false
            updatedFields[field] = value
          }
        }

        const updateResponse: { [field: string]: number | undefined } = {
          characterProfile: updatedFields.profile,
          inventory: updatedFields.inventory,
          crafting: updatedFields.crafting,
          smelting: updatedFields.smelting,
          boosts: updatedFields.boosts,
          buildplates: updatedFields.buildplates,
          playerJournal: updatedFields.journal,
          challenges: updatedFields.challenges,
          tokens: updatedFields.tokens
        }
        for (const field in updateResponse) {
          if (updateResponse[field] === undefined) {
            delete updateResponse[field]
          }
        }
        return updateResponse
      }
      catch (err) {
        if (err instanceof db.ConflictError) {
          continue
        }
        else {
          throw err
        }
      }
    }
  }
}

const queues: { [sessionId: string]: Queue } = {}

function getQueueForSessionId(sessionId: string): Queue {
  if (!(sessionId in queues)) {
    const queue = new Queue(() => {
      delete queues[sessionId]
    })
    queues[sessionId] = queue
    return queue
  }
  else {
    return queues[sessionId]
  }
}