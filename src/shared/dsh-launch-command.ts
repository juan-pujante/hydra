// DeepSeek Harness ships one binary, `dsh`, and boots a *profile* with it. Only the
// `dsh-tui` profile paints an interactive composer; `web` serves HTTP, `headless` answers
// one task and exits, `sdk`/`sdk-minimal`/`acp` speak JSON-RPC on stdio, and `plugin` is
// package management. All five are `dsh` in the process table, so foreground recognition
// has to read the profile to tell an agent pane from a server or a one-shot.
//
// `dsh-tui` (and its `dst` alias) forward straight to `dsh --profile dsh-tui`, so they are
// always interactive and never reach this matcher.

/** Profiles that boot something other than the interactive terminal UI. */
const NON_INTERACTIVE_PROFILES = new Set([
  'web',
  'headless',
  'sdk',
  'sdk-minimal',
  'acp',
  'desktop'
])

/** Subcommands that never boot a profile at all. */
const NON_BOOT_SUBCOMMANDS = new Set(['plugin'])

/** The documented bare-word alias for `--profile web`; the only one the launcher takes. */
const WEB_SUBCOMMAND = 'web'

/** Launcher flags that print a composed config and exit. */
const DUMP_FLAGS = new Set(['--dump-config', '--dump-default-config', '--dump-config-schema'])

function readProfileName(tokens: readonly string[], index: number): string | null {
  const token = tokens[index]
  if (token === undefined) {
    return null
  }
  if (token.startsWith('--profile=')) {
    return token.slice('--profile='.length)
  }
  return token === '--profile' ? (tokens[index + 1] ?? null) : null
}

/** Launcher flags that take a value, so the token after them is never an app argument. */
const LAUNCHER_FLAGS_WITH_VALUE = new Set(['--profile', '--from-default-profile', '--patch'])

/** Valueless launcher flags. */
const LAUNCHER_FLAGS = new Set(['-V', '--version', '-h', '--help', ...DUMP_FLAGS])

function isLauncherToken(token: string): boolean {
  if (LAUNCHER_FLAGS.has(token)) {
    return true
  }
  return [...LAUNCHER_FLAGS_WITH_VALUE].some(
    (flag) => token === flag || token.startsWith(`${flag}=`)
  )
}

/**
 * Whether a `dsh` command line runs something other than the interactive agent.
 *
 * Only the launcher's own tokens are read. Everything after the first token the launcher
 * does not recognize belongs to the booted app (`dsh --profile dsh-tui --resume <id>`),
 * and a prompt or session id is free text that must never be read as a launcher flag.
 */
export function isDshNonInteractiveCommand(tokens: readonly string[]): boolean {
  let profile: string | null = null
  let index = 1
  // Skip the leading non-flag tokens: an interpreter invocation puts the script path here.
  while (index < tokens.length && !isLauncherToken(tokens[index])) {
    const token = tokens[index]
    if (NON_BOOT_SUBCOMMANDS.has(token) || token === WEB_SUBCOMMAND) {
      return true
    }
    if (!token.startsWith('-') && index > 1) {
      // A bare word that is neither a subcommand nor a flag: the app's arguments start here.
      return false
    }
    index += 1
  }
  for (; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (DUMP_FLAGS.has(token)) {
      return true
    }
    if (!isLauncherToken(token)) {
      break
    }
    const explicitProfile = readProfileName(tokens, index)
    if (explicitProfile !== null && profile === null) {
      profile = explicitProfile
    }
    if (LAUNCHER_FLAGS_WITH_VALUE.has(token)) {
      index += 1
    }
  }
  return profile !== null && NON_INTERACTIVE_PROFILES.has(profile)
}
