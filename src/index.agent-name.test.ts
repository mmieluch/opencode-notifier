import { describe, test, expect } from "vitest"
import { extractAgentNameFromSessionTitle } from "./notifier.ts"

describe("extractAgentNameFromSessionTitle", () => {
  test("extracts agent name from subagent suffix", () => {
    const title = "Implement feature A (@builder subagent)"
    expect(extractAgentNameFromSessionTitle(title)).toBe("builder")
  })

  test("extracts hyphenated agent name", () => {
    const title = "Analyze codebase (@codebase-researcher subagent)"
    expect(extractAgentNameFromSessionTitle(title)).toBe("codebase-researcher")
  })

  test("returns empty string when no subagent suffix", () => {
    expect(extractAgentNameFromSessionTitle("Fix login bug")).toBe("")
  })

  test("returns empty string for nullish input", () => {
    expect(extractAgentNameFromSessionTitle(null)).toBe("")
    expect(extractAgentNameFromSessionTitle(undefined)).toBe("")
  })

  test("returns empty string for non-string input", () => {
    expect(extractAgentNameFromSessionTitle(123)).toBe("")
    expect(extractAgentNameFromSessionTitle({ title: "x" })).toBe("")
    expect(extractAgentNameFromSessionTitle(["(@builder subagent)"])).toBe("")
    expect(extractAgentNameFromSessionTitle(true)).toBe("")
  })
})
