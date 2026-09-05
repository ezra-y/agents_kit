/**
 * 判断第 7 节点名的模块是不是**真的被跑到了**。
 *
 * 规则文档：修复清单第 7 节
 *
 * ## 为什么用覆盖率当判据
 *
 * 「模块写好了」和「模块接进主流程了」是两回事。这个项目里出现过好几次
 * 后者没做：配方系统整套函数写完，只在单元测试里出现过，主流程一次都没调；
 * 视觉兜底的验证器写死成永远返回 false。
 *
 * 光看代码看不出来。`import` 成功也证明不了什么——那只说明文件能加载。
 * 所以判据是覆盖率：跑一遍真实测试，检查指定入口函数的调用次数。
 * 行覆盖只用于报告展示，不能证明入口函数真的被调用。
 *
 * 这个文件只有纯逻辑，不跑测试也不写盘。跑测试收集覆盖率的外壳在
 * `scripts/check-entrypoint-reachability.ts`——**分开是因为吃过亏**：
 * 上一版把逻辑写在脚本里，测试一 import 就触发了顶层代码，
 * 断言根本没跑却报了绿。
 */
export const ENTRYPOINT_MODULES = [
    { file: 'src/adapters/claude-code/runtime-adapter.ts', function: 'adaptClaudeRuntime' },
    {
        file: 'src/adapters/claude-code/visual-fallback-adapter.ts',
        function: 'executeClaudeVisualFallback',
    },
    { file: 'src/adapters/shared/detect-entrypoint.ts', function: 'detectEntrypointByCli' },
    {
        file: 'src/browser/actions/bind-page-group-to-profile-record.ts',
        function: 'bindPageGroupToProfileRecord',
    },
    {
        file: 'src/browser/actions/fill-repeatable-group.ts',
        function: 'fillRepeatableGroup',
    },
    { file: 'src/browser/actions/select-custom-option.ts', function: 'selectCustomOption' },
    { file: 'src/browser/actions/upload-files.ts', function: 'uploadFiles' },
    {
        file: 'src/browser/locators/record-locator-attempt.ts',
        function: 'recordLocatorAttempt',
    },
    { file: 'src/browser/network/observe-network.ts', function: 'observeNetwork' },
    { file: 'src/browser/scan/scan-changed-region.ts', function: 'scanChangedRegion' },
    {
        file: 'src/browser/visual/build-visual-fallback-request.ts',
        function: 'buildVisualFallbackRequest',
    },
    {
        file: 'src/browser/visual/verify-visual-fallback.ts',
        function: 'verifyVisualFallback',
    },
    { file: 'src/fixtures/capture-raw-fixture.ts', function: 'captureRawFixture' },
    { file: 'src/learning/capture-learning.ts', function: 'captureLearning' },
    {
        file: 'src/learning/create-knowledge-proposals.ts',
        function: 'createKnowledgeProposals',
    },
    {
        file: 'src/learning/promote-knowledge-proposal.ts',
        function: 'promoteKnowledgeProposal',
    },
    { file: 'src/recipes/match-page-recipe.ts', function: 'matchPageRecipe' },
    { file: 'src/recipes/save-recipe-candidate.ts', function: 'saveRecipeCandidate' },
];
/**
 * 从 lcov 里读出每个文件的行覆盖和函数调用次数。
 *
 * `FN` 声明函数，`FNDA` 记录调用次数。同一个文件来自多个测试进程时，
 * 同名函数取最大的调用次数。
 */
export function parseLcov(lcov) {
    const result = new Map();
    let file = '';
    let total = 0;
    let covered = 0;
    let functions = new Set();
    let functionCalls = new Map();
    for (const line of lcov.split('\n')) {
        if (line.startsWith('SF:')) {
            file = line.slice(3).trim();
            total = 0;
            covered = 0;
            functions = new Set();
            functionCalls = new Map();
            continue;
        }
        if (line.startsWith('DA:')) {
            const [, hits] = line.slice(3).split(',');
            total += 1;
            if (Number(hits) > 0) {
                covered += 1;
            }
            continue;
        }
        if (line.startsWith('FN:')) {
            const comma = line.indexOf(',');
            if (comma >= 0) {
                functions.add(line.slice(comma + 1).trim());
            }
            continue;
        }
        if (line.startsWith('FNDA:')) {
            const comma = line.indexOf(',');
            if (comma >= 0) {
                const name = line.slice(comma + 1).trim();
                const calls = Number(line.slice(5, comma));
                functions.add(name);
                functionCalls.set(name, Math.max(functionCalls.get(name) ?? 0, calls));
            }
            continue;
        }
        if (line.startsWith('end_of_record') && file !== '') {
            const previous = result.get(file);
            const percent = total === 0 ? 0 : Number(((covered / total) * 100).toFixed(2));
            const lines = previous === undefined || covered > previous.covered
                ? { file, total, covered, percent }
                : previous;
            const mergedFunctions = new Set(previous?.functions ?? []);
            const mergedCalls = new Map(previous?.functionCalls ?? []);
            for (const name of functions) {
                mergedFunctions.add(name);
            }
            for (const [name, calls] of functionCalls) {
                mergedCalls.set(name, Math.max(mergedCalls.get(name) ?? 0, calls));
            }
            result.set(file, {
                file: lines.file,
                total: lines.total,
                covered: lines.covered,
                percent: lines.percent,
                functions: mergedFunctions,
                functionCalls: mergedCalls,
            });
            file = '';
        }
    }
    return result;
}
export function checkReachability(coverage) {
    const reached = [];
    const unreached = [];
    const missing = [];
    for (const module of ENTRYPOINT_MODULES) {
        const found = coverage.get(module.file);
        if (found === undefined) {
            missing.push({ ...module, reason: '覆盖率数据里没有这个文件' });
        }
        else if (!found.functions.has(module.function)) {
            missing.push({
                ...module,
                total: found.total,
                covered: found.covered,
                percent: found.percent,
                reason: '覆盖率数据里没有这个函数记录',
            });
        }
        else if ((found.functionCalls.get(module.function) ?? 0) === 0) {
            unreached.push({
                ...module,
                calls: 0,
                total: found.total,
                covered: found.covered,
                percent: found.percent,
                reason: '函数调用次数为 0',
            });
        }
        else {
            reached.push({
                ...found,
                function: module.function,
                calls: found.functionCalls.get(module.function) ?? 0,
            });
        }
    }
    return { reached, unreached, missing };
}
//# sourceMappingURL=entrypoint-reachability.js.map