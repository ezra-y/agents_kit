#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""读 active.txt，把里面列出的技能软链接到本地技能目录。

    python scripts/link.py              建立软链
    python scripts/link.py --dry-run    只看会做什么，不实际改动
    python scripts/link.py --prune      顺便清掉本地那些「仓库里有、但不在 active.txt」的旧副本

同时链到 ~/.claude/skills（Claude Code）和 ~/.agents/skills（Codex 等）。
本地已存在的实体目录会被换成软链 —— 这样 git pull 就等于更新所有已装技能。
"""
import os, sys, shutil

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.expanduser('~')
DESTS = [f'{HOME}/.claude/skills', f'{HOME}/.agents/skills']
DRY = '--dry-run' in sys.argv
PRUNE = '--prune' in sys.argv
if DRY: print('【干跑模式，不实际改动】')

# ── 读 active.txt ──
want = []
for line in open(f'{REPO}/active.txt', encoding='utf-8'):
    line = line.split('#')[0].strip()
    if line: want.append(line)
print(f'active.txt 列出 {len(want)} 个常驻技能')

# ── 在 skills/ 里递归定位每个技能（不管埋多深）──
src, dupes = {}, []
for dp, dirs, files in os.walk(f'{REPO}/skills'):
    if 'SKILL.md' not in files: continue
    dirs[:] = []                      # 找到技能就不再往下钻，内部文件都算它的附件
    n = os.path.basename(dp)
    if n in src: dupes.append((n, src[n], dp))
    else: src[n] = dp
if dupes:
    for n, a, b in dupes:
        print(f'  ✗ 重名冲突: {n} 同时在 {a.replace(REPO+"/","")} 和 {b.replace(REPO+"/","")}', file=sys.stderr)
    sys.exit('重名会导致软链互相覆盖，先解决再跑。')
print(f'仓库里共 {len(src)} 个技能')

missing = [n for n in want if n not in src]
if missing:
    print(f'\n⚠ active.txt 里这些在仓库中不存在，已跳过：', file=sys.stderr)
    for n in missing: print(f'    {n}', file=sys.stderr)

linked = cleaned = pruned = 0
for dest in DESTS:
    # 防呆：目标目录本身若是指回本仓库的软链，会把链接写回仓库自己里面
    if os.path.islink(dest):
        r = os.path.realpath(dest)
        if r == REPO or r.startswith(REPO + os.sep):
            sys.exit(f'错误：{dest} 是指向本仓库的软链（{r}）。请先 rm 掉它。')
    if not DRY: os.makedirs(dest, exist_ok=True)
    print(f'\n→ {dest}')
    for n in want:
        s = src.get(n)
        if not s: continue
        t = f'{dest}/{n}'
        # 本地是实体目录 → 删掉换成软链。这是「更新不生效」的根源：
        # 实体副本不会随 git pull 变化，软链会。
        if os.path.exists(t) and not os.path.islink(t):
            print(f'  ⟲ 清理旧实体副本 {n}'); cleaned += 1
            if not DRY: shutil.rmtree(t)
        elif os.path.islink(t):
            if not DRY: os.unlink(t)
        if not DRY: os.symlink(s, t)
        print(f'  ✓ {n}  ←  {s.replace(REPO + "/skills/", "")}')
        linked += 1

    if PRUNE:
        for e in sorted(os.listdir(dest) if os.path.isdir(dest) else []):
            if e.startswith('.') or e in want: continue
            p = f'{dest}/{e}'
            # 只清理「仓库里有」的 —— 别人用插件装的、你手写的一律不动，
            # 因为那些删了就找不回来，而仓库里有的随时能链回来
            if e in src:
                print(f'  ⊘ 移除非常驻 {e}' + ('（软链）' if os.path.islink(p) else '（实体副本，仓库里有备份）'))
                if not DRY:
                    os.unlink(p) if os.path.islink(p) else shutil.rmtree(p)
                pruned += 1

print('\n' + '─' * 40)
print(f'链接 {linked} 个（{len(want) - len(missing)} 技能 × {len(DESTS)} 目录），清理旧副本 {cleaned} 个')
if PRUNE: print(f'移除非常驻 {pruned} 个（仓库里都有，随时能链回来）')
if missing: print(f'跳过 {len(missing)} 个（仓库里没有）')
if DRY: print('（干跑，未实际改动）')
