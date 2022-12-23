import assert, { AssertionError } from 'assert'
import Express from 'express'

import { Transaction } from '../../db'
import GUIDUtils from '../../utils/guid'
import sendAPIResponse from '../../utils/api-response-wrapper'

import ItemsCatalog from '../../catalog/items'
import RecipesCatalog, { SmeltingRecipe } from '../../catalog/recipes'

import { RequestSession, ModifiableSession } from '../../model/sessions'
import Player from '../../model/player'
import * as Inventory from '../../model/player/inventory'
import * as Workshop from '../../model/player/workshop'

const router = Express.Router()
function wrap(method: 'get' | 'post' | 'put' | 'delete', path: string, sendUpdates: boolean | null, callback: (req: Express.Request, res: Express.Response, session: ModifiableSession, player: Player) => any): void {
  router[method](path, async (req, res) => {
    (res.locals.session as RequestSession).queue(async session => {
      const result = await Transaction.runWithTransaction(async transaction => {
        const player = new Player(session.userId, transaction)
        return await callback(req, res, session, player)
      })
      if (result !== undefined) {
        if (sendUpdates == null) {
          res.send(result)
        }
        else {
          sendAPIResponse(res, result, sendUpdates ? await session.commitInvalidatedSequencesAndGetUpdateResponse() : null)
        }
      }
      else {
        res.status(400).end()
      }
    })
  })
}

// TODO

wrap('get', '/api/v1.1/player/tokens', false, (req, res, session, player) => {
  // TODO: figure out what tokens are
  return {
    tokens: {}
  }
})

wrap('get', '/api/v1.1/player/rubies', false, (req, res, session, player) => {
  return 5
})

wrap('get', '/api/v1.1/player/splitRubies', false, (req, res, session, player) => {
  return {
    purchased: 5,
    earned: 0
  }
})

wrap('get', '/api/v1.1/inventory/survival', false, async (req, res, session, player) => {
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

wrap('put', '/api/v1.1/inventory/survival/hotbar', null, async (req, res, session, player) => {
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

  const actionList: ({ action: 'remove', slotIndex: number } | { action: 'put' | 'take', slotIndex: number, guid: string, count: number } | { action: 'put', slotIndex: number, guid: string, instanceId: string })[] = []
  for (var slotIndex = 0; slotIndex < hotbar.length; slotIndex++) {
    const requestSlot = req.body[slotIndex]
    var requestStackable: boolean = false
    if (requestSlot === undefined) {
      return
    }
    if (requestSlot != null) {
      try {
        assert(typeof requestSlot == 'object')
        assert('id' in requestSlot)
        assert('count' in requestSlot)
        assert('instanceId' in requestSlot)

        assert(GUIDUtils.validateGUID(requestSlot.id))
        assert(typeof requestSlot.count == 'number')
        assert(requestSlot.instanceId == null || GUIDUtils.validateGUID(requestSlot.id))

        if (ItemsCatalog.isItemStackable(requestSlot.id)) {
          assert(requestSlot.count > 0 && requestSlot.count <= 64)
          assert(requestSlot.instanceId == null)
          requestStackable = true
        }
        else {
          assert(requestSlot.count == 1)
          assert(requestSlot.instanceId != null)
          requestStackable = false
        }
      }
      catch (err) {
        if (err instanceof AssertionError) {
          return
        }
        else {
          throw err
        }
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

function craftingSlotStateToAPIResponse(session: ModifiableSession, state: Workshop.CraftingSlotState) {
  if (Workshop.isActiveCraftingSlotState(state)) {
    return {
      sessionId: state.sessionId,
      recipeId: state.recipeId,
      output: { itemId: state.output.itemId, quantity: state.output.count },
      escrow: state.input == null ? [] : state.input.map(item => Workshop.isStackableCraftingInputItem(item) ? { itemId: item.itemId, quantity: item.count, itemInstanceIds: null } : { itemId: item.itemId, quantity: item.instances.length, instanceIds: item.instances.map(instance => instance.instanceId) }), // TODO: are we supposed to include the item instance info (e.g. health) somewhere?
      completed: state.completedRounds,
      available: state.availableRounds,
      total: state.totalRounds,
      nextCompletionUtc: state.nextCompletionTime != null ? new Date(state.nextCompletionTime) : null,
      totalCompletionUtc: new Date(state.totalCompletionTime),
      state: state.nextCompletionTime != null ? 'Active' : 'Completed',
      boostState: null,
      unlockPrice: null,
      streamVersion: session.getSequenceNumber('crafting')
    }
  }
  else {
    return {
      sessionId: null,
      recipeId: null,
      output: null,
      escrow: [],
      completed: 0,
      available: 0,
      total: 0,
      nextCompletionUtc: null,
      totalCompletionUtc: null,
      state: 'Empty',
      boostState: null,
      unlockPrice: null,
      streamVersion: session.getSequenceNumber('crafting')
    }
  }
}

function smeltingSlotStateToAPIResponse(session: ModifiableSession, state: Workshop.SmeltingSlotState) {
  const response: any = {
    fuel: null,
    burning: null,
    sessionId: null,
    recipeId: null,
    output: null,
    escrow: [],
    completed: 0,
    available: 0,
    total: 0,
    nextCompletionUtc: null,
    totalCompletionUtc: null,
    state: 'Empty',
    boostState: null,
    unlockPrice: null,
    streamVersion: session.getSequenceNumber('smelting')
  }

  if (Workshop.isActiveSmeltingSlotState(state) && state.completedRounds < state.totalRounds) {
    response.burning = {
      burnStartTime: new Date(state.heat.burnStartTime),
      burnsUntil: new Date(state.heat.burnEndTime),
      fuel: {
        burnRate: {
          burnTime: state.heat.fuel.totalBurnDuration,
          heatPerSecond: state.heat.fuel.heatPerSecond
        },
        itemId: state.heat.fuel.item.itemId,
        quantity: Workshop.isStackableSmeltingInputItems(state.heat.fuel.item) ? state.heat.fuel.item.count : state.heat.fuel.item.instances.length,
        itemInstanceIds: Workshop.isStackableSmeltingInputItems(state.heat.fuel.item) ? null : state.heat.fuel.item.instances.map(instance => instance.instanceId)
      }
    }
  }
  else if (state.heatCarriedOver != null) {
    response.burning = {
      remainingBurnTime: '00:00:' + (state.heatCarriedOver.fuel.totalBurnDuration - state.heatCarriedOver.secondsUsed),
      heatDepleted: state.heatCarriedOver.fuel.heatPerSecond * state.heatCarriedOver.secondsUsed,
      fuel: {
        burnRate: {
          burnTime: state.heatCarriedOver.fuel.totalBurnDuration,
          heatPerSecond: state.heatCarriedOver.fuel.heatPerSecond
        },
        itemId: state.heatCarriedOver.fuel.item.itemId,
        quantity: Workshop.isStackableSmeltingInputItems(state.heatCarriedOver.fuel.item) ? state.heatCarriedOver.fuel.item.count : state.heatCarriedOver.fuel.item.instances.length,
        itemInstanceIds: Workshop.isStackableSmeltingInputItems(state.heatCarriedOver.fuel.item) ? null : state.heatCarriedOver.fuel.item.instances.map(instance => instance.instanceId)
      }
    }
  }

  if (Workshop.isActiveSmeltingSlotState(state)) {
    response.fuel = state.fuel != null ? {
      burnRate: {
        burnTime: state.fuel.totalBurnDuration,
        heatPerSecond: state.fuel.heatPerSecond
      },
      itemId: state.fuel.item.itemId,
      quantity: Workshop.isStackableSmeltingInputItems(state.fuel.item) ? state.fuel.item.count : state.fuel.item.instances.length,
      itemInstanceIds: Workshop.isStackableSmeltingInputItems(state.fuel.item) ? null : state.fuel.item.instances.map(instance => instance.instanceId)
    } : null
    response.sessionId = state.sessionId
    response.recipeId = state.recipeId
    response.output = { itemId: state.output, quantity: 1 }
    response.escrow = state.input == null ? [] : [Workshop.isStackableSmeltingInputItems(state.input) ? { itemId: state.input.itemId, quantity: state.input.count, itemInstanceIds: null } : { itemId: state.input.itemId, quantity: state.input.instances.length, instanceIds: state.input.instances.map(instance => instance.instanceId) }]
    response.completed = state.completedRounds
    response.available = state.availableRounds
    response.total = state.totalRounds
    response.nextCompletionUtc = state.completedRounds < state.totalRounds ? new Date(state.nextCompletionTime) : null
    response.totalCompletionUtc = new Date(state.endTime)
    response.state = state.completedRounds == state.totalRounds ? 'Completed' : 'Active'
    response.boostState = null
    response.unlockPrice = null
    response.streamVersion = session.getSequenceNumber('smelting')
  }

  return response
}

interface RequestItem {
  itemId: string,
  quantity: number,
  itemInstanceIds: [string] | null
}

function validateRequestItem(item: any, allowZeroQuantity: boolean = false): asserts item is RequestItem {
  assert(typeof item == 'object')
  assert(GUIDUtils.validateGUID(item.itemId))
  assert(typeof item.quantity == 'number')
  if (allowZeroQuantity) {
    assert(item.quantity >= 0)
  }
  else {
    assert(item.quantity > 0)
  }
  if (ItemsCatalog.isItemStackable(item.itemId)) {
    assert(item.itemInstanceIds == null)
  }
  else {
    assert(typeof item.itemInstanceIds == 'object' && Array.isArray(item.itemInstanceIds))
    assert(item.itemInstanceIds.length == item.quantity)
    item.itemInstanceIds.forEach((itemInstanceId: unknown) => {
      assert(GUIDUtils.validateGUID(itemInstanceId))
    })
  }
}

async function collectRequestItemFromInventory(player: Player, item: RequestItem, maxCount: number | null = null): Promise<{ itemId: string; count: number; instances: { instanceId: string; item: Inventory.NonStackableItemInstance }[] | null } | null> {
  const inventory = await player.inventory.getInventory()

  const itemId = item.itemId as string
  if (ItemsCatalog.isItemStackable(itemId)) {
    const targetCount = maxCount != null ? Math.min(item.quantity as number, maxCount) : (item.quantity as number)
    var collectedCount = 0

    for (var hotbarSlotIndex = 0; hotbarSlotIndex < inventory.hotbar.length; hotbarSlotIndex++) {
      const hotbarSlot = inventory.hotbar[hotbarSlotIndex]
      if (hotbarSlot == null || hotbarSlot.guid != itemId) {
        continue
      }
      if (collectedCount < targetCount) {
        const items = await player.inventory.takeItemsFromHotbar(hotbarSlotIndex, Math.min(targetCount - collectedCount, (hotbarSlot as Inventory.StackableHotbarSlot).count))
        collectedCount += (items as { guid: string, count: number }).count
      }
    }

    if (collectedCount < targetCount) {
      if (!await player.inventory.removeStackableItemsFromInventory(itemId, targetCount - collectedCount)) {
        return null
      }
    }

    return { itemId: itemId, count: targetCount, instances: null }
  }
  else {
    const instances: { instanceId: string, item: Inventory.NonStackableItemInstance }[] = []
    for (const instanceId of item.itemInstanceIds as string[]) {
      if (maxCount != null && instances.length == maxCount) {
        break
      }

      var instance: Inventory.NonStackableItemInstance | null = null

      for (var hotbarSlotIndex = 0; hotbarSlotIndex < inventory.hotbar.length; hotbarSlotIndex++) {
        const hotbarSlot = inventory.hotbar[hotbarSlotIndex]
        if (hotbarSlot == null || hotbarSlot.guid != itemId || (hotbarSlot as Inventory.NonStackableHotbarSlot).instanceId != instanceId) {
          continue
        }
        instance = (await player.inventory.takeItemsFromHotbar(hotbarSlotIndex) as { guid: string, instanceId: string, item: Inventory.NonStackableItemInstance }).item
        break
      }

      if (instance == null) {
        if ((instance = await player.inventory.removeNonStackableItemFromInventory(itemId, instanceId)) == null) {
          return null
        }
      }

      instances.push({ instanceId: instanceId, item: instance })
    }

    return { itemId: itemId, count: instances.length, instances: instances }
  }
}

wrap('get', '/api/v1.1/player/utilityBlocks', false, async (req, res, session, player) => {
  for (const slot of player.workshop.craftingSlots) {
    if (await slot.updateState()) {
      session.invalidateSequence('crafting')
    }
  }
  for (const slot of player.workshop.smeltingSlots) {
    if (await slot.updateState()) {
      session.invalidateSequence('smelting')
    }
  }

  const craftingSlots = await Promise.all(player.workshop.craftingSlots.map(async slot => {
    return craftingSlotStateToAPIResponse(session, await slot.getState())
  }))
  const smeltingSlots = await Promise.all(player.workshop.smeltingSlots.map(async slot => {
    return smeltingSlotStateToAPIResponse(session, await slot.getState())
  }))

  return {
    crafting: {
      1: craftingSlots[0],
      2: craftingSlots[1],
      3: craftingSlots[2]
    },
    smelting: {
      1: smeltingSlots[0],
      2: smeltingSlots[1],
      3: smeltingSlots[2]
    }
  }
})

wrap('get', '/api/v1.1/crafting/:slotIndex', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.craftingSlots.length) {
    return
  }
  const slot = player.workshop.craftingSlots[slotIndex - 1]

  if (await slot.updateState()) {
    session.invalidateSequence('crafting')
  }

  return craftingSlotStateToAPIResponse(session, await slot.getState())
})

wrap('post', '/api/v1.1/crafting/:slotIndex/start', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.craftingSlots.length) {
    return
  }
  const slot = player.workshop.craftingSlots[slotIndex - 1]

  try {
    assert(typeof req.body == 'object')
    assert(GUIDUtils.validateGUID(req.body.sessionId))
    assert(GUIDUtils.validateGUID(req.body.recipeId))
    assert(typeof req.body.multiplier == 'number')
    assert(req.body.multiplier > 0)
    assert(typeof req.body.ingredients == 'object' && Array.isArray(req.body.ingredients))
    for (const ingredient of req.body.ingredients) {
      validateRequestItem(ingredient)
    }
  }
  catch (err) {
    if (err instanceof AssertionError) {
      return
    }
    else {
      throw err
    }
  }

  const ingredients: Workshop.CraftingInputItem[] = []
  for (const ingredient of req.body.ingredients as RequestItem[]) {
    const collected = await collectRequestItemFromInventory(player, ingredient)
    if (collected == null) {
      return
    }
    else {
      ingredients.push(collected.instances != null ? { itemId: collected.itemId, instances: collected.instances } : { itemId: collected.itemId, count: collected.count })
    }
  }

  if (await slot.start(req.body.sessionId, req.body.recipeId, req.body.multiplier, ingredients)) {
    session.invalidateSequence('crafting')
    session.invalidateSequence('inventory')
    return {}
  }
  else {
    return
  }
})

wrap('post', '/api/v1.1/crafting/:slotIndex/collectItems', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.craftingSlots.length) {
    return
  }
  const slot = player.workshop.craftingSlots[slotIndex - 1]

  const items = await slot.collect()
  if (items != null) {
    session.invalidateSequence('crafting')
    session.invalidateSequence('inventory')
    session.invalidateSequence('journal')

    await player.inventory.addItemsToInventory(items.itemId, items.count)

    return {
      rewards: {
        inventory: [
          {
            id: items.itemId,
            amount: items.count
          }
        ],
        buildplates: [],
        challenges: [],
        personaItems: [],
        utilityBlocks: []
      }
    }
  }
  else {
    return
  }
})

wrap('post', '/api/v1.1/crafting/:slotIndex/stop', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.craftingSlots.length) {
    return
  }
  const slot = player.workshop.craftingSlots[slotIndex - 1]

  const items = await slot.cancel()
  if (items != null) {
    session.invalidateSequence('crafting')
    session.invalidateSequence('inventory')
    session.invalidateSequence('journal')

    if (items.output != null) {
      await player.inventory.addItemsToInventory(items.output.itemId, items.output.count)
    }
    for (const item of items.input) {
      if (Workshop.isStackableCraftingInputItem(item)) {
        await player.inventory.addItemsToInventory(item.itemId, item.count)
      }
      else {
        for (const instance of item.instances) {
          await player.inventory.addExistingNonStackableItemToInventory(item.itemId, instance.instanceId, instance.item)
        }
      }
    }
  }

  return craftingSlotStateToAPIResponse(session, await slot.getState())
})

wrap('post', '/api/v1.1/crafting/:slotIndex/finish', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.craftingSlots.length) {
    return
  }
  const slot = player.workshop.craftingSlots[slotIndex - 1]

  try {
    assert(typeof req.body == 'object')
    assert(typeof req.body.expectedPurchasePrice == 'number')
    assert(req.body.expectedPurchasePrice > 0)
  }
  catch (err) {
    if (err instanceof AssertionError) {
      return
    }
    else {
      throw err
    }
  }

  if (!await slot.finishNow()) {
    return
  }

  // TODO: validate price, deduct rubies

  // TODO: return new rubies amount (same format as splitRubies)
  return {
    purchased: 5,
    earned: 0
  }
})

wrap('get', '/api/v1.1/crafting/finish/price', false, (req, res, session, player) => {
  // TODO
  return {
    cost: 5,
    discount: 0,
    validTime: req.query.remainingTime
  }
})

wrap('get', '/api/v1.1/smelting/:slotIndex', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.smeltingSlots.length) {
    return
  }
  const slot = player.workshop.smeltingSlots[slotIndex - 1]

  if (await slot.updateState()) {
    session.invalidateSequence('smelting')
  }

  return smeltingSlotStateToAPIResponse(session, await slot.getState())
})

wrap('post', '/api/v1.1/smelting/:slotIndex/start', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.smeltingSlots.length) {
    return
  }
  const slot = player.workshop.smeltingSlots[slotIndex - 1]

  try {
    assert(typeof req.body == 'object')
    assert(GUIDUtils.validateGUID(req.body.sessionId))
    assert(GUIDUtils.validateGUID(req.body.recipeId))
    assert(typeof req.body.multiplier == 'number')
    assert(req.body.multiplier > 0)
    validateRequestItem(req.body.input)
    validateRequestItem(req.body.fuel, true)
  }
  catch (err) {
    if (err instanceof AssertionError) {
      return
    }
    else {
      throw err
    }
  }

  const collectedInput = await collectRequestItemFromInventory(player, req.body.input as RequestItem)
  if (collectedInput == null) {
    return
  }
  const input: Workshop.SmeltingInputItems = collectedInput.instances != null ? { itemId: collectedInput.itemId, instances: collectedInput.instances } : { itemId: collectedInput.itemId, count: collectedInput.count }

  const recipe = RecipesCatalog.getSmeltingRecipe(req.body.recipeId)
  if (recipe == null) {
    return
  }
  const fuelItem = ItemsCatalog.getItem(req.body.fuel.itemId)
  if (fuelItem == null) {
    return
  }
  await slot.updateState()
  const state = await slot.getState()
  const requiredFuelCount = Math.ceil((recipe.heatRequired * req.body.multiplier - (state.heatCarriedOver != null ? (state.heatCarriedOver.fuel.totalBurnDuration - state.heatCarriedOver.secondsUsed) * state.heatCarriedOver.fuel.heatPerSecond : 0)) / (fuelItem.burnRate.burnTime * fuelItem.burnRate.heatPerSecond))
  const collectedFuel = (req.body.fuel as RequestItem).quantity > 0 ? await collectRequestItemFromInventory(player, req.body.fuel as RequestItem, requiredFuelCount) : null
  if ((req.body.fuel as RequestItem).quantity > 0 && collectedFuel == null) {
    return
  }
  const fuel: Workshop.SmeltingInputItems | null = collectedFuel != null ? (collectedFuel.instances != null ? { itemId: collectedFuel.itemId, instances: collectedFuel.instances } : { itemId: collectedFuel.itemId, count: collectedFuel.count }) : null

  if (await slot.start(req.body.sessionId, req.body.recipeId, req.body.multiplier, input, fuel)) {
    session.invalidateSequence('smelting')
    session.invalidateSequence('inventory')
    return {}
  }
  else {
    return
  }
})

wrap('post', '/api/v1.1/smelting/:slotIndex/collectItems', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.smeltingSlots.length) {
    return
  }
  const slot = player.workshop.smeltingSlots[slotIndex - 1]

  const items = await slot.collect()
  if (items != null) {
    session.invalidateSequence('smelting')
    session.invalidateSequence('inventory')
    session.invalidateSequence('journal')

    await player.inventory.addItemsToInventory(items.itemId, items.count)

    return {
      rewards: {
        inventory: [
          {
            id: items.itemId,
            amount: items.count
          }
        ],
        buildplates: [],
        challenges: [],
        personaItems: [],
        utilityBlocks: []
      }
    }
  }
  else {
    return
  }
})

wrap('post', '/api/v1.1/smelting/:slotIndex/stop', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.smeltingSlots.length) {
    return
  }
  const slot = player.workshop.smeltingSlots[slotIndex - 1]

  const items = await slot.cancel()
  if (items != null) {
    session.invalidateSequence('smelting')
    session.invalidateSequence('inventory')
    session.invalidateSequence('journal')

    if (items.output != null) {
      await player.inventory.addItemsToInventory(items.output.itemId, items.output.count)
    }
    if (Workshop.isStackableSmeltingInputItems(items.input)) {
      await player.inventory.addItemsToInventory(items.input.itemId, items.input.count)
    }
    else {
      for (const instance of items.input.instances) {
        await player.inventory.addExistingNonStackableItemToInventory(items.input.itemId, instance.instanceId, instance.item)
      }
    }
    if (items.fuel != null) {
      if (Workshop.isStackableSmeltingInputItems(items.fuel)) {
        await player.inventory.addItemsToInventory(items.fuel.itemId, items.fuel.count)
      }
      else {
        for (const instance of items.fuel.instances) {
          await player.inventory.addExistingNonStackableItemToInventory(items.fuel.itemId, instance.instanceId, instance.item)
        }
      }
    }
  }

  return smeltingSlotStateToAPIResponse(session, await slot.getState())
})

wrap('post', '/api/v1.1/smelting/:slotIndex/finish', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.smeltingSlots.length) {
    return
  }
  const slot = player.workshop.smeltingSlots[slotIndex - 1]

  try {
    assert(typeof req.body == 'object')
    assert(typeof req.body.expectedPurchasePrice == 'number')
    assert(req.body.expectedPurchasePrice > 0)
  }
  catch (err) {
    if (err instanceof AssertionError) {
      return
    }
    else {
      throw err
    }
  }

  if (!await slot.finishNow()) {
    return
  }

  // TODO: validate price, deduct rubies

  // TODO: return new rubies amount (same format as splitRubies)
  return {
    purchased: 5,
    earned: 0
  }
})


wrap('get', '/api/v1.1/smelting/finish/price', false, (req, res, session, player) => {
  // TODO
  return {
    cost: 5,
    discount: 0,
    validTime: req.query.remainingTime
  }
})

wrap('get', '/api/v1.1/player/profile/:userId', false, (req, res, session, player) => {
  // TODO: must we enforce only being able to look up your own profile?
  return {
    levelDistribution: {
      2: {
        experienceRequired: 500,
        rewards: {
          inventory: [
            {
              id: '730573d1-ba59-4fd4-89e0-85d4647466c2',
              amount: 1
            },
            {
              id: '20dbd5fc-06b7-1aa1-5943-7ddaa2061e6a',
              amount: 8
            },
            {
              id: '1eaa0d8c-2d89-2b84-aa1f-b75ccc85faff',
              amount: 64
            }
          ],
          rubies: 15,
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      3: {
        experienceRequired: 1500,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      4: {
        experienceRequired: 2800,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      5: {
        experienceRequired: 4600,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      6: {
        experienceRequired: 6100,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      7: {
        experienceRequired: 7800,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      8: {
        experienceRequired: 10100,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      9: {
        experienceRequired: 13300,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      10: {
        experienceRequired: 17800,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      11: {
        experienceRequired: 21400,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      12: {
        experienceRequired: 25700,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      13: {
        experienceRequired: 31300,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      14: {
        experienceRequired: 39100,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      15: {
        experienceRequired: 50000,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      16: {
        experienceRequired: 58700,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      17: {
        experienceRequired: 68700,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      18: {
        experienceRequired: 82700,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      19: {
        experienceRequired: 101700,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      20: {
        experienceRequired: 128700,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      21: {
        experienceRequired: 137400,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      22: {
        experienceRequired: 147000,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      23: {
        experienceRequired: 157000,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      24: {
        experienceRequired: 169000,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      },
      25: {
        experienceRequired: 185000,
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        }
      }
    },
    totalExperience: 0,
    level: 1,
    currentLevelExperience: 0,
    experienceRemaining: 500,
    health: 20,
    healthPercentage: 100
  }
})

wrap('get', '/api/v1.1/player/challenges', false, (req, res, session, player) => {
  return {
    challenges: {
      'f0532069-a70a-4a01-8611-f770bb46d9cd': {
        referenceId: 'a7ac0df7-4239-491d-9dc4-8691d053ebf4',
        duration: 'Season',
        type: 'Regular',
        endTimeUtc: '2023-09-24T01:00:00Z',
        rewards: {
          inventory: [
            {
              id: 'd9bbd707-8a7a-4edb-a85c-f8ec0c78a1f9',
              amount: 1
            }
          ],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        },
        percentComplete: 0,
        isComplete: false,
        state: 'Active',
        category: 'season_17',
        currentCount: 0,
        totalThreshold: 1,
        parentId: '3d82b9c1-f4e0-4a20-b87e-9a11734bcb6a',
        order: 1,
        rarity: null,
        prerequisiteLogicalCondition: 'And',
        prerequisiteIds: [],
        groupId: 'cc456b52-1586-4e75-b7e9-aa811f609567',
        clientProperties: {}
      },
      'cc456b52-1586-4e75-b7e9-aa811f609567': {
        referenceId: 'a46e0e1e-51cd-4fbc-b3b2-f6d33c78532c',
        duration: 'Season',
        type: 'Regular',
        endTimeUtc: '2023-09-24T01:00:00Z',
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        },
        percentComplete: 0,
        isComplete: false,
        state: 'Active',
        category: 'season_17',
        currentCount: 0,
        totalThreshold: 1,
        parentId: null,
        order: 0,
        rarity: null,
        prerequisiteLogicalCondition: 'And',
        prerequisiteIds: [],
        groupId: 'cc456b52-1586-4e75-b7e9-aa811f609567',
        clientProperties: {}
      },
      '3d82b9c1-f4e0-4a20-b87e-9a11734bcb6a': {
        referenceId: '87ded7ff-f837-4a20-bedd-77aa3d60c060',
        duration: 'Season',
        type: 'Regular',
        endTimeUtc: '2023-09-24T01:00:00Z',
        rewards: {
          inventory: [],
          buildplates: [],
          challenges: [],
          personaItems: [],
          utilityBlocks: []
        },
        percentComplete: 0,
        isComplete: false,
        state: 'Active',
        category: 'season_17',
        currentCount: 0,
        totalThreshold: 1,
        parentId: 'cc456b52-1586-4e75-b7e9-aa811f609567',
        order: 0,
        rarity: null,
        prerequisiteLogicalCondition: 'And',
        prerequisiteIds: [],
        groupId: 'cc456b52-1586-4e75-b7e9-aa811f609567',
        clientProperties: {}
      }
    },
    activeSeasonChallenge: 'f0532069-a70a-4a01-8611-f770bb46d9cd'
  }
})

wrap('get', '/api/v1.1/adventures/scrolls', false, (req, res, session, player) => {
  // TODO: does this belong in player or catalogs?
  return null
})

wrap('get', '/api/v1.1/boosts', true, (req, res, session, player) => {
  return {
    potions: [
      null,
      null,
      null,
      null,
      null
    ],
    miniFigs: [
      null,
      null,
      null,
      null,
      null
    ],
    miniFigRecords: {},
    activeEffects: [],
    statusEffects: {
      tappableInteractionRadius: null,
      experiencePointRate: null,
      itemExperiencePointRates: null,
      attackDamageRate: null,
      playerDefenseRate: null,
      blockDamageRate: null,
      maximumPlayerHealth: 20,
      craftingSpeed: null,
      smeltingFuelIntensity: null,
      foodHealthRate: null
    },
    scenarioBoosts: {},
    expiration: null
  }
})

module.exports = router