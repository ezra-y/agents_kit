import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
function firstAvailable(candidates) {
    for (const candidate of candidates) {
        if (existsSync(candidate.absolute) && statSync(candidate.absolute).isFile()) {
            return { available: true, path: candidate.display };
        }
    }
    return { available: false };
}
export function detectQiuzhaoSkill(input) {
    const home = path.resolve(input.homeDir ?? homedir());
    const project = (relative) => ({
        absolute: path.join(input.paths.root, relative),
        display: `<skill-root>/${relative}`,
    });
    const user = (relative) => ({
        absolute: path.join(home, relative),
        display: `~/${relative}`,
    });
    return {
        claudeCode: firstAvailable([
            project('skills/qiuzhao-feed/SKILL.md'),
            user('.claude/skills/qiuzhao-feed/SKILL.md'),
        ]),
        codex: firstAvailable([
            project('skills/qiuzhao-feed/SKILL.md'),
            user('.agents/skills/qiuzhao-feed/SKILL.md'),
            user('.codex/skills/qiuzhao-feed/SKILL.md'),
        ]),
    };
}
//# sourceMappingURL=detect-qiuzhao-skill.js.map