import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Workbox } from 'workbox-window'
import './index.css'
import App from './App'

const registerServiceWorker = () => {
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    const wb = new Workbox('/sw.js', { type: 'module' })
    wb.register().catch(() => {})
  })
}

if (import.meta.env.PROD) {
  registerServiceWorker()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
