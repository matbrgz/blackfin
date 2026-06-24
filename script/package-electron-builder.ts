/* eslint-disable no-sync */

import * as path from 'path'
import * as cp from 'child_process'
import { promisify } from 'util'

import glob = require('glob')
const globPromise = promisify(glob)

import {
  getArchitectureForFileName,
  getDistPath,
  getDistRoot,
} from './dist-info'
import { rename } from 'fs/promises'
import { getVersion } from '../app/package-info'

function getArchitecture() {
  const arch = process.env.npm_config_arch || process.arch
  switch (arch) {
    case 'arm64':
      return '--arm64'
    default:
      return '--x64'
  }
}

export async function packageElectronBuilder(): Promise<string> {
  const distPath = getDistPath()
  const distRoot = getDistRoot()

  const electronBuilder = path.resolve(
    __dirname,
    '..',
    'node_modules',
    '.bin',
    'electron-builder'
  )

  const configPath = path.resolve(__dirname, 'electron-builder-linux.yml')

  const args = [
    'build',
    '--prepackaged',
    distPath,
    getArchitecture(),
    '--config',
    configPath,
  ]

  const { error } = cp.spawnSync(electronBuilder, args, { stdio: 'inherit' })

  if (error != null) {
    return Promise.reject(error)
  }

  const appImageInstaller = `${distRoot}/DesktopPlus-linux-*.AppImage`

  const files = await globPromise(appImageInstaller)
  if (files.length !== 1) {
    return Promise.reject(
      `Expected one AppImage installer but instead found '${files.join(
        ', '
      )}' - exiting...`
    )
  }

  const oldPath = files[0]

  const newFileName = `DesktopPlus-v${getVersion()}-linux-${getArchitectureForFileName()}.AppImage`
  const newPath = path.join(distRoot, newFileName)
  await rename(oldPath, newPath)

  return Promise.resolve(newPath)
}
