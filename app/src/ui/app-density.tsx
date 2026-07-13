import * as React from 'react'
import { Density, densityClassName } from '../models/density'

interface IAppDensityProps {
  readonly density: Density
}

/**
 * Puts the density class on `<body>`, where `app/styles/_tokens.scss` reads it.
 *
 * Deliberately not modelled on `AppTheme`, which resolves the class
 * asynchronously and therefore leaves the body with no class at all during first
 * paint. That is survivable for the theme only because the light values live in
 * `:root` as a fallback — and the same is true here: `--row-height` and friends
 * have a comfortable default in `:root`, and `body.density-compact` overrides
 * them. So a missing class is the default, not an unresolved variable.
 */
export class AppDensity extends React.Component<IAppDensityProps> {
  public componentDidMount() {
    this.apply()
  }

  public componentDidUpdate() {
    this.apply()
  }

  public componentWillUnmount() {
    this.clear()
  }

  private apply() {
    const className = densityClassName(this.props.density)

    if (!document.body.classList.contains(className)) {
      this.clear()
      document.body.classList.add(className)
    }
  }

  private clear() {
    for (const density of Object.values(Density)) {
      document.body.classList.remove(densityClassName(density))
    }
  }

  public render() {
    return null
  }
}
