#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""重新生成文档。加了/删了/改了技能之后跑一下。

    python3 scripts/render.py

读什么：
    skills/**/SKILL.md      技能本体（正文会内嵌进 index.html）
    sources.json            上游来源
    active.txt              常驻名单
    scripts/descriptions.py 中文说明（没写的技能退回用 SKILL.md 的英文 description）
    docs/usage.json         使用次数快照（从会话记录统计出来的，静态文件）

写什么：
    docs/skills.md          markdown 清单，方便在 GitHub 上直接翻
    docs/index.html         完整清册，可搜索/筛选/展开全文
"""
import json, os, re, sys, html, math
from collections import defaultdict, Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'scripts'))
try:
    from descriptions import D as DESC
except Exception:
    DESC = {}

STARS = {  # 上游仓库的 star 数，用来画「火热程度」条
    'mattpocock/skills': 187775, 'anthropics/claude-code': 139035,
    'anthropics/skills': 164079, 'nextlevelbuilder/ui-ux-pro-max-skill': 109991,
    'anthropics/claude-plugins-official': 32634, 'vercel-labs/agent-skills': 29466,
    'zarazhangrui/frontend-slides': 26322, 'greensock/gsap-skills': 12357,
    'twostraws/SwiftUI-Agent-Skill': 4363, 'rohitg00/awesome-claude-code-toolkit': 2378,
    'mrgoonie/claudekit-skills': 2184, 'conorluddy/ios-simulator-skill': 1176,
    'twostraws/Swift-Concurrency-Agent-Skill': 495,
    'twostraws/Swift-Testing-Agent-Skill': 396,
    'Prisma-Labs-Dev/apple-skills': 290, 'senlindesign/claude2figma': 179,
}
RECLABEL = {5: '必留', 4: '值得留', 3: '看情况', 2: '可砍', 1: '建议删'}

# ── 1. 扫仓库 ─────────────────────────────────────────────
skills = {}
for dp, dirs, files in os.walk(f'{REPO}/skills'):
    if 'SKILL.md' not in files: continue
    dirs[:] = []                       # 找到技能就不往下钻，内部文件都算它的附件
    name = os.path.basename(dp)
    cat = os.path.relpath(os.path.dirname(dp), f'{REPO}/skills')
    raw = open(f'{dp}/SKILL.md', encoding='utf-8', errors='ignore').read()
    m = re.match(r'^---\s*\n(.*?)\n---\s*\n?(.*)', raw, re.S)
    fm, bodytext = (m.group(1), m.group(2)) if m else ('', raw)
    dm = re.search(r'^description:\s*(.*?)(?=\n[a-zA-Z_-]+:|\Z)', fm, re.S | re.M)
    endesc = ' '.join(dm.group(1).strip().strip('"\'').split()) if dm else ''
    attach = []
    for d2, _, fs in os.walk(dp):
        for f in fs:
            if f != 'SKILL.md': attach.append(os.path.relpath(os.path.join(d2, f), dp))
    skills[name] = dict(name=name, cat=cat, path=dp, abspath=dp,
                        lines=bodytext.count('\n') + 1, nfiles=len(attach),
                        files=sorted(attach), body=bodytext.strip(),
                        endesc=endesc, manual='disable-model-invocation' in fm)

src = json.load(open(f'{REPO}/sources.json', encoding='utf-8'))['skills']
active = [l.split('#')[0].strip() for l in open(f'{REPO}/active.txt', encoding='utf-8')
          if l.split('#')[0].strip()]
usage = {}
up = f'{REPO}/docs/usage.json'
if os.path.exists(up): usage = json.load(open(up, encoding='utf-8'))

# ── 2. 拼每条记录 ─────────────────────────────────────────
rows = []
for n, s in sorted(skills.items()):
    d = DESC.get(n)
    desc = d[2] if d else (s['endesc'] or '（未写中文说明，见 SKILL.md）')
    how = d[3] if d else ''
    rec = d[1] if d else 3
    up_ = src.get(n)
    if up_ and up_['type'] == 'github':
        repo = up_['repo']
        url = f"https://github.com/{repo}/tree/{up_['branch']}/{up_['path']}"
        stars = STARS.get(repo)
    elif up_:
        repo, url, stars = 'open.feishu.cn 官方', up_['url'], None
    else:
        repo = url = stars = None
    u = usage.get(n, {})
    rel = os.path.relpath(s['abspath'], REPO)      # 相对仓库根，克隆到哪都能用
    rows.append(dict(name=n, cat=s['cat'], desc=desc, how=how, rec=rec, rel=rel,
                     lines=s['lines'], nfiles=s['nfiles'], files=s['files'],
                     body=s['body'], manual=s['manual'],
                     active=n in active, repo=repo, url=url, stars=stars,
                     un=u.get('n', 0), us=u.get('s', 0), ul=u.get('last'),
                     ucx=u.get('cx', 0), ucc=u.get('cc', 0)))

maxstar = max((r['stars'] or 0) for r in rows) or 1
for r in rows:
    r['heat'] = 0 if not r['stars'] else round(math.log10(r['stars']) / math.log10(maxstar) * 100)

bycat = defaultdict(list)
for r in rows: bycat[r['cat']].append(r)
N, NACT = len(rows), sum(1 for r in rows if r['active'])
NUSED = sum(1 for r in rows if r['un'] > 0)

# ── 3. docs/skills.md ─────────────────────────────────────
L = [f'# 技能清单', '',
     f'共 **{N}** 个 · 常驻 **{NACT}** 个 · 有上游可自动同步 **{len(src)}** 个', '',
     '想看每个技能的详细说明和触发方式，开 [index.html](index.html)。', '',
     '`●` = 常驻（已链到 `~/.claude/skills`）', '']
for c in sorted(bycat):
    L += [f'## {c}（{len(bycat[c])} 个）', '',
          '| 技能 | 说明 | 常驻 | 用量 | 上游 |', '|---|---|:--:|---|---|']
    for r in sorted(bycat[c], key=lambda x: (-x['un'], x['name'])):
        d = r['desc'][:70].replace('|', '\\|').replace('**', '')
        use = f"{r['un']} 次" if r['un'] else ''
        up_ = f"[{r['repo']}]({r['url']})" if r['url'] and r['repo'] != 'open.feishu.cn 官方' \
              else ('飞书官方' if r['url'] else '—')
        L.append(f"| `{r['name']}` | {d} | {'●' if r['active'] else ''} | {use} | {up_} |")
    L.append('')
open(f'{REPO}/docs/skills.md', 'w', encoding='utf-8').write('\n'.join(L) + '\n')
print(f'✓ docs/skills.md  （{N} 个技能，{len(bycat)} 个分类）')

# ── 4. docs/index.html ────────────────────────────────────
def esc(s): return html.escape(str(s), quote=True)
data = json.dumps(rows, ensure_ascii=False)
# 技能正文里可能含 </script> 或 <!--，会提前终止内联脚本块，用 JSON 合法转义中和
data = data.replace('</', r'<\/').replace('<!--', '<\\u0021--')

CSS = """
:root{--paper:#F3F4F0;--paper-2:#EAECE6;--ink:#1A1D19;--ink-2:#4A4F49;--ink-3:#767C74;
--rule:#CFD3C9;--rule-2:#DDE0D8;--red:#9E2B25;--blue:#2F4B6E;--green:#3F6B4A;--amber:#8A6410}
@media(prefers-color-scheme:dark){:root{--paper:#15171A;--paper-2:#1D2024;--ink:#E4E3DA;
--ink-2:#A8ABA3;--ink-3:#787C76;--rule:#2C3035;--rule-2:#23262A;--red:#D9736A;
--blue:#89A9CC;--green:#82AC8D;--amber:#C9A24E}}
:root[data-theme=dark]{--paper:#15171A;--paper-2:#1D2024;--ink:#E4E3DA;--ink-2:#A8ABA3;
--ink-3:#787C76;--rule:#2C3035;--rule-2:#23262A;--red:#D9736A;--blue:#89A9CC;--green:#82AC8D;--amber:#C9A24E}
:root[data-theme=light]{--paper:#F3F4F0;--paper-2:#EAECE6;--ink:#1A1D19;--ink-2:#4A4F49;
--ink-3:#767C74;--rule:#CFD3C9;--rule-2:#DDE0D8;--red:#9E2B25;--blue:#2F4B6E;--green:#3F6B4A;--amber:#8A6410}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-size:16px;line-height:1.62;
font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:none;padding:0 28px 80px}
header{border-bottom:2px solid var(--ink);padding:40px 0 18px}
h1{font-family:Georgia,"Songti SC",serif;font-size:clamp(28px,4vw,42px);margin:0 0 12px;font-weight:600;text-wrap:balance}
.lede{max-width:70ch;color:var(--ink-2);font-size:16.5px;line-height:1.7;margin:0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));border-bottom:1px solid var(--rule)}
.stat{padding:16px 16px 14px;border-right:1px solid var(--rule-2)}
.stat:last-child{border-right:0}
.stat .n{font-family:ui-monospace,Menlo,monospace;font-size:25px;font-weight:600;display:block;margin-bottom:5px;font-variant-numeric:tabular-nums}
.stat .l{font-size:13px;color:var(--ink-3)}
.stat.g .n{color:var(--green)}.stat.r .n{color:var(--red)}
.controls{position:sticky;top:0;z-index:20;background:var(--paper);border-bottom:2px solid var(--ink);padding:14px 0 12px;display:flex;flex-direction:column;gap:10px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
#q{flex:1;min-width:200px;padding:10px 13px;font-size:15px;background:var(--paper-2);color:var(--ink);border:1px solid var(--rule);border-radius:2px;font-family:inherit}
#q:focus{outline:2px solid var(--red);outline-offset:1px}
.chip,.sbtn{font-family:inherit;font-size:13.5px;padding:7px 12px;cursor:pointer;background:transparent;color:var(--ink-2);border:1px solid var(--rule);border-radius:2px;white-space:nowrap}
.chip:hover,.sbtn:hover{border-color:var(--ink-3);color:var(--ink)}
.chip[aria-pressed=true],.sbtn.on{background:var(--ink);color:var(--paper);border-color:var(--ink);font-weight:600}
.chip .c{font-family:ui-monospace,Menlo,monospace;font-size:11px;opacity:.55;margin-left:5px}
.sl{font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-3)}
.sbtn.on::after{content:" ▼";font-size:8px}.sbtn.on[data-dir=asc]::after{content:" ▲"}
.count{margin-left:auto;font-size:12.5px;color:var(--ink-3);font-family:ui-monospace,Menlo,monospace}
table{width:100%;border-collapse:collapse}
tbody tr{border-bottom:1px solid var(--rule-2)}
tbody tr:hover{background:var(--paper-2)}
td.c-name{width:270px;min-width:240px;vertical-align:top;padding:16px 20px 16px 15px;position:relative}
td.c-name::before{content:"";position:absolute;left:0;top:16px;bottom:16px;width:3px;background:var(--rule)}
tr[data-rec="5"] td.c-name::before{background:var(--green)}
tr[data-rec="4"] td.c-name::before{background:var(--green);opacity:.5}
tr[data-rec="2"] td.c-name::before{background:var(--amber);opacity:.55}
tr[data-rec="1"] td.c-name::before{background:var(--red)}
.sname{font-family:ui-monospace,Menlo,monospace;font-size:15px;font-weight:600;color:var(--ink);background:none;border:0;padding:0;cursor:pointer;text-align:left;border-bottom:1px dashed var(--rule)}
.sname:hover{color:var(--red);border-bottom-color:var(--red)}
.caret{font-size:9px;opacity:.5;margin-right:5px}
.badge{display:inline-block;font-size:10px;padding:1px 5px;border:1px solid var(--rule);color:var(--ink-3);margin-left:5px;border-radius:2px}
.badge.on{color:var(--green);border-color:var(--green)}
.meta{font-size:12px;color:var(--ink-3);margin-top:6px;line-height:1.6;font-family:ui-monospace,Menlo,monospace}
.meta a{color:var(--blue);text-decoration:none}.meta a:hover{text-decoration:underline}
td.c-desc{vertical-align:top;padding:16px 26px 16px 0}
td.c-desc .d{margin:0;font-size:15.5px;line-height:1.72;color:var(--ink)}
td.c-desc strong{font-weight:650}
td.c-desc code{font-family:ui-monospace,Menlo,monospace;font-size:13px;background:var(--paper-2);padding:1px 5px;border-radius:2px}
td.c-desc .how{margin:10px 0 0;font-size:14px;line-height:1.68;color:var(--ink-2);padding-left:12px;border-left:2px solid var(--rule)}
.hk{display:inline-block;font-size:10.5px;letter-spacing:.12em;color:var(--ink-3);border:1px solid var(--rule);border-radius:2px;padding:1px 5px;margin-right:8px}
td.c-side{width:300px;min-width:270px;vertical-align:top;padding:16px 0 16px 20px;border-left:1px solid var(--rule-2)}
.s-row{display:flex;gap:10px;align-items:baseline;margin-bottom:6px;font-size:12.5px}
.sk{font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-3);white-space:nowrap;flex:none;width:30px}
.sv{color:var(--ink-2);min-width:0;word-break:break-word}
.sv a{color:var(--blue);text-decoration:none}.sv a:hover{text-decoration:underline}
.rec .on{color:var(--red)}.rec .off{color:var(--rule)}
.bar{display:inline-block;vertical-align:middle;width:56px;height:3px;background:var(--rule-2);margin-left:7px;position:relative}
.bar i{position:absolute;inset:0 auto 0 0;background:var(--blue)}
.dim{color:var(--ink-3)}
tr.detail>td{padding:0;background:var(--paper-2);border-bottom:1px solid var(--rule)}
.dwrap{padding:20px 22px 24px;display:flex;flex-direction:column;gap:16px}
.dbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.btn{font-family:inherit;font-size:12px;padding:5px 11px;cursor:pointer;background:var(--paper);color:var(--ink-2);border:1px solid var(--rule);border-radius:2px;text-decoration:none}
.btn:hover{border-color:var(--ink-3);color:var(--ink)}
.dlabel{font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-3);border-bottom:1px solid var(--rule);padding-bottom:5px}
.dbody{max-height:560px;overflow:auto;background:var(--paper);border:1px solid var(--rule);padding:18px 20px;font-size:14.5px;line-height:1.72}
.dbody h2,.dbody h3,.dbody h4{font-family:Georgia,"Songti SC",serif;margin:18px 0 7px;line-height:1.3;overflow-wrap:anywhere}
.dbody h2{font-size:17px;border-bottom:1px solid var(--rule-2);padding-bottom:5px}
.dbody h3{font-size:15px}.dbody h4{font-size:13.5px;color:var(--ink-2)}
.dbody>:first-child{margin-top:0}
.dbody p{margin:0 0 9px;color:var(--ink-2);overflow-wrap:anywhere}
.dbody pre{background:var(--paper-2);border:1px solid var(--rule-2);padding:11px 13px;overflow-x:auto;font-family:ui-monospace,Menlo,monospace;font-size:12px;margin:0 0 11px}
.dbody code{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:var(--paper-2);padding:1px 4px}
.dbody pre code{background:none;padding:0}
.dbody .li{margin:0 0 5px;padding-left:15px;position:relative;color:var(--ink-2);overflow-wrap:anywhere}
.dbody .li::before{content:"·";position:absolute;left:4px;color:var(--ink-3)}
.dfiles{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--ink-3);max-height:150px;overflow:auto;background:var(--paper);border:1px solid var(--rule);padding:11px 13px;columns:2;column-gap:22px}
.dfiles div{break-inside:avoid}
.empty{padding:60px;text-align:center;color:var(--ink-3)}
footer{margin-top:44px;padding-top:22px;border-top:1px solid var(--rule);font-size:13px;color:var(--ink-3);max-width:74ch}
footer code{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:var(--paper-2);padding:1px 4px}
@media(max-width:900px){
 .wrap{padding:0 14px 60px}.stats{grid-template-columns:repeat(2,1fr)}
 table,tbody,tr,td{display:block;width:100%}
 tbody tr:not(.detail){border-bottom:1px solid var(--rule);padding:14px 0 12px}
 td.c-name{width:auto;min-width:0;padding:0 0 0 11px;white-space:normal;display:flex;flex-wrap:wrap;align-items:baseline;gap:3px 5px}
 td.c-name .meta{flex-basis:100%}
 td.c-desc{padding:9px 0 0 11px}
 td.c-side{width:auto;min-width:0;padding:10px 0 0 11px;border-left:0;border-top:1px solid var(--rule-2);margin-top:10px}
 .dfiles{columns:1}
}
"""

JS = r"""
const DATA = __DATA__;
const RECLABEL = __RECLABEL__;
const tb=document.getElementById('tb'), q=document.getElementById('q'),
      countEl=document.getElementById('count'), emptyEl=document.getElementById('empty');
let cat='*', sortKey='un', sortDir='desc';
const fmt=n=>n===null?null:n.toLocaleString('en-US');
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const md=t=>esc(t||'').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');

// 轻量 Markdown：标题 / 代码块 / 行内代码 / 加粗 / 列表
function mdRender(src){
  const lines=(src||'').split('\n'); let out=[],inF=false,f=[];
  for(const raw of lines){
    if(/^\s*```/.test(raw)){ if(inF){out.push('<pre><code>'+esc(f.join('\n'))+'</code></pre>');f=[];inF=false;} else inF=true; continue; }
    if(inF){f.push(raw);continue;}
    const h=raw.match(/^(#{1,6})\s+(.*)$/);
    if(h){const lv=Math.min(Math.max(h[1].length,2),4);out.push('<h'+lv+'>'+md(h[2])+'</h'+lv+'>');continue;}
    if(/^\s*(---+|\*\*\*+)\s*$/.test(raw)){out.push('<hr>');continue;}
    const li=raw.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if(li){out.push('<div class="li">'+md(li[1])+'</div>');continue;}
    if(!raw.trim())continue;
    out.push('<p>'+md(raw)+'</p>');
  }
  if(inF&&f.length)out.push('<pre><code>'+esc(f.join('\n'))+'</code></pre>');
  return out.join('');
}

function render(){
  const term=q.value.trim().toLowerCase();
  let list=DATA.filter(r=>{
    if(cat==='__act'){ if(!r.active) return false; }
    else if(cat==='__never'){ if(r.un>0) return false; }
    else if(cat!=='*' && r.cat!==cat) return false;
    if(!term) return true;
    return (r.name+' '+r.desc+' '+r.how+' '+(r.repo||'')+' '+r.cat).toLowerCase().includes(term);
  });
  list.sort((a,b)=>{
    let x=a[sortKey],y=b[sortKey];
    if(sortKey==='stars'||sortKey==='un'){x=x||-1;y=y||-1;}
    let c=(typeof x==='number')?x-y:String(x).localeCompare(String(y),'zh');
    if(c===0)c=String(a.name).localeCompare(String(b.name));
    return sortDir==='desc'?-c:c;
  });
  countEl.textContent=list.length+' / '+DATA.length;
  emptyEl.hidden=list.length>0;
  tb.innerHTML=list.map(r=>{
    const badges=(r.active?'<span class="badge on">常驻</span>':'')
      +(r.manual?'<span class="badge">仅手动</span>':'');
    const use=r.un?('<b>'+r.un+' 次</b> · '+r.us+' 个会话<br><span class="dim" title="Codex '+r.ucx
      +' 次 / Claude Code '+r.ucc+' 次">'+(r.ul||'')+'</span>'):'<span class="dim">从没用过</span>';
    const up=r.url?('<a href="'+r.url+'" target="_blank" rel="noopener">'+esc(r.repo)+'</a>'
      +(r.stars?'<span class="bar"><i style="width:'+r.heat+'%"></i></span> ★'+fmt(r.stars):'')):'<span class="dim">来源未记录</span>';
    return '<tr data-rec="'+r.rec+'" data-name="'+r.name+'">'
      +'<td class="c-name"><button class="sname" type="button" aria-expanded="false">'
        +'<span class="caret">▶</span>'+r.name+'</button>'+badges
        +'<span class="meta">'+r.cat+' · '+r.lines+' 行 · '+r.nfiles+' 附件 · '
        +'<a href="../'+encodeURI(r.rel)+'/">📂 目录</a></span></td>'
      +'<td class="c-desc"><p class="d">'+md(r.desc)+'</p>'
        +(r.how?'<p class="how"><span class="hk">怎么用</span>'+md(r.how)+'</p>':'')+'</td>'
      +'<td class="c-side">'
        +'<div class="s-row"><span class="sk">推荐</span><span class="sv"><span class="rec">'
          +'<span class="on">'+'★'.repeat(r.rec)+'</span><span class="off">'+'★'.repeat(5-r.rec)
          +'</span></span> '+RECLABEL[r.rec]+'</span></div>'
        +'<div class="s-row"><span class="sk">使用</span><span class="sv">'+use+'</span></div>'
        +'<div class="s-row"><span class="sk">来源</span><span class="sv">'+up+'</span></div>'
      +'</td></tr>';
  }).join('');
}

tb.addEventListener('click',e=>{
  const b=e.target.closest('.sname'); if(!b) return;
  const tr=b.closest('tr'), open=tr.nextElementSibling&&tr.nextElementSibling.classList.contains('detail');
  b.setAttribute('aria-expanded',String(!open));
  b.querySelector('.caret').textContent=open?'▶':'▼';
  if(open){ tr.nextElementSibling.remove(); return; }
  const r=DATA.find(x=>x.name===tr.dataset.name);
  const files=r.files.length?('<div><div class="dlabel">附带资源 · '+r.files.length+' 个文件</div>'
    +'<div class="dfiles">'+r.files.map(f=>'<div>'+esc(f)+'</div>').join('')+'</div></div>'):'';
  tr.insertAdjacentHTML('afterend','<tr class="detail"><td colspan="3"><div class="dwrap">'
    +'<div class="dbar"><a class="btn" href="../'+encodeURI(r.rel)+'/">📂 打开目录</a>'
    +'<a class="btn" href="../'+encodeURI(r.rel)+'/SKILL.md">📄 打开 SKILL.md</a>'
    +(r.url?'<a class="btn" href="'+r.url+'" target="_blank" rel="noopener">上游 ↗</a>':'')+'</div>'
    +'<div><div class="dlabel">SKILL.md 全文 · '+r.lines+' 行</div>'
    +'<div class="dbody">'+mdRender(r.body)+'</div></div>'+files+'</div></td></tr>');
});

document.getElementById('chips').addEventListener('click',e=>{
  const b=e.target.closest('.chip'); if(!b) return;
  cat=b.dataset.cat;
  document.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-pressed',String(c===b)));
  render();
});
document.querySelectorAll('.sbtn').forEach(b=>b.addEventListener('click',()=>{
  const k=b.dataset.sort;
  if(sortKey===k) sortDir=sortDir==='desc'?'asc':'desc';
  else{sortKey=k;sortDir=(k==='name'||k==='cat')?'asc':'desc';}
  document.querySelectorAll('.sbtn').forEach(x=>{x.classList.remove('on');x.removeAttribute('data-dir');});
  b.classList.add('on');b.setAttribute('data-dir',sortDir);
  render();
}));
q.addEventListener('input',render);
render();
"""

chips = [f'<button class="chip" data-cat="*" aria-pressed="true">全部<span class="c">{N}</span></button>',
         f'<button class="chip" data-cat="__act" aria-pressed="false">常驻<span class="c">{NACT}</span></button>',
         f'<button class="chip" data-cat="__never" aria-pressed="false">从没用过<span class="c">{N-NUSED}</span></button>']
for c in sorted(bycat):
    chips.append(f'<button class="chip" data-cat="{esc(c)}" aria-pressed="false">{esc(c)}<span class="c">{len(bycat[c])}</span></button>')

page = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>技能清册 · {N} 个</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>{N} 个技能</h1>
  <p class="lede">点技能名可就地展开它的 <code>SKILL.md</code> 全文。<b>怎么用</b>那一栏写的是怎么触发它。
  <b>使用</b>取自 Codex 和 Claude Code 的真实调用记录。本页由 <code>scripts/render.py</code> 生成，
  改完技能跑一下就刷新。</p>
</header>
<div class="stats">
  <div class="stat"><span class="n">{N}</span><span class="l">技能总数</span></div>
  <div class="stat g"><span class="n">{NACT}</span><span class="l">常驻（已装）</span></div>
  <div class="stat"><span class="n">{NUSED}</span><span class="l">用过</span></div>
  <div class="stat r"><span class="n">{N-NUSED}</span><span class="l">从没用过</span></div>
  <div class="stat"><span class="n">{len(src)}</span><span class="l">可自动同步</span></div>
  <div class="stat"><span class="n">{len(bycat)}</span><span class="l">分类</span></div>
</div>
<div class="controls">
  <div class="row"><input id="q" type="search" placeholder="搜技能名、说明、来源…" aria-label="搜索">
    <span class="count" id="count"></span></div>
  <div class="row" id="chips">{''.join(chips)}</div>
  <div class="row"><span class="sl">排序</span>
    <button class="sbtn on" data-sort="un" data-dir="desc" type="button">使用次数</button>
    <button class="sbtn" data-sort="stars" type="button">Star</button>
    <button class="sbtn" data-sort="rec" type="button">推荐指数</button>
    <button class="sbtn" data-sort="name" type="button">名称</button>
    <button class="sbtn" data-sort="cat" type="button">分类</button>
  </div>
</div>
<table><tbody id="tb"></tbody></table>
<div class="empty" id="empty" hidden>没有匹配的技能。</div>
<footer>
  <p>本页是 <code>scripts/render.py</code> 从仓库直接生成的：技能正文来自 <code>skills/**/SKILL.md</code>，
  中文说明来自 <code>scripts/descriptions.py</code>，上游来自 <code>sources.json</code>，
  用量来自 <code>docs/usage.json</code>（会话记录的静态快照）。</p>
  <p>「📂 目录」是相对本仓库的链接，把这个文件在本地打开时能直接跳到技能目录。</p>
</footer>
</div>
<script>{JS.replace('__DATA__', data).replace('__RECLABEL__', json.dumps(RECLABEL, ensure_ascii=False))}</script>
</body>
</html>
"""
open(f'{REPO}/docs/index.html', 'w', encoding='utf-8').write(page)
sz = os.path.getsize(f'{REPO}/docs/index.html') / 1024 / 1024
print(f'✓ docs/index.html （{sz:.1f} MB，内嵌 {N} 份 SKILL.md 全文）')

nodesc = [r['name'] for r in rows if r['name'] not in DESC]
if nodesc:
    print(f'\n提示：{len(nodesc)} 个技能还没写中文说明（用的是 SKILL.md 里的英文）：')
    print('  ' + ' '.join(nodesc[:12]) + (' …' if len(nodesc) > 12 else ''))
    print('  想补的话编辑 scripts/descriptions.py')
