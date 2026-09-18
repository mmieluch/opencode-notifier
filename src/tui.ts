import * as Plugin from "@opencode/plugin/tui/plugin"
import type { Context } from "@opencode/plugin/tui/context"
import { loadConfig } from "./config.ts"
import type { EventType } from "./config.ts"
import { captureStartupWindowId } from "./focus.ts"
import { extractAgentNameFromSessionTitle, getProjectName, handleEvent } from "./notifier.ts"

export interface NotificationRequest {
  eventType: EventType
  directory?: string | null
  elapsedSeconds?: number | null
  sessionID: string
  sessionTitle?: string | null
}

export type NotificationDispatch = (request: NotificationRequest) => Promise<void>

type NotifierContext = Pick<Context, "data" | "location" | "ui">

async function defaultDispatch(request: NotificationRequest): Promise<void> {
  const config = loadConfig()
  const projectName = getProjectName(config, request.directory)
  const agentName = extractAgentNameFromSessionTitle(request.sessionTitle)
  await handleEvent(
    config,
    request.eventType,
    projectName,
    request.elapsedSeconds,
    request.sessionTitle,
    agentName,
  )
}

export function registerNotifier(context: NotifierContext, dispatch: NotificationDispatch = defaultDispatch): () => void {
  const executionStartedAt = new Map<string, number>()
  const unsubscribers: Array<() => void> = []
  let active = true

  const getSession = async (sessionID: string) => {
    let session = context.data.session.get(sessionID)
    if (!session) {
      await context.data.session.sync(sessionID)
      session = context.data.session.get(sessionID)
    }
    return session
  }

  const hasSession = (sessionID: string): boolean => {
    const rootID = context.data.session.root(sessionID)
    const route = context.ui.router.current()
    if (route.type === "session" && context.data.session.root(route.sessionID) === rootID) {
      return true
    }
    return context.ui.tabs.enabled() && context.ui.tabs.list().some((tab) => tab.sessionID === rootID)
  }

  const notify = async (
    sessionID: string,
    eventType: EventType | ((isChild: boolean) => EventType),
    elapsedSeconds?: number | null,
  ): Promise<void> => {
    const session = await getSession(sessionID)
    if (!active) return
    if (!hasSession(sessionID)) return
    await dispatch({
      eventType: typeof eventType === "function" ? eventType(Boolean(session?.parentID)) : eventType,
      sessionID,
      sessionTitle: session?.title ?? null,
      directory: session?.location.directory ?? context.location?.directory ?? null,
      elapsedSeconds,
    })
  }

  const safely = (task: Promise<void>) => {
    void task.catch(() => undefined)
  }

  const elapsedFor = (sessionID: string, endedAt: number): number | null => {
    const startedAt = executionStartedAt.get(sessionID)
    executionStartedAt.delete(sessionID)
    return startedAt === undefined ? null : Math.max(0, (endedAt - startedAt) / 1000)
  }

  unsubscribers.push(
    context.data.on("permission.asked", (event) => {
      safely(notify(event.data.sessionID, "permission"))
    }),
    context.data.on("form.created", (event) => {
      safely(notify(event.data.form.sessionID, "question"))
    }),
    context.data.on("session.execution.started", (event) => {
      executionStartedAt.set(event.data.sessionID, event.created)
    }),
    context.data.on("session.execution.succeeded", (event) => {
      safely(
        notify(
          event.data.sessionID,
          (isChild) => (isChild ? "subagent_complete" : "complete"),
          elapsedFor(event.data.sessionID, event.created),
        ),
      )
    }),
    context.data.on("session.execution.failed", (event) => {
      safely(notify(event.data.sessionID, "error", elapsedFor(event.data.sessionID, event.created)))
    }),
    context.data.on("session.execution.interrupted", (event) => {
      const elapsedSeconds = elapsedFor(event.data.sessionID, event.created)
      if (event.data.reason === "shutdown" || event.data.reason === "superseded") return
      safely(
        notify(
          event.data.sessionID,
          event.data.reason === "user" ? "user_cancelled" : "interrupted",
          elapsedSeconds,
        ),
      )
    }),
  )

  return () => {
    active = false
    for (const unsubscribe of unsubscribers) unsubscribe()
    executionStartedAt.clear()
  }
}

export default Plugin.define({
  id: "mmieluch.notifier.tui",
  setup(context) {
    captureStartupWindowId()
    return registerNotifier(context)
  },
})
