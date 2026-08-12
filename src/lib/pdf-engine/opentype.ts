/**
 * Single, environment-proof entry point to opentype.js.
 *
 * The package ships CommonJS, and the two environments this engine runs in
 * disagree about the resulting module shape: Node's interop hands back a
 * `default` wrapper, while Vite's dependency pre-bundling exposes the
 * members directly and provides no `default` at all. Importing it the
 * "obvious" way therefore works in the Node prototype and throws
 * "does not provide an export named 'default'" inside a browser worker —
 * which surfaces only as a worker that dies silently on startup.
 *
 * Normalising once, here, keeps that difference out of every call site.
 */
import * as opentypeNamespace from "opentype.js"

type OpentypeModule = typeof opentypeNamespace

const candidate = opentypeNamespace as OpentypeModule & { default?: OpentypeModule }

export const opentype: OpentypeModule =
  typeof candidate.parse === "function" ? candidate : (candidate.default ?? candidate)

export type OpentypeFont = opentypeNamespace.Font
