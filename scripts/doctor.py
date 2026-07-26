#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""体检：查仓库和本地安装有没有毛病。

    python scripts/doctor.py

检查六件事：
  1. SKILL.md 格式（有没有 frontmatter、name、description）
  2. 重名冲突（两个分类下同名技能，软链时会互相覆盖）
  3. active.txt 里写了但仓库没有的
  4. 断裂的技能引用（技能 A 说去跑 /技能B，但 B 不存在）
  5. 本地软链是否有效（指向的路径还在不在）
  6. 两个本地目录是否指向同一个源
"""
import json, os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.expanduser('~')
DESTS = [f'{HOME}/.claude/skills', f'{HOME}/.agents/skills']
problems = []
def bad(msg):  problems.append(msg); print(f'  ⚠ {msg}')
def ok(msg):   print(f'  ✓ {msg}')

# ── 收集仓库里的技能 ──
skills = {}      # name -> path
dupes = []
for dp, dirs, files in os.walk(f'{REPO}/skills'):
    if 'SKILL.md' not in files: continue
    dirs[:] = []                      # 找到技能就不再往下钻
    name = os.path.basename(dp)
    if name in skills: dupes.append((name, skills[name], dp))
    else: skills[name] = dp

print(f'\n[1/6] SKILL.md 格式 —— 共 {len(skills)} 个技能')
badfmt = 0
for n, p in sorted(skills.items()):
    t = open(f'{p}/SKILL.md', encoding='utf-8', errors='ignore').read()
    m = re.match(r'^---\s*\n(.*?)\n---', t, re.S)
    if not m: bad(f'{n}: 缺 YAML frontmatter'); badfmt += 1; continue
    fm = m.group(1)
    if not re.search(r'^description:', fm, re.M):
        bad(f'{n}: frontmatter 缺 description（模型无法判断何时使用）'); badfmt += 1
if badfmt == 0: ok('全部正常')

print(f'\n[2/6] 重名冲突')
if dupes:
    for n, a, b in dupes:
        bad(f'{n} 同时存在于 {a.replace(REPO+"/","")} 和 {b.replace(REPO+"/","")}')
else: ok('无重名')

print(f'\n[3/6] active.txt')
active = []
for line in open(f'{REPO}/active.txt', encoding='utf-8'):
    line = line.split('#')[0].strip()
    if line: active.append(line)
miss = [n for n in active if n not in skills]
if miss:
    for n in miss: bad(f'active.txt 里的 {n} 在仓库中不存在')
else: ok(f'{len(active)} 个常驻技能全部匹配')

print(f'\n[4/6] 技能间引用')
broken = 0
# 只有上下文里提到 skill/技能 才当成技能引用 —— 否则 `/users` 这种 REST 路径会误报
CONTEXT = re.compile(r'skill|技能|invoke|run the|/(?:run|use)\b', re.I)
for n, p in sorted(skills.items()):
    t = open(f'{p}/SKILL.md', encoding='utf-8', errors='ignore').read()
    seen = set()          # 同一个缺失引用在一个技能里只报一次
    for m in re.finditer(r'`/([a-z][a-z0-9-]{2,40})`', t):
        r = m.group(1)
        if r in skills or r in seen: continue
        # 只有上下文明确在讲技能时才算引用 —— 否则 `/users` 这种 REST 路径会误报
        around = t[max(0, m.start() - 80): m.end() + 80]
        if not CONTEXT.search(around): continue
        seen.add(r)
        bad(f'{n} 引用了 /{r}，但仓库里没有这个技能'); broken += 1
if broken == 0: ok('所有引用都能解析')

print(f'\n[5/6] 本地软链')
for d in DESTS:
    if not os.path.isdir(d): bad(f'{d} 不存在（还没跑过 link.sh？）'); continue
    entries = [e for e in os.listdir(d) if not e.startswith('.')]
    links = [e for e in entries if os.path.islink(f'{d}/{e}')]
    dead  = [e for e in links if not os.path.exists(os.path.realpath(f'{d}/{e}'))]
    real  = [e for e in entries if os.path.isdir(f'{d}/{e}') and not os.path.islink(f'{d}/{e}')]
    for e in dead: bad(f'{d}/{e} 是断链')
    if real: bad(f'{os.path.basename(d)} 里有 {len(real)} 个实体目录（不受仓库管理）: {", ".join(sorted(real)[:6])}{" …" if len(real)>6 else ""}')
    if not dead and not real: ok(f'{d}: {len(links)} 个软链全部有效')

print(f'\n[6/6] 两个目录是否一致')
a, b = DESTS
if os.path.isdir(a) and os.path.isdir(b):
    ta = {e: os.path.realpath(f'{a}/{e}') for e in os.listdir(a) if not e.startswith('.')}
    tb = {e: os.path.realpath(f'{b}/{e}') for e in os.listdir(b) if not e.startswith('.')}
    diff = [k for k in set(ta) & set(tb) if ta[k] != tb[k]]
    onlya, onlyb = sorted(set(ta)-set(tb)), sorted(set(tb)-set(ta))
    for k in diff: bad(f'{k} 两边指向不同源')
    if onlya: bad(f'只在 .claude 有 {len(onlya)} 个: {", ".join(onlya[:6])}{" …" if len(onlya)>6 else ""}')
    if onlyb: bad(f'只在 .agents 有 {len(onlyb)} 个: {", ".join(onlyb[:6])}{" …" if len(onlyb)>6 else ""}')
    if not diff and not onlya and not onlyb: ok('两个目录完全一致')

print('\n' + '─'*40)
if problems:
    print(f'发现 {len(problems)} 个问题')
    sys.exit(1)
print('全部检查通过')
