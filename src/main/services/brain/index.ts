
import { BrainMaintenance } from './maintenance'

export class Brain extends BrainMaintenance {
  override chat(agentId: string, message: string, onDelta?: (text: string) => void, onStep?: (step: string) => void, signal?: AbortSignal) { return this.memory.withScope(() => super.chat(agentId, message, onDelta, onStep, signal)) }
  override briefing(force = false) { return this.memory.withScope(() => super.briefing(force)) }
  override hybridSearch(query: string) { return this.memory.withScope(() => super.hybridSearch(query)) }
  override triageVaultTasks() { return this.memory.withScope(() => super.triageVaultTasks()) }
  override sleep() { return this.memory.withScope(() => super.sleep()) }
  override librarian() { return this.memory.withScope(() => super.librarian()) }
  override generateInsights() { return this.memory.withScope(() => super.generateInsights()) }
  override dailySummary() { return this.memory.withScope(() => super.dailySummary()) }

  override evolve() { return this.memory.withScope(() => super.evolve()) }
  override enrich() { return this.memory.withScope(() => super.enrich()) }
  override review() { return this.memory.withScope(() => super.review()) }
  override securityAudit() { return this.memory.withScope(() => super.securityAudit()) }
  override evolveSkills() { return this.memory.withScope(() => super.evolveSkills()) }
  override triageInbox() { return this.memory.withScope(() => super.triageInbox()) }

  listSleepReports(): { date: string; content: string }[] {
    return this.memory.list(this.memory.scopePath('sleep')).sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(this.memory.scopePath(`sleep/${f}`)) ?? ''
    }))
  }

  listInsights(): { date: string; content: string }[] {
    return this.memory.list(this.memory.scopePath('insights')).sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(this.memory.scopePath(`insights/${f}`)) ?? ''
    }))
  }

  listSummaries(): { date: string; content: string }[] {
    return this.memory.list(this.memory.scopePath('summaries')).sort().reverse().map(f => ({
      date: f.replace('.md', ''),
      content: this.memory.read(this.memory.scopePath(`summaries/${f}`)) ?? ''
    }))
  }
}
