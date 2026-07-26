#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""加一个新技能。给 GitHub 链接就行，自动拉取、归类、登记。

    python scripts/add.py https://github.com/foo/bar/tree/main/skills/baz
    python scripts/add.py https://github.com/foo/bar/tree/main/skills/baz --cat web/craft
    python scripts/add.py https://github.com/foo/bar --cat tools        # 整个仓库就是一个技能

不给 --cat 会列出现有分类让你选。
"""
import json, os, re, subprocess, sys, tempfile, shutil, argparse

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ap = argparse.ArgumentParser()
ap.add_argument('url', help='GitHub 链接（仓库根，或 /tree/<分支>/<路径>）')
ap.add_argument('--cat', help='分类目录，如 web/craft')
ap.add_argument('--name', help='本地技能名（默认用上游目录名）')
ap.add_argument('--active', action='store_true', help='同时加进 active.txt')
a = ap.parse_args()

# ── 解析链接 ──
m = re.match(r'https?://github\.com/([^/]+)/([^/]+?)(?:\.git)?(?:/tree/([^/]+)(?:/(.*))?)?/?$', a.url)
if not m:
    sys.exit(f'链接看不懂：{a.url}\n应该形如 https://github.com/用户/仓库/tree/main/skills/名字')
owner, name_, branch, path = m.group(1), m.group(2), m.group(3), m.group(4) or ''
repo = f'{owner}/{name_}'
if not branch:
    branch = subprocess.run(['gh', 'api', f'repos/{repo}', '--jq', '.default_branch'],
                            capture_output=True, text=True).stdout.strip() or 'main'
print(f'解析: {repo} @ {branch} → {path or "(仓库根)"}')

# ── 现有技能与分类 ──
existing, cats = {}, set()
for dp, _, fs in os.walk(f'{REPO}/skills'):
    if 'SKILL.md' in fs:
        existing[os.path.basename(dp)] = dp
        cats.add(os.path.relpath(os.path.dirname(dp), f'{REPO}/skills'))

cat = a.cat
if not cat:
    print('\n现有分类：')
    for c in sorted(cats): print(f'  {c}')
    if not sys.stdin.isatty():
        sys.exit('非交互环境，请用 --cat 指定分类')
    try: cat = input('\n放到哪个分类？（可新建）: ').strip()
    except EOFError: cat = ''
    if not cat: sys.exit('取消')

# ── 拉取 ──
tmp = tempfile.mkdtemp()
try:
    r = subprocess.run(['git', 'clone', '-q', '--depth', '1', '-b', branch,
                        f'https://github.com/{repo}.git', f'{tmp}/r'], capture_output=True, text=True)
    if r.returncode != 0: sys.exit(f'clone 失败: {r.stderr.strip()}')
    src = os.path.join(f'{tmp}/r', path) if path else f'{tmp}/r'
    if not os.path.isfile(f'{src}/SKILL.md'):
        found = [os.path.dirname(os.path.join(dp, 'SKILL.md'))
                 for dp, _, fs in os.walk(src) if 'SKILL.md' in fs]
        if len(found) == 1: src = found[0]; print(f'  自动定位到 {os.path.relpath(src, f"{tmp}/r")}')
        elif len(found) > 1:
            sys.exit('这个路径下有多个技能，请指到具体某一个：\n  ' +
                     '\n  '.join(os.path.relpath(f, f'{tmp}/r') for f in found[:20]))
        else: sys.exit(f'{src} 下找不到 SKILL.md')

    sk = a.name or os.path.basename(src.rstrip('/'))
    if sk in existing:
        sys.exit(f'✗ 已经有同名技能 {sk}，在 {existing[sk].replace(REPO+"/","")}\n'
                 f'  想换个名字用 --name')

    t = open(f'{src}/SKILL.md', encoding='utf-8', errors='ignore').read()
    fm = re.match(r'^---\s*\n(.*?)\n---', t, re.S)
    if not fm: print('  ⚠ 警告：这个 SKILL.md 没有 frontmatter，模型可能不知道何时用它')
    desc = ''
    if fm:
        d = re.search(r'^description:\s*(.*?)(?=\n[a-zA-Z_-]+:|\Z)', fm.group(1), re.S | re.M)
        desc = ' '.join(d.group(1).split()) if d else ''
        if not desc: print('  ⚠ 警告：frontmatter 里没有 description')

    dst = f'{REPO}/skills/{cat}/{sk}'
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copytree(src, dst)
    nfiles = sum(len(f) for _, _, f in os.walk(dst)) - 1
    print(f'✓ {sk}：{t.count(chr(10))+1} 行，{nfiles} 个附件 → skills/{cat}/{sk}')
finally:
    shutil.rmtree(tmp, ignore_errors=True)

# ── 登记到 sources.json ──
sp = f'{REPO}/sources.json'
cfg = json.load(open(sp, encoding='utf-8'))
cfg['skills'][sk] = {'type': 'github', 'repo': repo, 'branch': branch,
                     'path': path or '.', 'category': cat}
cfg['skills'] = dict(sorted(cfg['skills'].items()))
json.dump(cfg, open(sp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'✓ 已登记到 sources.json（以后 sync.py 会自动跟它对齐）')

def ask(prompt, default=''):
    if not sys.stdin.isatty(): return default
    try: return input(prompt).strip()
    except EOFError: return default

if a.active or ask('\n设为常驻？(加进 active.txt) [y/N] ').lower() == 'y':
    with open(f'{REPO}/active.txt', 'a', encoding='utf-8') as f:
        f.write(f'{sk}\n')
    print('✓ 已加进 active.txt —— 跑 scripts/link.py 生效')

if desc: print(f'\n描述: {desc[:160]}')

# ── 连带更新：文档重新生成 + 体检 ──
# 加技能会让 README/清册过期，所以这里直接重跑，不指望你记得
print('\n重新生成文档…')
subprocess.run([sys.executable, f'{REPO}/scripts/render.py'])
print('\n体检…')
subprocess.run([sys.executable, f'{REPO}/scripts/doctor.py'])
print(f'\n提示：在 scripts/descriptions.py 里给 {sk} 补一条中文说明，'
      f'然后重跑 scripts/render.py，文档里就有中文了。')
if a.active:
    print('已加进 active.txt —— 跑 python3 scripts/link.py 把它装上')
