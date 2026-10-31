import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { inr, kg, prettyDate, daysAgo, pct } from '../lib/format'
import { Card, ErrorBanner, Page, Stat, Table, Badge } from '../components/ui'

export default function Dashboard({ onNavigate }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .dashboard()
      .then((res) => {
        setData(res)
        setError('')
      })
      .catch((e) => setError(e.message))
  }, [])

  const pnl = data?.report?.pnl
  const prod = data?.report?.production
  const inv = data?.inventory

  const activeBatches = inv?.activeBatches || []

  function go(section, tab) {
    if (onNavigate) {
      onNavigate(section, tab)
    } else {
      window.location.hash = tab ? `${section}?tab=${tab}` : section
    }
  }

  return (
    <Page
      title="MicroLife Dashboard"
      subtitle={`Business performance & live operations for ${data?.month || 'current month'}.`}
    >
      <ErrorBanner error={error} />

      {/* Quick Action Shortcuts */}
      <div className="quick-actions">
        <button type="button" className="action-card" onClick={() => go('production', 'sow')}>
          <span className="action-icon">🌱</span>
          <div>
            <strong>New Sowing</strong>
            <small>Sow trays & deduct seed</small>
          </div>
        </button>
        <button type="button" className="action-card" onClick={() => go('production', 'harvest')}>
          <span className="action-icon">✂️</span>
          <div>
            <strong>Record Harvest</strong>
            <small>Harvest & pack boxes</small>
          </div>
        </button>
        <button type="button" className="action-card" onClick={() => go('sales', 'record')}>
          <span className="action-icon">🛒</span>
          <div>
            <strong>Record Sale</strong>
            <small>Sell boxes & track revenue</small>
          </div>
        </button>
        <button type="button" className="action-card" onClick={() => go('inventory', 'purchase')}>
          <span className="action-icon">🌾</span>
          <div>
            <strong>Buy Seed</strong>
            <small>Record purchase batch</small>
          </div>
        </button>
        <button type="button" className="action-card" onClick={() => go('finances', 'electricity')}>
          <span className="action-icon">⚡</span>
          <div>
            <strong>Monthly Power</strong>
            <small>Smart switch kWh & bill</small>
          </div>
        </button>
      </div>

      {/* Top Business KPI Stats */}
      <div className="stats">
        <Stat
          label="Seed stock value"
          value={inr(inv?.stockValue)}
          hint={`${(inv?.stock || []).filter((s) => s.remainingKg > 0).length} varieties in stock`}
        />
        <Stat
          label="Active trays growing"
          value={inv?.activeTrays ?? 0}
          hint={`${activeBatches.length} active batches`}
        />
        <Stat
          label="Packed unsold stock"
          value={`${inv?.packedBoxes ?? 0} boxes`}
          hint={inr(inv?.packedValue)}
        />
        <Stat
          label="Net profit (this month)"
          value={inr(pnl?.netProfit)}
          hint={pnl?.revenue > 0 ? `${pct(pnl?.profitMargin)} margin` : 'Based on sales'}
        />
      </div>

      <div className="grid-2">
        {/* Financial Performance Summary */}
        <Card
          title="Monthly Financial Overview"
          subtitle="Matching revenue with COGS of sold boxes + monthly overheads"
          actions={
            <button className="btn ghost" type="button" onClick={() => go('finances', 'pnl')}>
              Full P&L Report →
            </button>
          }
        >
          <ul className="kv">
            <li>
              <span>Boxes sold</span>
              <b>{prod?.boxesSold ?? 0} boxes</b>
            </li>
            <li>
              <span>Revenue (Sales)</span>
              <b style={{ color: 'var(--green)' }}>{inr(pnl?.revenue)}</b>
            </li>
            <li>
              <span>Seed cost (sold boxes)</span>
              <b>{inr(pnl?.seedCost)}</b>
            </li>
            <li>
              <span>Cocopeat cost (sold boxes)</span>
              <b>{inr(pnl?.cocopeatCost)}</b>
            </li>
            <li>
              <span>Packaging cost (sold boxes)</span>
              <b>{inr(pnl?.packagingCost)}</b>
            </li>
            <li>
              <span>Total COGS</span>
              <b style={{ color: 'var(--amber)' }}>{inr(pnl?.cogs)}</b>
            </li>
            <li>
              <span>Gross profit</span>
              <b>{inr(pnl?.grossProfit)}</b>
            </li>
            <li>
              <span>Electricity & operating overheads</span>
              <b style={{ color: 'var(--danger)' }}>{inr(pnl?.operating)}</b>
            </li>
            <li className="total">
              <span>Net Business Profit</span>
              <span style={{ color: (pnl?.netProfit || 0) >= 0 ? 'var(--green-dark)' : 'var(--danger)' }}>
                {inr(pnl?.netProfit)}
              </span>
            </li>
          </ul>
        </Card>

        {/* Seed Stock On Hand */}
        <Card
          title="Seed Inventory On Hand"
          subtitle="FIFO tracks every purchase price separately"
          actions={
            <button className="btn ghost" type="button" onClick={() => go('inventory', 'stock')}>
              Manage Seeds →
            </button>
          }
        >
          {(inv?.stock || []).length ? (
            <ul className="kv">
              {inv.stock.map((s) => {
                const isLow = s.remainingKg < 0.2
                return (
                  <li key={s.name}>
                    <div>
                      <span>{s.name}</span>
                      {isLow ? <Badge variant="warning">Low stock</Badge> : null}
                    </div>
                    <b>{kg(s.remainingKg)}</b>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="muted empty-note">No seed stock recorded yet. Click 'Buy Seed' to add your first batch.</p>
          )}
        </Card>
      </div>

      {/* Active Growing Batches in Production */}
      <Card
        title="Active Growing Batches"
        subtitle="Trays currently in the grow room"
        actions={
          <button className="btn ghost" type="button" onClick={() => go('production', 'harvest')}>
            Harvest Batches →
          </button>
        }
      >
        <Table
          rows={activeBatches}
          empty="No active growing batches. Click 'New Sowing' to start a batch."
          columns={[
            { key: 'batchCode', label: 'Batch ID' },
            { key: 'date', label: 'Sown Date', render: (r) => prettyDate(r.date) },
            {
              key: 'days',
              label: 'Age',
              render: (r) => {
                const days = daysAgo(r.date)
                return (
                  <span>
                    Day {days} {days >= 7 ? <Badge variant="success">Ready</Badge> : null}
                  </span>
                )
              },
            },
            {
              key: 'items',
              label: 'Trays & Varieties',
              render: (r) =>
                r.items
                  .map(
                    (i) =>
                      `${i.varietyName}: ${Math.max(0, i.trays - (i.harvestedTrays || 0))} / ${i.trays} trays`,
                  )
                  .join(', '),
            },
            {
              key: 'cost',
              label: 'Production Cost',
              render: (r) => inr(r.totalProductionCost || r.seedCost + r.cocopeatCost),
            },
            {
              key: 'status',
              label: 'Status',
              render: (r) => (
                <Badge variant={r.status === 'partial' ? 'warning' : 'info'}>
                  {r.status === 'partial' ? 'Partially harvested' : 'Growing'}
                </Badge>
              ),
            },
            {
              key: 'action',
              label: '',
              render: (r) => (
                <button
                  type="button"
                  className="btn ghost"
                  style={{ padding: '6px 12px', fontSize: '13px' }}
                  onClick={() => go('production', `harvest&batch=${r.id}`)}
                >
                  Harvest ✂️
                </button>
              ),
            },
          ]}
        />
      </Card>
    </Page>
  )
}
