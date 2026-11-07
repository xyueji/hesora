import { contextBridge, ipcRenderer } from 'electron'

const api = {
  invoke: (channel: string, payload?: unknown): Promise<unknown> =>
    ipcRenderer.invoke(channel, payload === undefined ? undefined : JSON.parse(JSON.stringify(payload)))
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
