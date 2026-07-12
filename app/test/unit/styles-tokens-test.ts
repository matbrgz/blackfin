import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readdir, readFile } from 'fs/promises'
import * as Path from 'path'

const stylesRoot = Path.join(__dirname, '..', '..', 'styles')

/**
 * Custom properties that are legitimately never written in SCSS because
 * TypeScript sets them on an element at runtime. Each one was verified to have
 * a `setProperty` call behind it — if you add to this list, verify the same.
 */
const SetAtRuntime = new Set([
  '--available-height', // ui/lib/popover.tsx
  '--available-width', // ui/lib/popover.tsx
  '--diff-font-family', // ui/app.tsx
  '--diff-font-size', // ui/app.tsx
  '--diff-line-height', // ui/app.tsx
  '--font-family', // ui/get-monospace-font-family.ts
])

/**
 * Custom properties that are referenced but never defined anywhere — inherited
 * from upstream GitHub Desktop, where they resolve to nothing and the rule is
 * silently dropped. They are recorded rather than fixed because correcting them
 * changes upstream visuals, which is not this file's job.
 *
 * The point of this list is that it must not grow. A `var()` referencing a token
 * nobody defines is not a style choice; it is a rule that does not apply.
 */
const KnownUndefined = new Set([
  '--border-color', // ui/dialogs/_pull-request-comment-like.scss
  '--co-author-tag-selected-border-color', // ui/_author-input.scss
  '--diff-background-color', // ui/_side-by-side-diff.scss
  '--spacing-quarter', // ui/changes/_changes-list.scss, ui/history/_commit-graph.scss
])

async function scssFiles(dir: string): Promise<ReadonlyArray<string>> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const full = Path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await scssFiles(full)))
    } else if (entry.name.endsWith('.scss')) {
      files.push(full)
    }
  }

  return files
}

describe('styles custom properties', () => {
  it('never references a token that nothing defines', async () => {
    const files = await scssFiles(stylesRoot)
    assert.ok(files.length > 0, 'found no SCSS to check')

    const defined = new Set<string>()
    const used = new Map<string, string>()

    for (const file of files) {
      const contents = await readFile(file, 'utf8')
      const relative = Path.relative(stylesRoot, file)

      for (const match of contents.matchAll(/^\s*(--[\w-]+)\s*:/gm)) {
        defined.add(match[1])
      }

      for (const match of contents.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (!used.has(match[1])) {
          used.set(match[1], relative)
        }
      }
    }

    const undefinedTokens = [...used.keys()]
      .filter(token => !defined.has(token))
      .filter(token => !SetAtRuntime.has(token))
      .filter(token => !KnownUndefined.has(token))
      .sort()

    assert.deepStrictEqual(
      undefinedTokens,
      [],
      `These custom properties are used but never defined, so the rules using ` +
        `them silently do nothing:\n` +
        undefinedTokens.map(t => `  ${t} — ${used.get(t)}`).join('\n')
    )
  })

  it('defines every theme-varying token in the dark theme too', async () => {
    // A color defined only in :root is inherited by the dark theme. That is
    // almost never right, and it fails invisibly — the rule applies, it is just
    // the wrong color on the wrong surface. These are the ones we rely on.
    const dark = await readFile(
      Path.join(stylesRoot, 'themes', '_dark.scss'),
      'utf8'
    )

    for (const token of [
      '--dialog-warning-background',
      '--dialog-error-background',
    ]) {
      assert.ok(
        new RegExp(`^\\s*${token}\\s*:`, 'm').test(dark),
        `${token} is a color and must be defined in the dark theme, not ` +
          `inherited from :root`
      )
    }
  })
})
