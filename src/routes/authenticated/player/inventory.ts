import * as Runtypes from 'runtypes'
import Express from 'express'
const router = Express.Router()
import { wrap } from './wrap'

import GUIDUtils from '../../../utils/guid'

import ItemsCatalog from '../../../catalog/items'

import * as Inventory from '../../../model/player/inventory'

wrap(router, 'get', '/api/v1.1/inventory/survival', false, async (req, res, session, player) => {
  const inventory = await player.inventory.getInventory()
  return {
    hotbar: inventory.hotbar.map(slot => slot == null ? null : (Inventory.isStackableHotbarSlot(slot) ? {
      id: slot.guid,
      count: slot.count,
      instanceId: null,
      health: null
    } : {
      id: slot.guid,
      count: 1,
      instanceId: slot.instanceId,
      health: slot.item.health
    })),
    stackableItems: Object.entries(inventory.inventory).filter(entry => Inventory.isStackableInventoryEntry(entry[1])).map(entry => ({
      id: entry[0],
      owned: (entry[1] as Inventory.StackableInventoryEntry).count,
      fragments: 1,
      unlocked: {
        on: entry[1].firstSeen
      },
      seen: {
        on: entry[1].lastSeen
      }
    })),
    nonStackableItems: Object.entries(inventory.inventory).filter(entry => !Inventory.isStackableInventoryEntry(entry[1])).map(entry => ({
      id: entry[0],
      instances: Object.entries((entry[1] as Inventory.NonStackableInventoryEntry).instances).map(instancesEntry => ({
        id: instancesEntry[0],
        health: instancesEntry[1].health
      })),
      fragments: 1,
      unlocked: {
        on: entry[1].firstSeen
      },
      seen: {
        on: entry[1].lastSeen
      }
    }))
  }
})

const HotbarRequest = Runtypes.Array(Runtypes.Union(
  Runtypes.Record({
    id: Runtypes.String.withConstraint(value => GUIDUtils.validateGUID(value)),
    count: Runtypes.Number.withConstraint(value => Number.isInteger(value)).withConstraint(value => value > 0 && value <= 64),
    instanceId: Runtypes.Optional(Runtypes.Nullish),
  }),
  Runtypes.Record({
    id: Runtypes.String.withConstraint(value => GUIDUtils.validateGUID(value)),
    count: Runtypes.Number.withConstraint(value => Number.isInteger(value)).withConstraint(value => value == 1),
    instanceId: Runtypes.String.withConstraint(value => GUIDUtils.validateGUID(value))
  }),
  Runtypes.Null
))

wrap(router, 'put', '/api/v1.1/inventory/survival/hotbar', null, async (req, res, session, player) => {
  async function removeExistingItem(slotIndex: number): Promise<boolean> {
    const item = await player.inventory.takeItemsFromHotbar(slotIndex)
    if (item == null) {
      return false
    }
    if ('instanceId' in item) {
      return await player.inventory.addExistingNonStackableItemToInventory(item.guid, item.instanceId, item.item)
    }
    else {
      await player.inventory.addItemsToInventory(item.guid, item.count)
      return true
    }
  }
  async function putNonStackableItem(slotIndex: number, guid: string, instanceId: string): Promise<boolean> {
    const item = await player.inventory.removeNonStackableItemFromInventory(guid, instanceId)
    if (item == null) {
      return false
    }
    return await player.inventory.putNonStackableItemOnHotbar(slotIndex, guid, instanceId, item)
  }
  async function putStackableItem(slotIndex: number, guid: string, count: number): Promise<boolean> {
    if (!await player.inventory.removeStackableItemsFromInventory(guid, count)) {
      return false
    }
    return await player.inventory.putStackableItemsOnHotbar(slotIndex, guid, count)
  }
  async function takeStackableItem(slotIndex: number, guid: string, count: number): Promise<boolean> {
    const item = await player.inventory.takeItemsFromHotbar(slotIndex, count)
    if (item == null || 'instanceId' in item) {
      return false
    }
    if (item.guid != guid || item.count != count) {
      return false
    }
    await player.inventory.addItemsToInventory(guid, count)
    return true
  }

  if (typeof req.body != 'object') {
    return
  }

  const hotbar = (await player.inventory.getInventory()).hotbar
  const request = HotbarRequest.withConstraint(value => value.length == hotbar.length).validate(req.body)
  if (!request.success) {
    return
  }

  const actionList: ({ action: 'remove', slotIndex: number } | { action: 'put' | 'take', slotIndex: number, guid: string, count: number } | { action: 'put', slotIndex: number, guid: string, instanceId: string })[] = []
  for (var slotIndex = 0; slotIndex < hotbar.length; slotIndex++) {
    const requestSlot = request.value[slotIndex]
    const requestStackable = requestSlot?.instanceId == null
    if (requestSlot != null) {
      if (requestStackable && !ItemsCatalog.isItemStackable(requestSlot.id)) {
        return
      }
      else if (!requestStackable && ItemsCatalog.isItemStackable(requestSlot.id)) {
        return
      }
    }
    const existingSlot = hotbar[slotIndex]

    if (requestSlot == null && existingSlot != null) {
      actionList.push({ action: 'remove', slotIndex: slotIndex })
    }
    else if (requestSlot != null) {
      if (requestStackable) {
        if (existingSlot == null) {
          actionList.push({ action: 'put', slotIndex: slotIndex, guid: requestSlot.id, count: requestSlot.count })
        }
        else if (Inventory.isStackableHotbarSlot(existingSlot) && existingSlot.guid == requestSlot.id) {
          const countDelta = requestSlot.count - existingSlot.count
          if (countDelta > 0) {
            actionList.push({ action: 'put', slotIndex: slotIndex, guid: requestSlot.id, count: countDelta })
          }
          else if (countDelta < 0) {
            actionList.push({ action: 'take', slotIndex: slotIndex, guid: requestSlot.id, count: -countDelta })
          }
          else {
            // empty
          }
        }
        else {
          actionList.push({ action: 'remove', slotIndex: slotIndex })
          actionList.push({ action: 'put', slotIndex: slotIndex, guid: requestSlot.id, count: requestSlot.count })
        }
      }
      else {
        if (existingSlot == null) {
          actionList.push({ action: 'put', slotIndex: slotIndex, guid: requestSlot.id, instanceId: requestSlot.instanceId })
        }
        else if (!Inventory.isStackableHotbarSlot(existingSlot) && existingSlot.guid == requestSlot.id && existingSlot.instanceId == requestSlot.instanceId) {
          // empty
        }
        else {
          actionList.push({ action: 'remove', slotIndex: slotIndex })
          actionList.push({ action: 'put', slotIndex: slotIndex, guid: requestSlot.id, instanceId: requestSlot.instanceId })
        }
      }
    }
  }

  for (const action of actionList) {
    if (action.action == 'remove') {
      await removeExistingItem(action.slotIndex)
    }
    else if (action.action == 'take') {
      await takeStackableItem(action.slotIndex, action.guid, action.count)
    }
  }
  for (const action of actionList) {
    if (action.action == 'put') {
      if ('instanceId' in action) {
        await putNonStackableItem(action.slotIndex, action.guid, action.instanceId)
      }
      else {
        await putStackableItem(action.slotIndex, action.guid, action.count)
      }
    }
  }

  return hotbar.map(slot => slot == null ? null : (Inventory.isStackableHotbarSlot(slot) ? {
    id: slot.guid,
    count: slot.count,
    instanceId: null,
    health: null
  } : {
    id: slot.guid,
    count: 1,
    instanceId: slot.instanceId,
    health: slot.item.health
  }))
})

export = router