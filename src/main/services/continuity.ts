import { ContinuityService, withProjectLock, assertNoSymlinkPath } from '../../../tools/lib/continuity.mjs'
import type { Memory } from './brain/memory-store'

export function createContinuityService(memory: Memory): ContinuityService {
  return new ContinuityService({
    read: path => memory.read(path),
    write: (path, content) => memory.write(path, content),
    list: dir => memory.list(dir),
    assertEvidencePath: path => assertNoSymlinkPath(memory.resolve('.'), path),
    scopePath: path => memory.scopePath(path),
    space: () => memory.currentSpace,
    withLock: (path, fn) => withProjectLock(memory.resolve(path), fn)
  })
}
export { ContinuityService }
