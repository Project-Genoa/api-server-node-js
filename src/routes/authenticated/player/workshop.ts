import assert, { AssertionError } from 'assert'
import Express from 'express'
const router = Express.Router()
import { wrap } from './wrap'

import GUIDUtils from '../../../utils/guid'
import { ModifiableSession } from '../../../model/sessions'

import ItemsCatalog from '../../../catalog/items'
import RecipesCatalog, { SmeltingRecipe } from '../../../catalog/recipes'

import Player from '../../../model/player'
import * as Inventory from '../../../model/player/inventory'
import * as Workshop from '../../../model/player/workshop'

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

wrap(router, 'get', '/api/v1.1/player/utilityBlocks', false, async (req, res, session, player) => {
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

wrap(router, 'get', '/api/v1.1/crafting/:slotIndex', true, async (req, res, session, player) => {
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

wrap(router, 'post', '/api/v1.1/crafting/:slotIndex/start', true, async (req, res, session, player) => {
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

wrap(router, 'post', '/api/v1.1/crafting/:slotIndex/collectItems', true, async (req, res, session, player) => {
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

wrap(router, 'post', '/api/v1.1/crafting/:slotIndex/stop', true, async (req, res, session, player) => {
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

wrap(router, 'post', '/api/v1.1/crafting/:slotIndex/finish', true, async (req, res, session, player) => {
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

wrap(router, 'get', '/api/v1.1/crafting/finish/price', false, (req, res, session, player) => {
  // TODO
  return {
    cost: 5,
    discount: 0,
    validTime: req.query.remainingTime
  }
})

wrap(router, 'get', '/api/v1.1/smelting/:slotIndex', true, async (req, res, session, player) => {
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

wrap(router, 'post', '/api/v1.1/smelting/:slotIndex/start', true, async (req, res, session, player) => {
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

wrap(router, 'post', '/api/v1.1/smelting/:slotIndex/collectItems', true, async (req, res, session, player) => {
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

wrap(router, 'post', '/api/v1.1/smelting/:slotIndex/stop', true, async (req, res, session, player) => {
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

wrap(router, 'post', '/api/v1.1/smelting/:slotIndex/finish', true, async (req, res, session, player) => {
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

wrap(router, 'get', '/api/v1.1/smelting/finish/price', false, (req, res, session, player) => {
  // TODO
  return {
    cost: 5,
    discount: 0,
    validTime: req.query.remainingTime
  }
})

export = router