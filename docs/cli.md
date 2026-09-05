# agents-kit 命令参考

本文件由 `agents-kit docs build` 生成。

```text
usage: agents-kit [-h] {status,sync,migrate,source,skill,plugin,marketplace,mcp,global,project,docs,ui,check} ...

统一管理 agents_kit 中的技能、来源、安装和生成文档

positional arguments:
  {status,sync,migrate,source,skill,plugin,marketplace,mcp,global,project,docs,ui,check}
    status              查看仓库摘要
    sync                获取远端、同步安装并核验真实加载；有未提交修改时跳过
    migrate             迁移旧状态到当前 Schema
    source              检查和更新技能来源
    skill               管理中央技能库
    plugin              管理完整 Plugin 包
    marketplace         生成和检查平台 Marketplace 索引
    mcp                 管理中央 MCP 清单和客户端配置
    global              管理全局技能链接
    project             向项目复制技能
    docs                构建和检查生成文档
    ui                  打开本地可视化技能清册
    check               执行完整只读体检

options:
  -h, --help            show this help message and exit

$ agents-kit status --help
usage: agents-kit status [-h] [--json]

options:
  -h, --help  show this help message and exit
  --json

$ agents-kit sync --help
usage: agents-kit sync [-h] [--json]

options:
  -h, --help  show this help message and exit
  --json

$ agents-kit migrate --help
usage: agents-kit migrate [-h] [--dry-run] [--json]

options:
  -h, --help  show this help message and exit
  --dry-run
  --json

$ agents-kit source --help
usage: agents-kit source [-h] {providers,inspect,detach,check,update,report} ...

positional arguments:
  {providers,inspect,detach,check,update,report}
    providers           列出来源适配器
    inspect             检查来源；--save 把技能索引存入收藏（scout.json）
    detach              停止跟踪技能来源
    check               检查来源变化
    update              获取并应用经过确认的来源更新
    report              把来源检查 JSON 渲染为人工审核 Markdown

options:
  -h, --help            show this help message and exit

$ agents-kit source providers --help
usage: agents-kit source providers [-h] [--json]

options:
  -h, --help  show this help message and exit
  --json

$ agents-kit source inspect --help
usage: agents-kit source inspect [-h] [--provider PROVIDER] [--ref REF] [--source-path SOURCE_PATH] [--save] [--name NAME] [--note NOTE] [--refresh-index] [--json] [source]

positional arguments:
  source

options:
  -h, --help            show this help message and exit
  --provider PROVIDER
  --ref REF
  --source-path SOURCE_PATH
  --save
  --name NAME           --save 时的索引名，默认从来源推导
  --note NOTE           --save 时的备注
  --refresh-index       重扫 scout.json 里已保存的全部来源
  --json

$ agents-kit source detach --help
usage: agents-kit source detach [-h] [--dry-run] [--json] name

positional arguments:
  name

options:
  -h, --help  show this help message and exit
  --dry-run
  --json

$ agents-kit source check --help
usage: agents-kit source check [-h] [--all] [--json] [name]

positional arguments:
  name

options:
  -h, --help  show this help message and exit
  --all
  --json

$ agents-kit source update --help
usage: agents-kit source update [-h] [--all] [--dry-run] [--safe] [--auto-docs] [--yes] [--repo-only] [--json] [name]

positional arguments:
  name

options:
  -h, --help   show this help message and exit
  --all
  --dry-run
  --safe       兼容别名；等同 --auto-docs
  --auto-docs  只自动应用无本地冲突的 License/Changelog 变化
  --yes
  --repo-only  只更新仓库，不修改本机安装；用于云端检查
  --json

$ agents-kit source report --help
usage: agents-kit source report [-h] [--run-url RUN_URL] report

positional arguments:
  report

options:
  -h, --help         show this help message and exit
  --run-url RUN_URL

$ agents-kit skill --help
usage: agents-kit skill [-h] {import,list,show,open,metadata,rename,move,remove} ...

positional arguments:
  {import,list,show,open,metadata,rename,move,remove}
    import              从来源导入并按 scope 安装技能
    list                列出技能
    show                查看单个技能
    open                在 Finder 中打开技能目录
    metadata            修改本地清册信息
    rename              重命名本地技能 ID
    move                移动技能分类
    remove              删除技能及全部登记

options:
  -h, --help            show this help message and exit

$ agents-kit skill import --help
usage: agents-kit skill import [-h] --category CATEGORY --scope {library,global,project} [--name NAME] --description DESCRIPTION [--trigger TRIGGER] --tag TAG [--recommendation {1,2,3,4,5}] [--project PROJECT] [--replace] [--dry-run] [--yes] [--provider PROVIDER] [--ref REF] [--source-path SOURCE_PATH] [--candidate CANDIDATE] [--json] source

positional arguments:
  source

options:
  -h, --help            show this help message and exit
  --category CATEGORY
  --scope {library,global,project}
  --name NAME
  --description DESCRIPTION
  --trigger TRIGGER
  --tag TAG
  --recommendation {1,2,3,4,5}
  --project PROJECT
  --replace
  --dry-run
  --yes
  --provider PROVIDER
  --ref REF
  --source-path SOURCE_PATH
  --candidate CANDIDATE
  --json

$ agents-kit skill list --help
usage: agents-kit skill list [-h] [--active] [--category CATEGORY] [--tag TAG] [--tracked] [--json]

options:
  -h, --help           show this help message and exit
  --active
  --category CATEGORY
  --tag TAG
  --tracked
  --json

$ agents-kit skill show --help
usage: agents-kit skill show [-h] [--json] name

positional arguments:
  name

options:
  -h, --help  show this help message and exit
  --json

$ agents-kit skill open --help
usage: agents-kit skill open [-h] [--dry-run] [--json] name

positional arguments:
  name

options:
  -h, --help  show this help message and exit
  --dry-run
  --json

$ agents-kit skill metadata --help
usage: agents-kit skill metadata [-h] {set} ...

positional arguments:
  {set}
    set       设置 metadata

options:
  -h, --help  show this help message and exit

$ agents-kit skill metadata set --help
usage: agents-kit skill metadata set [-h] [--description DESCRIPTION] [--trigger TRIGGER] [--recommendation {1,2,3,4,5}] [--dependency DEPENDENCY] [--clear-dependencies] [--tag TAG] [--clear-tags] [--dry-run] [--json] name

positional arguments:
  name

options:
  -h, --help            show this help message and exit
  --description DESCRIPTION
  --trigger TRIGGER
  --recommendation {1,2,3,4,5}
  --dependency DEPENDENCY
  --clear-dependencies
  --tag TAG
  --clear-tags
  --dry-run
  --json

$ agents-kit skill rename --help
usage: agents-kit skill rename [-h] [--dry-run] [--json] old_name new_name

positional arguments:
  old_name
  new_name

options:
  -h, --help  show this help message and exit
  --dry-run
  --json

$ agents-kit skill move --help
usage: agents-kit skill move [-h] [--dry-run] [--json] name category

positional arguments:
  name
  category

options:
  -h, --help  show this help message and exit
  --dry-run
  --json

$ agents-kit skill remove --help
usage: agents-kit skill remove [-h] [--dry-run] [--yes] [--json] name

positional arguments:
  name

options:
  -h, --help  show this help message and exit
  --dry-run
  --yes
  --json

$ agents-kit plugin --help
usage: agents-kit plugin [-h] {inspect,import,list,show,open,enable,disable,update,detach,remove} ...

positional arguments:
  {inspect,import,list,show,open,enable,disable,update,detach,remove}
    inspect             检查 Plugin 来源
    import              导入完整 Plugin 并迁移同内容独立 Skill
    list                列出 Plugin
    show                查看 Plugin
    open                在 Finder 中打开 Plugin
    enable              加入期望安装清单
    disable             移出期望安装清单
    update              检查或更新 Plugin
    detach              停止跟踪 Plugin 来源
    remove              删除完整 Plugin

options:
  -h, --help            show this help message and exit

$ agents-kit plugin inspect --help
usage: agents-kit plugin inspect [-h] [--candidate CANDIDATE] [--provider PROVIDER] [--ref REF] [--source-path SOURCE_PATH] [--json] source

positional arguments:
  source

options:
  -h, --help            show this help message and exit
  --candidate CANDIDATE
  --provider PROVIDER
  --ref REF
  --source-path SOURCE_PATH
  --json

$ agents-kit plugin import --help
usage: agents-kit plugin import [-h] [--candidate CANDIDATE] --category CATEGORY [--target {claude,codex}] --tag TAG [--replace] [--dry-run] [--yes] [--provider PROVIDER] [--ref REF] [--source-path SOURCE_PATH] [--json] source

positional arguments:
  source

options:
  -h, --help            show this help message and exit
  --candidate CANDIDATE
  --category CATEGORY
  --target {claude,codex}
  --tag TAG
  --replace
  --dry-run
  --yes
  --provider PROVIDER
  --ref REF
  --source-path SOURCE_PATH
  --json

$ agents-kit plugin list --help
usage: agents-kit plugin list [-h] [--json]

options:
  -h, --help  show this help message and exit
  --json

$ agents-kit plugin show --help
usage: agents-kit plugin show [-h] [--json] name

positional arguments:
  name

options:
  -h, --help  show this help message and exit
  --json

$ agents-kit plugin open --help
usage: agents-kit plugin open [-h] [--dry-run] [--json] name

positional arguments:
  name

options:
  -h, --help  show this help message and exit
  --dry-run
  --json

$ agents-kit plugin enable --help
usage: agents-kit plugin enable [-h] --target {claude,codex} [--distribution {skills-dir,marketplace}] [--dry-run] [--json] name

positional arguments:
  name

options:
  -h, --help            show this help message and exit
  --target {claude,codex}
  --distribution {skills-dir,marketplace}
  --dry-run
  --json

$ agents-kit plugin disable --help
usage: agents-kit plugin disable [-h] --target {claude,codex} [--distribution {skills-dir,marketplace}] [--dry-run] [--json] name

positional arguments:
  name

options:
  -h, --help            show this help message and exit
  --target {claude,codex}
  --distribution {skills-dir,marketplace}
  --dry-run
  --json

$ agents-kit plugin update --help
usage: agents-kit plugin update [-h] [--all] [--auto-docs] [--dry-run] [--yes] [--repo-only] [--json] [name]

positional arguments:
  name

options:
  -h, --help   show this help message and exit
  --all
  --auto-docs
  --dry-run
  --yes
  --repo-only  只更新仓库，不修改本机安装；用于云端检查
  --json

$ agents-kit plugin detach --help
usage: agents-kit plugin detach [-h] [--dry-run] [--json] name

positional arguments:
  name

options:
  -h, --help  show this help message and exit
  --dry-run
  --json

$ agents-kit plugin remove --help
usage: agents-kit plugin remove [-h] [--dry-run] [--yes] [--json] name

positional arguments:
  name

options:
  -h, --help  show this help message and exit
  --dry-run
  --yes
  --json

$ agents-kit marketplace --help
usage: agents-kit marketplace [-h] {build,check,status} ...

positional arguments:
  {build,check,status}
    build               生成 Marketplace 索引
    check               检查 Marketplace 索引
    status              查看 Marketplace 状态

options:
  -h, --help            show this help message and exit

$ agents-kit marketplace build --help
usage: agents-kit marketplace build [-h] [--json]

options:
  -h, --help  show this help message and exit
  --json

$ agents-kit marketplace check --help
usage: agents-kit marketplace check [-h] [--json]

options:
  -h, --help  show this help message and exit
  --json

$ agents-kit marketplace status --help
usage: agents-kit marketplace status [-h] [--json]

options:
  -h, --help  show this help message and exit
  --json

$ agents-kit mcp --help
usage: agents-kit mcp [-h] {import,list,show,enable,disable,apply,update,remove,run} ...

positional arguments:
  {import,list,show,enable,disable,apply,update,remove,run}
    import              收录 MCP 并按 scope 写入客户端
    list                列出 MCP
    show                查看单个 MCP
    enable              启用并同步 MCP
    disable             停用并移除客户端配置
    apply               收敛 MCP 客户端配置
    update              检查并应用 MCP 上游版本
    remove              删除 MCP 及受管客户端配置
    run                 ==SUPPRESS==

options:
  -h, --help            show this help message and exit

$ agents-kit mcp import --help
usage: agents-kit mcp import [-h] --name NAME --description DESCRIPTION [--tag TAG] [--recommendation {1,2,3,4,5}] --distribution {brew,npm,pypi,remote} [--package PACKAGE] [--version VERSION] --command COMMAND [--arg ARG] [--secret-env SECRET_ENV] [--secret-command NAME=COMMAND] [--target {claude,codex}] --scope {library,global} [--replace] [--dry-run] [--yes] [--json] source

positional arguments:
  source

options:
  -h, --help            show this help message and exit
  --name NAME
  --description DESCRIPTION
  --tag TAG
  --recommendation {1,2,3,4,5}
  --distribution {brew,npm,pypi,remote}
  --package PACKAGE
  --version VERSION
  --command COMMAND
  --arg ARG
  --secret-env SECRET_ENV
  --secret-command NAME=COMMAND
  --target {claude,codex}
  --scope {library,global}
  --replace
  --dry-run
  --yes
  --json

$ agents-kit mcp list --help
usage: agents-kit mcp list [-h] [--enabled] [--json]

options:
  -h, --help  show this help message and exit
  --enabled
  --json

$ agents-kit mcp show --help
usage: agents-kit mcp show [-h] [--json] name

positional arguments:
  name

options:
  -h, --help  show this help message and exit
  --json

$ agents-kit mcp enable --help
usage: agents-kit mcp enable [-h] [--target {claude,codex}] [--dry-run] [--json] name

positional arguments:
  name

options:
  -h, --help            show this help message and exit
  --target {claude,codex}
  --dry-run
  --json

$ agents-kit mcp disable --help
usage: agents-kit mcp disable [-h] [--target {claude,codex}] [--dry-run] [--json] name

positional arguments:
  name

options:
  -h, --help            show this help message and exit
  --target {claude,codex}
  --dry-run
  --json

$ agents-kit mcp apply --help
usage: agents-kit mcp apply [-h] [--all] [--replace] [--dry-run] [--yes] [--json] [name]

positional arguments:
  name

options:
  -h, --help  show this help message and exit
  --all
  --replace
  --dry-run
  --yes
  --json

$ agents-kit mcp update --help
usage: agents-kit mcp update [-h] [--all] [--dry-run] [--yes] [--json] [name]

positional arguments:
  name

options:
  -h, --help  show this help message and exit
  --all
  --dry-run
  --yes
  --json

$ agents-kit mcp remove --help
usage: agents-kit mcp remove [-h] [--dry-run] [--yes] [--json] name

positional arguments:
  name

options:
  -h, --help  show this help message and exit
  --dry-run
  --yes
  --json

$ agents-kit mcp run --help
usage: agents-kit mcp run [-h] name

positional arguments:
  name

options:
  -h, --help  show this help message and exit

$ agents-kit global --help
usage: agents-kit global [-h] {enable,disable,apply} ...

positional arguments:
  {enable,disable,apply}
    enable              启用全局技能
    disable             停用全局技能
    apply               收敛全部全局链接

options:
  -h, --help            show this help message and exit

$ agents-kit global enable --help
usage: agents-kit global enable [-h] [--target {claude,codex}] [--dry-run] [--json] name

positional arguments:
  name

options:
  -h, --help            show this help message and exit
  --target {claude,codex}
  --dry-run
  --json

$ agents-kit global disable --help
usage: agents-kit global disable [-h] [--target {claude,codex}] [--dry-run] [--json] name

positional arguments:
  name

options:
  -h, --help            show this help message and exit
  --target {claude,codex}
  --dry-run
  --json

$ agents-kit global apply --help
usage: agents-kit global apply [-h] [--target {claude,codex}] [--dry-run] [--json]

options:
  -h, --help            show this help message and exit
  --target {claude,codex}
  --dry-run
  --json

$ agents-kit project --help
usage: agents-kit project [-h] {install} ...

positional arguments:
  {install}
    install   安装技能或分类到项目

options:
  -h, --help  show this help message and exit

$ agents-kit project install --help
usage: agents-kit project install [-h] --project PROJECT [--replace] [--dry-run] [--yes] [--json] target

positional arguments:
  target

options:
  -h, --help         show this help message and exit
  --project PROJECT
  --replace
  --dry-run
  --yes
  --json

$ agents-kit docs --help
usage: agents-kit docs [-h] {build,check} ...

positional arguments:
  {build,check}
    build        更新全部生成内容
    check        检查 tracked 文档是否过期

options:
  -h, --help     show this help message and exit

$ agents-kit docs build --help
usage: agents-kit docs build [-h] [--json]

options:
  -h, --help  show this help message and exit
  --json

$ agents-kit docs check --help
usage: agents-kit docs check [-h] [--json]

options:
  -h, --help  show this help message and exit
  --json

$ agents-kit ui --help
usage: agents-kit ui [-h] [--port PORT] [--no-open]

options:
  -h, --help   show this help message and exit
  --port PORT
  --no-open

$ agents-kit check --help
usage: agents-kit check [-h] [--repo-only] [--runtime] [--json]

options:
  -h, --help   show this help message and exit
  --repo-only
  --runtime    核验 Claude/Codex 实际插件加载，不调用模型
  --json
```
