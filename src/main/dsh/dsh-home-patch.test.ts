import { describe, expect, it } from 'vitest'
import {
  applyManagedDshPatch,
  findManagedDshPatchRegion,
  readManagedDshHooksConfigPath,
  removeManagedDshPatch
} from './dsh-home-patch'

const HOOKS_PATH = '/home/dev/.orca/agent-hooks/dsh-hooks.json'

// The body DSH writes into a freshly initialized patch file.
const PRISTINE = [
  '# Your patch layer for this dsh profile, applied after every bundle layer:',
  '# a top-level YAML array of loader patch entries (id-targeted config',
  '# overrides, disables, and insert lists; `!!js` expressions allowed).',
  '[]',
  ''
].join('\n')

const USER_ROWS = ['- id: llm-deepseek', '  config:', "    apiKeyEnv: 'MY_KEY'", ''].join('\n')

describe('applyManagedDshPatch', () => {
  it('creates the managed block in an empty file', () => {
    const text = applyManagedDshPatch('', HOOKS_PATH)
    expect(readManagedDshHooksConfigPath(text)).toBe(HOOKS_PATH)
    expect(text).toContain("name: '@deepseek-ai/dsh-hooks-claude-code'")
    expect(text.endsWith('\n')).toBe(true)
  })

  it('replaces the empty flow sequence DSH ships, keeping its comments', () => {
    const text = applyManagedDshPatch(PRISTINE, HOOKS_PATH)
    // `- item` after `[]` is a YAML parse error, so the `[]` token has to go.
    expect(text).not.toMatch(/^\[]$/m)
    expect(text).toContain('# Your patch layer for this dsh profile')
    expect(readManagedDshHooksConfigPath(text)).toBe(HOOKS_PATH)
  })

  it('appends after user rows without touching them', () => {
    const text = applyManagedDshPatch(USER_ROWS, HOOKS_PATH)
    expect(text.startsWith(USER_ROWS.trimEnd())).toBe(true)
    expect(readManagedDshHooksConfigPath(text)).toBe(HOOKS_PATH)
  })

  it('rewrites its own block in place rather than stacking copies', () => {
    const once = applyManagedDshPatch(USER_ROWS, '/old/path.json')
    const twice = applyManagedDshPatch(once, HOOKS_PATH)
    expect(twice.match(/orca-managed-dsh-hooks \(managed by Orca/g)).toHaveLength(1)
    expect(readManagedDshHooksConfigPath(twice)).toBe(HOOKS_PATH)
    expect(twice).not.toContain('/old/path.json')
  })

  it('is idempotent', () => {
    const once = applyManagedDshPatch(PRISTINE, HOOKS_PATH)
    expect(applyManagedDshPatch(once, HOOKS_PATH)).toBe(once)
  })

  it('quotes a path containing a single quote', () => {
    const awkward = "/home/o'brien/.orca/agent-hooks/dsh-hooks.json"
    expect(readManagedDshHooksConfigPath(applyManagedDshPatch('', awkward))).toBe(awkward)
  })
})

describe('removeManagedDshPatch', () => {
  it('restores the empty flow sequence when nothing else remains', () => {
    const installed = applyManagedDshPatch(PRISTINE, HOOKS_PATH)
    const { text, changed } = removeManagedDshPatch(installed)
    expect(changed).toBe(true)
    // Without this the file would come back as an unparseable empty document.
    expect(text.trimEnd().endsWith('[]')).toBe(true)
    expect(text).toContain('# Your patch layer for this dsh profile')
  })

  it('leaves user rows alone and adds no [] when they remain', () => {
    const installed = applyManagedDshPatch(USER_ROWS, HOOKS_PATH)
    const { text } = removeManagedDshPatch(installed)
    expect(text.trimEnd()).toBe(USER_ROWS.trimEnd())
  })

  it('reports no change when the file carries no managed block', () => {
    expect(removeManagedDshPatch(USER_ROWS)).toEqual({ text: USER_ROWS, changed: false })
  })
})

describe('findManagedDshPatchRegion', () => {
  it('fails closed on a truncated region rather than guessing its extent', () => {
    // Splicing a guessed end marker would delete the user rows that follow.
    const truncated = `# >>> orca-managed-dsh-hooks (managed by Orca; do not edit) >>>\n${USER_ROWS}`
    expect(findManagedDshPatchRegion(truncated)).toBeNull()
    expect(removeManagedDshPatch(truncated).changed).toBe(false)
  })
})
