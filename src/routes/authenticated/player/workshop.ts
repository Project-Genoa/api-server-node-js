import Runtypes from 'runtypes'
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

async function craftingSlotToAPIResponse(session: ModifiableSession, slot: Workshop.CraftingSlot) {
  const response: any = {
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

  const lockState = await slot.getLockState()
  if (lockState.locked) {
    response.state = 'Locked'
    response.unlockPrice = { cost: lockState.unlockPrice, discount: 0 }
  }
  else {
    const state = await slot.getState()

    if (Workshop.isActiveCraftingSlotState(state)) {
      response.sessionId = state.sessionId
      response.recipeId = state.recipeId
      response.output = { itemId: state.output.itemId, quantity: state.output.count }
      response.escrow = state.input == null ? [] : state.input.map(item => Workshop.isStackableCraftingInputItem(item) ? { itemId: item.itemId, quantity: item.count, itemInstanceIds: null } : { itemId: item.itemId, quantity: item.instances.length, instanceIds: item.instances.map(instance => instance.instanceId) }) // TODO: are we supposed to include the item instance info (e.g. health) somewhere?
      response.completed = state.completedRounds
      response.available = state.availableRounds
      response.total = state.totalRounds
      response.nextCompletionUtc = state.nextCompletionTime != null ? new Date(state.nextCompletionTime) : null
      response.totalCompletionUtc = new Date(state.totalCompletionTime)
      response.state = state.nextCompletionTime != null ? 'Active' : 'Completed'
    }
  }

  return response
}

async function smeltingSlotToAPIResponse(session: ModifiableSession, slot: Workshop.SmeltingSlot) {
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

  const lockState = await slot.getLockState()
  if (lockState.locked) {
    response.state = 'Locked'
    response.unlockPrice = { cost: lockState.unlockPrice, discount: 0 }
  }
  else {
    const state = await slot.getState()

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
    }
  }

  return response
}

const RequestItem = Runtypes.Record({
  itemId: Runtypes.String.withConstraint(value => GUIDUtils.validateGUID(value)),
  quantity: Runtypes.Number.withConstraint(value => Number.isInteger(value)).withConstraint(value => value >= 0),
  itemInstanceIds: Runtypes.Union(Runtypes.Array(Runtypes.String.withConstraint(value => GUIDUtils.validateGUID(value))), Runtypes.Null)
}).withConstraint(value => value.itemInstanceIds == null || value.itemInstanceIds.length == value.quantity)

async function collectRequestItemFromInventory(player: Player, item: Runtypes.Static<typeof RequestItem>, maxCount: number | null = null): Promise<{ itemId: string; count: number; instances: { instanceId: string; item: Inventory.NonStackableItemInstance }[] | null } | null> {
  const inventory = await player.inventory.getInventory()

  const itemId = item.itemId
  if (ItemsCatalog.isItemStackable(itemId)) {
    if (item.itemInstanceIds != null) {
      return null
    }

    const targetCount = maxCount != null ? Math.min(item.quantity, maxCount) : (item.quantity)
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
    if (item.itemInstanceIds == null) {
      return null
    }

    const instances: { instanceId: string, item: Inventory.NonStackableItemInstance }[] = []
    for (const instanceId of item.itemInstanceIds) {
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

const PurchaseRequest = Runtypes.Record({
  expectedPurchasePrice: Runtypes.Number.withConstraint(value => Number.isInteger(value)).withConstraint(value => value > 0)
})

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
    return await craftingSlotToAPIResponse(session, slot)
  }))
  const smeltingSlots = await Promise.all(player.workshop.smeltingSlots.map(async slot => {
    return await smeltingSlotToAPIResponse(session, slot)
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

  return await craftingSlotToAPIResponse(session, slot)
})

const CraftingStartRequest = Runtypes.Record({
  sessionId: Runtypes.String.withConstraint(value => GUIDUtils.validateGUID(value)),
  recipeId: Runtypes.String.withConstraint(value => GUIDUtils.validateGUID(value)),
  multiplier: Runtypes.Number.withConstraint(value => Number.isInteger(value)).withConstraint(value => value > 0),
  ingredients: Runtypes.Array(RequestItem.withConstraint(value => value.quantity > 0))
})

wrap(router, 'post', '/api/v1.1/crafting/:slotIndex/start', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.craftingSlots.length) {
    return
  }
  const slot = player.workshop.craftingSlots[slotIndex - 1]
  const request = CraftingStartRequest.validate(req.body)
  if (!request.success) {
    return
  }

  if ((await slot.getLockState()).locked) {
    return
  }

  const ingredients: Workshop.CraftingInputItem[] = []
  for (const ingredient of request.value.ingredients) {
    const collected = await collectRequestItemFromInventory(player, ingredient)
    if (collected == null) {
      return
    }
    else {
      ingredients.push(collected.instances != null ? { itemId: collected.itemId, instances: collected.instances } : { itemId: collected.itemId, count: collected.count })
    }
  }

  if (await slot.start(request.value.sessionId, request.value.recipeId, request.value.multiplier, ingredients)) {
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

    await player.inventory.addItemsToInventory(items.itemId, items.count, true)

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
      await player.inventory.addItemsToInventory(items.output.itemId, items.output.count, true)
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

  return await craftingSlotToAPIResponse(session, slot)
})

wrap(router, 'post', '/api/v1.1/crafting/:slotIndex/finish', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.craftingSlots.length) {
    return
  }
  const slot = player.workshop.craftingSlots[slotIndex - 1]
  const request = PurchaseRequest.validate(req.body)
  if (!request.success) {
    return
  }

  const state = await slot.getState()
  if (!Workshop.isActiveCraftingSlotState(state)) {
    return
  }
  const remainingTime = Math.ceil((state.totalCompletionTime - new Date().getTime()) / 1000)
  if (remainingTime < 0) {
    return
  }
  const price = Workshop.CraftingSlot.getPriceToFinish(remainingTime)

  if (request.value.expectedPurchasePrice < price.price) {
    return
  }

  if (!await player.rubies.spendRubies(price.price)) {
    return
  }

  if (!await slot.finishNow()) {
    return
  }

  const rubies = await player.rubies.getRubies()
  return {
    purchased: rubies.purchased,
    earned: rubies.earned
  }
})

wrap(router, 'get', '/api/v1.1/crafting/finish/price', false, (req, res, session, player) => {
  const remainingTime = req.query.remainingTime
  if (typeof remainingTime != 'string') {
    return
  }
  const remainingTimeSeconds = remainingTime.split(':').map(part => parseInt(part)).reduce((time, part) => time * 60 + part, 0)
  if (Number.isNaN(remainingTimeSeconds) || remainingTimeSeconds < 0) {
    return
  }

  const price = Workshop.CraftingSlot.getPriceToFinish(remainingTimeSeconds)

  const validTime = remainingTimeSeconds - price.changesAt

  return {
    cost: price.price,
    discount: 0,
    validTime: '00:00:' + validTime
  }
})

wrap(router, 'post', '/api/v1.1/crafting/:slotIndex/unlock', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.craftingSlots.length) {
    return
  }
  const slot = player.workshop.craftingSlots[slotIndex - 1]
  const request = PurchaseRequest.validate(req.body)
  if (!request.success) {
    return
  }

  const lockState = await slot.getLockState()
  if (!lockState.locked || request.value.expectedPurchasePrice != lockState.unlockPrice) {
    return
  }

  if (!await player.rubies.spendRubies(lockState.unlockPrice)) {
    return
  }

  if (!await slot.unlock()) {
    return
  }
  session.invalidateSequence('crafting')

  return {}
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

  return await smeltingSlotToAPIResponse(session, slot)
})

const SmeltingStartRequest = Runtypes.Record({
  sessionId: Runtypes.String.withConstraint(value => GUIDUtils.validateGUID(value)),
  recipeId: Runtypes.String.withConstraint(value => GUIDUtils.validateGUID(value)),
  multiplier: Runtypes.Number.withConstraint(value => Number.isInteger(value)).withConstraint(value => value > 0),
  input: RequestItem.withConstraint(value => value.quantity > 0),
  fuel: Runtypes.Optional(Runtypes.Union(RequestItem, Runtypes.Nullish))
})

wrap(router, 'post', '/api/v1.1/smelting/:slotIndex/start', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.smeltingSlots.length) {
    return
  }
  const slot = player.workshop.smeltingSlots[slotIndex - 1]
  const request = SmeltingStartRequest.validate(req.body)
  if (!request.success) {
    return
  }

  if ((await slot.getLockState()).locked) {
    return
  }

  const collectedInput = await collectRequestItemFromInventory(player, request.value.input)
  if (collectedInput == null) {
    return
  }
  const input: Workshop.SmeltingInputItems = collectedInput.instances != null ? { itemId: collectedInput.itemId, instances: collectedInput.instances } : { itemId: collectedInput.itemId, count: collectedInput.count }

  var fuel: Workshop.SmeltingInputItems | null = null
  if (request.value.fuel != null && request.value.fuel.quantity > 0) {
    const recipe = RecipesCatalog.getSmeltingRecipe(request.value.recipeId)
    if (recipe == null) {
      return
    }
    const fuelItem = ItemsCatalog.getItem(request.value.fuel.itemId)
    if (fuelItem == null) {
      return
    }
    await slot.updateState()
    const state = await slot.getState()
    const requiredFuelCount = Math.ceil((recipe.heatRequired * request.value.multiplier - (state.heatCarriedOver != null ? (state.heatCarriedOver.fuel.totalBurnDuration - state.heatCarriedOver.secondsUsed) * state.heatCarriedOver.fuel.heatPerSecond : 0)) / (fuelItem.burnRate.burnTime * fuelItem.burnRate.heatPerSecond))
    const collectedFuel = await collectRequestItemFromInventory(player, request.value.fuel, requiredFuelCount)
    if (collectedFuel == null) {
      return
    }
    fuel = collectedFuel.instances != null ? { itemId: collectedFuel.itemId, instances: collectedFuel.instances } : { itemId: collectedFuel.itemId, count: collectedFuel.count }
  }
  else {
    fuel = null
  }

  if (await slot.start(request.value.sessionId, request.value.recipeId, request.value.multiplier, input, fuel)) {
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

    await player.inventory.addItemsToInventory(items.itemId, items.count, true)

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
      await player.inventory.addItemsToInventory(items.output.itemId, items.output.count, true)
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

  return await smeltingSlotToAPIResponse(session, slot)
})

wrap(router, 'post', '/api/v1.1/smelting/:slotIndex/finish', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.smeltingSlots.length) {
    return
  }
  const slot = player.workshop.smeltingSlots[slotIndex - 1]
  const request = PurchaseRequest.validate(req.body)
  if (!request.success) {
    return
  }

  const state = await slot.getState()
  if (!Workshop.isActiveSmeltingSlotState(state)) {
    return
  }
  const remainingTime = Math.ceil((state.endTime - new Date().getTime()) / 1000)
  if (remainingTime < 0) {
    return
  }
  const price = Workshop.SmeltingSlot.getPriceToFinish(remainingTime)

  if (request.value.expectedPurchasePrice < price.price) {
    return
  }

  if (!await player.rubies.spendRubies(price.price)) {
    return
  }

  if (!await slot.finishNow()) {
    return
  }

  const rubies = await player.rubies.getRubies()
  return {
    purchased: rubies.purchased,
    earned: rubies.earned
  }
})

wrap(router, 'get', '/api/v1.1/smelting/finish/price', false, (req, res, session, player) => {
  const remainingTime = req.query.remainingTime
  if (typeof remainingTime != 'string') {
    return
  }
  const remainingTimeSeconds = remainingTime.split(':').map(part => parseInt(part)).reduce((time, part) => time * 60 + part, 0)
  if (Number.isNaN(remainingTimeSeconds) || remainingTimeSeconds < 0) {
    return
  }

  const price = Workshop.SmeltingSlot.getPriceToFinish(remainingTimeSeconds)

  const validTime = remainingTimeSeconds - price.changesAt

  return {
    cost: price.price,
    discount: 0,
    validTime: '00:00:' + validTime
  }
})

wrap(router, 'post', '/api/v1.1/smelting/:slotIndex/unlock', true, async (req, res, session, player) => {
  const slotIndex = parseInt(req.params.slotIndex)
  if (Number.isNaN(slotIndex) || slotIndex < 1 || slotIndex > player.workshop.smeltingSlots.length) {
    return
  }
  const slot = player.workshop.smeltingSlots[slotIndex - 1]
  const request = PurchaseRequest.validate(req.body)
  if (!request.success) {
    return
  }

  const lockState = await slot.getLockState()
  if (!lockState.locked || request.value.expectedPurchasePrice != lockState.unlockPrice) {
    return
  }

  if (!await player.rubies.spendRubies(lockState.unlockPrice)) {
    return
  }

  if (!await slot.unlock()) {
    return
  }
  session.invalidateSequence('smelting')

  return {}
})

export = router