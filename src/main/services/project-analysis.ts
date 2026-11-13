import type { Memory } from './brain/memory-store'
import { createContinuityService } from './continuity'
import type { AnalysisCallback, AnalysisArgs, ContinuityRecord, AnalysisMetadata } from '../../../tools/lib/continuity.mjs'

export function createProjectAnalysisService(memory: Memory, callback: AnalysisCallback, metadata?: AnalysisMetadata) {
  return {
    analyze(args: AnalysisArgs): Promise<ContinuityRecord> {
      return memory.withScope(() => createContinuityService(memory).analyze(args, callback, metadata))
    }
  }
}
