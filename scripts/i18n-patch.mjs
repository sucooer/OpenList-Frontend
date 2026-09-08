// Apply fork-custom locale patches on top of the official language packs.
//
// Why this exists
// ---------------
// The official workflow downloads translations from Crowdin at build time
// (`pnpm i18n:release`). Crowdin only knows keys that exist upstream, so
// anything this fork adds on its own (the whole `planned_task.json`
// namespace, plus a few keys that upstream ships but hasn't translated yet)
// will never appear in a downloaded language pack. Worse, `i18n.mjs` falls
// back to copying the English file for missing namespaces, so the planned
// task UI would silently render in English after any official i18n refresh.
//
// This script re-applies our custom translations after the official download.
// Rules per file:
//   - planned_task.json  -> whole-file overwrite (English fallback copy must
//                           be replaced with the real Chinese/Trad. content)
//   - manage/shares.json -> merge, only filling keys that are missing, so we
//                           never clobber a newer official translation
//
// Usage: node ./scripts/i18n-patch.mjs
// It is appended to `i18n:build` / `i18n:release` in package.json so it runs
// automatically right after every official language-pack refresh.
import fs from "fs"
import path from "path"

const patchRoot = path.join(import.meta.dirname, "..", "i18n-patches")
const langRoot = path.join(import.meta.dirname, "..", "src", "lang")

/** overwrite: replace the whole target file with the patch */
const OVERWRITE_FILES = new Set(["planned_task.json"])

function deepMergeMissing(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      if (typeof target[k] !== "object" || target[k] === null || Array.isArray(target[k])) {
        target[k] = {}
      }
      deepMergeMissing(target[k], v)
    } else if (!(k in target)) {
      target[k] = v
    }
  }
  return target
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"))
  } catch {
    return null
  }
}

let applied = 0
const langs = fs
  .readdirSync(patchRoot)
  .filter((d) => fs.statSync(path.join(patchRoot, d)).isDirectory())

for (const lang of langs) {
  const patchDir = path.join(patchRoot, lang)
  const targetDir = path.join(langRoot, lang)
  fs.mkdirSync(targetDir, { recursive: true })

  for (const file of fs.readdirSync(patchDir)) {
    if (!file.endsWith(".json")) continue
    const patch = readJson(path.join(patchDir, file))
    if (patch === null) continue
    const target = path.join(targetDir, file)

    if (OVERWRITE_FILES.has(file)) {
      // Whole namespace owned by this fork -> always overwrite.
      fs.writeFileSync(target, JSON.stringify(patch, null, 2) + "\n")
    } else {
      // Shared file -> fill missing keys only.
      const base = readJson(target) ?? {}
      const merged = deepMergeMissing(base, patch)
      fs.writeFileSync(target, JSON.stringify(merged, null, 2) + "\n")
    }
    applied++
    console.log(`i18n-patch: ${lang}/${file}`)
  }
}

console.log(`i18n-patch: done, ${applied} file(s) applied`)
