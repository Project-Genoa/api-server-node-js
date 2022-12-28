import assert from 'assert'
import Player from '../player'
import GUIDUtils from '../../utils/guid'

import ItemsCatalog from '../../catalog/items'

// TODO: stop using Date instances because it turns out that RedisJSON doesn't serialise these correctly and rather use UNIX timestamps
export interface NonStackableItemInstance {
  health: number
}
export type InventoryEntry = StackableInventoryEntry | NonStackableInventoryEntry
export interface StackableInventoryEntry {
  count: number,
  firstSeen: Date,
  lastSeen: Date
}
export interface NonStackableInventoryEntry {
  instances: { [index: string]: NonStackableItemInstance },
  firstSeen: Date,
  lastSeen: Date
}
export type HotbarSlot = StackableHotbarSlot | NonStackableHotbarSlot | null
export interface StackableHotbarSlot {
  guid: string,
  count: number
}
export interface NonStackableHotbarSlot {
  guid: string,
  instanceId: string,
  item: NonStackableItemInstance
}
export type InventoryList = { [index: string]: InventoryEntry }
export type Hotbar = [HotbarSlot, HotbarSlot, HotbarSlot, HotbarSlot, HotbarSlot, HotbarSlot, HotbarSlot]
export function isStackableInventoryEntry(inventoryEntry: InventoryEntry): inventoryEntry is StackableInventoryEntry {
  return 'count' in inventoryEntry
}
export function isStackableHotbarSlot(hotbarSlot: HotbarSlot): hotbarSlot is StackableHotbarSlot {
  return hotbarSlot != null && 'count' in hotbarSlot
}

export default class Inventory {
  readonly player: Player

  private inventory: InventoryList | null
  private hotbar: Hotbar | null

  constructor(player: Player) {
    this.player = player

    this.inventory = null
    this.hotbar = null
  }

  async getInventory(): Promise<{ inventory: InventoryList, hotbar: Hotbar }> {
    if (this.inventory == null || this.hotbar == null) {
      this.inventory = await this.player.transaction.get('player', this.player.userId, 'inventory') as InventoryList | null ?? {}
      this.hotbar = await this.player.transaction.get('player', this.player.userId, 'hotbar') as Hotbar | null ?? [null, null, null, null, null, null, null]
    }
    return { inventory: this.inventory, hotbar: this.hotbar }
  }

  async addItemsToInventory(guid: string, count: number, updateLastSeen: boolean = false): Promise<void> {
    assert(count == null || count > 0)

    const stackable = ItemsCatalog.isItemStackable(guid)

    const now = new Date()

    const inventory = (await this.getInventory()).inventory
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'inventory', {})

    const newInventoryEntry: InventoryEntry = stackable ? {
      count: 0,
      firstSeen: now,
      lastSeen: now
    } : {
      instances: {},
      firstSeen: now,
      lastSeen: now
    }
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'inventory.' + guid, newInventoryEntry)
    inventory[guid] = inventory[guid] ?? newInventoryEntry

    if (stackable) {
      await this.player.transaction.increment('player', this.player.userId, 'inventory.' + guid + '.count', count);
      (inventory[guid] as StackableInventoryEntry).count += count
    }
    else {
      for (var num = 0; num < count; num++) {
        const newInstanceId = await GUIDUtils.generateGUID()
        const newInstance = {
          health: 100.0
        }
        await this.player.transaction.set('player', this.player.userId, 'inventory.' + guid + '.instances.' + newInstanceId, newInstance);
        (inventory[guid] as NonStackableInventoryEntry).instances[newInstanceId] = newInstance
      }
    }

    if (updateLastSeen) {
      await this.player.transaction.set('player', this.player.userId, 'inventory.' + guid + '.lastSeen', now)
      inventory[guid].lastSeen = now
    }
  }

  async addExistingNonStackableItemToInventory(guid: string, instanceId: string, item: NonStackableItemInstance, updateLastSeen: boolean = false): Promise<boolean> {
    const now = new Date()

    const inventory = (await this.getInventory()).inventory
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'inventory', {})

    const existingInventoryEntry = inventory[guid]
    const exists = existingInventoryEntry !== undefined && (isStackableInventoryEntry(existingInventoryEntry) || instanceId in existingInventoryEntry.instances)
    if (exists) {
      return false
    }

    const newInventoryEntry: NonStackableInventoryEntry = {
      instances: {},
      firstSeen: now,
      lastSeen: now
    }
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'inventory.' + guid, newInventoryEntry)
    inventory[guid] = inventory[guid] ?? newInventoryEntry

    await this.player.transaction.set('player', this.player.userId, 'inventory.' + guid + '.instances.' + instanceId, item);
    (inventory[guid] as NonStackableInventoryEntry).instances[instanceId] = item

    if (updateLastSeen) {
      await this.player.transaction.set('player', this.player.userId, 'inventory.' + guid + '.lastSeen', now)
      inventory[guid].lastSeen = now
    }

    return true
  }

  async putStackableItemsOnHotbar(slotIndex: number, guid: string, count: number): Promise<boolean> {
    assert(count == null || count > 0)

    const hotbar = (await this.getInventory()).hotbar
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'hotbar', [null, null, null, null, null, null, null])

    const slot = hotbar[slotIndex]
    const hasSpace = slot == null || (isStackableHotbarSlot(slot) && slot.guid == guid && slot.count + count < 64)
    if (!hasSpace) {
      return false
    }

    const newSlot: StackableHotbarSlot = {
      guid: guid,
      count: 0,
    }
    if (slot == null) {
      await this.player.transaction.set('player', this.player.userId, 'hotbar.' + slotIndex, newSlot)
    }
    hotbar[slotIndex] = hotbar[slotIndex] ?? newSlot

    await this.player.transaction.increment('player', this.player.userId, 'hotbar.' + slotIndex + '.count', count);
    (hotbar[slotIndex] as StackableHotbarSlot).count += count

    return true
  }

  async putNonStackableItemOnHotbar(slotIndex: number, guid: string, instanceId: string, item: NonStackableItemInstance): Promise<boolean> {
    const hotbar = (await this.getInventory()).hotbar
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'hotbar', [null, null, null, null, null, null, null])

    const slot = hotbar[slotIndex]
    const hasSpace = slot == null
    if (!hasSpace) {
      return false
    }

    const newSlot: NonStackableHotbarSlot = {
      guid: guid,
      instanceId: instanceId,
      item: item
    }
    await this.player.transaction.set('player', this.player.userId, 'hotbar.' + slotIndex, newSlot)
    hotbar[slotIndex] = newSlot

    return true
  }

  async removeStackableItemsFromInventory(guid: string, count: number): Promise<boolean> {
    assert(count == null || count > 0)

    const inventory = (await this.getInventory()).inventory
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'inventory', {})

    const inventoryEntry = inventory[guid]
    const available = inventoryEntry !== undefined && isStackableInventoryEntry(inventoryEntry) && inventoryEntry.count >= count
    if (!available) {
      return false
    }

    await this.player.transaction.increment('player', this.player.userId, 'inventory.' + guid + '.count', -count);
    (inventory[guid] as StackableInventoryEntry).count -= count

    return true
  }

  async removeNonStackableItemFromInventory(guid: string, instanceId: string): Promise<NonStackableItemInstance | null> {
    const inventory = (await this.getInventory()).inventory
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'inventory', {})

    const inventoryEntry = inventory[guid]
    const item = inventoryEntry !== undefined && !isStackableInventoryEntry(inventoryEntry) && instanceId in inventoryEntry.instances ? inventoryEntry.instances[instanceId] : null
    if (item === null) {
      return null
    }

    await this.player.transaction.delete('player', this.player.userId, 'inventory.' + guid + '.instances.' + instanceId)
    delete (inventory[guid] as NonStackableInventoryEntry).instances[instanceId]

    return item
  }

  async takeItemsFromHotbar(slotIndex: number, count: number | null = null): Promise<{ guid: string, count: number } | { guid: string, instanceId: string, item: NonStackableItemInstance } | null> {
    assert(count == null || count > 0)

    const hotbar = (await this.getInventory()).hotbar
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'hotbar', [null, null, null, null, null, null, null])

    const slot = hotbar[slotIndex]
    if (slot == null) {
      return null
    }
    const slotCount = isStackableHotbarSlot(slot) ? slot.count : 1
    const takeCount = count ?? slotCount
    if (takeCount > slotCount) {
      return null
    }

    const returnItem = isStackableHotbarSlot(slot) ? {
      guid: slot.guid,
      count: takeCount
    } : {
      guid: slot.guid,
      instanceId: slot.instanceId,
      item: slot.item
    }

    if (takeCount == slotCount) {
      await this.player.transaction.delete('player', this.player.userId, 'hotbar.' + slotIndex)
      hotbar[slotIndex] = null
    }
    else {
      await this.player.transaction.increment('player', this.player.userId, 'hotbar.' + slotIndex + '.count', -takeCount);
      (hotbar[slotIndex] as StackableHotbarSlot).count -= takeCount
    }

    return returnItem
  }
}