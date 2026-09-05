'use strict';

const SOURCE_EXTENSION = /\.(?:py|js|jsx|ts|tsx|java|go|rb|c|cc|cpp|cxx|h|hpp|cs|php|rs|kt|kts|scala|swift|vue|svelte)$/i;
const TEST_PATH = /(?:^|\/)(?:test|tests|spec|specs)(?:\/|$)|\.(?:test|spec)\./i;

function extractSourceFiles(patch) {
  const files = [...String(patch || '').matchAll(/^diff --git a\/\S+ b\/(\S+)$/gm)]
    .map((match) => match[1])
    .filter((file) => SOURCE_EXTENSION.test(file) && !TEST_PATH.test(file));
  return [...new Set(files)];
}

function mapSwebenchProRow(row) {
  if (!row || !row.repo || !row.problem_statement || !row.instance_id) return null;
  const goldFiles = extractSourceFiles(row.patch);
  if (goldFiles.length < 1 || goldFiles.length > 3) return null;
  const problem = String(row.problem_statement).slice(0, 3500);
  return {
    id: String(row.instance_id),
    source: 'ScaleAI/SWE-bench_Pro',
    mode: 'swe-localize',
    license: 'unknown',
    prompt: `Repository: ${row.repo}\n\nGitHub issue:\n${problem}\n\nWhich single source file in this repository most likely needs to be modified to fix this issue? Reason about the symptom and where it originates, then give the repository-relative path. End with exactly: ANSWER: <path/to/file.ext>`,
    gold_files: goldFiles,
    repo: row.repo,
    repo_language: row.repo_language || null,
    issue_categories: row.issue_categories || null,
    issue_specificity: row.issue_specificity || null,
  };
}

module.exports = {
  extractSourceFiles,
  mapSwebenchProRow,
};
