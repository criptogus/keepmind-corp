import {createHash} from 'node:crypto';

// Preserve complete source bodies. Validate the entire batch before any I/O.
export async function readScopedSources(job, paths, readNote) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 11 ||
      paths.some(path => typeof path !== 'string' || !job.paths.includes(path)))
    throw Error('Tool or source not authorized');
  const records = [];
  for (const path of [...new Set(paths)]) {
    const {body} = await readNote(path);
    if (typeof body !== 'string') throw Error('Source unavailable');
    records.push({path, sha256:createHash('sha256').update(body).digest('hex'), body});
  }
  // Only credit reads once the complete response can be returned.
  job.sourceHashes ||= {};
  for (const record of records) {
    job.sourceHashes[record.path] = record.sha256;
    if (record.path === job.skillPath) job.skillHash = record.sha256;
    if (!job.reads.includes(record.path)) job.reads.push(record.path);
    job.events.push({at:new Date().toISOString(),text:'Fonte consultada via MCP',path:record.path});
  }
  return records;
}
