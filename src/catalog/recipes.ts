import { Catalog, readJSONFile, getJSONFilesInDir } from './catalog'
import path from 'path'

export interface CraftingRecipe {
  id: string,
  deprecated: boolean,
  displayCategory: 'Construction' | 'Equipment' | 'Items' | 'Nature',
  input: { itemIds: string[], count: number }[],
  output: { itemId: string, count: number },
  returnItems: { itemId: string, count: number }[],
  duration: number
}

export interface SmeltingRecipe {
  id: string,
  deprecated: boolean,
  input: string,
  output: string,
  heatRequired: number
}

class RecipesCatalog extends Catalog {
  private apiResponse: { crafting: any[], smelting: any[] } = { crafting: [], smelting: [] }

  private craftingRecipesMap: { [index: string]: CraftingRecipe } = {}
  private smeltingRecipesMap: { [index: string]: SmeltingRecipe } = {}

  protected async doLoadData(): Promise<void> {
    for (const filePath of await getJSONFilesInDir(path.join('recipes', 'crafting'))) {
      const recipe = await readJSONFile(filePath) as CraftingRecipe
      this.craftingRecipesMap[recipe.id] = recipe
      this.apiResponse.crafting.push({
        id: recipe.id,
        deprecated: recipe.deprecated,
        category: recipe.displayCategory,
        ingredients: recipe.input.map(ingredient => ({ items: ingredient.itemIds, quantity: ingredient.count })),
        output: { itemId: recipe.output.itemId, quantity: recipe.output.count },
        returnItems: recipe.returnItems.map(item => ({ id: item.itemId, amount: item.count })),
        duration: '00:00:' + recipe.duration
      })
    }

    for (const filePath of await getJSONFilesInDir(path.join('recipes', 'smelting'))) {
      const recipe = await readJSONFile(filePath) as SmeltingRecipe
      this.smeltingRecipesMap[recipe.id] = recipe
      this.apiResponse.smelting.push({
        id: recipe.id,
        deprecated: recipe.deprecated,
        inputItemId: recipe.input,
        output: { itemId: recipe.output, quantity: 1 },
        returnItems: [],
        heatRequired: recipe.heatRequired
      })
    }
  }

  protected doGetAPIResponse(): any {
    return this.apiResponse
  }

  getCraftingRecipe(guid: string): CraftingRecipe | null {
    return this.craftingRecipesMap[guid] ?? null
  }

  getSmeltingRecipe(guid: string): SmeltingRecipe | null {
    return this.smeltingRecipesMap[guid] ?? null
  }
}

export default new RecipesCatalog()