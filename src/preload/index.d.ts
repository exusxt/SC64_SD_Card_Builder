// Renderer-side declaration of the preload bridge.
// Included in the web tsconfig so window.api is typed for the React code.
// The concrete Api type lives in index.ts and is derived from the api object.

import type { Api } from './index'

declare global {
  interface Window {
    api: Api // the preload bridge exposed via contextBridge.exposeInMainWorld('api', ...)
  }
}

export {}
