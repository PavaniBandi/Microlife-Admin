export function Page({ title, subtitle, actions, children }) {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}

export function Card({ title, subtitle, actions, children, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <small className="muted">{subtitle}</small> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </div>
      )}
      {children}
    </div>
  )
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint ? <small className="field-hint"> ({hint})</small> : null}
      </span>
      {children}
    </label>
  )
}

export function Button({ children, variant = 'primary', className = '', ...props }) {
  return (
    <button className={`btn ${variant} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function Stat({ label, value, hint, variant }) {
  return (
    <div className={`stat ${variant ? `stat-${variant}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <em>{hint}</em> : null}
    </div>
  )
}

export function Badge({ children, variant = 'default' }) {
  return <span className={`badge badge-${variant}`}>{children}</span>
}

export function ErrorBanner({ error }) {
  if (!error) return null
  return <div className="banner error">{error}</div>
}

export function SuccessBanner({ message }) {
  if (!message) return null
  return <div className="banner success">{message}</div>
}

export function Tabs({ tabs, activeTab, onChange }) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.icon ? <span className="tab-icon">{tab.icon}</span> : null}
          <span>{tab.label}</span>
          {tab.count != null ? <span className="tab-count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function Table({ columns, rows, empty = 'No records yet.' }) {
  if (!rows?.length) return <p className="muted empty-note">{empty}</p>
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={c.style}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.id || row._id || idx}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.label} style={c.style}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
