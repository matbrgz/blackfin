import * as React from 'react'
import classNames from 'classnames'

/**
 * The state of a sensitive value — an env var, a secret — without the value.
 *
 * A control center shows you *that* `OPENAI_API_KEY` is set for a project, not
 * what it is. These four states are the whole vocabulary a cell is allowed to
 * speak about a secret.
 */
export type SensitiveState = 'configured' | 'absent' | 'inherited' | 'external'

const SENSITIVE_LABEL: Record<SensitiveState, string> = {
  configured: 'Configured',
  absent: 'Not set',
  inherited: 'Inherited',
  external: 'Stored externally',
}

export interface ISensitiveValue {
  readonly state: SensitiveState

  /**
   * A value a caller may hold by accident. It is typed here precisely so it can
   * be *dropped* here: `sensitiveDisplay` never reads it and the cell never
   * renders it. Structural safety — a screen cannot leak a secret it has no
   * path to put on the page — beats trusting every caller to omit it.
   *
   * Never read, by design: that is the whole point, so the "unused prop" lint is
   * the rule being satisfied, not violated.
   */
  // eslint-disable-next-line react/no-unused-prop-types
  readonly value?: string
}

/** The word a sensitive cell shows. The value, if any, is ignored by construction. */
export function sensitiveDisplay(v: ISensitiveValue): string {
  return SENSITIVE_LABEL[v.state]
}

/**
 * States a secret's condition and can never print the secret. Composes inside a
 * column's `render` — `render: row => <SensitiveValue state={row.apiKey} />` —
 * so it emits the content, not the `<td>` the table already provides.
 */
export class SensitiveValue extends React.Component<ISensitiveValue> {
  public render() {
    return (
      <span className={`sensitive-state sensitive-state--${this.props.state}`}>
        {sensitiveDisplay(this.props)}
      </span>
    )
  }
}

export interface IColumn<T> {
  /** A stable key for the column. */
  readonly key: string

  /** The `<th>` text. */
  readonly header: string

  /** Renders the cell for a row. Plain content — never treated as markup. */
  readonly render: (row: T) => React.ReactNode

  /** Right-aligned and tabular — for columns of numbers. */
  readonly numeric?: boolean
}

interface ITableProps<T> {
  readonly columns: ReadonlyArray<IColumn<T>>
  readonly rows: ReadonlyArray<T>

  /** A stable key per row. */
  readonly getRowKey: (row: T) => string

  /** A caption, for both sighted users and the accessible name of the table. */
  readonly caption?: string

  readonly className?: string
}

/**
 * A real table — `<table>`, `<th scope="col">` — not a grid of divs, because a
 * grid of divs is a table a screen reader cannot read.
 *
 * Not virtualized: its consumers (#44, #34) show tens of rows. A screen that
 * needs thousands is a `List`, not this.
 */
export class Table<T> extends React.Component<ITableProps<T>> {
  public render() {
    const { columns, rows, getRowKey } = this.props

    return (
      <table className={classNames('table', this.props.className)}>
        {this.props.caption !== undefined && (
          <caption className="table-caption">{this.props.caption}</caption>
        )}
        <thead>
          <tr>
            {columns.map(column => (
              <th
                key={column.key}
                scope="col"
                className={classNames('table-header', {
                  'table-header--numeric': column.numeric,
                })}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={getRowKey(row)}>
              {columns.map(column => (
                <td
                  key={column.key}
                  className={classNames('table-cell', {
                    'table-cell--numeric': column.numeric,
                  })}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
}
