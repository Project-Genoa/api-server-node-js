import Player from '../player'
import * as Inventory from './inventory'

import RecipesCatalog, { CraftingRecipe } from '../../catalog/recipes'

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

export class WorkshopSlot {
  readonly player: Player
  readonly slotIndex: number

  constructor(player: Player, slotIndex: number) {
    this.player = player
    this.slotIndex = slotIndex
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
  private state: CraftingSlotState | null

  constructor(player: Player, slotIndex: number) {
    super(player, slotIndex)

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
                if (targetCount - consumedCount > inputItem.count) {
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

export class SmeltingSlot extends WorkshopSlot {
  constructor(player: Player, slotIndex: number) {
    super(player, slotIndex)
  }
}