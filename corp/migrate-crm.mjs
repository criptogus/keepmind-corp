#!/usr/bin/env node
import path from 'node:path'
import { migrateCorpCrm } from './crm-storage.mjs'
const args = process.argv.slice(2)
const apply = args.includes('--apply')
const index = args.indexOf('--vault')
if (index < 0 || !args[index + 1] || !path.isAbsolute(args[index + 1]) || args.filter(x => x === '--vault').length !== 1 || args.filter(x => x === '--apply' || x === '--check').length > 1 || args.some((arg, i) => i !== index + 1 && !['--vault', '--apply', '--check'].includes(arg)) || (apply && args.includes('--check'))) {
  console.error('Usage: node corp/migrate-crm.mjs --vault /absolute/vault [--check | --apply]')
  process.exitCode = 2
} else {
  try {
    const report = migrateCorpCrm(path.resolve(args[index + 1]), { apply })
    console.log(JSON.stringify(report))
    process.exitCode = !report.examined ? 2 : report.failed || report.pending ? 1 : 0
  } catch {
    console.error(JSON.stringify({ error: 'CRM_MIGRATION_UNAVAILABLE' }))
    process.exitCode = 2
  }
}
