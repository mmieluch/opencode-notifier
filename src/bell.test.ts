import { describe, test, expect, beforeEach, vi } from "vitest"
import { ringBell, resetBellState } from "./bell.ts"

describe("ringBell", () => {
  beforeEach(() => {
    resetBellState()
  })

  test("writes BEL when stdout is TTY", async () => {
    const originalIsTTY = process.stdout.isTTY
    const writeSpy = vi.fn((_: string, cb?: () => void) => {
      cb?.()
      return true
    })
    const originalWrite = process.stdout.write

    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })
    process.stdout.write = writeSpy as unknown as typeof process.stdout.write

    await ringBell(1000)

    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(writeSpy.mock.calls[0]?.[0]).toBe("\x07")

    process.stdout.write = originalWrite
    Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true })
  })

  test("skips when stdout is not TTY", async () => {
    const originalIsTTY = process.stdout.isTTY
    const writeSpy = vi.fn((_: string, cb?: () => void) => {
      cb?.()
      return true
    })
    const originalWrite = process.stdout.write

    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true })
    process.stdout.write = writeSpy as unknown as typeof process.stdout.write

    await ringBell(1000)

    expect(writeSpy).toHaveBeenCalledTimes(0)

    process.stdout.write = originalWrite
    Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true })
  })
})
