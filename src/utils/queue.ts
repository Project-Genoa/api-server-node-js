interface QueuedCallback<ReturnType> {
  callback: () => ReturnType,
  resolve: (value: ReturnType) => void,
  reject: (err: any) => void
}

export default class Queue {
  #list: QueuedCallback<any>[]
  #emptyCallback: () => void

  constructor(emptyCallback: () => void) {
    this.#list = []
    this.#emptyCallback = emptyCallback
  }

  addToQueue<ReturnType>(callback: () => ReturnType): Promise<ReturnType> {
    return new Promise<ReturnType>((resolve, reject) => {
      this.#list.push({ callback: callback, resolve: resolve, reject: reject })
      if (this.#list.length == 1) {
        setImmediate(() => this.#runCallbackLoop())
      }
    })
  }

  async #handleNextCallback() {
    if (this.#list.length >= 1) {
      const callback = this.#list[0]
      try {
        callback.resolve(await callback.callback())
      }
      catch (err) {
        callback.reject(err)
      }
      this.#list.shift()
    }
    return this.#list.length >= 1
  }

  async #runCallbackLoop() {
    while (this.#list.length >= 1) {
      await this.#handleNextCallback()
    }
    if (typeof this.#emptyCallback == 'function') {
      this.#emptyCallback()
    }
  }
}