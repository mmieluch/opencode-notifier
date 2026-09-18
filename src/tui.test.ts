import { describe, expect, test, vi } from "vitest"
import type { Context } from "@opencode/plugin/tui/context"
import { registerNotifier } from "./tui.ts"

type Handler = (event: any) => void

function createContext() {
  const handlers = new Map<string, Handler>()
  let route: ReturnType<Context["ui"]["router"]["current"]> = { type: "session", sessionID: "ses_root" }
  let tabs: ReturnType<Context["ui"]["tabs"]["list"]> = []
  let tabsEnabled = false
  const sessions = new Map<string, any>([
    ["ses_root", { id: "ses_root", title: "Root session", location: { directory: "/workspace/project" } }],
    [
      "ses_child",
      {
        id: "ses_child",
        parentID: "ses_root",
        title: "Child task (@explore subagent)",
        location: { directory: "/workspace/project" },
      },
    ],
    ["ses_other", { id: "ses_other", title: "Other session", location: { directory: "/workspace/other" } }],
    [
      "ses_other_child",
      {
        id: "ses_other_child",
        parentID: "ses_other",
        title: "Other child",
        location: { directory: "/workspace/other" },
      },
    ],
  ])
  const unsubscribe = vi.fn()
  const context = {
    location: { directory: "/workspace/project" },
    data: {
      on: vi.fn((type: string, handler: Handler) => {
        handlers.set(type, handler)
        return unsubscribe
      }),
      session: {
        get: vi.fn((sessionID: string) => sessions.get(sessionID)),
        root: vi.fn((sessionID: string) => {
          let current = sessions.get(sessionID)
          while (current?.parentID) current = sessions.get(current.parentID)
          return current?.id ?? sessionID
        }),
        sync: vi.fn(async () => undefined),
      },
    },
    ui: {
      router: {
        current: vi.fn(() => route),
      },
      tabs: {
        enabled: vi.fn(() => tabsEnabled),
        list: vi.fn(() => tabs),
      },
    },
  } as unknown as Pick<Context, "data" | "location" | "ui">

  const emit = (type: string, data: object, created = 1_000) => {
    const handler = handlers.get(type)
    if (!handler) throw new Error(`No handler for ${type}`)
    handler({ type, data, created })
  }

  return {
    context,
    emit,
    sessions,
    unsubscribe,
    setRoute(next: typeof route) {
      route = next
    },
    setTabs(next: typeof tabs) {
      tabs = next
      tabsEnabled = true
    },
  }
}

describe("v2 TUI event mapping", () => {
  test("maps permission and form requests to alerts", async () => {
    const { context, emit } = createContext()
    const dispatch = vi.fn(async () => undefined)
    registerNotifier(context, dispatch)

    emit("permission.asked", { sessionID: "ses_root" })
    emit("form.created", { form: { sessionID: "ses_root" } })

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2))
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ eventType: "permission", sessionID: "ses_root" })
    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({ eventType: "question", sessionID: "ses_root" })
  })

  test("classifies root and child completions and measures elapsed time", async () => {
    const { context, emit } = createContext()
    const dispatch = vi.fn(async () => undefined)
    registerNotifier(context, dispatch)

    emit("session.execution.started", { sessionID: "ses_root" }, 1_000)
    emit("session.execution.succeeded", { sessionID: "ses_root" }, 4_500)
    emit("session.execution.started", { sessionID: "ses_child" }, 5_000)
    emit("session.execution.succeeded", { sessionID: "ses_child" }, 7_000)

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2))
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ eventType: "complete", elapsedSeconds: 3.5 })
    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
      eventType: "subagent_complete",
      elapsedSeconds: 2,
      sessionTitle: "Child task (@explore subagent)",
    })
  })

  test("syncs an uncached child before classifying its completion", async () => {
    const { context, emit, sessions } = createContext()
    const child = sessions.get("ses_child")
    sessions.delete("ses_child")
    vi.mocked(context.data.session.sync).mockImplementationOnce(async () => {
      sessions.set("ses_child", child)
    })
    const dispatch = vi.fn(async () => undefined)
    registerNotifier(context, dispatch)

    emit("session.execution.succeeded", { sessionID: "ses_child" })

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
    expect(context.data.session.sync).toHaveBeenCalledWith("ses_child")
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ eventType: "subagent_complete" })
  })

  test("ignores events for sessions not represented by this TUI", async () => {
    const { context, emit } = createContext()
    const dispatch = vi.fn(async () => undefined)
    registerNotifier(context, dispatch)

    emit("session.execution.succeeded", { sessionID: "ses_other" })
    emit("session.execution.succeeded", { sessionID: "ses_other_child" })

    await vi.waitFor(() => expect(context.data.session.get).toHaveBeenCalledWith("ses_other_child"))
    expect(dispatch).not.toHaveBeenCalled()
  })

  test("handles child events for a root session open in this TUI's tabs", async () => {
    const { context, emit, setRoute, setTabs } = createContext()
    setRoute({ type: "home" })
    setTabs([{ sessionID: "ses_root", active: false, busy: true, attention: false }])
    const dispatch = vi.fn(async () => undefined)
    registerNotifier(context, dispatch)

    emit("session.execution.succeeded", { sessionID: "ses_child" })

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ eventType: "subagent_complete", sessionID: "ses_child" })
  })

  test("maps failures and interruptions without producing completion", async () => {
    const { context, emit } = createContext()
    const dispatch = vi.fn(async () => undefined)
    registerNotifier(context, dispatch)

    emit("session.execution.started", { sessionID: "ses_root" }, 1_000)
    emit("session.execution.failed", { sessionID: "ses_root" }, 1_500)
    emit("session.execution.started", { sessionID: "ses_root" }, 2_000)
    emit("session.execution.interrupted", { sessionID: "ses_root", reason: "user" }, 2_750)
    emit("session.execution.started", { sessionID: "ses_root" }, 3_000)
    emit("session.execution.interrupted", { sessionID: "ses_root", reason: "inactivity" }, 4_250)
    emit("session.execution.interrupted", { sessionID: "ses_root", reason: "shutdown" }, 5_000)
    emit("session.execution.interrupted", { sessionID: "ses_root", reason: "superseded" }, 6_000)

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(3))
    expect(dispatch.mock.calls.map(([request]) => request.eventType)).toEqual([
      "error",
      "user_cancelled",
      "interrupted",
    ])
    expect(dispatch.mock.calls.map(([request]) => request.elapsedSeconds)).toEqual([0.5, 0.75, 1.25])
  })

  test("unsubscribes every listener during cleanup", () => {
    const { context, unsubscribe } = createContext()
    const cleanup = registerNotifier(context, async () => undefined)

    cleanup()

    expect(unsubscribe).toHaveBeenCalledTimes(6)
  })
})
