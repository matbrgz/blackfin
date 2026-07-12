import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  countLines,
  countRules,
  extractReferences,
  parseFrontmatter,
  parseHeadings,
  parseTitle,
} from '../../src/lib/workspace/parse'

describe('parseFrontmatter', () => {
  it('reads name and description', () => {
    const content = [
      '---',
      'name: deploy-to-prod',
      'description: Ships the current branch to production',
      '---',
      '',
      '# Deploy',
    ].join('\n')

    assert.deepEqual(parseFrontmatter(content), {
      name: 'deploy-to-prod',
      description: 'Ships the current branch to production',
    })
  })

  it('strips surrounding quotes', () => {
    const content = ['---', 'name: "quoted"', "description: 'also quoted'", '---'].join(
      '\n'
    )
    assert.deepEqual(parseFrontmatter(content), {
      name: 'quoted',
      description: 'also quoted',
    })
  })

  it('ignores nested keys, which belong to something we do not read', () => {
    const content = [
      '---',
      'metadata:',
      '  name: not-the-skill-name',
      'name: the-skill-name',
      '---',
    ].join('\n')

    assert.equal(parseFrontmatter(content).name, 'the-skill-name')
  })

  it('yields nothing when the frontmatter block never closes', () => {
    // Rather than swallowing the entire file as frontmatter.
    const content = ['---', 'name: unterminated', '', '# A heading'].join('\n')
    assert.deepEqual(parseFrontmatter(content), { name: null, description: null })
  })

  it('yields nothing when there is no frontmatter at all', () => {
    assert.deepEqual(parseFrontmatter('# Just a heading\n'), {
      name: null,
      description: null,
    })
  })

  it('does not throw on an empty file', () => {
    assert.deepEqual(parseFrontmatter(''), { name: null, description: null })
  })
})

describe('parseHeadings', () => {
  it('reads the heading tree', () => {
    const content = ['# Top', '', '## Middle', '', '### Deep'].join('\n')
    assert.deepEqual(parseHeadings(content), [
      { level: 1, text: 'Top' },
      { level: 2, text: 'Middle' },
      { level: 3, text: 'Deep' },
    ])
  })

  it('strips closing hashes', () => {
    assert.deepEqual(parseHeadings('## Middle ##'), [{ level: 2, text: 'Middle' }])
  })

  it('ignores hashes inside fenced code, which are comments and not headings', () => {
    const content = [
      '# Real heading',
      '',
      '```bash',
      '# this is a shell comment',
      'echo hi',
      '```',
      '',
      '## Also real',
    ].join('\n')

    assert.deepEqual(parseHeadings(content), [
      { level: 1, text: 'Real heading' },
      { level: 2, text: 'Also real' },
    ])
  })

  it('handles a fence opened with more than three backticks', () => {
    const content = [
      '````md',
      '# not a heading',
      '```',
      'still inside',
      '````',
      '# actually a heading',
    ].join('\n')

    assert.deepEqual(parseHeadings(content), [
      { level: 1, text: 'actually a heading' },
    ])
  })
})

describe('parseTitle', () => {
  it('prefers the first level-1 heading', () => {
    assert.equal(parseTitle('## Subtitle\n\n# The Title\n'), 'The Title')
  })

  it('falls back to the first heading of any level', () => {
    assert.equal(parseTitle('## Only a subtitle\n'), 'Only a subtitle')
  })

  it('returns null when there are no headings', () => {
    assert.equal(parseTitle('Just prose.\n'), null)
  })
})

describe('countRules', () => {
  it('counts bullets and numbered items', () => {
    const content = [
      '# Rules',
      '- Always run the tests',
      '* Never force push',
      '+ Prefer clarity',
      '1. Read the spec',
      '2. Then write code',
    ].join('\n')

    assert.equal(countRules(content), 5)
  })

  it('counts nested bullets', () => {
    assert.equal(countRules('- one\n  - nested\n'), 2)
  })

  it('does not count bullets inside fenced code', () => {
    const content = ['- a real rule', '', '```diff', '- removed line', '```'].join(
      '\n'
    )
    assert.equal(countRules(content), 1)
  })

  it('does not count a horizontal rule or an empty bullet', () => {
    assert.equal(countRules('---\n***\n-\n'), 0)
  })
})

describe('extractReferences', () => {
  it('finds claude-style imports', () => {
    assert.deepEqual(extractReferences('See @docs/architecture.md for details.'), [
      'docs/architecture.md',
    ])
  })

  it('finds relative markdown links', () => {
    assert.deepEqual(extractReferences('[the spec](./docs/spec.md)'), [
      './docs/spec.md',
    ])
  })

  it('strips anchors from links', () => {
    assert.deepEqual(extractReferences('[section](docs/spec.md#testing)'), [
      'docs/spec.md',
    ])
  })

  it('ignores absolute URLs, which cannot be broken in a way we could detect', () => {
    assert.deepEqual(
      extractReferences('[docs](https://example.com/a.md) and @http://x.com/y'),
      []
    )
  })

  it('ignores bare anchors and absolute paths', () => {
    assert.deepEqual(extractReferences('[here](#section) and [there](/etc/passwd)'), [])
  })

  it('does not swallow the punctuation ending the sentence', () => {
    // Without this, every reference written at the end of a sentence resolves
    // to a path with a trailing period and is reported as broken.
    assert.deepEqual(extractReferences('Read @docs/spec.md.'), ['docs/spec.md'])
    assert.deepEqual(extractReferences('See @docs/a.md, then @docs/b.md!'), [
      'docs/a.md',
      'docs/b.md',
    ])
  })

  it('ignores an @mention of a person', () => {
    // This is the case that makes a naive @-scanner useless.
    assert.deepEqual(extractReferences('Ask @claude about it.'), [])
  })

  it('deduplicates', () => {
    assert.deepEqual(extractReferences('@a/b.md and again @a/b.md'), ['a/b.md'])
  })

  it('ignores references inside fenced code', () => {
    assert.deepEqual(extractReferences('```\n@not/a-reference.md\n```\n'), [])
  })
})

describe('countLines', () => {
  it('does not count a trailing newline as a line', () => {
    assert.equal(countLines('a\nb\n'), 2)
    assert.equal(countLines('a\nb'), 2)
  })

  it('counts an empty file as zero', () => {
    assert.equal(countLines(''), 0)
  })
})
