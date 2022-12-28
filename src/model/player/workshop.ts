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
export type CraftingSlotState = ActiveCraftingSlotState | EmptyCraftingSlotState
export interface ActiveCraftingSlotState {
  sessionId: string,
  recipeId: string,
  input: CraftingInputItem[] | null,
  output: { itemId: string, count: number },
  completedRounds: number,
  availableRounds: number,
  totalRounds: number,
  nextCompletionTime: number | null,
  totalCompletionTime: number
}
export interface EmptyCraftingSlotState {
  // empty
}
export function isActiveCraftingSlotState(state: CraftingSlotState): state is ActiveCraftingSlotState {
  return 'sessionId' in state
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

  private state: CraftingSlotState | null

  constructor(player: Player, slotIndex: number) {
    super(player, slotIndex, 'crafting')

    this.state = null
  }

  async getState(): Promise<CraftingSlotState> {
    if (this.state == null) {
      this.state = await this.player.transaction.get('player', this.player.userId, 'workshop.crafting.' + this.slotIndex) as CraftingSlot | null ?? {}
    }
    return this.state
  }

  async updateState(): Promise<boolean> {
    const now = new Date().getTime()

    const state = await this.getState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.crafting.' + this.slotIndex, {})

    if (isActiveCraftingSlotState(state)) {
      const recipe = RecipesCatalog.getCraftingRecipe(state.recipeId)
      if (recipe == null) {
        return false
      }

      var changed = false
      while (state.nextCompletionTime != null && now >= state.nextCompletionTime - config.craftingGracePeriod) {
        state.completedRounds++
        state.availableRounds++
        state.nextCompletionTime = state.completedRounds == state.totalRounds ? null : state.nextCompletionTime + recipe.duration * 1000
        await this.player.transaction.increment('player', this.player.userId, 'workshop.crafting.' + this.slotIndex + '.completedRounds', 1)
        await this.player.transaction.increment('player', this.player.userId, 'workshop.crafting.' + this.slotIndex + '.availableRounds', 1)
        await this.player.transaction.set('player', this.player.userId, 'workshop.crafting.' + this.slotIndex + '.nextCompletionTime', state.nextCompletionTime)
        if (state.completedRounds == state.totalRounds) {
          // TODO: decide/determine if we are supposed to do this
          //state.input = null
          //this.player.transaction.set('player', this.player.userId, 'workshop.crafting.' + this.slotIndex + '.input', null)
        }
        changed = true
      }

      return changed
    }
    else {
      return false
    }
  }

  async start(sessionId: string, recipeId: string, rounds: number, ingredients: CraftingInputItem[]): Promise<boolean> {
    const now = new Date().getTime()

    const state = await this.getState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.crafting.' + this.slotIndex, {})

    if (isActiveCraftingSlotState(state)) {
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

    const newState: ActiveCraftingSlotState = {
      sessionId: sessionId,
      recipeId: recipeId,
      input: ingredients,
      output: { itemId: recipe.output.itemId, count: recipe.output.count },
      completedRounds: 0,
      availableRounds: 0,
      totalRounds: rounds,
      nextCompletionTime: now + recipe.duration * 1000,
      totalCompletionTime: now + recipe.duration * 1000 * rounds
    }
    this.state = newState
    await this.player.transaction.set('player', this.player.userId, 'workshop.crafting.' + this.slotIndex, newState)

    return true
  }

  async collect(): Promise<{ itemId: string, count: number } | null> {
    await this.updateState()

    const state = await this.getState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.crafting.' + this.slotIndex, {})

    if (!isActiveCraftingSlotState(state)) {
      return null
    }

    if (state.availableRounds == 0) {
      return null
    }

    const items = { itemId: state.output.itemId, count: state.output.count * state.availableRounds }
    if (state.nextCompletionTime == null) {
      this.state = {}
      await this.player.transaction.set('player', this.player.userId, 'workshop.crafting.' + this.slotIndex, {})
    }
    else {
      state.availableRounds = 0
      await this.player.transaction.set('player', this.player.userId, 'workshop.crafting.' + this.slotIndex + '.availableRounds', 0)
    }

    return items
  }

  async cancel(): Promise<{ output: { itemId: string, count: number } | null, input: CraftingInputItem[] } | null> {
    await this.updateState()

    const state = await this.getState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.crafting.' + this.slotIndex, {})

    if (!isActiveCraftingSlotState(state)) {
      return null
    }

    const items = { itemId: state.output.itemId, count: state.output.count * state.availableRounds }

    var unusedIngredients: CraftingInputItem[] = []
    if (state.input != null) {
      const completedRounds = state.completedRounds
      const recipe = RecipesCatalog.getCraftingRecipe(state.recipeId) as CraftingRecipe
      var craftingIngredientsStillInInput: CraftingInputItem[] = []
      var craftingIngredientsRemainingInInput: CraftingInputItem[] = state.input
      for (const recipeIngredient of recipe.input) {
        const targetCount = recipeIngredient.count * completedRounds
        var consumedCount = 0
        craftingIngredientsStillInInput = craftingIngredientsRemainingInInput
        craftingIngredientsRemainingInInput = []
        for (const inputItem of craftingIngredientsStillInInput) {
          if (recipeIngredient.itemIds.includes(inputItem.itemId)) {
            if (isStackableCraftingInputItem(inputItem)) {
              if (consumedCount < targetCount) {
                if (targetCount - consumedCount >= inputItem.count) {
                  consumedCount += inputItem.count
                }
                else {
                  craftingIngredientsRemainingInInput.push({ itemId: inputItem.itemId, count: inputItem.count - (targetCount - consumedCount) })
                  consumedCount = targetCount
                }
              }
              else {
                craftingIngredientsRemainingInInput.push({ itemId: inputItem.itemId, count: inputItem.count })
              }
            }
            else {
              const instancesReminingInInput: { instanceId: string, item: Inventory.NonStackableItemInstance }[] = []
              for (const instance of inputItem.instances) {
                if (consumedCount < targetCount) {
                  consumedCount++
                }
                else {
                  instancesReminingInInput.push(instance)
                }
              }
              if (instancesReminingInInput.length != 0) {
                craftingIngredientsRemainingInInput.push({ itemId: inputItem.itemId, instances: instancesReminingInInput })
              }
            }
          }
          else {
            craftingIngredientsRemainingInInput.push(inputItem)
          }
        }
      }
      unusedIngredients = craftingIngredientsRemainingInInput
    }

    this.state = {}
    await this.player.transaction.set('player', this.player.userId, 'workshop.crafting.' + this.slotIndex, {})

    return { output: items.count > 0 ? items : null, input: unusedIngredients }
  }

  async finishNow(): Promise<boolean> {
    await this.updateState()

    const state = await this.getState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.crafting.' + this.slotIndex, {})

    if (!isActiveCraftingSlotState(state)) {
      return false
    }

    if (state.nextCompletionTime == null) {
      return false
    }

    state.availableRounds = state.availableRounds + (state.totalRounds - state.completedRounds)
    state.completedRounds = state.totalRounds
    state.nextCompletionTime = null
    await this.player.transaction.set('player', this.player.userId, 'workshop.crafting.' + this.slotIndex + '.availableRounds', state.availableRounds)
    await this.player.transaction.set('player', this.player.userId, 'workshop.crafting.' + this.slotIndex + '.completedRounds', state.completedRounds)
    await this.player.transaction.set('player', this.player.userId, 'workshop.crafting.' + this.slotIndex + '.nextCompletionTime', state.nextCompletionTime)

    return true
  }
}

export type SmeltingInputItems = StackableSmeltingInputItems | NonStackableSmeltingInputItems
export interface StackableSmeltingInputItems { itemId: string, count: number }
export interface NonStackableSmeltingInputItems { itemId: string, instances: { instanceId: string, item: Inventory.NonStackableItemInstance }[] }
export type SmeltingSlotState = ActiveSmeltingSlotState | EmptySmeltingSlotState
export interface ActiveSmeltingSlotState {
  fuel: FurnaceFuel | null,
  heat: ActiveFurnaceHeat,
  heatCarriedOver: PausedFurnaceHeat | null,
  sessionId: string,
  recipeId: string,
  input: SmeltingInputItems | null,
  output: string,
  completedRounds: number,
  availableRounds: number,
  totalRounds: number,
  startTime: number,
  endTime: number,
  nextCompletionTime: number
}
export interface EmptySmeltingSlotState {
  heatCarriedOver: PausedFurnaceHeat | null
}
export interface FurnaceFuel {
  item: SmeltingInputItems,
  singleBurnDuration: number,
  totalBurnDuration: number,
  heatPerSecond: number
}
export interface ActiveFurnaceHeat {
  fuel: FurnaceFuel,
  secondsUsedCarriedOver: number,
  burnStartTime: number,
  burnEndTime: number
}
export interface PausedFurnaceHeat {
  fuel: FurnaceFuel,
  secondsUsed: number
}
export function isActiveSmeltingSlotState(state: SmeltingSlotState): state is ActiveSmeltingSlotState {
  return 'sessionId' in state
}
export function isActiveFurnaceHeat(heat: ActiveFurnaceHeat | PausedFurnaceHeat): heat is ActiveFurnaceHeat {
  return 'startTime' in heat
}
export function isStackableSmeltingInputItems(item: SmeltingInputItems): item is StackableSmeltingInputItems {
  return 'count' in item
}

function calculateDurationForRounds(requiredHeatPerRound: number, rounds: number, heatCarriedOver: PausedFurnaceHeat | null, fuel: FurnaceFuel | null) {
  const requiredHeat = requiredHeatPerRound * rounds
  var duration = 0
  if (heatCarriedOver != null) {
    duration += Math.min(requiredHeat / heatCarriedOver.fuel.heatPerSecond, heatCarriedOver.fuel.totalBurnDuration - heatCarriedOver.secondsUsed)
  }
  if (fuel != null) {
    duration += Math.max(requiredHeat - (heatCarriedOver != null ? (heatCarriedOver.fuel.totalBurnDuration - heatCarriedOver.secondsUsed) * heatCarriedOver.fuel.heatPerSecond : 0), 0) / fuel.heatPerSecond
  }
  return duration
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
      this.state = await this.player.transaction.get('player', this.player.userId, 'workshop.smelting.' + this.slotIndex) as SmeltingSlotState | null ?? { heatCarriedOver: null }
    }
    return this.state
  }

  async updateState(): Promise<boolean> {
    const now = new Date().getTime()

    const state = await this.getState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, { heatCarriedOver: null })

    if (isActiveSmeltingSlotState(state)) {
      const recipe = RecipesCatalog.getSmeltingRecipe(state.recipeId)
      if (recipe == null) {
        return false
      }

      var changed = false
      while (state.completedRounds < state.totalRounds && now >= state.nextCompletionTime - config.craftingGracePeriod) {
        if (state.input != null) {
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
          await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex + '.input', state.input)
        }

        if (state.nextCompletionTime > state.heat.burnEndTime) {
          state.heat = {
            fuel: state.fuel as FurnaceFuel,
            secondsUsedCarriedOver: 0,
            burnStartTime: state.heat.burnEndTime,
            burnEndTime: state.heat.burnEndTime + (state.fuel as FurnaceFuel).totalBurnDuration * 1000
          }
          await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex + '.heat', state.heat)
        }

        state.nextCompletionTime = state.startTime + calculateDurationForRounds(recipe.heatRequired, state.completedRounds + 2, state.heatCarriedOver, state.fuel) * 1000
        await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex + '.nextCompletionTime', state.nextCompletionTime)

        state.completedRounds++
        state.availableRounds++
        await this.player.transaction.increment('player', this.player.userId, 'workshop.smelting.' + this.slotIndex + '.completedRounds', 1)
        await this.player.transaction.increment('player', this.player.userId, 'workshop.smelting.' + this.slotIndex + '.availableRounds', 1)

        if (state.completedRounds == state.totalRounds) {
          state.heatCarriedOver = {
            fuel: state.heat.fuel,
            secondsUsed: state.heat.secondsUsedCarriedOver + Math.ceil((state.endTime - state.heat.burnStartTime) / 1000)
          }
          if (state.heatCarriedOver.secondsUsed >= state.heatCarriedOver.fuel.totalBurnDuration) {
            state.heatCarriedOver = null
          }
          await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex + '.heatCarriedOver', state.heatCarriedOver)
        }

        changed = true
      }
      if (state.completedRounds < state.totalRounds && now > state.heat.burnEndTime) {
        state.heat = {
          fuel: state.fuel as FurnaceFuel,
          secondsUsedCarriedOver: 0,
          burnStartTime: state.heat.burnEndTime,
          burnEndTime: state.heat.burnEndTime + (state.fuel as FurnaceFuel).totalBurnDuration * 1000
        }
        await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex + '.heat', state.heat)

        changed = true
      }

      return changed
    }
    else {
      return false
    }
  }

  async start(sessionId: string, recipeId: string, rounds: number, input: SmeltingInputItems, fuel: SmeltingInputItems | null): Promise<boolean> {
    const now = new Date().getTime()

    const state = await this.getState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, { heatCarriedOver: null })

    if (isActiveSmeltingSlotState(state)) {
      return false
    }

    const recipe = RecipesCatalog.getSmeltingRecipe(recipeId)
    if (recipe == null) {
      return false
    }

    if (fuel != null && ItemsCatalog.getItem(fuel.itemId).fuelReturnItems.length != 0) {
      // TODO: figure out how returnItems are supposed to be implemented
      return false
    }
    const addedFuel: FurnaceFuel | null = fuel != null ? {
      item: fuel,
      singleBurnDuration: ItemsCatalog.getItem(fuel.itemId).burnRate.burnTime,
      totalBurnDuration: ItemsCatalog.getItem(fuel.itemId).burnRate.burnTime * (isStackableSmeltingInputItems(fuel) ? fuel.count : fuel.instances.length),
      heatPerSecond: ItemsCatalog.getItem(fuel.itemId).burnRate.heatPerSecond
    } : null

    if (input.itemId != recipe.input) {
      return false
    }
    if ((isStackableSmeltingInputItems(input) ? input.count : input.instances.length) != rounds) {
      return false
    }
    const requiredHeat = recipe.heatRequired * rounds
    var availableHeat = 0
    if (state.heatCarriedOver != null) {
      availableHeat += state.heatCarriedOver.fuel.heatPerSecond * (state.heatCarriedOver.fuel.totalBurnDuration - state.heatCarriedOver.secondsUsed)
    }
    if (addedFuel != null) {
      availableHeat += addedFuel.heatPerSecond * addedFuel.totalBurnDuration
    }
    if (availableHeat < requiredHeat) {
      return false
    }

    const newState: ActiveSmeltingSlotState = {
      fuel: addedFuel,
      heat: state.heatCarriedOver != null ? {
        fuel: state.heatCarriedOver.fuel,
        secondsUsedCarriedOver: state.heatCarriedOver.secondsUsed,
        burnStartTime: now,
        burnEndTime: now + (state.heatCarriedOver.fuel.totalBurnDuration - state.heatCarriedOver.secondsUsed) * 1000
      } : {
        fuel: addedFuel as FurnaceFuel,
        secondsUsedCarriedOver: 0,
        burnStartTime: now,
        burnEndTime: now + (addedFuel as FurnaceFuel).totalBurnDuration * 1000
      },
      heatCarriedOver: state.heatCarriedOver,
      sessionId: sessionId,
      recipeId: recipeId,
      input: input,
      output: recipe.output,
      completedRounds: 0,
      availableRounds: 0,
      totalRounds: rounds,
      startTime: now,
      endTime: now + calculateDurationForRounds(recipe.heatRequired, rounds, state.heatCarriedOver, addedFuel) * 1000,
      nextCompletionTime: now + calculateDurationForRounds(recipe.heatRequired, 1, state.heatCarriedOver, addedFuel) * 1000
    }
    this.state = newState
    await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, newState)

    return true
  }

  async collect(): Promise<{ itemId: string, count: number } | null> {
    await this.updateState()

    const state = await this.getState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, { heatCarriedOver: null })

    if (!isActiveSmeltingSlotState(state)) {
      return null
    }

    if (state.availableRounds == 0) {
      return null
    }

    const items = { itemId: state.output, count: state.availableRounds }
    if (state.completedRounds == state.totalRounds) {
      this.state = {
        heatCarriedOver: state.heatCarriedOver
      }
      await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, this.state)
    }
    else {
      state.availableRounds = 0
      await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex + '.availableRounds', 0)
    }

    return items
  }

  async cancel(): Promise<{ output: { itemId: string, count: number } | null, input: SmeltingInputItems, fuel: SmeltingInputItems | null } | null> {
    await this.updateState()

    const now = new Date().getTime()

    const state = await this.getState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, {})

    if (!isActiveSmeltingSlotState(state)) {
      return null
    }

    const output = { itemId: state.output, count: state.availableRounds }

    if (state.input == null) {
      return null
    }
    const unusedInput: SmeltingInputItems = state.input

    const unusedFuel: SmeltingInputItems | null = state.heatCarriedOver != null && state.heat.burnStartTime == state.startTime ? (state.fuel != null ? state.fuel.item : null) : null
    const usedFuelTime = Math.ceil((now - state.heat.burnStartTime) / 1000)
    this.state = {
      heatCarriedOver: {
        fuel: state.heat.fuel,
        secondsUsed: state.heat.secondsUsedCarriedOver + usedFuelTime
      }
    }
    if (this.state.heatCarriedOver != null && this.state.heatCarriedOver.secondsUsed >= this.state.heatCarriedOver.fuel.totalBurnDuration) {
      this.state.heatCarriedOver = null
    }

    await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, this.state)

    return { output: output.count > 0 ? output : null, input: unusedInput, fuel: unusedFuel }
  }

  async finishNow(): Promise<boolean> {
    await this.updateState()

    const state = await this.getState()
    await this.player.transaction.createIfNotExists('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, {})

    if (!isActiveSmeltingSlotState(state)) {
      return false
    }

    if (state.completedRounds == state.totalRounds) {
      return false
    }

    state.input = null
    await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex + '.input', null)

    const recipe = RecipesCatalog.getSmeltingRecipe(state.recipeId) as SmeltingRecipe
    const requiredHeat = recipe.heatRequired * state.totalRounds
    const heatCarriedOver = state.heatCarriedOver != null ? (state.heatCarriedOver.fuel.totalBurnDuration - state.heatCarriedOver.secondsUsed) * state.heatCarriedOver.fuel.heatPerSecond : 0
    if (requiredHeat > heatCarriedOver) {
      const burnStartTime = state.startTime + (state.heatCarriedOver != null ? state.heatCarriedOver.fuel.totalBurnDuration - state.heatCarriedOver.secondsUsed : 0) * 1000
      state.heat = {
        fuel: state.fuel as FurnaceFuel,
        secondsUsedCarriedOver: 0,
        burnStartTime: burnStartTime,
        burnEndTime: burnStartTime + (state.fuel as FurnaceFuel).totalBurnDuration * 1000
      }
    }
    state.heatCarriedOver = {
      fuel: state.heat.fuel,
      secondsUsed: state.heat.secondsUsedCarriedOver + Math.ceil((requiredHeat > heatCarriedOver ? requiredHeat - heatCarriedOver : requiredHeat) / state.heat.fuel.heatPerSecond)
    }
    if (state.heatCarriedOver.secondsUsed >= state.heatCarriedOver.fuel.totalBurnDuration) {
      state.heatCarriedOver = null
    }
    await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex + '.heat', state.heat)
    await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex + '.heatCarriedOver', state.heatCarriedOver)

    state.availableRounds = state.availableRounds + (state.totalRounds - state.completedRounds)
    state.completedRounds = state.totalRounds
    await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex + '.availableRounds', state.availableRounds)
    await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex + '.completedRounds', state.completedRounds)

    return true
  }
}