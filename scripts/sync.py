#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""跟上游对齐。由 GitHub Action 每天自动跑，一般不用手动执行。

    python scripts/sync.py            # 实际同步
    python scripts/sync.py --dry-run  # 只报告不改动

策略（改动大小决定处理方式）：
  相似度 >= 90% 且附件数不变  → 直接更新
  否则                        → 不动，写进报告等人工确认
不在 sources.json 里的技能完全不碰（那 23 个自有/来源不明的）。
"""
import json, os, subprocess, tempfile, shutil, difflib, hashlib, sys, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY = '--dry-run' in sys.argv
SIM_THRESHOLD = 0.90

cfg = json.load(open(f'{REPO}/sources.json', encoding='utf-8'))['skills']

def find_local(name):
    for dp, dirs, fs in os.walk(f'{REPO}/skills'):
        if 'SKILL.md' not in fs: continue
        dirs[:] = []
        if os.path.basename(dp) == name: return dp
    return None

def blob_sha(path):
    d = open(path, 'rb').read()
    return hashlib.sha1(b'blob %d\0' % len(d) + d).hexdigest()

def gh(args):
    return subprocess.run(['gh'] + args, capture_output=True, text=True).stdout.strip()

updated, flagged, failed, unchanged = [], [], [], 0

# ── 1. GitHub 来源：先用 blob SHA 指纹比对，一样就跳过，不下载 ──
gh_items = {n: v for n, v in cfg.items() if v['type'] == 'github'}
repos = {}
for n, v in gh_items.items():
    repos.setdefault((v['repo'], v['branch']), []).append(n)

for (repo, branch), names in sorted(repos.items()):
    tree = gh(['api', f'repos/{repo}/git/trees/{branch}?recursive=1',
               '--jq', '.tree[]|select(.path|endswith("SKILL.md"))|.path+"\t"+.sha'])
    if not tree:
        for n in names: failed.append((n, f'{repo} 树读取失败'))
        continue
    shas = dict(l.split('\t') for l in tree.split('\n') if '\t' in l)
    changed = []
    for n in names:
        local = find_local(n)
        if not local: failed.append((n, '本地找不到')); continue
        up = shas.get(cfg[n]['path'] + '/SKILL.md')
        if up is None: flagged.append((n, repo, '上游路径已不存在（改名或删除？）', None)); continue
        if up == blob_sha(f'{local}/SKILL.md'): unchanged += 1; continue
        changed.append((n, local))
    if not changed: continue

    tmp = tempfile.mkdtemp()
    try:
        r = subprocess.run(['git', 'clone', '-q', '--depth', '1', '-b', branch,
                            f'https://github.com/{repo}.git', f'{tmp}/r'], capture_output=True)
        if r.returncode != 0:
            for n, _ in changed: failed.append((n, f'{repo} clone 失败'))
            continue
        for n, local in changed:
            usrc = f"{tmp}/r/{cfg[n]['path']}"
            if not os.path.isdir(usrc): flagged.append((n, repo, '上游目录不存在', None)); continue
            lo = open(f'{local}/SKILL.md', encoding='utf-8', errors='ignore').read().split('\n')
            up = open(f'{usrc}/SKILL.md', encoding='utf-8', errors='ignore').read().split('\n')
            ratio = difflib.SequenceMatcher(None, lo, up).ratio()
            lo_n = sum(len(f) for _, _, f in os.walk(local)) - 1
            up_n = sum(len(f) for _, _, f in os.walk(usrc)) - 1
            detail = f'{len(lo)}→{len(up)} 行，相似度 {ratio:.0%}，附件 {lo_n}→{up_n}'
            if ratio >= SIM_THRESHOLD and lo_n == up_n:
                if not DRY:
                    shutil.rmtree(local); shutil.copytree(usrc, local)
                updated.append((n, repo, detail))
            else:
                flagged.append((n, repo, '改动过大，需人工确认', detail))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

# ── 2. URL 来源（飞书）：单文件，直接抓下来比 ──
for n, v in sorted(cfg.items()):
    if v['type'] != 'url': continue
    local = find_local(n)
    if not local: failed.append((n, '本地找不到')); continue
    try:
        with urllib.request.urlopen(v['url'], timeout=25) as r:
            up_t = r.read().decode('utf-8', 'ignore')
    except Exception as e:
        failed.append((n, f'拉取失败 {e}')); continue
    if len(up_t) < 80: failed.append((n, '拉到的内容异常短')); continue
    lo_t = open(f'{local}/SKILL.md', encoding='utf-8', errors='ignore').read()
    if lo_t.strip() == up_t.strip(): unchanged += 1; continue
    ratio = difflib.SequenceMatcher(None, lo_t.split('\n'), up_t.split('\n')).ratio()
    detail = f"{lo_t.count(chr(10))+1}→{up_t.count(chr(10))+1} 行，相似度 {ratio:.0%}"
    # 飞书是单文件覆盖，没有目录结构问题，阈值放宽
    if not DRY:
        open(f'{local}/SKILL.md', 'w', encoding='utf-8').write(up_t)
    updated.append((n, 'open.feishu.cn', detail))

# ── 报告 ──
print(f'\n{"="*46}\n同步结果{"（干跑）" if DRY else ""}\n{"="*46}')
print(f'未变化 {unchanged} · 已更新 {len(updated)} · 待确认 {len(flagged)} · 失败 {len(failed)}\n')
if updated:
    print('【已更新】')
    for n, r, d in updated: print(f'  ✓ {n:<30} {d}')
if flagged:
    print('\n【待人工确认 —— 未改动本地文件】')
    for n, r, why, d in flagged:
        print(f'  ⚠ {n:<30} {why}')
        if d: print(f'    {d}')
        print(f'    上游: https://github.com/{r}' if r != 'open.feishu.cn' else '')
if failed:
    print('\n【失败】')
    for n, why in failed: print(f'  ✗ {n:<30} {why}')

report = {'updated': updated, 'flagged': flagged, 'failed': failed, 'unchanged': unchanged}
open(f'{REPO}/.sync-report.json', 'w', encoding='utf-8').write(
    json.dumps(report, ensure_ascii=False, indent=1))
sys.exit(0)
