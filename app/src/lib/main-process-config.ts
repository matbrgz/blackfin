import { writeFile } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { TitleBarStyle } from '../ui/lib/title-bar-style'

export type MainProcessConfig = {
  titleBarStyle: TitleBarStyle
  hideWindowOnQuit: boolean
}

const DEFAULT_CONFIG: MainProcessConfig = {
  titleBarStyle: 'native',
  hideWindowOnQuit: false,
}

let cachedMainProcessConfig: MainProcessConfig | null = null

// The function has to be synchronous,
// since we need its return value to create electron BrowserWindow
export function readMainProcessConfig(): MainProcessConfig {
  if (cachedMainProcessConfig) {
    return cachedMainProcessConfig
  }

  const mainProcessConfigPath = getMainProcessConfigPath()

  if (existsSync(mainProcessConfigPath)) {
    const storedMainProcessConfig = JSON.parse(
      readFileSync(mainProcessConfigPath, 'utf8')
    )

    if (
      storedMainProcessConfig.titleBarStyle === 'native' ||
      storedMainProcessConfig.titleBarStyle === 'custom' ||
      storedMainProcessConfig.titleBarStyle === 'native-without-menu-bar'
    ) {
      cachedMainProcessConfig = storedMainProcessConfig
    }
  }

  // Cache the default value if the config file is not found, or if it contains an invalid value.
  if (cachedMainProcessConfig == null) {
    cachedMainProcessConfig = DEFAULT_CONFIG
  }

  return cachedMainProcessConfig
}

export function updateMainProcessConfig(
  configDiff: Partial<MainProcessConfig>
) {
  const previous = readMainProcessConfig()
  const newConfig = { ...previous, ...configDiff }
  cachedMainProcessConfig = newConfig
  return writeFile(
    getMainProcessConfigPath(),
    JSON.stringify(newConfig),
    'utf8'
  )
}

const getMainProcessConfigPath = () =>
  join(app.getPath('userData'), '.main-process-config')
