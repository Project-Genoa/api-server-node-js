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
export interface SmeltingSlotInactiveState {
  heatCarriedOver: FurnaceHeat | null
}
export interface SmeltingSlotSessionState {
  sessionId: string,
  recipeId: string,
  startTime: number,
  input: SmeltingInputItems,
  outputItemId: string,
  totalRounds: number,
  fuel: FurnaceFuel | null,
  heatCarriedOver: FurnaceHeat | null,
  collectedRounds: number,
  finishedEarly: boolean
}
export interface SmeltingSlotInstantState {
  input: SmeltingInputItems | null,
  completedRounds: number,
  availableRounds: number,
  nextCompletionTime: number | null,
  totalCompletionTime: number,
  fuel: FurnaceFuel | null,
  heat: FurnaceHeat,
  burning: FurnaceBurning | null
}
export interface FurnaceFuel {
  item: SmeltingInputItems,
  burnDuration: number,
  heatPerSecond: number,
  totalHeat: number
}
export interface FurnaceHeat {
  fuel: FurnaceFuel,
  remainingHeat: number
}
export interface FurnaceBurning {
  burnStartTime: number,
  burnEndTime: number
}
export function isSmeltingSlotSessionState(state: SmeltingSlotSessionState | SmeltingSlotInactiveState): state is SmeltingSlotSessionState {
  return 'sessionId' in state
}
export function isStackableSmeltingInputItems(item: SmeltingInputItems): item is StackableSmeltingInputItems {
  return 'count' in item
}

function calculateBurnDurationForFuel(fuel: FurnaceFuel): number {
  return fuel.burnDuration * 1000.0
}

function calculateBurnDurationForHeatCarriedOver(heatCarriedOver: FurnaceHeat): number {
  return (heatCarriedOver.remainingHeat / heatCarriedOver.fuel.heatPerSecond) * 1000.0
}

function calculateDurationForHeat(requiredHeat: number, heatCarriedOver: FurnaceHeat | null, fuel: FurnaceFuel | null): number {
  var duration = 0
  if (heatCarriedOver != null) {
    if (heatCarriedOver.remainingHeat >= requiredHeat) {
      duration += (requiredHeat / heatCarriedOver.fuel.heatPerSecond) * 1000.0
      requiredHeat = 0
    }
    else {
      duration += calculateBurnDurationForHeatCarriedOver(heatCarriedOver)
      requiredHeat -= heatCarriedOver.remainingHeat
    }
  }
  if (fuel != null) {
    const fuelCount = isStackableSmeltingInputItems(fuel.item) ? fuel.item.count : fuel.item.instances.length
    for (var count = 0; count < fuelCount; count++) {
      if (requiredHeat < fuel.totalHeat) {
        duration += (requiredHeat / fuel.heatPerSecond) * 1000.0
        requiredHeat = 0
        break
      }
      else {
        duration += calculateBurnDurationForFuel(fuel)
        requiredHeat -= fuel.totalHeat
      }
    }
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

  static getInstantState(sessionState: SmeltingSlotSessionState, now: number): SmeltingSlotInstantState {
    const recipe = RecipesCatalog.getSmeltingRecipe(sessionState.recipeId)
    assert(recipe != null)

    const totalCompletionTime = sessionState.startTime + calculateDurationForHeat(sessionState.totalRounds * recipe.heatRequired, sessionState.heatCarriedOver, sessionState.fuel)
    var nextCompletionTime
    var completedRounds
    if (sessionState.finishedEarly) {
      completedRounds = sessionState.totalRounds
      nextCompletionTime = null
    }
    else {
      for (completedRounds = 0; completedRounds < sessionState.totalRounds; completedRounds++) {
        nextCompletionTime = sessionState.startTime + calculateDurationForHeat((completedRounds + 1) * recipe.heatRequired, sessionState.heatCarriedOver, sessionState.fuel)
        if (nextCompletionTime >= now) {
          break
        }
      }
      if (completedRounds == sessionState.totalRounds) {
        nextCompletionTime = null
      }
    }
    assert(nextCompletionTime !== undefined)
    const availableRounds = completedRounds - sessionState.collectedRounds

    const input = isStackableSmeltingInputItems(sessionState.input) ? { itemId: sessionState.input.itemId, count: sessionState.input.count - completedRounds } : { itemId: sessionState.input.itemId, instances: sessionState.input.instances.slice(completedRounds) }

    const fuel = sessionState.fuel == null ? null : { burnDuration: sessionState.fuel.burnDuration, heatPerSecond: sessionState.fuel.heatPerSecond, totalHeat: sessionState.fuel.totalHeat, item: isStackableSmeltingInputItems(sessionState.fuel.item) ? { itemId: sessionState.fuel.item.itemId, count: sessionState.fuel.item.count } : { itemId: sessionState.fuel.item.itemId, instances: sessionState.fuel.item.instances.map(instance => instance) } }
    const fuelEndTime = completedRounds == sessionState.totalRounds ? totalCompletionTime : now
    var totalFuelHeat = 0
    var currentFuel: FurnaceFuel
    var currentRemainingHeat: number
    var currentBurnStartTime: number | null
    var currentBurnEndTime: number | null
    if (sessionState.heatCarriedOver != null) {
      currentFuel = sessionState.heatCarriedOver.fuel
      currentRemainingHeat = sessionState.heatCarriedOver.remainingHeat
      currentBurnStartTime = sessionState.startTime
      currentBurnEndTime = currentBurnStartTime + calculateBurnDurationForHeatCarriedOver(sessionState.heatCarriedOver)
    }
    else {
      assert(fuel != null)
      currentFuel = { burnDuration: fuel.burnDuration, heatPerSecond: fuel.heatPerSecond, totalHeat: fuel.totalHeat, item: isStackableSmeltingInputItems(fuel.item) ? { itemId: fuel.item.itemId, count: 1 } : { itemId: fuel.item.itemId, instances: [fuel.item.instances[0]] } }
      if (isStackableSmeltingInputItems(fuel.item)) {
        fuel.item.count--
      }
      else {
        fuel.item.instances.shift()
      }
      currentRemainingHeat = currentFuel.totalHeat
      currentBurnStartTime = sessionState.startTime
      currentBurnEndTime = currentBurnStartTime + calculateBurnDurationForFuel(currentFuel)
    }
    while (currentBurnEndTime < fuelEndTime) {
      assert(fuel != null)
      totalFuelHeat += currentRemainingHeat
      currentFuel = { burnDuration: fuel.burnDuration, heatPerSecond: fuel.heatPerSecond, totalHeat: fuel.totalHeat, item: isStackableSmeltingInputItems(fuel.item) ? { itemId: fuel.item.itemId, count: 1 } : { itemId: fuel.item.itemId, instances: [fuel.item.instances[0]] } }
      if (isStackableSmeltingInputItems(fuel.item)) {
        fuel.item.count--
      }
      else {
        fuel.item.instances.shift()
      }
      currentRemainingHeat = currentFuel.totalHeat
      currentBurnStartTime = currentBurnEndTime
      currentBurnEndTime = currentBurnStartTime + calculateBurnDurationForFuel(currentFuel)
    }
    if (completedRounds == sessionState.totalRounds) {
      currentRemainingHeat -= recipe.heatRequired * sessionState.totalRounds - totalFuelHeat
      currentBurnStartTime = null
      currentBurnEndTime = null
    }
    else {
      currentRemainingHeat -= Math.ceil(((fuelEndTime - currentBurnStartTime) / 1000.0) * currentFuel.heatPerSecond)
    }

    return {
      input: (isStackableSmeltingInputItems(input) ? input.count > 0 : input.instances.length > 0) ? input : null,
      completedRounds: completedRounds,
      availableRounds: availableRounds,
      nextCompletionTime: nextCompletionTime,
      totalCompletionTime: totalCompletionTime,
      fuel: fuel != null && (isStackableSmeltingInputItems(fuel.item) ? fuel.item.count > 0 : fuel.item.instances.length > 0) ? fuel : null,
      heat: { fuel: currentFuel, remainingHeat: currentRemainingHeat },
      burning: currentBurnStartTime != null && currentBurnEndTime != null ? { burnStartTime: currentBurnStartTime, burnEndTime: currentBurnEndTime } : null
    }
  }

  constructor(player: Player, slotIndex: number) {
    super(player, slotIndex, 'smelting')
  }

  async getSessionState(): Promise<SmeltingSlotSessionState | SmeltingSlotInactiveState> {
    return await this.player.transaction.get('player', this.player.userId, 'workshop.smelting.' + this.slotIndex) as SmeltingSlotSessionState | SmeltingSlotInactiveState | null ?? { fuel: null, heatCarriedOver: null }
  }

  private async setSessionState(state: SmeltingSlotSessionState | SmeltingSlotInactiveState) {
    await this.player.transaction.set('player', this.player.userId, 'workshop.smelting.' + this.slotIndex, state)
  }

  async start(sessionId: string, recipeId: string, rounds: number, input: SmeltingInputItems, fuel: SmeltingInputItems | null): Promise<boolean> {
    const now = new Date().getTime()

    const sessionState = await this.getSessionState()
    if (isSmeltingSlotSessionState(sessionState)) {
      return false
    }

    const recipe = RecipesCatalog.getSmeltingRecipe(recipeId)
    if (recipe == null) {
      return false
    }

    if (fuel != null && ItemsCatalog.getItem(fuel.itemId).fuelReturnItems.length != 0) {
      // TODO: implement returnItems
      return false
    }
    const addedFuel: FurnaceFuel | null = fuel != null ? {
      item: fuel,
      burnDuration: ItemsCatalog.getItem(fuel.itemId).burnRate.burnTime,
      heatPerSecond: ItemsCatalog.getItem(fuel.itemId).burnRate.heatPerSecond,
      totalHeat: ItemsCatalog.getItem(fuel.itemId).burnRate.burnTime * ItemsCatalog.getItem(fuel.itemId).burnRate.heatPerSecond
    } : null

    if (input.itemId != recipe.input) {
      return false
    }
    if ((isStackableSmeltingInputItems(input) ? input.count : input.instances.length) != rounds) {
      return false
    }

    var requiredHeat = recipe.heatRequired * rounds
    if (sessionState.heatCarriedOver != null) {
      requiredHeat -= sessionState.heatCarriedOver.remainingHeat
    }
    if (addedFuel != null) {
      requiredHeat -= addedFuel.totalHeat * (isStackableSmeltingInputItems(addedFuel.item) ? addedFuel.item.count : addedFuel.item.instances.length)
    }
    if (requiredHeat > 0) {
      return false
    }

    const newSessionState: SmeltingSlotSessionState = {
      sessionId: sessionId,
      recipeId: recipeId,
      startTime: now,
      input: input,
      outputItemId: recipe.output,
      totalRounds: rounds,
      fuel: addedFuel,
      heatCarriedOver: sessionState.heatCarriedOver,
      collectedRounds: 0,
      finishedEarly: false
    }
    await this.setSessionState(newSessionState)

    return true
  }

  async collect(): Promise<{ itemId: string, count: number } | null> {
    const now = new Date().getTime()

    const sessionState = await this.getSessionState()
    if (!isSmeltingSlotSessionState(sessionState)) {
      return null
    }
    const instantState = SmeltingSlot.getInstantState(sessionState, now)

    sessionState.collectedRounds += instantState.availableRounds
    if (sessionState.collectedRounds == sessionState.totalRounds) {
      const newSessionState: SmeltingSlotInactiveState = {
        heatCarriedOver: instantState.heat
      }
      await this.setSessionState(newSessionState)
    }
    else {
      await this.setSessionState(sessionState)
    }

    return { itemId: sessionState.outputItemId, count: instantState.availableRounds }
  }

  async cancel(): Promise<{ output: { itemId: string, count: number }, input: SmeltingInputItems | null } | null> {
    const now = new Date().getTime()

    const sessionState = await this.getSessionState()
    if (!isSmeltingSlotSessionState(sessionState)) {
      return null
    }
    const instantState = SmeltingSlot.getInstantState(sessionState, now)

    await this.setSessionState({
      fuel: instantState.fuel,
      heatCarriedOver: instantState.heat
    })

    return { output: { itemId: sessionState.outputItemId, count: instantState.availableRounds }, input: instantState.input }
  }

  async finishNow(): Promise<boolean> {
    const now = new Date().getTime()

    const sessionState = await this.getSessionState()
    if (!isSmeltingSlotSessionState(sessionState)) {
      return false
    }
    const instantState = SmeltingSlot.getInstantState(sessionState, now)

    if (instantState.completedRounds == sessionState.totalRounds) {
      return false
    }

    sessionState.finishedEarly = true
    await this.setSessionState(sessionState)

    return true
  }
}