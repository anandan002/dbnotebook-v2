import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './contexts'
import { withBasePath } from './utils/paths'

declare global {
  interface Window {
    __dbnotebookFetchPatched?: boolean
  }
}

function patchFetchForBasePath() {
  if (window.__dbnotebookFetchPatched) {
    return
  }

  const nativeFetch = window.fetch.bind(window)

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') {
      return nativeFetch(withBasePath(input), init)
    }

    if (input instanceof URL) {
      const isSameOrigin = input.origin === window.location.origin
      if (!isSameOrigin) {
        return nativeFetch(input, init)
      }
      const relativeUrl = `${input.pathname}${input.search}${input.hash}`
      return nativeFetch(withBasePath(relativeUrl), init)
    }

    if (input instanceof Request) {
      try {
        const requestUrl = new URL(input.url)
        if (requestUrl.origin === window.location.origin) {
          const relativeUrl = `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`
          const rewritten = withBasePath(relativeUrl)
          if (rewritten !== relativeUrl) {
            return nativeFetch(new Request(rewritten, input), init)
          }
        }
      } catch {
        // Fall back to the original request when URL parsing fails.
      }
    }

    return nativeFetch(input, init)
  }) as typeof window.fetch

  window.__dbnotebookFetchPatched = true
}

patchFetchForBasePath()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
