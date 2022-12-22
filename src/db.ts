import * as mongodb from 'mongodb'

var client: mongodb.MongoClient | null = null
var database: mongodb.Db | null = null

export async function connect() {
  client = new mongodb.MongoClient('mongodb://127.0.0.1/?directConnection=true', { serverApi: { version: mongodb.ServerApiVersion.v1, strict: true, deprecationErrors: true } })
  await client.connect()
  database = client.db('genoa')

  for (const collection of ['session', 'player']) {
    try {
      await database.createCollection(collection)
    }
    catch (err) {
      if (err instanceof mongodb.MongoServerError && err.codeName == 'NamespaceExists') {
        // empty
      }
      else {
        throw err
      }
    }
  }

  await database.createIndex('session', { 'value.refreshed': 1 }, { expireAfterSeconds: 3600 })
}

export class Transaction {
  static async makeTransaction(): Promise<Transaction> {
    if (client == null) {
      throw new Error()
    }
    if (database == null) {
      throw new Error()
    }

    const session = client.startSession()
    session.startTransaction({ readConcern: { level: 'majority' }, writeConcern: { w: 'majority' } })

    return new Transaction(client, database, session)
  }

  static async runWithTransaction<ReturnType>(callback: (transaction: Transaction) => ReturnType | undefined, retryUntilDatabaseIsFree: boolean = true): Promise<ReturnType | undefined> {
    while (true) {
      try {
        const transaction = await Transaction.makeTransaction()
        const result = await callback(transaction)
        if (result !== undefined) {
          await transaction.commit()
          return result
        }
        else {
          await transaction.discard()
          return
        }
      }
      catch (err) {
        if (err instanceof ConflictError) {
          if (retryUntilDatabaseIsFree) {
            continue
          }
          else {
            return
          }
        }
        else {
          throw err
        }
      }
    }
  }

  private readonly database: mongodb.Db
  private readonly session: mongodb.ClientSession

  private finished: boolean = false

  private constructor(client: mongodb.MongoClient, database: mongodb.Db, session: mongodb.ClientSession) {
    this.database = database
    this.session = session
  }

  async commit() {
    if (this.finished) {
      throw new Error('transaction has already been comitted or discarded')
    }
    this.finished = true

    await this.session.commitTransaction()
    await this.session.endSession()
  }

  async discard() {
    if (this.finished) {
      throw new Error('transaction has already been comitted or discarded')
    }
    this.finished = true

    await this.session.abortTransaction()
    await this.session.endSession()
  }

  //

  async catchConflict(task: () => any) {
    try {
      return await task()
    }
    catch (err) {
      if (err instanceof mongodb.MongoServerError && err.errorLabels.includes(mongodb.MongoErrorLabel.TransientTransactionError)) {
        this.finished = true
        await this.session.abortTransaction()
        await this.session.endSession()
        throw new ConflictError()
      }
      else {
        throw err
      }
    }
  }

  async get(collection: string, id: string, path: string | null = null): Promise<any | null> {
    const dbCollection = this.database.collection(collection)
    const document = await this.catchConflict(async () => {
      return await dbCollection.findOneAndUpdate({ id: id }, { $inc: { readLockHack: 1 } }, { upsert: false, session: this.session })
    })
    if (document.value == null) {
      return null
    }
    var value: any = document.value.value
    if (path != null) {
      for (const part of path.split('.')) {
        value = value[part]
        if (value == null) {
          return null
        }
      }
    }
    return value
  }

  async set(collection: string, id: string, path: string | null = null, data: any) {
    const dbCollection = this.database.collection(collection)
    const value: any = {}
    value[path != null ? 'value' + '.' + path : 'value'] = data
    await this.catchConflict(async () => {
      await dbCollection.updateOne({ id: id }, { $set: value, $setOnInsert: { readLockHack: 0 } }, { upsert: true, session: this.session })
    })
  }

  async delete(collection: string, id: string, path: string | null = null) {
    const dbCollection = this.database.collection(collection)
    if (path != null) {
      const value: any = {}
      value['value' + '.' + path] = ''
      await this.catchConflict(async () => {
        await dbCollection.updateOne({ id: id }, { $unset: value }, { upsert: false, session: this.session })
      })
    }
    else {
      await this.catchConflict(async () => {
        await dbCollection.deleteOne({ id: id }, { session: this.session })
      })
    }
  }

  async createIfNotExists(collection: string, id: string, path: string | null = null, data: any) {
    if (await this.get(collection, id, path) == null) {
      const dbCollection = this.database.collection(collection)
      const value: any = {}
      value[path != null ? 'value' + '.' + path : 'value'] = data
      await this.catchConflict(async () => {
        await dbCollection.updateOne({ id: id }, { $set: value, $setOnInsert: { readLockHack: 0 } }, { upsert: true, session: this.session })
      })
    }
  }

  async increment(collection: string, id: string, path: string | null = null, amount: number) {
    const dbCollection = this.database.collection(collection)
    const value: any = {}
    value[path != null ? 'value' + '.' + path : 'value'] = amount
    await this.catchConflict(async () => {
      await dbCollection.updateOne({ id: id }, { $inc: value }, { upsert: false, session: this.session })
    })
  }
}

export class ConflictError extends Error {
  constructor() {
    super('transaction conflict')
  }
}