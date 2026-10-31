import { useEffect, useState } from 'react'
import Dashboard from './pages/Dashboard'
import Production from './pages/Production'
import Sales from './pages/Sales'
import Inventory from './pages/Inventory'
import Finances from './pages/Finances'
import Settings from './pages/Settings'

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊', desc: 'Overview & KPIs' },
  { id: 'production', label: 'Production', icon: '🌱', desc: 'Sow & Harvest' },
  { id: 'sales', label: 'Sales & Stock', icon: '📦', desc: 'Orders & Inventory' },
  { id: 'inventory', label: 'Seed Inventory', icon: '🌾', desc: 'Seeds & Purchases' },
  { id: 'finances', label: 'Finances & P&L', icon: '💰', desc: 'Reports & Expenses' },
  { id: 'settings', label: 'Cost Settings', icon: '⚙️', desc: 'Cocopeat & Packaging' },
]

function parseHash() {
  const hash = window.location.hash.slice(1) || 'dashboard'
  const [page, queryString] = hash.split('?')
  const params = new URLSearchParams(queryString || '')
  return {
    page: page || 'dashboard',
    tab: params.get('tab') || undefined,
    batchId: params.get('batch') || undefined,
  }
}

export default function App() {
  const [route, setRoute] = useState(parseHash)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  function navigate(pageId, tab, batchId) {
    let hash = `#${pageId}`
    const params = new URLSearchParams()
    if (tab) params.set('tab', tab)
    if (batchId) params.set('batch', batchId)
    const q = params.toString()
    if (q) hash += `?${q}`
    window.location.assign(hash)
    setRoute({ page: pageId, tab, batchId })
    setMenuOpen(false)
  }

  function renderPage() {
    switch (route.page) {
      case 'production':
        return <Production initialTab={route.tab} initialBatchId={route.batchId} />
      case 'sales':
        return <Sales initialTab={route.tab} />
      case 'inventory':
        return <Inventory initialTab={route.tab} />
      case 'finances':
        return <Finances initialTab={route.tab} />
      case 'settings':
        return <Settings />
      case 'dashboard':
      default:
        return <Dashboard onNavigate={navigate} />
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => navigate('dashboard')} style={{ cursor: 'pointer' }}>
          <span className="brand-icon">🌱</span>
          <div>
            <strong>MicroLife</strong>
            <small>Business Management System</small>
          </div>
        </div>
        <div className="topbar-right">
          <button
            className="menu-btn"
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle navigation menu"
          >
            ☰ Menu
          </button>
        </div>
      </header>

      <div className="shell">
        <nav className={menuOpen ? 'open' : ''}>
          <div className="nav-section-title">Navigation</div>
          {NAV.map((item) => (
            <button
              key={item.id}
              className={route.page === item.id ? 'active' : ''}
              type="button"
              onClick={() => navigate(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <div>
                <span>{item.label}</span>
              </div>
            </button>
          ))}
        </nav>

        <main id="main-content">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}
