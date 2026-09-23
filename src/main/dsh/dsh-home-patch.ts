/**
 * Orca's managed block inside `$DSH_HOME/cordis.patch.yml`.
 *
 * That file is a hand-editable top-level YAML sequence of loader patch entries, and no
 * YAML library is vendored in the main process, so Orca manages only its own
 * marker-delimited region: install rewrites the region, remove strips it, and everything
 * outside the markers is copied through byte for byte. Appending sequence entries to a
 * block sequence is always valid YAML, so the region can live at the end of any file.
 *
 * The one shape that is not append-safe is an empty *flow* sequence (`[]`), which is what
 * DSH writes into a freshly initialized patch file. `- item` after `[]` is a parse error,
 * so that token is dropped when the managed block is added and restored when it is the
 * last thing removed — otherwise the file would come back as an unparseable empty
 * document.
 */

const START_MARKER = '# >>> orca-managed-dsh-hooks (managed by Orca; do not edit) >>>'
const END_MARKER = '# <<< orca-managed-dsh-hooks <<<'

/** The loader row id Orca owns. A patch row is addressed by id, so this must be stable. */
const MANAGED_ROW_ID = 'orca-agent-hooks'

const EMPTY_FLOW_SEQUENCE = '[]'

export type ManagedDshPatchRegion = { startLine: number; endLine: number }

function splitLines(text: string): string[] {
  return text.split('\n')
}

/** Locate the managed region, or null when the file carries none. */
export function findManagedDshPatchRegion(text: string): ManagedDshPatchRegion | null {
  const lines = splitLines(text)
  const startLine = lines.findIndex((line) => line.trim() === START_MARKER)
  if (startLine === -1) {
    return null
  }
  const endOffset = lines.slice(startLine + 1).findIndex((line) => line.trim() === END_MARKER)
  // Why: a truncated region (start with no end) is unknown extent. Splicing a guess would
  // delete user rows, so fail closed and report it as absent — install then appends a
  // fresh region and status reports the duplicate rather than silently eating content.
  return endOffset === -1 ? null : { startLine, endLine: startLine + 1 + endOffset }
}

function buildManagedBlock(managedHooksPath: string): string[] {
  return [
    START_MARKER,
    '- insert:',
    `    - id: ${MANAGED_ROW_ID}`,
    "      name: '@deepseek-ai/dsh-hooks-claude-code'",
    '      config:',
    `        configPath: ${quoteYamlScalar(managedHooksPath)}`,
    END_MARKER
  ]
}

/** Single-quoted YAML scalar: the only escape inside one is a doubled quote. */
function quoteYamlScalar(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll("''", "'")
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** The `configPath` Orca's managed region currently points at, if any. */
export function readManagedDshHooksConfigPath(text: string): string | undefined {
  const region = findManagedDshPatchRegion(text)
  if (!region) {
    return undefined
  }
  for (const line of splitLines(text).slice(region.startLine + 1, region.endLine)) {
    const match = /^\s*configPath:\s*(.+?)\s*$/.exec(line)
    if (match) {
      return unquoteYamlScalar(match[1])
    }
  }
  return undefined
}

function stripRegion(lines: string[], region: ManagedDshPatchRegion): string[] {
  return [...lines.slice(0, region.startLine), ...lines.slice(region.endLine + 1)]
}

function isBlank(line: string): boolean {
  return line.trim().length === 0
}

function isComment(line: string): boolean {
  return line.trim().startsWith('#')
}

/** Index of a top-level `[]` document body, or -1 when the file has real content. */
function findEmptyFlowSequenceLine(lines: readonly string[]): number {
  let found = -1
  for (const [index, line] of lines.entries()) {
    if (isBlank(line) || isComment(line)) {
      continue
    }
    if (line.trim() === EMPTY_FLOW_SEQUENCE && found === -1) {
      found = index
      continue
    }
    return -1
  }
  return found
}

function joinPreservingTrailingNewline(lines: readonly string[]): string {
  const text = lines.join('\n')
  return text.endsWith('\n') || text.length === 0 ? text : `${text}\n`
}

/**
 * Install (or refresh) Orca's managed region so the DSH hook bridge reads
 * `managedHooksPath`. Everything outside the markers is preserved.
 */
export function applyManagedDshPatch(text: string, managedHooksPath: string): string {
  const region = findManagedDshPatchRegion(text)
  const block = buildManagedBlock(managedHooksPath)
  if (region) {
    const lines = splitLines(text)
    return joinPreservingTrailingNewline([
      ...lines.slice(0, region.startLine),
      ...block,
      ...lines.slice(region.endLine + 1)
    ])
  }

  let lines = splitLines(text)
  const emptyFlowLine = findEmptyFlowSequenceLine(lines)
  if (emptyFlowLine !== -1) {
    lines = [...lines.slice(0, emptyFlowLine), ...lines.slice(emptyFlowLine + 1)]
  }
  while (lines.length > 0 && isBlank(lines.at(-1) ?? '')) {
    lines.pop()
  }
  return joinPreservingTrailingNewline(lines.length > 0 ? [...lines, ...block] : block)
}

/** Strip Orca's managed region, restoring `[]` when nothing else is left. */
export function removeManagedDshPatch(text: string): { text: string; changed: boolean } {
  const region = findManagedDshPatchRegion(text)
  if (!region) {
    return { text, changed: false }
  }
  let lines = stripRegion(splitLines(text), region)
  while (lines.length > 0 && isBlank(lines.at(-1) ?? '')) {
    lines.pop()
  }
  if (lines.every((line) => isBlank(line) || isComment(line))) {
    lines = [...lines, EMPTY_FLOW_SEQUENCE]
  }
  return { text: joinPreservingTrailingNewline(lines), changed: true }
}
