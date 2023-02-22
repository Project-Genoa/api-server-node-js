import * as Runtypes from 'runtypes'
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
    const sessionState = await slot.getSessionState()
    if (sessionState != null) {
      const instantState = await Workshop.CraftingSlot.getInstantState(sessionState, new Date().getTime())
      response.sessionId = sessionState.sessionId
      response.recipeId = sessionState.recipeId
      response.output = instantState.output.count > 0 ? { itemId: instantState.output.itemId, quantity: instantState.output.count } : null
      // TODO: I'm using sessionState here rather than instantState because sessionState shows all the input items whereas instantState shows only the ones that haven't been consumed yet - there is some debate as to which behavior is correct
      // TODO: are we supposed to include the item instance info (e.g. health) somewhere?
      response.escrow = sessionState.input.map(item => Workshop.isStackableCraftingInputItem(item) ? { itemId: item.itemId, quantity: item.count, itemInstanceIds: null } : { itemId: item.itemId, quantity: item.instances.length, instanceIds: item.instances.map(instance => instance.instanceId) })
      response.completed = instantState.completedRounds
      response.available = instantState.availableRounds
      response.total = sessionState.totalRounds
      response.nextCompletionUtc = instantState.nextCompletionTime != null ? new Date(instantState.nextCompletionTime) : null
      response.totalCompletionUtc = new Date(instantState.totalCompletionTime)
      response.state = instantState.completedRounds == sessionState.totalRounds ? 'Completed' : 'Active'
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
    var fuel: Workshop.FurnaceFuel | null = null
    const sessionState = await slot.getSessionState()
    if (Workshop.isSmeltingSlotSessionState(sessionState)) {
      const instantState = await Workshop.SmeltingSlot.getInstantState(sessionState, new Date().getTime())

      response.fuel = instantState.fuel != null ? {
        burnRate: {
          burnTime: instantState.fuel.burnDuration,
          heatPerSecond: instantState.fuel.heatPerSecond
        },
        itemId: instantState.fuel.item.itemId,
        quantity: Workshop.isStackableSmeltingInputItems(instantState.fuel.item) ? instantState.fuel.item.count : instantState.fuel.item.instances.length,
        itemInstanceIds: Workshop.isStackableSmeltingInputItems(instantState.fuel.item) ? null : instantState.fuel.item.instances.map(instance => instance.instanceId)
      } : null
      response.sessionId = sessionState.sessionId
      response.recipeId = sessionState.recipeId
      response.output = { itemId: sessionState.outputItemId, quantity: 1 }
      response.escrow = instantState.input == null ? [] : [Workshop.isStackableSmeltingInputItems(instantState.input) ? { itemId: instantState.input.itemId, quantity: instantState.input.count, itemInstanceIds: null } : { itemId: instantState.input.itemId, quantity: instantState.input.instances.length, instanceIds: instantState.input.instances.map(instance => instance.instanceId) }]
      response.completed = instantState.completedRounds
      response.available = instantState.availableRounds
      response.total = sessionState.totalRounds
      response.nextCompletionUtc = instantState.nextCompletionTime != null ? new Date(instantState.nextCompletionTime) : null
      response.totalCompletionUtc = new Date(instantState.totalCompletionTime)
      response.state = instantState.completedRounds == sessionState.totalRounds ? 'Completed' : 'Active'

      if (instantState.burning != null) {
        response.burning = {
          burnStartTime: new Date(instantState.burning.burnStartTime),
          burnsUntil: new Date(instantState.burning.burnEndTime),
          fuel: null
        }
        fuel = instantState.heat.fuel
      }
      else {
        response.burning = {
          remainingBurnTime: '00:00:' + Math.round(instantState.heat.remainingHeat / instantState.heat.fuel.heatPerSecond),
          heatDepleted: instantState.heat.fuel.totalHeat - instantState.heat.remainingHeat,
          fuel: null
        }
        fuel = instantState.heat.fuel
      }
    }
    else if (sessionState.heatCarriedOver != null) {
      response.burning = {
        remainingBurnTime: '00:00:' + Math.round(sessionState.heatCarriedOver.remainingHeat / sessionState.heatCarriedOver.fuel.heatPerSecond),
        heatDepleted: sessionState.heatCarriedOver.fuel.totalHeat - sessionState.heatCarriedOver.remainingHeat,
        fuel: null
      }
      fuel = sessionState.heatCarriedOver.fuel
    }
    if (fuel != null) {
      response.burning.fuel = {
        burnRate: {
          burnTime: fuel.burnDuration,
          heatPerSecond: fuel.heatPerSecond
        },
        itemId: fuel.item.itemId,
        quantity: Workshop.isStackableSmeltingInputItems(fuel.item) ? fuel.item.count : fuel.item.instances.length,
        itemInstanceIds: Workshop.isStackableSmeltingInputItems(fuel.item) ? null : fuel.item.instances.map(instance => instance.instanceId)
      }
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

    if (items.count > 0) {
      await player.inventory.addItemsToInventory(items.itemId, items.count, true)
    }

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

    if (items.output.count > 0) {
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

  const sessionState = await slot.getSessionState()
  if (sessionState == null) {
    return
  }
  const instantState = Workshop.CraftingSlot.getInstantState(sessionState, new Date().getTime())

  const remainingTime = Math.ceil((instantState.totalCompletionTime - new Date().getTime()) / 1000)
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
    const state = await slot.getSessionState()
    if (Workshop.isSmeltingSlotSessionState(state)) {
      return
    }
    const requiredFuelCount = Math.ceil((recipe.heatRequired * request.value.multiplier - (state.heatCarriedOver != null ? state.heatCarriedOver.remainingHeat : 0)) / (fuelItem.burnRate.burnTime * fuelItem.burnRate.heatPerSecond))
    if (request.value.fuel.quantity < requiredFuelCount) {
      return
    }
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

    if (items.count > 0) {
      await player.inventory.addItemsToInventory(items.itemId, items.count, true)
    }

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

    if (items.output.count > 0) {
      await player.inventory.addItemsToInventory(items.output.itemId, items.output.count, true)
    }
    if (items.input != null) {
      if (Workshop.isStackableSmeltingInputItems(items.input)) {
        await player.inventory.addItemsToInventory(items.input.itemId, items.input.count)
      }
      else {
        for (const instance of items.input.instances) {
          await player.inventory.addExistingNonStackableItemToInventory(items.input.itemId, instance.instanceId, instance.item)
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

  const sessionState = await slot.getSessionState()
  if (!Workshop.isSmeltingSlotSessionState(sessionState)) {
    return
  }
  const instantState = Workshop.SmeltingSlot.getInstantState(sessionState, new Date().getTime())

  const remainingTime = Math.ceil((instantState.totalCompletionTime - new Date().getTime()) / 1000)
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