#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Import a GitHub skill, register it, and optionally install it.

Examples:
    python3 scripts/add.py <url> --cat tools --scope global
    python3 scripts/add.py <url> --cat web --scope project --project-dir /path
    python3 scripts/add.py <url> --cat agent --scope library

Network attempts are bounded: SSH is tried first, then HTTPS. Third-party code
is copied but never executed during installation.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATEGORIES = ('apple', 'web', 'design', 'lark', 'method', 'agent', 'tools', 'backend')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True)


def run(command, *, timeout=None, cwd=None, env=None):
    return subprocess.run(
        command, capture_output=True, text=True, timeout=timeout, cwd=cwd, env=env
    )


def default_branch(repo):
    try:
        result = run(
            ['gh', 'api', f'repos/{repo}', '--jq', '.default_branch'], timeout=12
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None


def clone(repo, branch, destination):
    base = ['git', 'clone', '-q', '--depth', '1']
    if branch:
        base += ['-b', branch]
    attempts = [
        (
            'SSH',
            base + [f'git@github.com:{repo}.git', destination],
            {
                **os.environ,
                'GIT_TERMINAL_PROMPT': '0',
                'GIT_SSH_COMMAND': (
                    'ssh -o BatchMode=yes -o ConnectTimeout=8 '
                    '-o ServerAliveInterval=5 -o ServerAliveCountMax=2'
                ),
            },
            25,
        ),
        (
            'HTTPS',
            [
                'git', '-c', 'http.version=HTTP/1.1',
                '-c', 'http.lowSpeedLimit=1', '-c', 'http.lowSpeedTime=10',
                'clone', '-q', '--depth', '1',
                *(['-b', branch] if branch else []),
                f'https://github.com/{repo}.git', destination,
            ],
            {**os.environ, 'GIT_TERMINAL_PROMPT': '0'},
            30,
        ),
    ]
    errors = []
    for label, command, env, timeout in attempts:
        shutil.rmtree(destination, ignore_errors=True)
        print(f'  {label} 拉取…')
        try:
            result = run(command, timeout=timeout, env=env)
        except subprocess.TimeoutExpired:
            errors.append(f'{label}: 超过 {timeout} 秒')
            continue
        if result.returncode == 0:
            print(f'  ✓ {label} 成功')
            return
        errors.append(f'{label}: {result.stderr.strip() or "失败"}')
    raise SystemExit('clone 失败：\n  ' + '\n  '.join(errors))


def skill_index():
    found = {}
    for directory, dirs, files in os.walk(f'{REPO}/skills'):
        if 'SKILL.md' not in files:
            continue
        dirs[:] = []
        found[os.path.basename(directory)] = directory
    return found


def save_json(path, data, indent=2):
    tmp = f'{path}.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
        f.write('\n')
    os.replace(tmp, path)


def call_script(name, *args, cwd=None):
    result = subprocess.run(
        [sys.executable, f'{REPO}/scripts/{name}', *args], cwd=cwd or REPO
    )
    if result.returncode:
        raise SystemExit(result.returncode)


parser = argparse.ArgumentParser()
parser.add_argument('url', help='GitHub 链接（仓库根，或 /tree/<分支>/<路径>）')
parser.add_argument('--cat', choices=CATEGORIES, help='八个一级分类之一')
parser.add_argument('--name', help='本地技能名（默认用上游目录名）')
parser.add_argument('--scope', choices=('library', 'global', 'project'))
parser.add_argument('--active', action='store_true', help='兼容旧用法，等同 --scope global')
parser.add_argument('--project-dir', help='项目级安装的项目目录，默认当前目录')
parser.add_argument('--description-zh', help='写入 metadata.json 的中文说明')
parser.add_argument('--trigger-zh', help='写入 metadata.json 的触发说明')
parser.add_argument('--recommendation', type=int, choices=range(1, 6), default=3)
args = parser.parse_args()

match = re.match(
    r'https?://github\.com/([^/]+)/([^/]+?)(?:\.git)?'
    r'(?:/tree/([^/]+)(?:/(.*))?)?/?$',
    args.url,
)
if not match:
    raise SystemExit(
        f'链接看不懂：{args.url}\n'
        '应该形如 https://github.com/用户/仓库/tree/main/skills/名字'
    )
owner, repo_name, branch, requested_path = (
    match.group(1), match.group(2), match.group(3), match.group(4) or ''
)
repo = f'{owner}/{repo_name}'
branch = branch or default_branch(repo)

category = args.cat
if not category:
    print('\n现有分类：')
    for item in CATEGORIES:
        print(f'  {item}')
    if not sys.stdin.isatty():
        raise SystemExit('非交互环境，请用 --cat 指定分类')
    category = input('\n放到哪个分类？').strip()
    if category not in CATEGORIES:
        raise SystemExit('分类必须是上面八个之一')

scope = 'global' if args.active else args.scope
if args.active and args.scope not in (None, 'global'):
    raise SystemExit('--active 不能和非 global 的 --scope 一起使用')
if scope is None:
    if sys.stdin.isatty():
        scope = 'global' if input('\n设为全局常驻？[y/N] ').strip().lower() == 'y' else 'library'
    else:
        scope = 'library'

tmp = tempfile.mkdtemp()
try:
    checkout = f'{tmp}/repo'
    clone(repo, branch, checkout)
    if not branch:
        branch = run(
            ['git', '-C', checkout, 'branch', '--show-current'], timeout=5
        ).stdout.strip()
    print(f'解析: {repo} @ {branch} → {requested_path or "(仓库根)"}')

    source = os.path.realpath(
        os.path.join(checkout, requested_path) if requested_path else checkout
    )
    if source != os.path.realpath(checkout) and not source.startswith(
        os.path.realpath(checkout) + os.sep
    ):
        raise SystemExit('技能路径越出了仓库目录')
    if not os.path.isfile(f'{source}/SKILL.md'):
        found = []
        for directory, dirs, files in os.walk(source):
            if '.git' in dirs:
                dirs.remove('.git')
            if 'SKILL.md' in files:
                found.append(directory)
                dirs[:] = []
        if len(found) == 1:
            source = found[0]
            print(f'  自动定位到 {os.path.relpath(source, checkout)}')
        elif len(found) > 1:
            choices = '\n  '.join(os.path.relpath(item, checkout) for item in found[:20])
            raise SystemExit(f'这个路径下有多个技能，请指到具体一个：\n  {choices}')
        else:
            raise SystemExit(f'{source} 下找不到 SKILL.md')

    source_path = os.path.relpath(source, os.path.realpath(checkout))
    skill_name = args.name or os.path.basename(source.rstrip('/'))
    existing = skill_index()
    destination = f'{REPO}/skills/{category}/{skill_name}'
    source_registry = json.load(open(f'{REPO}/sources.json', encoding='utf-8'))
    prior = source_registry['skills'].get(skill_name)
    same_source = prior and prior.get('repo') == repo and prior.get('path') == source_path
    if skill_name in existing and not same_source:
        raise SystemExit(
            f'已经有同名技能 {skill_name}，在 {existing[skill_name].replace(REPO + "/", "")}\n'
            '来源不同；想换名用 --name'
        )
    if skill_name in existing:
        current_category = os.path.relpath(
            os.path.dirname(existing[skill_name]), f'{REPO}/skills'
        )
        if category != current_category:
            print(f'  已收录在 {current_category}，忽略本次分类 {category}')
            category = current_category
            destination = existing[skill_name]

    text = open(f'{source}/SKILL.md', encoding='utf-8', errors='ignore').read()
    frontmatter = re.match(r'^---\s*\n(.*?)\n---', text, re.S)
    if not frontmatter:
        print('  ⚠ SKILL.md 缺 frontmatter')
    description = ''
    if frontmatter:
        item = re.search(
            r'^description:\s*(.*?)(?=\n[a-zA-Z_-]+:|\Z)',
            frontmatter.group(1),
            re.S | re.M,
        )
        description = ' '.join(item.group(1).split()) if item else ''
        if not description:
            print('  ⚠ frontmatter 缺 description')

    if skill_name not in existing:
        source_root = os.path.realpath(source)
        for directory, dirs, files in os.walk(source):
            for item in dirs + files:
                candidate = os.path.join(directory, item)
                if not os.path.islink(candidate):
                    continue
                target = os.path.realpath(candidate)
                if target != source_root and not target.startswith(source_root + os.sep):
                    raise SystemExit(f'技能包含指向目录外的软链接：{candidate}')
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copytree(
            source,
            destination,
            symlinks=True,
            ignore=shutil.ignore_patterns('.git', '__pycache__', '*.pyc'),
        )
        attachments = sum(len(files) for _, _, files in os.walk(destination)) - 1
        print(
            f'✓ {skill_name}：{text.count(chr(10)) + 1} 行，'
            f'{attachments} 个附件 → skills/{category}/{skill_name}'
        )
    else:
        print(f'✓ {skill_name} 已收录，继续处理安装范围')
finally:
    shutil.rmtree(tmp, ignore_errors=True)

source_registry['skills'][skill_name] = {
    'type': 'github',
    'repo': repo,
    'branch': branch,
    'path': source_path,
    'category': category,
}
source_registry['skills'] = dict(sorted(source_registry['skills'].items()))
save_json(f'{REPO}/sources.json', source_registry, indent=1)
print('✓ 已登记到 sources.json')

if args.description_zh or args.trigger_zh:
    metadata = json.load(open(f'{REPO}/metadata.json', encoding='utf-8'))
    record = metadata['skills'].setdefault(skill_name, {})
    record['recommendation'] = args.recommendation
    record['description'] = args.description_zh or record.get('description') or description
    record['trigger'] = args.trigger_zh or record.get('trigger', '')
    metadata['skills'] = dict(sorted(metadata['skills'].items()))
    save_json(f'{REPO}/metadata.json', metadata)
    print('✓ 已写入 metadata.json')

if scope == 'global':
    active = [
        line.split('#', 1)[0].strip()
        for line in open(f'{REPO}/active.txt', encoding='utf-8')
        if line.split('#', 1)[0].strip()
    ]
    if skill_name not in active:
        active.append(skill_name)
        header = (
            '# 常驻技能名单。只有这里列出的技能才会链接到 '
            '~/.claude/skills 和 ~/.agents/skills。\n'
            '# 修改后运行 python3 scripts/link.py --prune。\n\n'
        )
        open(f'{REPO}/active.txt', 'w', encoding='utf-8').write(
            header + '\n'.join(active) + '\n'
        )

call_script('render.py')
if scope == 'global':
    call_script('link.py', '--quiet')
elif scope == 'project':
    project_dir = os.path.abspath(args.project_dir or os.getcwd())
    if not os.path.isdir(project_dir):
        raise SystemExit(f'项目目录不存在：{project_dir}')
    call_script('pull.py', skill_name, cwd=project_dir)
call_script('doctor.py')

if description:
    print(f'\n描述: {description[:160]}')
print(f'✓ 完成：{skill_name}，范围 {scope}')
