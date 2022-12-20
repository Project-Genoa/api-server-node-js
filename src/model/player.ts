import { Transaction } from '../db'

import Inventory from './player/inventory'
import Workshop from './player/workshop'

export default class Player {
  readonly userId: string
  readonly transaction: Transaction

  readonly inventory: Inventory
  readonly workshop: Workshop

  constructor(userId: string, transaction: Transaction) {
    this.userId = userId
    this.transaction = transaction

    this.inventory = new Inventory(this)
    this.workshop = new Workshop(this)
  }
}