import { Catalog, readJSONFile, getJSONFilesInDir } from './catalog'
import path from 'path'

export interface CraftingRecipe {
  input: { itemIds: string[], count: number }[],
  output: { itemId: string, count: number },
  returnItems: { itemId: string, count: number }[],
  duration: number
}

class RecipesCatalog extends Catalog {
  private recipes: { crafting: object[], smelting: object[] } = { crafting: [], smelting: [] }
  private craftingRecipesMap: { [index: string]: CraftingRecipe } = {}

  protected async doLoadData(): Promise<void> {
    var crafting = []
    for (const filePath of await getJSONFilesInDir(path.join('recipes', 'crafting'))) {
      const recipe = await readJSONFile(filePath)
      crafting.push(recipe)
      this.craftingRecipesMap[recipe.id] = {
        input: (recipe.ingredients as { quantity: number, items: string[] }[]).map(ingredient => ({ itemIds: ingredient.items, count: ingredient.quantity })),
        output: { itemId: recipe.output.itemId as string, count: recipe.output.quantity as number },
        returnItems: (recipe.returnItems as { id: string, amount: number }[]).map(item => ({ itemId: item.id, count: item.amount })),
        duration: (recipe.duration as string).split(':').reduce((sum, part) => sum * 60 + parseInt(part), 0)
      }
    }

    var smelting = []
    for (const filePath of await getJSONFilesInDir(path.join('recipes', 'smelting'))) {
      const recipe = await readJSONFile(filePath)
      smelting.push(recipe)
    }

    this.recipes = {
      crafting: crafting,
      smelting: smelting
    }
  }

  protected doGetAPIResponse(): any {
    return this.recipes
  }

  getCraftingRecipe(guid: string): CraftingRecipe | null {
    return this.craftingRecipesMap[guid] ?? null
  }
}

export default new RecipesCatalog()