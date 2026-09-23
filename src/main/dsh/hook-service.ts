import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SFTPWrapper } from 'ssh2'

import type { AgentHookInstallState, AgentHookInstallStatus } from '../../shared/agent-hook-types'
import { isDefinitiveAbsence } from '../../shared/definitive-filesystem-absence'
import {
  buildWindowsAgentHookCurlPostCommand,
  writeHooksJson,
  writeManagedScript
} from '../agent-hooks/installer-utils'
import { refreshManagedScriptIfPresent } from '../agent-hooks/managed-hook-script-refresh'
import {
  readTextFileRemote,
  writeManagedScriptRemote,
  writeTextFileRemoteAtomic
} from '../agent-hooks/installer-utils-remote'
import {
  buildPosixHookPayloadCapture,
  buildPosixHookSpoolLines,
  buildWindowsHookEnvironmentGuardLines,
  buildWindowsHookStdinDrainEpilogue
} from '../agent-hooks/hook-stdin-contract'
import { buildPosixAgentHookPostCommand } from '../agent-hooks/hook-post-command'
import {
  applyManagedDshPatch,
  readManagedDshHooksConfigPath,
  removeManagedDshPatch
} from './dsh-home-patch'
import {
  buildDshManagedHooksFile,
  DSH_HOOK_EVENTS,
  getDshConfigPath,
  getDshManagedCommand,
  getDshManagedCommandMatcher,
  getDshManagedHooksPath,
  getDshManagedScriptPath,
  getDshRemoteConfigPath,
  getDshRemoteManagedCommand,
  getDshRemoteManagedHooksPath,
  readManagedDshHookEvents
} from './hook-settings'

function getManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      // Why: same scrub as POSIX — restore the canonical names from their aliases first.
      'if not defined ORCA_PANE_KEY if defined ORCA_AGENT_PANE set "ORCA_PANE_KEY=%ORCA_AGENT_PANE%"',
      'if not defined ORCA_AGENT_LAUNCH_TOKEN if defined ORCA_AGENT_LAUNCH set "ORCA_AGENT_LAUNCH_TOKEN=%ORCA_AGENT_LAUNCH%"',
      'if defined ORCA_AGENT_HOOK_ENDPOINT if exist "%ORCA_AGENT_HOOK_ENDPOINT%" call "%ORCA_AGENT_HOOK_ENDPOINT%" 2>nul',
      ...buildWindowsHookEnvironmentGuardLines(),
      buildWindowsAgentHookCurlPostCommand('dsh'),
      'exit /b 0',
      ...buildWindowsHookStdinDrainEpilogue(),
      ''
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    // Why first: DSH's shell executor drops every env var whose NAME contains KEY, TOKEN,
    // SECRET or PASSWORD before the hook starts, which takes ORCA_PANE_KEY and
    // ORCA_AGENT_LAUNCH_TOKEN with it. Orca mirrors both onto scrub-safe aliases at spawn
    // (see agent-hook-scrub-safe-env.ts); restore the canonical names from them so every
    // line below — including the shared spool and post builders — is unchanged.
    ': "${ORCA_PANE_KEY:=${ORCA_AGENT_PANE:-}}"',
    ': "${ORCA_AGENT_LAUNCH_TOKEN:=${ORCA_AGENT_LAUNCH:-}}"',
    'export ORCA_PANE_KEY ORCA_AGENT_LAUNCH_TOKEN',
    ...buildPosixHookPayloadCapture(),
    ...buildPosixHookSpoolLines('dsh'),
    // Why: the endpoint file holds the live port/token; a PTY that outlived an Orca
    // restart carries stale env, so source it to reach the new server.
    'if [ -n "$ORCA_AGENT_HOOK_ENDPOINT" ] && [ -r "$ORCA_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$ORCA_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$ORCA_AGENT_HOOK_PORT" ] || [ -z "$ORCA_AGENT_HOOK_TOKEN" ] || [ -z "$ORCA_PANE_KEY" ]; then',
    '  spool_hook_event',
    '  exit 0',
    'fi',
    ...buildPosixAgentHookPostCommand('dsh').map((line, index, lines) =>
      index === lines.length - 1 ? `${line} >/dev/null 2>&1 || spool_hook_event` : line
    ),
    'exit 0',
    ''
  ].join('\n')
}

/** '' when the file is absent (DSH creates it lazily), null when it exists but is unreadable. */
function readPatchText(configPath: string): string | null {
  try {
    return readFileSync(configPath, 'utf-8')
  } catch (error) {
    return isDefinitiveAbsence(error) ? '' : null
  }
}

function readManagedHooksFile(managedHooksPath: string): string | null {
  if (!existsSync(managedHooksPath)) {
    return ''
  }
  try {
    return readFileSync(managedHooksPath, 'utf-8')
  } catch {
    return null
  }
}

function parseManagedHooksFile(text: string): unknown {
  if (text.trim().length === 0) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed
  } catch {
    return null
  }
}

function errorStatus(configPath: string, detail: string): AgentHookInstallStatus {
  return { agent: 'dsh', state: 'error', configPath, managedHooksPresent: false, detail }
}

function buildStatus(
  patchText: string,
  managedHooksPath: string,
  managedText: string | null,
  configPath: string
): AgentHookInstallStatus {
  const base = { agent: 'dsh' as const, configPath }
  if (managedText === null) {
    return {
      ...base,
      state: 'error',
      managedHooksPresent: false,
      detail: 'Could not read Orca managed hooks file'
    }
  }
  const pointer = readManagedDshHooksConfigPath(patchText)
  if (pointer !== managedHooksPath) {
    return {
      ...base,
      state: 'not_installed',
      managedHooksPresent: false,
      detail:
        pointer === undefined
          ? null
          : `The Orca patch block points at ${pointer}, not the Orca managed hooks file`
    }
  }
  const present = readManagedDshHookEvents(
    parseManagedHooksFile(managedText),
    getDshManagedCommandMatcher()
  )
  const missing = DSH_HOOK_EVENTS.filter((event) => !present.has(event))
  let state: AgentHookInstallState
  let detail: string | null
  if (missing.length === 0) {
    state = 'installed'
    detail = null
  } else if (present.size === 0) {
    state = 'not_installed'
    detail = null
  } else {
    state = 'partial'
    detail = `Managed hook missing for events: ${missing.join(', ')}`
  }
  return { ...base, state, managedHooksPresent: present.size > 0, detail }
}

export class DshHookService {
  async refreshManagedScripts(): Promise<void> {
    await refreshManagedScriptIfPresent(getDshManagedScriptPath(), getManagedScript())
  }

  getStatus(): AgentHookInstallStatus {
    const configPath = getDshConfigPath()
    const patchText = readPatchText(configPath)
    if (patchText === null) {
      return errorStatus(configPath, 'Could not read the DSH home patch file')
    }
    const managedHooksPath = getDshManagedHooksPath()
    return buildStatus(
      patchText,
      managedHooksPath,
      readManagedHooksFile(managedHooksPath),
      configPath
    )
  }

  install(): AgentHookInstallStatus {
    const configPath = getDshConfigPath()
    const patchText = readPatchText(configPath)
    if (patchText === null) {
      return errorStatus(configPath, 'Could not read the DSH home patch file')
    }
    const scriptPath = getDshManagedScriptPath()
    const managedHooksPath = getDshManagedHooksPath()
    // Write the script and the managed hooks file first so the patch layer never points at
    // files that do not exist yet — a bridge that cannot read its config runs no hooks.
    writeManagedScript(scriptPath, getManagedScript())
    writeHooksJson(
      managedHooksPath,
      { hooks: {} },
      { serialized: buildDshManagedHooksFile(getDshManagedCommand(scriptPath)) }
    )
    const nextText = applyManagedDshPatch(patchText, managedHooksPath)
    if (nextText !== patchText) {
      mkdirSync(dirname(configPath), { recursive: true })
      writeHooksJson(configPath, {}, { serialized: nextText })
    }
    return this.getStatus()
  }

  /** Install on an SSH execution host, where DSH's shell contract is always POSIX. */
  async installRemote(sftp: SFTPWrapper, remoteHome: string): Promise<AgentHookInstallStatus> {
    const remoteConfigPath = getDshRemoteConfigPath(remoteHome)
    const remoteScriptPath = `${remoteHome.replace(/\/$/, '')}/.orca/agent-hooks/dsh-hook.sh`
    const remoteManagedHooksPath = getDshRemoteManagedHooksPath(remoteHome)
    try {
      const body = (await readTextFileRemote(sftp, remoteConfigPath)) ?? ''
      await writeManagedScriptRemote(sftp, remoteScriptPath, getManagedScript('posix'))
      await writeTextFileRemoteAtomic(
        sftp,
        remoteManagedHooksPath,
        buildDshManagedHooksFile(getDshRemoteManagedCommand(remoteScriptPath))
      )
      await writeTextFileRemoteAtomic(
        sftp,
        remoteConfigPath,
        applyManagedDshPatch(body, remoteManagedHooksPath)
      )
      return {
        agent: 'dsh',
        state: 'installed',
        configPath: remoteConfigPath,
        managedHooksPresent: true,
        detail: null
      }
    } catch (err) {
      return errorStatus(remoteConfigPath, err instanceof Error ? err.message : String(err))
    }
  }

  remove(): AgentHookInstallStatus {
    const configPath = getDshConfigPath()
    const patchText = readPatchText(configPath)
    if (patchText === null) {
      return errorStatus(configPath, 'Could not read the DSH home patch file')
    }
    const { text: nextText, changed } = removeManagedDshPatch(patchText)
    if (changed) {
      mkdirSync(dirname(configPath), { recursive: true })
      writeHooksJson(configPath, {}, { serialized: nextText })
    }
    try {
      const managedHooksPath = getDshManagedHooksPath()
      if (existsSync(managedHooksPath)) {
        unlinkSync(managedHooksPath)
      }
    } catch {
      // best effort
    }
    return this.getStatus()
  }
}

export const dshHookService = new DshHookService()
