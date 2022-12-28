import assert from 'assert'
import Player from '../player'

export interface SplitRubies {
  purchased: number,
  earned: number
}

export default class Rubies {
  readonly player: Player

  private rubies: SplitRubies | null

  constructor(player: Player) {
    this.player = player

    this.rubies = null
  }

  async getRubies(): Promise<SplitRubies> {
    if (this.rubies == null) {
      this.rubies = await this.player.transaction.get('player', this.player.userId, 'rubies') as SplitRubies | null ?? { purchased: 0, earned: 0 }
    }
    return this.rubies
  }

  async addPurchasedRubies(count: number): Promise<void> {
    assert(count > 0)

    const rubies = await this.getRubies()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'rubies', { purchased: 0, earned: 0 })

    await this.player.transaction.increment('player', this.player.userId, 'rubies.purchased', count)
    rubies.purchased += count
  }

  async addEarnedRubies(count: number): Promise<void> {
    assert(count > 0)

    const rubies = await this.getRubies()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'rubies', { purchased: 0, earned: 0 })

    await this.player.transaction.increment('player', this.player.userId, 'rubies.earned', count)
    rubies.earned += count
  }

  async spendRubies(count: number): Promise<boolean> {
    assert(count > 0)

    const rubies = await this.getRubies()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'rubies', { purchased: 0, earned: 0 })

    if (count > rubies.purchased + rubies.earned) {
      return false
    }

    // TODO: in what order should purchased/earned rubies be spent?
    const purchasedSpendCount = count > rubies.purchased ? rubies.purchased : count
    const earnedSpendCount = count > rubies.purchased ? count - rubies.purchased : 0
    await this.player.transaction.increment('player', this.player.userId, 'rubies.purchased', -purchasedSpendCount)
    await this.player.transaction.increment('player', this.player.userId, 'rubies.earned', -earnedSpendCount)
    rubies.purchased -= purchasedSpendCount
    rubies.earned -= earnedSpendCount

    return true
  }
}