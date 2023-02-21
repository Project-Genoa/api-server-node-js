import assert from 'assert'
import Player from '../player'
import * as Inventory from './inventory'

import RecipesCatalog, { CraftingRecipe, SmeltingRecipe } from '../../catalog/recipes'
import ItemsCatalog from '../../catalog/items'

import config from '../../config'

export default class Workshop {
  readonly player: Player

  readonly craftingSlots: readonly [CraftingSlot, CraftingSlot, CraftingSlot]
  readonly smeltingSlots: readonly [SmeltingSlot, SmeltingSlot, SmeltingSlot]

  constructor(player: Player) {
    this.player = player

    this.craftingSlots = [new CraftingSlot(this.player, 0), new CraftingSlot(this.player, 1), new CraftingSlot(this.player, 2)]
    this.smeltingSlots = [new SmeltingSlot(this.player, 0), new SmeltingSlot(this.player, 1), new SmeltingSlot(this.player, 2)]
  }
}

export type WorkshopSlotType = 'crafting' | 'smelting'

export class WorkshopSlot {
  readonly player: Player
  readonly slotIndex: number
  readonly type: WorkshopSlotType

  private locked: boolean | null

  constructor(player: Player, slotIndex: number, type: WorkshopSlotType) {
    this.player = player
    this.slotIndex = slotIndex
    this.type = type

    this.locked = null
  }

  async getLockState(): Promise<{ locked: true, unlockPrice: number } | { locked: false }> {
    if (this.locked == null) {
      this.locked = await this.player.transaction.get('player', this.player.userId, 'workshop.lock.' + this.type + '.' + this.slotIndex) as boolean | null ?? true
    }
    return { locked: this.locked, unlockPrice: 5 }  // TODO: unlock price should be in a data file somewhere
  }

  async unlock(): Promise<boolean> {
    const locked = await this.getLockState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.lock.' + this.type + '.' + this.slotIndex, true)

    if (!locked) {
      return false
    }

    await this.player.transaction.set('player', this.player.userId, 'workshop.lock.' + this.type + '.' + this.slotIndex, false)
    this.locked = false

    return true
  }
}

export type CraftingInputItem = StackableCraftingInputItem | NonStackableCraftingInputItem
export interface StackableCraftingInputItem { itemId: string, count: number }
export interface NonStackableCraftingInputItem { itemId: string, instances: { instanceId: string, item: Inventory.NonStackableItemInstance }[] }
export interface CraftingSlotSessionState {
  sessionId: string,
  recipeId: string,
  startTime: number,
  input: CraftingInputItem[],
  totalRounds: number,
  collectedRounds: number,
  finishedEarly: boolean
}
export interface CraftingSlotInstantState {
  input: CraftingInputItem[],
  output: { itemId: string, count: number },
  completedRounds: number,
  availableRounds: number,
  nextCompletionTime: number | null,
  totalCompletionTime: number
}
export function isStackableCraftingInputItem(item: CraftingInputItem): item is StackableCraftingInputItem {
  return 'count' in item
}

export class CraftingSlot extends WorkshopSlot {
  static getPriceToFinish(remainingTime: number): { price: number, changesAt: number } {
    assert(remainingTime >= 0)

    // TODO: the parameters for this should be in a data file
    return {
      price: Math.ceil(remainingTime / 10) * 5,
      changesAt: Math.max((Math.ceil(remainingTime / 10) - 1) * 10, 0)
    }
  }

  static getInstantState(sessionState: CraftingSlotSessionState, now: number): CraftingSlotInstantState {
    const recipe = RecipesCatalog.getCraftingRecipe(sessionState.recipeId)
    assert(recipe != null)

    const completedRounds = sessionState.finishedEarly ? sessionState.totalRounds : Math.min(Math.floor((now - sessionState.startTime) / (recipe.duration * 1000)), sessionState.totalRounds)
    const availableRounds = completedRounds - sessionState.collectedRounds
    const nextCompletionTime = completedRounds >= sessionState.totalRounds ? null : (sessionState.startTime + (completedRounds + 1) * recipe.duration * 1000)
    const totalCompletionTime = sessionState.startTime + sessionState.totalRounds * recipe.duration * 1000

    const input = sessionState.input.map(item => isStackableCraftingInputItem(item) ? { itemId: item.itemId, count: item.count } : { itemId: item.itemId, instances: item.instances.map(instance => instance) })
    for (const ingredient of recipe.input) {
      var requiredCount = ingredient.count * completedRounds
      for (const item of input) {
        if (ingredient.itemIds.includes(item.itemId)) {
          if (isStackableCraftingInputItem(item)) {
            const takenCount = Math.min(requiredCount, item.count)
            requiredCount -= takenCount
            item.count -= takenCount
          }
          else {
            while (requiredCount > 0 && item.instances.length > 0) {
              requiredCount--
              item.instances.shift()
            }
          }
        }
      }
      assert(requiredCount == 0)
    }
    const output = { itemId: recipe.output.itemId, count: recipe.output.count * availableRounds }

    return {
      input: input.filter(item => isStackableCraftingInputItem(item) ? item.count > 0 : item.instances.length > 0),
      output: output,
      completedRounds: completedRounds,
      availableRounds: availableRounds,
      nextCompletionTime: nextCompletionTime,
      totalCompletionTime: totalCompletionTime
    }
  }

  constructor(player: Player, slotIndex: number) {
    super(player, slotIndex, 'crafting')
  }

  async getSessionState(): Promise<CraftingSlotSessionState | null> {
    return await this.player.transaction.get('player', this.player.userId, 'workshop.crafting.' + this.slotIndex) as CraftingSlotSessionState | null
  }

  private async setSessionState(state: CraftingSlotSessionState | null) {
    await this.player.transaction.set('player', this.player.userId, 'workshop.crafting.' + this.slotIndex, state)
  }

  async start(sessionId: string, recipeId: string, rounds: number, ingredients: CraftingInputItem[]): Promise<boolean> {
    const now = new Date().getTime()

    if (await this.getSessionState() != null) {
      return false
    }

    const recipe = RecipesCatalog.getCraftingRecipe(recipeId)
    if (recipe == null) {
      return false
    }

    const providedCounts: number[] = Array(recipe.input.length).fill(0)
    for (const ingredient of ingredients) {
      const index = recipe.input.findIndex(recipeIngredient => recipeIngredient.itemIds.includes(ingredient.itemId))
      if (index == -1) {
        return false
      }
      providedCounts[index] += isStackableCraftingInputItem(ingredient) ? ingredient.count : ingredient.instances.length
    }
    for (var index = 0; index < recipe.input.length; index++) {
      if (providedCounts[index] != recipe.input[index].count * rounds) {
        return false
      }
    }

    if (recipe.returnItems.length != 0) {
      // TODO: figure out how recipes with returnItems are supposed to be implemented
      return false
    }

    const sessionState: CraftingSlotSessionState = {
      sessionId: sessionId,
      recipeId: recipeId,
      startTime: now,
      input: ingredients,
      totalRounds: rounds,
      collectedRounds: 0,
      finishedEarly: false
    }
    await this.setSessionState(sessionState)

    return true
  }

  async collect(): Promise<{ itemId: string, count: number } | null> {
    const now = new Date().getTime()

    const sessionState = await this.getSessionState()
    if (sessionState == null) {
      return null
    }
    const instantState = CraftingSlot.getInstantState(sessionState, now)

    sessionState.collectedRounds += instantState.availableRounds
    if (sessionState.collectedRounds == sessionState.totalRounds) {
      await this.setSessionState(null)
    }
    else {
      await this.setSessionState(sessionState)
    }

    return instantState.output
  }

  async cancel(): Promise<{ output: { itemId: string, count: number }, input: CraftingInputItem[] } | null> {
    const now = new Date().getTime()

    const sessionState = await this.getSessionState()
    if (sessionState == null) {
      return null
    }
    const instantState = CraftingSlot.getInstantState(sessionState, now)

    await this.setSessionState(null)

    return { output: instantState.output, input: instantState.input }
  }

  async finishNow(): Promise<boolean> {
    const now = new Date().getTime()

    const sessionState = await this.getSessionState()
    if (sessionState == null) {
      return false
    }
    const instantState = CraftingSlot.getInstantState(sessionState, now)

    if (instantState.completedRounds == sessionState.totalRounds) {
      return false
    }

    sessionState.finishedEarly = true
    await this.setSessionState(sessionState)

    return true
  }
}

export type SmeltingInputItems = StackableSmeltingInputItems | NonStackableSmeltingInputItems
export interface StackableSmeltingInputItems { itemId: string, count: number }
export interface NonStackableSmeltingInputItems { itemId: string, instances: { instanceId: string, item: Inventory.NonStackableItemInstance }[] }
export type SmeltingSlotState = ActiveSmeltingSlotState | EmptySmeltingSlotState
export interface ActiveSmeltingSlotState {
  fuel: FurnaceFuel | null,
  heat: ActiveFurnaceHeat | PausedFurnaceHeat,
  sessionId: string,
  recipeId: string,
  input: SmeltingInputItems | null,
  outputItemId: string,
  completedRounds: number,
  availableRounds: number,
  totalRounds: number,
  endTime: number,
  heatRequiredPerRound: number,
  currentRoundRequiredHeat: number,
  currentRoundEndTime: number
}
export interface EmptySmeltingSlotState {
  fuel: FurnaceFuel | null,
  heat: PausedFurnaceHeat | null
}
export interface FurnaceFuel {
  item: SmeltingInputItems,
  burnDuration: number,
  heatPerSecond: number,
  totalHeat: number
}
export interface ActiveFurnaceHeat {
  fuel: FurnaceFuel,
  remainingHeat: number,
  burning: true,
  burnStartTime: number,
  burnEndTime: number,
  remainingHeatAtBurnStart: number
}
export interface PausedFurnaceHeat {
  fuel: FurnaceFuel,
  remainingHeat: number,
  burning: false
}
export function isActiveSmeltingSlotState(state: SmeltingSlotState): state is ActiveSmeltingSlotState {
  return 'sessionId' in state
}
export function isActiveFurnaceHeat(heat: ActiveFurnaceHeat | PausedFurnaceHeat): heat is ActiveFurnaceHeat {
  return heat.burning
}
export function isStackableSmeltingInputItems(item: SmeltingInputItems): item is StackableSmeltingInputItems {
  return 'count' in item
}

function calculateDurationForHeat(requiredHeat: number, currentFurnceHeat: ActiveFurnaceHeat | PausedFurnaceHeat | null, queuedFuel: FurnaceFuel | null) {
  var duration = 0
  if (currentFurnceHeat != null) {
    const obtainedHeat = currentFurnceHeat.remainingHeat > requiredHeat ? requiredHeat : currentFurnceHeat.remainingHeat
    duration += obtainedHeat / currentFurnceHeat.fuel.heatPerSecond
    requiredHeat -= obtainedHeat
  }
  if (queuedFuel != null) {
    duration += requiredHeat / queuedFuel.heatPerSecond
  }
  return duration
}

function takeNextFuelItem(state: ActiveSmeltingSlotState) {
  const fuel = state.fuel
  assert(fuel != null)

  var item: SmeltingInputItems
  if (isStackableSmeltingInputItems(fuel.item)) {
    fuel.item.count--
    if (fuel.item.count == 0) {
      state.fuel = null
    }

    item = {
      itemId: fuel.item.itemId,
      count: 1
    }
  }
  else {
    const instance = fuel.item.instances.shift()
    assert(instance !== undefined)
    if (fuel.item.instances.length == 0) {
      state.fuel = null
    }

    item = {
      itemId: fuel.item.itemId,
      instances: [instance]
    }
  }

  assert(isActiveFurnaceHeat(state.heat))
  state.heat = {
    fuel: {
      item: item,
      burnDuration: fuel.burnDuration,
      heatPerSecond: fuel.heatPerSecond,
      totalHeat: fuel.totalHeat
    },
    remainingHeat: fuel.totalHeat,
    burning: true,
    burnStartTime: state.heat.burnEndTime,
    burnEndTime: state.heat.burnEndTime + fuel.burnDuration * 1000,
    remainingHeatAtBurnStart: fuel.totalHeat
  }
}

export class SmeltingSlot extends WorkshopSlot {
  static getPriceToFinish(remainingTime: number): { price: number, changesAt: number } {
    assert(remainingTime >= 0)

    // TODO: the parameters for this should be in a data file
    return {
      price: Math.ceil(remainingTime / 10) * 5,
      changesAt: Math.max((Math.ceil(remainingTime / 10) - 1) * 10, 0)
    }
  }

  private state: SmeltingSlotState | null

  constructor(player: Player, slotIndex: number) {
    super(player, slotIndex, 'smelting')

    this.state = null
  }

  async getState(): Promise<SmeltingSlotState> {
    if (this.state == null) {
      this.state = await this.player.transaction.get('player', this.player.userId, 'workshop.smelting.' + this.slotIndex) as SmeltingSlotState | null ?? { fuel: null, heat: null }
    }
    return this.state
  }

  async updateState(): Promise<boolean> {
    const now = new Date().getTime()

    const state = await this.getState()
    if (isActiveSmeltingSlotState(state)) {
      var changed = false

      while (state.completedRounds < state.totalRounds && now >= state.currentRoundEndTime - config.craftingGracePeriod) {
        assert(state.input != null)
        if (isStackableSmeltingInputItems(state.input)) {
          state.input.count--
          if (state.input.count == 0) {
            state.input = null
          }
        }
        else {
          state.input.instances.shift()
          if (state.input.instances.length == 0) {
            state.input = null
          }
        }

        while (state.currentRoundRequiredHeat > state.heat.remainingHeat) {
          state.currentRoundRequiredHeat -= state.heat.remainingHeat
          takeNextFuelItem(state)
        }
        state.heat.remainingHeat -= state.currentRoundRequiredHeat

        state.completedRounds++
        state.availableRounds++
        state.currentRoundRequiredHeat = state.heatRequiredPerRound
        state.currentRoundEndTime = state.currentRoundEndTime + calculateDurationForHeat(state.heatRequiredPerRound, state.heat, state.fuel) * 1000

        if (state.completedRounds == state.totalRounds) {
          state.heat = {
            fuel: state.heat.fuel,
            remainingHeat: state.heat.remainingHeat,
            burning: false
          }
        }

        changed = true
      }
      if (state.completedRounds < state.totalRounds) {
        assert(isActiveFurnaceHeat(state.heat))
        while (now > state.heat.burnEndTime) {
          if (state.currentRoundRequiredHeat < state.heat.remainingHeat) {
            break
          }
          state.currentRoundRequiredHeat -= state.heat.remainingHeat

          takeNextFuelItem(state)

          changed = true
        }
      }

      if (changed) {
        await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, state)
      }

      return changed
    }
    else {
      return false
    }
  }

  async start(sessionId: string, recipeId: string, rounds: number, input: SmeltingInputItems, fuel: SmeltingInputItems | null): Promise<{ success: false } | { success: true, oldFuel: SmeltingInputItems | null }> {
    const now = new Date().getTime()

    const state = await this.getState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, { fuel: null, heat: null })

    if (isActiveSmeltingSlotState(state)) {
      return { success: false }
    }

    const recipe = RecipesCatalog.getSmeltingRecipe(recipeId)
    if (recipe == null) {
      return { success: false }
    }

    if (fuel != null && ItemsCatalog.getItem(fuel.itemId).fuelReturnItems.length != 0) {
      // TODO: implement returnItems
      return { success: false }
    }
    const addedFuel: FurnaceFuel | null = fuel != null ? {
      item: fuel,
      burnDuration: ItemsCatalog.getItem(fuel.itemId).burnRate.burnTime,
      heatPerSecond: ItemsCatalog.getItem(fuel.itemId).burnRate.heatPerSecond,
      totalHeat: ItemsCatalog.getItem(fuel.itemId).burnRate.burnTime * ItemsCatalog.getItem(fuel.itemId).burnRate.heatPerSecond
    } : null

    if (input.itemId != recipe.input) {
      return { success: false }
    }
    if ((isStackableSmeltingInputItems(input) ? input.count : input.instances.length) != rounds) {
      return { success: false }
    }
    const requiredHeat = recipe.heatRequired * rounds
    var availableHeat = 0
    if (state.heat != null) {
      availableHeat += state.heat.remainingHeat
    }
    if (addedFuel != null) {
      availableHeat += addedFuel.totalHeat * (isStackableSmeltingInputItems(addedFuel.item) ? addedFuel.item.count : addedFuel.item.instances.length)
    }
    if (availableHeat < requiredHeat) {
      return { success: false }
    }

    var newHeat: ActiveFurnaceHeat
    if (state.heat != null) {
      newHeat = {
        fuel: state.heat.fuel,
        remainingHeat: state.heat.remainingHeat,
        burning: true,
        burnStartTime: now,
        burnEndTime: now + (state.heat.remainingHeat / state.heat.fuel.heatPerSecond) * 1000,
        remainingHeatAtBurnStart: state.heat.remainingHeat
      }
    }
    else {
      assert(addedFuel != null)
      var item: SmeltingInputItems
      if (isStackableSmeltingInputItems(addedFuel.item)) {
        addedFuel.item.count--
        item = {
          itemId: addedFuel.item.itemId,
          count: 1
        }
      }
      else {
        const instance = addedFuel.item.instances.shift()
        assert(instance !== undefined)
        item = {
          itemId: addedFuel.item.itemId,
          instances: [instance]
        }
      }
      newHeat = {
        fuel: {
          item: item,
          heatPerSecond: addedFuel.heatPerSecond,
          burnDuration: addedFuel.burnDuration,
          totalHeat: addedFuel.totalHeat
        },
        remainingHeat: addedFuel.totalHeat,
        burning: true,
        burnStartTime: now,
        burnEndTime: now + addedFuel.burnDuration * 1000,
        remainingHeatAtBurnStart: addedFuel.totalHeat
      }
    }

    const oldFuel = addedFuel != null ? state.fuel : null

    const newState: ActiveSmeltingSlotState = {
      fuel: addedFuel == null ? state.fuel : (addedFuel != null && (isStackableSmeltingInputItems(addedFuel.item) ? addedFuel.item.count > 0 : addedFuel.item.instances.length > 0) ? addedFuel : null),
      heat: newHeat,
      sessionId: sessionId,
      recipeId: recipeId,
      input: input,
      outputItemId: recipe.output,
      completedRounds: 0,
      availableRounds: 0,
      totalRounds: rounds,
      endTime: now + calculateDurationForHeat(recipe.heatRequired * rounds, state.heat, addedFuel) * 1000,
      heatRequiredPerRound: recipe.heatRequired,
      currentRoundRequiredHeat: recipe.heatRequired,
      currentRoundEndTime: now + calculateDurationForHeat(recipe.heatRequired, state.heat, addedFuel) * 1000
    }
    this.state = newState
    await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, newState)

    return { success: true, oldFuel: oldFuel != null ? oldFuel.item : null }
  }

  async collect(): Promise<{ itemId: string, count: number } | null> {
    await this.updateState()

    const state = await this.getState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, { fuel: null, heat: null })

    if (!isActiveSmeltingSlotState(state)) {
      return null
    }

    if (state.availableRounds == 0) {
      return null
    }

    const items = { itemId: state.outputItemId, count: state.availableRounds }
    if (state.completedRounds == state.totalRounds) {
      assert(!isActiveFurnaceHeat(state.heat))
      this.state = {
        fuel: state.fuel,
        heat: state.heat.remainingHeat > 0 ? state.heat : null
      }
      await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, this.state)
    }
    else {
      state.availableRounds = 0
      await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex + '.availableRounds', 0)
    }

    return items
  }

  async cancel(): Promise<{ output: { itemId: string, count: number } | null, input: SmeltingInputItems } | null> {
    await this.updateState()

    const now = new Date().getTime()

    const state = await this.getState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, { fuel: null, heat: null })

    if (!isActiveSmeltingSlotState(state)) {
      return null
    }

    const output = { itemId: state.outputItemId, count: state.availableRounds }

    if (state.input == null) {
      return null
    }
    const unusedInput: SmeltingInputItems = state.input

    var newHeat: PausedFurnaceHeat | null
    if (isActiveFurnaceHeat(state.heat)) {
      const usedFuelHeat = Math.ceil(((now - state.heat.burnStartTime) / 1000) * state.heat.fuel.heatPerSecond) - (state.heat.remainingHeatAtBurnStart - state.heat.remainingHeat)
      if (usedFuelHeat >= state.heat.remainingHeat) {
        newHeat = null
      }
      else {
        newHeat = {
          fuel: state.heat.fuel,
          remainingHeat: state.heat.remainingHeat - usedFuelHeat,
          burning: false
        }
      }
    }
    else {
      newHeat = state.heat
    }
    this.state = {
      fuel: state.fuel,
      heat: newHeat
    }

    await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, this.state)

    return { output: output.count > 0 ? output : null, input: unusedInput }
  }

  async finishNow(): Promise<boolean> {
    await this.updateState()

    const state = await this.getState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, { fuel: null, heat: null })

    if (!isActiveSmeltingSlotState(state)) {
      return false
    }

    if (state.completedRounds == state.totalRounds) {
      return false
    }

    state.input = null

    var requiredHeat = state.heatRequiredPerRound * (state.totalRounds - state.completedRounds) + state.currentRoundRequiredHeat
    while (requiredHeat > state.heat.remainingHeat) {
      requiredHeat -= state.heat.remainingHeat
      takeNextFuelItem(state)
    }
    state.heat.remainingHeat -= requiredHeat

    state.heat = {
      fuel: state.heat.fuel,
      remainingHeat: state.heat.remainingHeat,
      burning: false
    }

    state.availableRounds = state.availableRounds + (state.totalRounds - state.completedRounds)
    state.completedRounds = state.totalRounds

    await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, state)

    return true
  }
}