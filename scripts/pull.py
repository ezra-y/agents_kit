#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把某个分类（或单个技能）拷贝进当前项目的 .claude/skills/。

    python ~/agents_kit/scripts/pull.py apple/guides   拉一整个分类
    python ~/agents_kit/scripts/pull.py lark           拉飞书全套（自动带 lark-shared）
    python ~/agents_kit/scripts/pull.py xcuitest       拉单个技能
    python ~/agents_kit/scripts/pull.py --list         看有哪些分类

用拷贝不用软链：项目目录可能提交给别人，软链指向本机路径对别人是死链。
"""
import os, sys, shutil
from collections import Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(os.getcwd(), '.claude', 'skills')

# 某些技能离了依赖就不能用。上游把技能重构成「去跑另一个技能」的空壳之后，
# 光拉它本身是拉了个寂寞，所以这里硬编码几组已知的依赖关系。
DEPS = {
    'lark':            ['lark-shared'],
    'grill-me':        ['grilling'],
    'grill-with-docs': ['grilling', 'domain-modeling'],
    'triage':          ['setup-matt-pocock-skills'],
    'to-prd':          ['setup-matt-pocock-skills'],
    'to-issues':       ['setup-matt-pocock-skills'],
}

skills, bycat = {}, Counter()
for dp, dirs, files in os.walk(f'{REPO}/skills'):
    if 'SKILL.md' not in files: continue
    dirs[:] = []
    skills[os.path.basename(dp)] = dp
    bycat[os.path.relpath(os.path.dirname(dp), f'{REPO}/skills')] += 1

args = [a for a in sys.argv[1:] if not a.startswith('-')]
if '--list' in sys.argv or not args:
    print('可用分类：')
    for c, n in sorted(bycat.items()):
        print(f'  {c:<26} {n} 个')
    print(f'\n共 {len(skills)} 个技能')
    print('用法: pull.py <分类|技能名>')
    sys.exit(0)

target = args[0]
picked = {}
catdir = f'{REPO}/skills/{target}'
if os.path.isdir(catdir):
    for dp, dirs, files in os.walk(catdir):
        if 'SKILL.md' not in files: continue
        dirs[:] = []
        picked[os.path.basename(dp)] = dp
elif target in skills:
    picked[target] = skills[target]
else:
    sys.exit(f'找不到「{target}」。跑 pull.py --list 看有哪些。')

# 补依赖
extra = {}
for key, deps in DEPS.items():
    if key != target and key not in picked: continue
    for d in deps:
        if d not in picked and d in skills: extra[d] = skills[d]

os.makedirs(DEST, exist_ok=True)
print(f'拉取 {target} → .claude/skills/')
for n, s in sorted(picked.items()):
    t = f'{DEST}/{n}'
    if os.path.exists(t): shutil.rmtree(t)
    shutil.copytree(s, t)
    print(f'  ✓ {n}')
for n, s in sorted(extra.items()):
    t = f'{DEST}/{n}'
    if os.path.exists(t): shutil.rmtree(t)
    shutil.copytree(s, t)
    print(f'  + {n}   （依赖，自动带上）')

print(f'\n共 {len(picked) + len(extra)} 个，已拷贝到 {DEST}')
print('提示：这是拷贝不是软链，不会随仓库自动更新。要更新就重跑一次。')
