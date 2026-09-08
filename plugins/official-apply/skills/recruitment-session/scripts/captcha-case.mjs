import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const CASE_EVENTS = new Set(['CANDIDATES', 'ANGLE', 'DRAG', 'POST_VERIFY_STATE']);
const IMAGE_ARGUMENTS = new Set(['--background', '--piece', '--inner', '--outer']);

export function createCaptchaCase({ evidenceDir, pageUrl, runId, taskId, type, solver, sessionScript }) {
  const url = pageUrl ? new URL(pageUrl) : undefined;
  const root = path.join(evidenceDir, 'sites', url?.hostname ?? 'unattributed', 'captcha');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(path.join(root, 'case-'));
  const solverName = path.basename(solver);
  copyFileSync(solver, path.join(directory, solverName));
  copyFileSync(sessionScript, path.join(directory, 'session-script.mjs'));
  const data = { schemaVersion: 1, type, runId, taskId,
    pageUrl: url ? `${url.origin}${url.pathname}` : undefined, startedAt: new Date().toISOString(),
    status: 'in_progress', solverName, solverRuns: [], events: [] };
  function save() {
    writeFileSync(path.join(directory, 'case.json.tmp'), JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(path.join(directory, 'case.json.tmp'), path.join(directory, 'case.json'));
  }
  save();
  return {
    directory,
    record(event, value) {
      data.events.push({ at: new Date().toISOString(), event, value });
      save();
    },
    recordEvent(event, value) {
      if (CASE_EVENTS.has(event)) this.record(event, value);
      if (event === 'FAST_RESULT') {
        const { solution, drag, verification, solved, captchaSolved, verificationStillOpen } = value;
        this.record(event, { solution, drag, verification, solved, captchaSolved, verificationStillOpen,
          loginStage: value.status?.data?.stage ?? value.loginStatus?.data?.stage });
      }
    },
    solve(args) {
      const recordedArgs = [...args];
      for (let index = 0; index < args.length - 1; index += 1) {
        if (!IMAGE_ARGUMENTS.has(args[index])) continue;
        const source = path.resolve(args[index + 1]);
        const target = path.dirname(source) === path.resolve(directory) ? source :
          path.join(directory, `input-${data.solverRuns.length}-${args[index].slice(2)}${path.extname(source) || '.img'}`);
        if (source !== target) copyFileSync(source, target);
        recordedArgs[index + 1] = path.basename(target);
      }
      const run = { args: recordedArgs, startedAt: new Date().toISOString() };
      data.solverRuns.push(run);
      save();
      try {
        const output = execFileSync('python3', [path.join(directory, solverName), ...recordedArgs], { cwd: directory, encoding: 'utf8' });
        run.stdout = output;
        save();
        run.solution = JSON.parse(output);
        run.finishedAt = new Date().toISOString();
        save();
        return run.solution;
      } catch (error) {
        run.error = error instanceof Error ? error.message : String(error);
        run.stdout ??= error.stdout?.toString();
        run.stderr = error.stderr?.toString();
        run.finishedAt = new Date().toISOString();
        save();
        throw error;
      }
    },
    finish(outcome, detail) {
      data.status = 'finished';
      data.outcome = outcome;
      data.detail = detail;
      data.finishedAt = new Date().toISOString();
      save();
    },
    fail(error) {
      data.status = 'failed';
      data.error = error instanceof Error ? error.message : String(error);
      data.finishedAt = new Date().toISOString();
      save();
    },
  };
}

export function replayCaptchaCase(directory, { solverDir, baseline = false }) {
  const data = JSON.parse(readFileSync(path.join(directory, 'case.json'), 'utf8'));
  const solver = path.join(baseline ? directory : solverDir, data.solverName);
  const runs = data.solverRuns.map((previous, index) => {
    const result = { index, previous: previous.solution, expected: previous.expected };
    try {
      const solution = JSON.parse(execFileSync('python3', [solver, ...previous.args], {
        cwd: directory, encoding: 'utf8',
      }));
      result.solution = solution;
      result.changed = !isDeepStrictEqual(solution, previous.solution);
      const expected = previous.expected;
      if (expected && Object.keys(expected).length > 0) {
        result.checks = Object.entries(expected).map(([field, expectation]) => {
          const value = solution[field];
          if (typeof expectation === 'object' && expectation !== null) {
            let difference = typeof value === 'number' ? Math.abs(value - expectation.value) : Infinity;
            if (expectation.period && Number.isFinite(difference)) {
              difference %= expectation.period;
              difference = Math.min(difference, expectation.period - difference);
            }
            return { field, actual: value, expected: expectation, passed: difference <= (expectation.tolerance ?? 0) };
          }
          return { field, actual: value, expected: expectation, passed: value === expectation };
        });
        result.status = result.checks.every(check => check.passed) ? 'passed' : 'failed';
      } else {
        result.status = 'unlabelled';
      }
    } catch (error) {
      result.status = 'error';
      result.error = error instanceof Error ? error.message : String(error);
    }
    return result;
  });
  return { caseDirectory: directory, originalStatus: data.status, originalOutcome: data.outcome,
    solver, replayedAt: new Date().toISOString(), runs,
    status: runs.length === 0 ? 'no_solver_input' :
      runs.some(run => run.status === 'failed' || run.status === 'error') ? 'failed' :
      runs.some(run => run.status === 'unlabelled') ? 'unlabelled' : 'passed' };
}
