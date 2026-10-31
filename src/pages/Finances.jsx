import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { inr, monthISO, prettyDate, todayISO, pct } from '../lib/format'
import { Button, Card, ErrorBanner, SuccessBanner, Field, Page, Stat, Table, Tabs, Badge } from '../components/ui'

const EXPENSE_CATEGORIES = [
  'Labour',
  'Water',
  'Delivery',
  'Maintenance',
  'Growing medium',
  'Miscellaneous',
]

function shiftMonth(m, delta) {
  const [y, mon] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mon - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}

export default function Finances({ initialTab = 'pnl' }) {
  const [tab, setTab] = useState(initialTab)
  const [month, setMonth] = useState(monthISO())
  const [report, setReport] = useState(null)
  const [power, setPower] = useState([])
  const [expenses, setExpenses] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Electricity form
  const [bill, setBill] = useState({
    month: monthISO(),
    units: '',
    rate: '8',
    billAmount: '',
    notes: '',
  })

  // Other expense form
  const [expenseForm, setExpenseForm] = useState({
    date: todayISO(),
    category: 'Labour',
    amount: '',
    description: '',
  })

  const loadData = async (m = month) => {
    try {
      const [rep, p, exp] = await Promise.all([
        api.report({ mode: 'month', month: m }),
        api.electricity(),
        api.expenses(),
      ])
      setReport(rep)
      setPower(p)
      setExpenses(exp)

      // If electricity exists for this month, prefill the bill form
      const existingBill = p.find((b) => b.month === m)
      if (existingBill) {
        setBill({
          month: m,
          units: existingBill.units || '',
          rate: existingBill.rate || '8',
          billAmount: existingBill.total || '',
          notes: existingBill.notes || '',
        })
      } else {
        setBill((curr) => ({ ...curr, month: m }))
      }
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    loadData(month)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])

  // Save electricity
  async function handleSaveElectricity(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      await api.saveElectricity(bill.month, {
        units: Number(bill.units),
        rate: Number(bill.rate),
        billAmount: bill.billAmount ? Number(bill.billAmount) : undefined,
        notes: bill.notes,
      })
      setSuccess(`Saved electricity expense for ${bill.month}! Included in ${bill.month} P&L.`)
      await loadData(month)
    } catch (err) {
      setError(err.message)
    }
  }

  // Save other expense
  async function handleSaveExpense(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    try {
      await api.createExpense({
        ...expenseForm,
        amount: Number(expenseForm.amount),
      })
      setSuccess(`Expense for ${expenseForm.category} (${inr(expenseForm.amount)}) recorded!`)
      setExpenseForm((f) => ({ ...f, amount: '', description: '' }))
      await loadData(month)
    } catch (err) {
      setError(err.message)
    }
  }

  // Delete expense
  async function handleDeleteExpense(id) {
    try {
      await api.deleteExpense(id)
      await loadData(month)
    } catch (err) {
      setError(err.message)
    }
  }

  // CSV Export
  function exportCsv() {
    if (!report) return
    const lines = [
      ['MICROGREENS BUSINESS MANAGEMENT SYSTEM - MONTHLY P&L REPORT'],
      ['Report Month', report.period.month],
      [],
      ['PROFIT & LOSS STATEMENT', 'AMOUNT (INR)'],
      ['Revenue (Boxes Sold)', report.pnl.revenue],
      ['Seed Cost (FIFO)', report.pnl.seedCost],
      ['Cocopeat Cost', report.pnl.cocopeatCost],
      ['Packaging Box Cost', report.pnl.packagingCost],
      ['Total Cost of Goods Sold (COGS)', report.pnl.cogs],
      ['Gross Profit', report.pnl.grossProfit],
      ['Smart Switch Electricity Expense', report.pnl.electricityExpense],
      ['Other Operating Expenses', report.pnl.otherExpenses],
      ['Total Operating Overheads', report.pnl.operating],
      ['Net Profit', report.pnl.netProfit],
      ['Profit Margin %', `${report.pnl.profitMargin}%`],
      [],
      ['PRODUCTION ACTIVITY IN PERIOD', 'COUNT / AMOUNT'],
      ['Trays Sown', report.production.traysSown],
      ['Direct Sowing Cost Incurred', report.production.directGrowingCostSown],
      ['Trays Harvested', report.production.traysHarvested],
      ['Boxes Packed', report.production.boxesPacked],
      ['Packaging Cost Incurred', report.production.packagingCostPacked],
      ['Grams Harvested', `${report.production.gramsHarvested} g`],
      ['Avg Yield (g / tray)', `${report.production.avgGramsPerTray} g`],
      ['Avg Yield (boxes / tray)', report.production.avgBoxesPerTray],
      [],
      ['VARIETY BREAKDOWN', 'BOXES SOLD', 'REVENUE', 'COGS', 'GROSS PROFIT', 'MARGIN %'],
      ...report.byVariety.map((r) => [
        r.varietyName,
        r.boxesSold,
        r.revenue,
        r.cogs,
        r.grossProfit,
        `${r.margin}%`,
      ]),
    ]

    const csvContent = lines.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `microlife-pnl-${report.period.month}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const pnl = report?.pnl
  const prod = report?.production
  const calcPower = Number(bill.units || 0) * Number(bill.rate || 0)

  return (
    <Page
      title="Finances & P&L Reports"
      subtitle="Complete accounting: sales revenue, direct COGS, smart-switch electricity, operating overheads, and net profit."
    >
      <ErrorBanner error={error} />
      <SuccessBanner message={success} />

      <Tabs
        activeTab={tab}
        onChange={setTab}
        tabs={[
          { id: 'pnl', label: '1. Monthly P&L Report', icon: '📊' },
          { id: 'electricity', label: '2. Electricity (Smart Switch)', icon: '⚡', count: power.length },
          { id: 'expenses', label: '3. Operating Expenses', icon: '🧾', count: expenses.length },
        ]}
      />

      {/* ==================== SUB-TAB 1: MONTHLY P&L REPORT ==================== */}
      {tab === 'pnl' && (
        <>
          {/* Month Selector Bar */}
          <Card className="filter-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, marginRight: 4 }}>Period:</span>
                <Button
                  type="button"
                  variant="ghost"
                  style={{ padding: '6px 12px', fontSize: 13 }}
                  onClick={() => setMonth(shiftMonth(month, -1))}
                >
                  ← Prev
                </Button>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  style={{ width: 'auto', padding: '6px 12px' }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  style={{ padding: '6px 12px', fontSize: 13 }}
                  onClick={() => setMonth(shiftMonth(month, 1))}
                >
                  Next →
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  style={{ padding: '6px 12px', fontSize: 13 }}
                  onClick={() => setMonth(monthISO())}
                >
                  This Month
                </Button>
              </div>
              <div className="row-actions">
                <Button type="button" variant="ghost" onClick={exportCsv}>
                  📥 Export CSV
                </Button>
                <Button type="button" variant="ghost" onClick={() => window.print()}>
                  🖨️ Print Report
                </Button>
              </div>
            </div>
          </Card>

          {/* Top KPI Cards */}
          <div className="stats">
            <Stat label="Sales Revenue" value={inr(pnl?.revenue)} hint={`${prod?.boxesSold ?? 0} boxes sold`} />
            <Stat label="Cost of Goods Sold (COGS)" value={inr(pnl?.cogs)} hint="Seed + Coco + Pack" />
            <Stat label="Operating Overheads" value={inr(pnl?.operating)} hint="Power + Expenses" />
            <Stat
              label="Net Business Profit"
              value={inr(pnl?.netProfit)}
              hint={pnl?.revenue > 0 ? `${pct(pnl?.profitMargin)} margin` : 'For selected month'}
            />
          </div>

          <div className="grid-2">
            {/* Income Statement Table */}
            <Card title={`Profit & Loss Statement (${month})`} subtitle="Standard accounting matching costs to sold boxes">
              <ul className="kv">
                <li>
                  <span>Revenue (Boxes Sold)</span>
                  <b style={{ color: 'var(--green)' }}>{inr(pnl?.revenue)}</b>
                </li>
                <li>
                  <span>Seed Cost (FIFO allocated)</span>
                  <b>{inr(pnl?.seedCost)}</b>
                </li>
                <li>
                  <span>Cocopeat Cost (allocated)</span>
                  <b>{inr(pnl?.cocopeatCost)}</b>
                </li>
                <li>
                  <span>Packaging Box Cost</span>
                  <b>{inr(pnl?.packagingCost)}</b>
                </li>
                <li style={{ background: '#fcfdfc', padding: '8px 10px', borderRadius: 8 }}>
                  <span><b>Total COGS</b></span>
                  <b style={{ color: 'var(--amber)' }}>{inr(pnl?.cogs)}</b>
                </li>
                <li>
                  <span><b>Gross Business Profit</b></span>
                  <b style={{ color: 'var(--green-dark)' }}>{inr(pnl?.grossProfit)}</b>
                </li>
                <li>
                  <span>Smart Switch Electricity Expense</span>
                  <b>{inr(pnl?.electricityExpense)}</b>
                </li>
                <li>
                  <span>Other Operating Expenses</span>
                  <b>{inr(pnl?.otherExpenses)}</b>
                </li>
                <li style={{ background: '#fdf8f8', padding: '8px 10px', borderRadius: 8 }}>
                  <span><b>Total Overheads</b></span>
                  <b style={{ color: 'var(--danger)' }}>{inr(pnl?.operating)}</b>
                </li>
                <li className="total">
                  <span>NET PROFIT FOR MONTH</span>
                  <span style={{ color: (pnl?.netProfit || 0) >= 0 ? 'var(--green-dark)' : 'var(--danger)' }}>
                    {inr(pnl?.netProfit)}
                  </span>
                </li>
              </ul>
            </Card>

            {/* Production Activity In Period */}
            <Card
              title={`Production Activity (${month})`}
              subtitle="Trays grown and boxes produced during this month"
            >
              <ul className="kv">
                <li>
                  <span>Trays sown in month</span>
                  <b>{prod?.traysSown ?? 0} trays</b>
                </li>
                <li>
                  <span>Direct growing cost of sown trays</span>
                  <b>{inr(prod?.directGrowingCostSown)}</b>
                </li>
                <li>
                  <span>Trays harvested in month</span>
                  <b>{prod?.traysHarvested ?? 0} trays</b>
                </li>
                <li>
                  <span>Boxes packed / produced</span>
                  <b>{prod?.boxesPacked ?? 0} boxes</b>
                </li>
                <li>
                  <span>Packaging cost incurred</span>
                  <b>{inr(prod?.packagingCostPacked)}</b>
                </li>
                <li>
                  <span>Total yield weight</span>
                  <b>{prod?.gramsHarvested ?? 0} grams</b>
                </li>
                <li>
                  <span>Average grams / tray</span>
                  <b>{prod?.avgGramsPerTray ?? 0} g / tray</b>
                </li>
                <li>
                  <span>Average boxes / tray</span>
                  <b>{prod?.avgBoxesPerTray ?? 0} boxes / tray</b>
                </li>
                <li>
                  <span>Boxes sold / dispatched</span>
                  <b style={{ color: 'var(--green)' }}>{prod?.boxesSold ?? 0} boxes</b>
                </li>
                {prod?.boxesWrittenOff > 0 ? (
                  <li>
                    <span>Boxes written off</span>
                    <b style={{ color: 'var(--danger)' }}>{prod.boxesWrittenOff} boxes</b>
                  </li>
                ) : null}
              </ul>
            </Card>
          </div>

          {/* Variety Breakdown */}
          <Card title="Performance by Seed Variety" subtitle="Revenue, costs, and profit margin for each variety sold in this month">
            <Table
              rows={report?.byVariety || []}
              empty="No variety sales recorded for this month."
              columns={[
                { key: 'varietyName', label: 'Variety' },
                { key: 'boxesSold', label: 'Boxes Sold' },
                { key: 'revenue', label: 'Revenue', render: (r) => inr(r.revenue) },
                { key: 'cogs', label: 'Direct COGS', render: (r) => inr(r.cogs) },
                {
                  key: 'grossProfit',
                  label: 'Gross Profit',
                  render: (r) => (
                    <span style={{ fontWeight: 600, color: r.grossProfit >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                      {inr(r.grossProfit)}
                    </span>
                  ),
                },
                {
                  key: 'margin',
                  label: 'Gross Margin',
                  render: (r) => <Badge variant={r.margin >= 50 ? 'success' : 'default'}>{pct(r.margin)}</Badge>,
                },
              ]}
            />
          </Card>

          {/* Batch Breakdown */}
          <Card title="Performance by Sowing Batch" subtitle="Profitability attribution per sowing batch">
            <Table
              rows={report?.byBatch || []}
              empty="No batch activity in this period."
              columns={[
                { key: 'batchCode', label: 'Batch ID' },
                { key: 'sowingDate', label: 'Sown Date', render: (r) => prettyDate(r.sowingDate) },
                { key: 'traysSown', label: 'Trays Sown' },
                { key: 'productionCost', label: 'Growing Cost', render: (r) => inr(r.productionCost) },
                { key: 'boxesSold', label: 'Boxes Sold' },
                { key: 'revenue', label: 'Revenue', render: (r) => inr(r.revenue) },
                { key: 'cogs', label: 'COGS', render: (r) => inr(r.cogs) },
                {
                  key: 'profit',
                  label: 'Profit',
                  render: (r) => (
                    <span style={{ fontWeight: 600, color: r.profit >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                      {inr(r.profit)}
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        </>
      )}

      {/* ==================== SUB-TAB 2: MONTHLY ELECTRICITY ==================== */}
      {tab === 'electricity' && (
        <>
          <Card
            title="Monthly Grow-Light Electricity (Smart Switch)"
            subtitle="Enter monthly total kWh consumption from your smart-switch app and tariff rate per unit."
          >
            <form onSubmit={handleSaveElectricity}>
              <div className="form-grid">
                <Field label="Month">
                  <input
                    type="month"
                    value={bill.month}
                    onChange={(e) => {
                      setBill({ ...bill, month: e.target.value })
                      const existing = power.find((b) => b.month === e.target.value)
                      if (existing) {
                        setBill((b) => ({
                          ...b,
                          units: existing.units || '',
                          rate: existing.rate || '8',
                          billAmount: existing.total || '',
                          notes: existing.notes || '',
                        }))
                      }
                    }}
                    required
                  />
                </Field>

                <Field label="Electricity Consumed (kWh units)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={bill.units}
                    onChange={(e) => setBill({ ...bill, units: e.target.value })}
                    placeholder="e.g. 150"
                    required
                  />
                </Field>

                <Field label="Rate per Unit (₹ / kWh)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={bill.rate}
                    onChange={(e) => setBill({ ...bill, rate: e.target.value })}
                    placeholder="e.g. 8"
                    required
                  />
                </Field>

                <Field label="Bill Amount Override (Optional)" hint="Use if bill differs from units × rate">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={bill.billAmount}
                    onChange={(e) => setBill({ ...bill, billAmount: e.target.value })}
                    placeholder={calcPower ? String(calcPower) : 'Calculated automatically'}
                  />
                </Field>

                <Field label="Notes / Smart Switch Reference">
                  <input
                    value={bill.notes}
                    onChange={(e) => setBill({ ...bill, notes: e.target.value })}
                    placeholder="e.g. Grow rack smart plug reading"
                  />
                </Field>
              </div>

              {/* LIVE ELECTRICITY CALCULATION PREVIEW */}
              <div className="cost-preview">
                <h4>Electricity Expense Preview</h4>
                <div className="preview-grid">
                  <div className="preview-item">
                    <span>Units Consumed</span>
                    <strong>{Number(bill.units || 0)} kWh</strong>
                    <small>Grow lights smart switch</small>
                  </div>
                  <div className="preview-item">
                    <span>Tariff Rate</span>
                    <strong>{inr(bill.rate || 0)} / kWh</strong>
                    <small>Cost per unit</small>
                  </div>
                  <div className="preview-item">
                    <span>Calculated Cost</span>
                    <strong>{inr(calcPower)}</strong>
                    <small>{bill.units || 0} × {bill.rate || 0}</small>
                  </div>
                  <div className="preview-item">
                    <span>Amount in Monthly P&L</span>
                    <strong style={{ color: 'var(--green-dark)' }}>
                      {inr(bill.billAmount ? bill.billAmount : calcPower)}
                    </strong>
                    <small>Operating overhead</small>
                  </div>
                </div>
              </div>

              <Button type="submit">Save Monthly Electricity</Button>
            </form>
          </Card>

          <Card title="Monthly Electricity Records" subtitle="Changes to a later month do not alter prior months">
            <Table
              rows={power.map((p) => ({ ...p, id: p.month }))}
              empty="No electricity records recorded yet."
              columns={[
                { key: 'month', label: 'Month' },
                { key: 'units', label: 'Units (kWh)', render: (r) => `${r.units} kWh` },
                { key: 'rate', label: 'Rate', render: (r) => `${inr(r.rate)} / unit` },
                { key: 'calculated', label: 'Units × Rate', render: (r) => inr(r.calculated) },
                { key: 'total', label: 'In Monthly P&L', render: (r) => <b>{inr(r.total)}</b> },
                { key: 'notes', label: 'Notes', render: (r) => r.notes || '—' },
              ]}
            />
          </Card>
        </>
      )}

      {/* ==================== SUB-TAB 3: OPERATING EXPENSES ==================== */}
      {tab === 'expenses' && (
        <>
          <Card
            title="Record Operating Expense"
            subtitle="Water, labour, delivery, maintenance and other expenses separate from seed, cocopeat and packaging."
          >
            <form onSubmit={handleSaveExpense}>
              <div className="form-grid">
                <Field label="Date">
                  <input
                    type="date"
                    value={expenseForm.date}
                    onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })}
                    required
                  />
                </Field>

                <Field label="Expense Category">
                  <select
                    value={expenseForm.category}
                    onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Amount (₹)">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                    placeholder="e.g. 500"
                    required
                  />
                </Field>

                <Field label="Description / Notes">
                  <input
                    value={expenseForm.description}
                    onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                    placeholder="e.g. Delivery petrol, harvesting shears"
                  />
                </Field>
              </div>

              <Button type="submit">Record Expense</Button>
            </form>
          </Card>

          <Card title="Operating Expenses Log" subtitle="Recorded expenses in the system">
            <Table
              rows={expenses}
              empty="No operating expenses recorded yet."
              columns={[
                { key: 'date', label: 'Date', render: (r) => prettyDate(r.date) },
                {
                  key: 'category',
                  label: 'Category',
                  render: (r) => <Badge variant="default">{r.category}</Badge>,
                },
                { key: 'amount', label: 'Amount', render: (r) => <b>{inr(r.amount)}</b> },
                { key: 'description', label: 'Description', render: (r) => r.description || '—' },
                {
                  key: 'action',
                  label: '',
                  render: (r) => (
                    <Button
                      type="button"
                      variant="danger"
                      style={{ padding: '4px 10px', fontSize: 13 }}
                      onClick={() => handleDeleteExpense(r.id)}
                    >
                      Remove
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
        </>
      )}
    </Page>
  )
}
