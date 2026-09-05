'use strict';

const { extractSourceFiles } = require('./swebench-pro');

function mapSwebenchVerifiedToolRow(row) {
  if (!row || !row.repo || !row.problem_statement || !row.instance_id || !row.base_commit) {
    return null;
  }
  const goldFiles = extractSourceFiles(row.patch);
  if (goldFiles.length !== 1 || goldFiles[0].split('/').length < 3) return null;
  const problem = String(row.problem_statement).slice(0, 3500);
  return {
    id: String(row.instance_id),
    source: 'princeton-nlp/SWE-bench_Verified',
    mode: 'swe-tool-localize',
    license: 'MIT',
    prompt: `Repository: ${row.repo}\n\nGitHub issue:\n${problem}\n\nUse the available repository observations to identify the single implementation-owner source file most likely needing modification. End with exactly: ANSWER: <path/to/file.ext>`,
    problem_statement: problem,
    gold_files: goldFiles,
    repo: row.repo,
    base_commit: String(row.base_commit),
  };
}

module.exports = {
  mapSwebenchVerifiedToolRow,
};
