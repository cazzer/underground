/** RFC 4180 CSV → records. Handles BOM, CRLF, quoted fields (commas, "" escapes, newlines). */

interface RawRow {
  fields: string[]
  line: number
}

function scanRows(text: string, file: string): RawRow[] {
  const rows: RawRow[] = []
  const n = text.length
  let i = 0
  let line = 1
  while (i < n) {
    const startLine = line
    const fields: string[] = []
    for (;;) {
      if (text[i] === '"') {
        let out = ''
        let j = i + 1
        for (;;) {
          const q = text.indexOf('"', j)
          if (q === -1) throw new Error(`${file}:${startLine}: unterminated quoted field`)
          out += text.slice(j, q)
          if (text[q + 1] === '"') {
            out += '"'
            j = q + 2
          } else {
            i = q + 1
            break
          }
        }
        for (const ch of out) if (ch === '\n') line++
        fields.push(out)
        const next = text[i]
        if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
          throw new Error(`${file}:${startLine}: text after closing quote`)
        }
      } else {
        let e = i
        while (e < n) {
          const c = text.charCodeAt(e)
          if (c === 44 || c === 10 || c === 13) break
          e++
        }
        fields.push(text.slice(i, e))
        i = e
      }
      const c = text[i]
      if (c === ',') {
        i++
        continue
      }
      if (c === '\r') i++
      if (text[i] === '\n') i++
      break
    }
    line++
    const blank = fields.length === 1 && fields[0] === ''
    if (!blank) rows.push({ fields, line: startLine })
  }
  return rows
}

/** `required` columns must be in the header. `file` only labels errors. */
export function parseCsv(text: string, file: string, required: readonly string[]): Record<string, string>[] {
  const rows = scanRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, file)
  const header = rows[0]?.fields ?? []
  for (const col of required) {
    if (!header.includes(col)) throw new Error(`${file}: missing required column "${col}"`)
  }
  const records: Record<string, string>[] = []
  for (let r = 1; r < rows.length; r++) {
    const { fields, line } = rows[r]!
    if (fields.length !== header.length) {
      throw new Error(`${file}:${line}: expected ${header.length} fields, got ${fields.length}`)
    }
    const record: Record<string, string> = {}
    for (let c = 0; c < header.length; c++) record[header[c]!] = fields[c]!
    records.push(record)
  }
  return records
}
