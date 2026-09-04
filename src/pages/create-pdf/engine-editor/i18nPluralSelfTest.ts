/**
 * Do the counted messages read correctly at every count, in both languages?
 *
 * This exists because the same fault kept arriving one screenshot at a time —
 * "1 products", "1 SKUs read", "1 lines were not SKUs". Each was fixed alone,
 * and the next one was found by a person looking at the screen, which is not
 * a process.
 *
 * Two different faults are checked, and the second is the dangerous one:
 *
 *   English — a plural noun against a count of one. Ugly, obvious, harmless.
 *
 *   Hebrew  — SILENT FALLBACK TO ENGLISH. Hebrew's CLDR rules have a distinct
 *             "two" category, so a key with only _one and _other has no match
 *             at exactly two, and i18next quietly serves the English string.
 *             It is correct at 1, correct at 3, correct at 48, and English at
 *             2. Nobody finds that by looking.
 */
import i18n from "@/i18n"
import en from "@/i18n/locales/en"
import he from "@/i18n/locales/he"

export interface PluralTestResult {
  errors: string[]
  /** Keys examined — a count of zero would mean the test found nothing. */
  checked: number
  /** Sample renderings, for reading when something fails. */
  samples: Record<string, string[]>
  controlCaught: boolean
}

const HEBREW = /[֐-׿]/
/** The counts that matter: one, Hebrew's dual, a plain plural, and a big one. */
const COUNTS = [1, 2, 3, 48]

export async function runI18nPluralSelfTest(): Promise<PluralTestResult> {
  const out: PluralTestResult = { errors: [], checked: 0, samples: {}, controlCaught: false }
  const previous = i18n.language

  try {
    // Every pdfTemplates key that declares plural forms, by base name.
    const bases = new Set<string>()
    for (const key of Object.keys(en.pdfTemplates ?? {})) {
      const m = key.match(/^(.*)_(one|two|many|other)$/)
      if (m) bases.add(m[1])
    }
    out.checked = bases.size
    if (bases.size === 0) {
      out.errors.push("no plural keys found at all — this test is not looking where it thinks")
      return out
    }

    for (const base of bases) {
      const full = `pdfTemplates.${base}`

      // Hebrew must declare the dual, or two is served in English.
      const heKeys = Object.keys(he.pdfTemplates ?? {})
      if (heKeys.includes(`${base}_other`) && !heKeys.includes(`${base}_two`)) {
        out.errors.push(
          `${base}: Hebrew has no _two form, so a count of exactly 2 falls back to English`)
      }

      await i18n.changeLanguage("en")
      const english = COUNTS.map((n) => i18n.t(full, { count: n, name: "X", list: "Y", pages: 2 }))
      await i18n.changeLanguage("he")
      const hebrew = COUNTS.map((n) => i18n.t(full, { count: n, name: "X", list: "Y", pages: 2 }))
      out.samples[base] = [...english, ...hebrew]

      for (let i = 0; i < COUNTS.length; i++) {
        // An unresolved placeholder means the interpolation never ran.
        if (english[i].includes("{{") || hebrew[i].includes("{{")) {
          out.errors.push(`${base} at ${COUNTS[i]}: a placeholder was left unfilled`)
        }
        // THE check. Hebrew text with no Hebrew letters is English that leaked
        // through a missing plural form.
        if (!HEBREW.test(hebrew[i])) {
          out.errors.push(
            `${base} at ${COUNTS[i]}: Hebrew rendered as "${hebrew[i]}" — English fallback`)
        }
      }
      // The singular has to actually be reached, or declaring it changed nothing.
      if (english[0] === english[2] && english[0].includes(String(COUNTS[0]))) {
        // Same wording at 1 and 3 is only suspicious, not wrong — some strings
        // legitimately read the same. Reported, not failed.
        out.samples[`${base} (identical at 1 and 3)`] = [english[0]]
      }
    }

    // ── The control ───────────────────────────────────────────────────
    // A key deliberately missing its Hebrew _two. If the check above does not
    // catch this, it cannot catch the real thing either.
    i18n.addResource("he", "translation", "pdfTemplates.__control_one", "פריט אחד")
    i18n.addResource("he", "translation", "pdfTemplates.__control_other", "{{count}} פריטים")
    i18n.addResource("en", "translation", "pdfTemplates.__control_one", "{{count}} item")
    i18n.addResource("en", "translation", "pdfTemplates.__control_other", "{{count}} items")
    await i18n.changeLanguage("he")
    const atTwo = i18n.t("pdfTemplates.__control", { count: 2 })
    out.controlCaught = !HEBREW.test(atTwo)
    if (!out.controlCaught) {
      out.errors.push(
        `the control rendered "${atTwo}" in Hebrew despite having no _two form —`
        + " this test cannot detect the fallback it exists for")
    }
  } catch (err) {
    out.errors.push(String(err))
  } finally {
    await i18n.changeLanguage(previous)
  }

  return out
}
