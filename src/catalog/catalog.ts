import * as fs from 'fs'
import * as path from 'path'

import config from '../config'

export class Catalog {
  private loaded = false

  async loadData(): Promise<void> {
    if (this.loaded) {
      throw new Error('data already loaded')
    }
    await this.doLoadData()
    this.loaded = true
  }

  getAPIResponse(): any {
    if (!this.loaded) {
      throw new Error('data has not been loaded')
    }
    return this.doGetAPIResponse()
  }

  protected async doLoadData(): Promise<void> {
    throw new Error('doLoadData not implemented')
  }

  protected doGetAPIResponse(): Promise<any> {
    throw new Error('doGetAPIResponse not implemented')
  }
}

export async function readJSONFile(filePath: string): Promise<any> {
  //console.log('Catalog: reading ' + filePath)
  const fullPath = path.join(config.dataLocation, 'catalog', filePath)
  const string = await fs.promises.readFile(fullPath, 'utf-8')
  const json = JSON.parse(string)
  return json
}

export async function getJSONFilesInDir(filePath: string): Promise<string[]> {
  //console.log('Catalog: searching ' + filePath)
  const fullPath = path.join(config.dataLocation, 'catalog', filePath)
  const names = await fs.promises.readdir(fullPath)
  const jsonFiles = names.filter(name => !!name.match(/^.*\.json$/)).map(name => path.join(filePath, name))
  return jsonFiles
}