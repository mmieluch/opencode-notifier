import { readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"
import {
  getIconPath,
  getMessage,
  getSoundPath,
  getSoundVolume,
  getStatePath,
  interpolateMessage,
  isEventBellEnabled,
  isEventCommandEnabled,
  isEventNotificationEnabled,
  isEventSoundEnabled,
} from "./config.ts"
import type { EventType, NotifierConfig } from "./config.ts"
import { ringBell } from "./bell.ts"
import { runCommand } from "./command.ts"
import { focusTerminal, isKDEJumpBackSupported, isTerminalFocused } from "./focus.ts"
import { sendNotification } from "./notify.ts"
import { playSound } from "./sound.ts"

let globalTurnCount: number | null = null

function loadTurnCount(): number {
  try {
    const content = readFileSync(getStatePath(), "utf-8")
    const state = JSON.parse(content) as { turn?: unknown }
    if (typeof state.turn === "number" && Number.isFinite(state.turn) && state.turn >= 0) {
      return state.turn
    }
  } catch {}
  return 0
}

function saveTurnCount(count: number): void {
  try {
    writeFileSync(getStatePath(), JSON.stringify({ turn: count }))
  } catch {}
}

function incrementTurnCount(): number {
  if (globalTurnCount === null) {
    globalTurnCount = loadTurnCount()
  }
  globalTurnCount++
  saveTurnCount(globalTurnCount)
  return globalTurnCount
}

function getNotificationTitle(config: NotifierConfig, projectName: string | null): string {
  if (config.showProjectName && projectName) {
    return `OpenCode (${projectName})`
  }
  return "OpenCode"
}

function formatTimestamp(): string {
  const now = new Date()
  const h = String(now.getHours()).padStart(2, "0")
  const m = String(now.getMinutes()).padStart(2, "0")
  const s = String(now.getSeconds()).padStart(2, "0")
  return `${h}:${m}:${s}`
}

export function getProjectName(config: NotifierConfig, directory: string | null | undefined): string | null {
  if (!directory) return null
  return config.showFullPath ? directory : basename(directory)
}

export function extractAgentNameFromSessionTitle(sessionTitle: unknown): string {
  if (typeof sessionTitle !== "string" || sessionTitle.length === 0) {
    return ""
  }

  const match = sessionTitle.match(/\s*\(@([^\s)]+)\s+subagent\)\s*$/)
  return match ? match[1] : ""
}

export async function handleEvent(
  config: NotifierConfig,
  eventType: EventType,
  projectName: string | null,
  elapsedSeconds?: number | null,
  sessionTitle?: string | null,
  agentName?: string | null,
): Promise<void> {
  if (config.suppressWhenFocused && isTerminalFocused()) {
    return
  }

  if (
    (eventType === "complete" || eventType === "subagent_complete") &&
    typeof elapsedSeconds === "number" &&
    Number.isFinite(elapsedSeconds) &&
    elapsedSeconds < config.minDuration
  ) {
    return
  }

  const promises: Promise<void>[] = []
  const timestamp = formatTimestamp()
  const turn = incrementTurnCount()
  const message = interpolateMessage(getMessage(config, eventType), {
    sessionTitle: config.showSessionTitle ? sessionTitle : null,
    agentName,
    projectName,
    timestamp,
    turn,
  })

  const notificationEnabled = isEventNotificationEnabled(config, eventType)
  if (notificationEnabled) {
    const title = getNotificationTitle(config, projectName)
    const iconPath = getIconPath(config)
    const onNotificationClick = isKDEJumpBackSupported() ? () => void focusTerminal() : undefined
    promises.push(
      sendNotification(
        title,
        message,
        config.timeout,
        iconPath,
        config.notificationSystem,
        config.linux.grouping,
        onNotificationClick,
        config.windows.appID,
      ),
    )
  }

  if (isEventSoundEnabled(config, eventType)) {
    const customSoundPath = getSoundPath(config, eventType)
    const ghosttyOnMac =
      process.platform === "darwin" &&
      config.notificationSystem === "ghostty" &&
      notificationEnabled &&
      config.suppressGhosttySound
    if (!ghosttyOnMac) {
      promises.push(playSound(eventType, customSoundPath, getSoundVolume(config, eventType)))
    }
  }

  if (isEventBellEnabled(config, eventType)) {
    promises.push(ringBell())
  }

  const commandMinDuration = config.command.minDuration
  const shouldSkipCommand =
    !isEventCommandEnabled(config, eventType) ||
    (typeof commandMinDuration === "number" &&
      Number.isFinite(commandMinDuration) &&
      commandMinDuration > 0 &&
      typeof elapsedSeconds === "number" &&
      Number.isFinite(elapsedSeconds) &&
      elapsedSeconds < commandMinDuration)

  if (!shouldSkipCommand) {
    runCommand(config, eventType, message, sessionTitle, agentName, projectName, timestamp, turn)
  }

  await Promise.allSettled(promises)
}
