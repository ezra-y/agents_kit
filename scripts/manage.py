#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Manage skills already stored in agents_kit.

Use add.py to import an upstream skill. This script handles the repository
state around existing skills:

    python3 scripts/manage.py list [--active] [--category web] [--json]
    python3 scripts/manage.py activate <name>
    python3 scripts/manage.py deactivate <name>
    python3 scripts/manage.py remove <name> --yes
    python3 scripts/manage.py move <name> <category>
    python3 scripts/manage.py detach <name>
    python3 scripts/manage.py describe <name> [metadata options]
    python3 scripts/manage.py refresh [--link] [--prune]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS_DIR = os.path.join(REPO, 'skills')
ACTIVE_PATH = os.path.join(REPO, 'active.txt')
SOURCES_PATH = os.path.join(REPO, 'sources.json')
METADATA_PATH = os.path.join(REPO, 'metadata.json')
CATEGORIES = ('apple', 'web', 'design', 'lark', 'method', 'agent', 'tools', 'backend')
DESTS = (
    os.path.expanduser('~/.claude/skills'),
    os.path.expanduser('~/.agents/skills'),
)


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save_json(path, data):
    tmp = f'{path}.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
    os.replace(tmp, path)


def skill_index():
    found = {}
    for directory, dirs, files in os.walk(SKILLS_DIR):
        if 'SKILL.md' not in files:
            continue
        dirs[:] = []
        name = os.path.basename(directory)
        if name in found:
            raise SystemExit(f'技能重名：{name}\n  {found[name]}\n  {directory}')
        found[name] = directory
    return found


def read_active():
    names = []
    with open(ACTIVE_PATH, encoding='utf-8') as f:
        for line in f:
            name = line.split('#', 1)[0].strip()
            if name and name not in names:
                names.append(name)
    return names


def write_active(names):
    text = (
        '# 常驻技能名单。只有这里列出的技能才会链接到 '
        '~/.claude/skills 和 ~/.agents/skills。\n'
        '# 修改后运行 python3 scripts/link.py --prune。\n\n'
        + '\n'.join(names)
        + '\n'
    )
    tmp = f'{ACTIVE_PATH}.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(text)
    os.replace(tmp, ACTIVE_PATH)


def run_script(name, *args, cwd=None):
    command = [sys.executable, os.path.join(REPO, 'scripts', name), *args]
    result = subprocess.run(command, cwd=cwd or REPO)
    if result.returncode:
        raise SystemExit(result.returncode)


def finish(*, link=False, prune=False):
    run_script('render.py')
    if link or prune:
        args = ('--quiet', '--prune') if prune else ('--quiet',)
        run_script('link.py', *args)
    run_script('doctor.py')


def require_skill(name):
    path = skill_index().get(name)
    if not path:
        raise SystemExit(f'找不到技能：{name}')
    return path


def command_list(args):
    active = set(read_active())
    rows = []
    for name, path in skill_index().items():
        category = os.path.relpath(os.path.dirname(path), SKILLS_DIR)
        if args.active and name not in active:
            continue
        if args.category and category != args.category:
            continue
        rows.append({'name': name, 'category': category, 'active': name in active})
    rows.sort(key=lambda row: (row['category'], row['name']))
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return
    for row in rows:
        marker = '*' if row['active'] else ' '
        print(f"{marker} {row['category']:<8} {row['name']}")
    print(f'\n共 {len(rows)} 个；* = 常驻')


def command_activate(args):
    require_skill(args.name)
    active = read_active()
    if args.name not in active:
        active.append(args.name)
        write_active(active)
    finish(link=True)


def command_deactivate(args):
    require_skill(args.name)
    active = [name for name in read_active() if name != args.name]
    write_active(active)
    finish(prune=True)


def command_remove(args):
    path = require_skill(args.name)
    if not args.yes:
        answer = input(f'彻底删除 {args.name}？这会移除技能、登记和全局链接。[y/N] ')
        if answer.strip().lower() != 'y':
            raise SystemExit('取消')

    managed_root = os.path.realpath(SKILLS_DIR)
    source_path = os.path.realpath(path)
    for dest in DESTS:
        link = os.path.join(dest, args.name)
        if os.path.islink(link):
            target = os.path.realpath(link)
            if target == source_path or target.startswith(managed_root + os.sep):
                os.unlink(link)

    shutil.rmtree(path)
    write_active([name for name in read_active() if name != args.name])

    sources = load_json(SOURCES_PATH)
    sources.get('skills', {}).pop(args.name, None)
    save_json(SOURCES_PATH, sources)

    metadata = load_json(METADATA_PATH)
    metadata.get('skills', {}).pop(args.name, None)
    save_json(METADATA_PATH, metadata)

    finish(prune=True)


def command_move(args):
    path = require_skill(args.name)
    destination = os.path.join(SKILLS_DIR, args.category, args.name)
    if os.path.realpath(path) == os.path.realpath(destination):
        print(f'{args.name} 已在 {args.category}')
        finish()
        return
    if os.path.exists(destination):
        raise SystemExit(f'目标已存在：{destination}')
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    shutil.move(path, destination)

    sources = load_json(SOURCES_PATH)
    if args.name in sources.get('skills', {}):
        sources['skills'][args.name]['category'] = args.category
        save_json(SOURCES_PATH, sources)
    finish(link=True)


def command_detach(args):
    require_skill(args.name)
    sources = load_json(SOURCES_PATH)
    if sources.get('skills', {}).pop(args.name, None) is None:
        print(f'{args.name} 本来就没有上游登记')
    else:
        save_json(SOURCES_PATH, sources)
    finish()


def command_describe(args):
    require_skill(args.name)
    if args.description is None and args.trigger is None and args.recommendation is None:
        raise SystemExit('至少提供一个说明字段')
    metadata = load_json(METADATA_PATH)
    record = metadata.setdefault('skills', {}).setdefault(args.name, {})
    if args.description is not None:
        record['description'] = args.description
    if args.trigger is not None:
        record['trigger'] = args.trigger
    if args.recommendation is not None:
        record['recommendation'] = args.recommendation
    metadata['skills'] = dict(sorted(metadata['skills'].items()))
    save_json(METADATA_PATH, metadata)
    finish()


def command_refresh(args):
    finish(link=args.link, prune=args.prune)


def parser():
    root = argparse.ArgumentParser(description='管理 agents_kit 中已有的技能')
    commands = root.add_subparsers(dest='command', required=True)

    p = commands.add_parser('list', help='列出技能')
    p.add_argument('--active', action='store_true')
    p.add_argument('--category', choices=CATEGORIES)
    p.add_argument('--json', action='store_true')
    p.set_defaults(func=command_list)

    p = commands.add_parser('activate', help='设为常驻并建立全局软链')
    p.add_argument('name')
    p.set_defaults(func=command_activate)

    p = commands.add_parser('deactivate', help='取消常驻并移除全局软链')
    p.add_argument('name')
    p.set_defaults(func=command_deactivate)

    p = commands.add_parser('remove', help='彻底删除技能及其登记')
    p.add_argument('name')
    p.add_argument('--yes', action='store_true')
    p.set_defaults(func=command_remove)

    p = commands.add_parser('move', help='移动技能到另一个一级分类')
    p.add_argument('name')
    p.add_argument('category', choices=CATEGORIES)
    p.set_defaults(func=command_move)

    p = commands.add_parser('detach', help='停止跟踪上游，改为本地维护')
    p.add_argument('name')
    p.set_defaults(func=command_detach)

    p = commands.add_parser('describe', help='更新中文说明、触发方式或推荐指数')
    p.add_argument('name')
    p.add_argument('--description')
    p.add_argument('--trigger')
    p.add_argument('--recommendation', type=int, choices=range(1, 6))
    p.set_defaults(func=command_describe)

    p = commands.add_parser('refresh', help='重建文档并体检')
    p.add_argument('--link', action='store_true')
    p.add_argument('--prune', action='store_true')
    p.set_defaults(func=command_refresh)
    return root


if __name__ == '__main__':
    args = parser().parse_args()
    args.func(args)
