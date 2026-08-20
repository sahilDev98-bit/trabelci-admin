// Does the document object stay the SAME object between renders?
//
// It reads like a detail and was the biggest cause of the editor feeling
// heavy. The editor holds one object from usePdfEngineDocument and hands it
// to effects; two of those effects ask the engine to re-render the selected
// object and the hole behind it, roughly 35ms of worker time each. React
// compares dependencies by identity, so while the hook returned a fresh
// literal every render, those effects re-ran on every render — and a drag
// renders on every pointermove. The worker was handed more work per second
// than it could finish, so the drag stuttered and the drop waited behind the
// queue.
//
// The property is therefore: renders that change nothing about the document
// must not change its identity. The control renders a plain literal beside
// it, to show this test can tell a stable object from an unstable one.
import { createElement, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import { usePdfEngineDocument } from "./usePdfEngineDocument"

export interface DocStabilityTestResult {
  errors: string[]
  renders: number
  distinctDocs: number
  distinctControls: number
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runDocStabilitySelfTest(): Promise<DocStabilityTestResult> {
  const out: DocStabilityTestResult = {
    errors: [], renders: 0, distinctDocs: 0, distinctControls: 0,
  }

  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)

  const docs = new Set<unknown>()
  const controls = new Set<unknown>()
  let renders = 0

  // No template id, so nothing is fetched and no worker starts: this is
  // purely about what the hook returns between renders.
  const Probe = () => {
    const doc = usePdfEngineDocument(null)
    // Stands in for the drag state that really drives these renders.
    const [tick, setTick] = useState(0)
    const control = { ...doc }
    renders++
    docs.add(doc)
    controls.add(control)
    useEffect(() => {
      if (tick < 5) setTick(tick + 1)
    }, [tick])
    return null
  }

  try {
    root.render(createElement(Probe))
    await wait(400)

    out.renders = renders
    out.distinctDocs = docs.size
    out.distinctControls = controls.size

    if (renders < 5) {
      out.errors.push(`only ${renders} renders happened — the test never exercised anything`)
    }
    if (controls.size < renders) {
      out.errors.push(
        "the control object did NOT change every render, so this test cannot"
        + " tell a stable object from an unstable one")
    }
    if (docs.size !== 1) {
      out.errors.push(
        `the document object changed identity ${docs.size} times across ${renders} renders`
        + " — effects keyed on it will re-run on every pointermove of a drag")
    }
    return out
  } finally {
    root.unmount()
    host.remove()
  }
}
