export type FactOrigin = 'user' | 'sleep' | 'chat' | 'mcp' | 'webhook' | 'agent' | 'legacy'
export type FactStatus = 'active' | 'archived' | 'proposal'
export interface Fact { id: string; status: FactStatus; since: string; until: string; source: string; origin: FactOrigin; supersedes: string; supersededBy: string; text: string }
export interface FactDoc { legacy: string; facts: Fact[] }
export interface MemorySelectionOptions { mode?: 'current' | 'history' | 'asOf'; asOf?: string }
export function readFactDocument(raw: string): FactDoc
export function selectFacts(raw: string, options?: MemorySelectionOptions): FactDoc
export function formatFactSelection(raw: string, options?: MemorySelectionOptions): string
export function labelMemorySource(path: string): string
