@AGENTS.md

## Claude Code 专属

技能目录结构必须是 `skills/<任意分类层级>/<技能名>/SKILL.md`。Claude Code 只认 `~/.claude/skills/<技能名>/SKILL.md` 一层，分类层由 `link.sh` 在建软链时拍平。所以**分类怎么嵌套都行，但技能名必须全局唯一**。
