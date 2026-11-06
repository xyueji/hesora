import { contextBridge, ipcRenderer } from 'electron'

const api = {
  invoke: (channel: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, payload)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
