import { join, resolve } from 'path'
import parse from 'minimist'
import { execFile, spawn } from 'child_process'
import { allCommands } from '../lib/cli/registry'
import { buildCapabilities } from '../lib/cli/capabilities'
import { renderCapabilities, resolveInvocation } from '../lib/cli/dispatch'

const run = (...args: Array<string>) => {
  function cb(e: unknown | null, stderr?: string) {
    if (e) {
      console.error(`Error running command ${args}`)
      console.error(stderr ?? `${e}`)
      process.exit(
        typeof e === 'object' && 'code' in e && typeof e.code === 'number'
          ? e.code
          : 1
      )
    }
  }

  if (process.platform === 'darwin') {
    execFile('open', ['-n', join(__dirname, '../../..'), '--args', ...args], cb)
  } else if (process.platform === 'win32') {
    const exeName = `Blackfin${__DEV__ ? '-dev' : ''}.exe`
    spawn(join(__dirname, `../../${exeName}`), args, {
      detached: true,
      stdio: 'ignore',
    })
      .on('error', cb)
      .on('exit', code => (process.exitCode = code ?? process.exitCode))
      .unref()
  } else if (process.platform === 'linux') {
    execFile('/bin/blackfin', args, cb)
  } else {
    throw new Error('Unsupported platform')
  }
}

const args = parse(process.argv.slice(2), {
  alias: { help: 'h', branch: 'b' },
  boolean: ['help', 'schema-only'],
})

// Build the capabilities document locally — the registry is compiled into this
// bundle, so describing the CLI needs no app. `--schema-only` (and the app-closed
// path) always report `running: false`.
//
// NOTE (runtime-deferred): a best-effort socket probe (short timeout) that fills
// `app.running` / `app.version` when the app is open belongs to the CLI-client
// increment (#61's `client.ts` + the socket connect), which is not wired into
// this launcher yet. `--schema-only` must never attempt it; the other path may.
const capabilitiesDocument = () =>
  buildCapabilities(allCommands(), {
    cliVersion: __APP_VERSION__,
    app: { running: false, version: null },
    now: () => new Date(),
  })

const usage = (exitCode = 1): never => {
  const stream = exitCode === 0 ? process.stdout : process.stderr
  stream.write(
    renderCapabilities(capabilitiesDocument(), 'human') +
      '\n\n' +
      'Launcher commands (start the app):\n' +
      '  blackfin                           Open the current directory\n' +
      '  blackfin open [path]               Open the provided path\n' +
      '  blackfin clone [-b branch] <url>   Clone a repository by url or name/owner\n'
  )
  process.exit(exitCode)
}

// `capabilities` — the self-describing command. It answers locally, so it works
// with the app closed and never launches it. `--json` is the default without a
// TTY; a human at a terminal gets the table.
const printCapabilities = (): never => {
  const invocation = resolveInvocation(args, {
    stdoutIsTTY: Boolean(process.stdout.isTTY),
  })
  process.stdout.write(
    renderCapabilities(capabilitiesDocument(), invocation.format) + '\n'
  )
  process.exit(0)
}

delete process.env.ELECTRON_RUN_AS_NODE

if (args._.at(0) === 'capabilities') {
  printCapabilities()
} else if (args.help || args._.at(0) === 'help') {
  usage(0)
} else if (args._.at(0) === 'clone') {
  const urlArg = args._.at(1)
  // Assume name with owner slug if it looks like it
  const url =
    urlArg && /^[^\/]+\/[^\/]+$/.test(urlArg)
      ? `https://github.com/${urlArg}`
      : urlArg

  if (!url) {
    usage(1)
  } else if (typeof args.branch === 'string') {
    run(`--cli-clone=${url}`, `--cli-branch=${args.branch}`)
  } else {
    run(`--cli-clone=${url}`)
  }
} else {
  const [firstArg, secondArg] = args._
  const pathArg = firstArg === 'open' ? secondArg : firstArg
  const path = resolve(pathArg ?? '.')
  run(`--cli-open=${path}`)
}
