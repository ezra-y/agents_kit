"""Deterministic generated documentation for agents_kit."""

from __future__ import annotations

import html
import json
import urllib.parse
from collections import defaultdict
from pathlib import Path
from typing import Any

from . import scout
from .models import parse_skill_frontmatter
from .repository import Repository

RECLABEL = {5: "必留", 4: "值得留", 3: "看情况", 2: "可砍", 1: "建议删"}


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


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
.tag-controls{gap:12px}
.tag-field{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ink-3)}
.tag-field select{max-width:210px;padding:6px 24px 6px 8px;background:var(--paper-2);color:var(--ink-2);
border:1px solid var(--rule);border-radius:2px;font:12px ui-monospace,Menlo,monospace}
.tag-field select:focus{outline:2px solid var(--red);outline-offset:1px}
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
.badge.idx{color:var(--amber);border-color:var(--amber)}
.meta{display:block;font-size:12px;color:var(--ink-3);margin-top:6px;line-height:1.6;font-family:ui-monospace,Menlo,monospace}
.meta a{color:var(--blue);text-decoration:none}.meta a:hover{text-decoration:underline}
.folder-link{font:inherit;color:var(--blue);background:none;border:0;padding:0;cursor:pointer}
.folder-link:hover{text-decoration:underline}
td.c-desc{vertical-align:top;padding:16px 26px 16px 0}
td.c-desc .d{margin:0;font-size:15.5px;line-height:1.72;color:var(--ink)}
td.c-desc strong{font-weight:650}
td.c-desc code{font-family:ui-monospace,Menlo,monospace;font-size:13px;background:var(--paper-2);padding:1px 5px;border-radius:2px}
td.c-desc .how{margin:10px 0 0;font-size:14px;line-height:1.68;color:var(--ink-2);padding-left:12px;border-left:2px solid var(--rule)}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
.tag{font:10.5px ui-monospace,Menlo,monospace;padding:2px 6px;color:var(--ink-3);
background:transparent;border:1px solid var(--rule);border-radius:2px;cursor:pointer}
.tag:hover{color:var(--ink);border-color:var(--ink-3)}
.tag.role{color:var(--red);border-color:color-mix(in srgb,var(--red) 45%,var(--rule))}
.hk{display:inline-block;font-size:10.5px;letter-spacing:.12em;color:var(--ink-3);border:1px solid var(--rule);border-radius:2px;padding:1px 5px;margin-right:8px}
td.c-side{width:300px;min-width:270px;vertical-align:top;padding:16px 0 16px 20px;border-left:1px solid var(--rule-2)}
.s-row{display:flex;gap:10px;align-items:baseline;margin-bottom:6px;font-size:12.5px}
.sk{font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-3);white-space:nowrap;flex:none;width:30px}
.sv{color:var(--ink-2);min-width:0;word-break:break-word}
.sv a{color:var(--blue);text-decoration:none}.sv a:hover{text-decoration:underline}
.rec .on{color:var(--red)}.rec .off{color:var(--rule)}
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
let cat='*', sortKey='name', sortDir='asc', tagFilters={};
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

async function openFinder(name){
  if(location.protocol==='file:'){
    window.alert('请运行 agents-kit ui 后使用 Finder 按钮。');
    return;
  }
  try{
    const response=await fetch('/api/skills/'+encodeURIComponent(name)+'/open',{
      method:'POST',
      headers:{'X-Agents-Kit-UI':'1'}
    });
    const payload=await response.json();
    if(!response.ok) throw new Error(payload.error||'无法打开目录');
  }catch(error){
    window.alert('Finder 连接失败。请通过 agents-kit ui 打开本页。');
  }
}

function render(){
  const term=q.value.trim().toLowerCase();
  let list=DATA.filter(r=>{
    if(cat==='__act'){ if(!r.active) return false; }
    else if(cat!=='*' && r.cat!==cat) return false;
    if(Object.values(tagFilters).some(tag=>tag && !(r.tags||[]).includes(tag))) return false;
    if(!term) return true;
    return (r.name+' '+(r.ref||'')+' '+(r.ownerId||'')+' '+r.desc+' '+r.how+' '
      +(r.repo||'')+' '+r.cat+' '+(r.path||'')+' '
      +(r.catLabel||'')+' '+(r.tags||[]).join(' ')).toLowerCase().includes(term);
  });
  list.sort((a,b)=>{
    let x=a[sortKey],y=b[sortKey];
    let c=(typeof x==='number')?x-y:String(x).localeCompare(String(y),'zh');
    if(c===0)c=String(a.name).localeCompare(String(b.name));
    return sortDir==='desc'?-c:c;
  });
  countEl.textContent=list.length+' / '+DATA.length;
  emptyEl.hidden=list.length>0;
  tb.innerHTML=list.map(r=>{
    const badges=(r.status?'<span class="badge '
        +(r.active?'on':(r.kind==='scout'?'idx':''))+'">'+r.status+'</span>':'')
      +(r.kind==='mcp'?'<span class="badge">MCP</span>':'')
      +(r.owner==='plugin'?'<span class="badge">'+esc(r.ownerId)+'</span>':'')
      +(r.manual?'<span class="badge">仅手动</span>':'');
    const up=r.url?('<a href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(r.repo)+'</a>')
      :'<span class="dim">来源未记录</span>';
    const tags=(r.tags||[]).map(tag=>{
      const ns=tag.split('/',1)[0];
      return '<button class="tag '+(ns==='role'?'role':'')+'" type="button" data-tag="'
        +esc(tag)+'">'+esc(tag)+'</button>';
    }).join('');
    const meta=r.kind==='mcp'
      ?('MCP · '+esc(r.runtime)+' · '+esc(r.targets.join(', ')))
      :r.kind==='scout'
      ?('未收录 · '+esc(r.repo||'')+' · '+esc(r.path||''))
      :(esc(r.catLabel||r.cat)+' · '+r.lines+' 行 · '+r.nfiles+' 附件 · '
        +'<button class="folder-link" type="button" data-open-skill="'+esc(r.ref||r.name)
        +'">Finder</button>');
    const side=(r.kind==='scout'
      ?'<div class="s-row"><span class="sk">状态</span><span class="sv">仅索引，内容未下载</span></div>'
      :'<div class="s-row"><span class="sk">推荐</span><span class="sv"><span class="rec">'
        +'<span class="on">'+'★'.repeat(r.rec)+'</span><span class="off">'+'★'.repeat(5-r.rec)
        +'</span></span> '+RECLABEL[r.rec]+'</span></div>')
      +'<div class="s-row"><span class="sk">来源</span><span class="sv">'+up+'</span></div>';
    return '<tr data-rec="'+r.rec+'" data-name="'+r.name+'">'
      +'<td class="c-name"><button class="sname" type="button" aria-expanded="false">'
        +'<span class="caret">▶</span>'+r.name+'</button>'+badges
        +'<span class="meta">'+meta+'</span></td>'
      +'<td class="c-desc"><p class="d">'+md(r.desc)+'</p>'
        +(r.how?'<p class="how"><span class="hk">怎么用</span>'+md(r.how)+'</p>':'')
        +(tags?'<div class="tags">'+tags+'</div>':'')+'</td>'
      +'<td class="c-side">'+side+'</td></tr>';
  }).join('');
}

tb.addEventListener('click',e=>{
  const folder=e.target.closest('[data-open-skill]');
  if(folder){openFinder(folder.dataset.openSkill);return;}
  const tagButton=e.target.closest('[data-tag]');
  if(tagButton){
    const tag=tagButton.dataset.tag, ns=tag.split('/',1)[0];
    const select=document.querySelector('[data-tag-ns="'+ns+'"]');
    if(select){select.value=tag;tagFilters[ns]=tag;render();}
    return;
  }
  const b=e.target.closest('.sname'); if(!b) return;
  const tr=b.closest('tr'), open=tr.nextElementSibling&&tr.nextElementSibling.classList.contains('detail');
  b.setAttribute('aria-expanded',String(!open));
  b.querySelector('.caret').textContent=open?'▶':'▼';
  if(open){ tr.nextElementSibling.remove(); return; }
  const r=DATA.find(x=>x.name===tr.dataset.name);
  const files=r.files.length?('<div><div class="dlabel">附带资源 · '+r.files.length+' 个文件</div>'
    +'<div class="dfiles">'+r.files.map(f=>'<div>'+esc(f)+'</div>').join('')+'</div></div>'):'';
  const actions=r.kind==='mcp'
    ?(r.url?'<a class="btn" href="'+esc(r.url)+'" target="_blank" rel="noopener">上游 ↗</a>':'')
    :r.kind==='scout'
    ?(r.url?'<a class="btn" href="'+esc(r.url)+'" target="_blank" rel="noopener">上游 SKILL.md 原文 ↗</a>':'')
    :'<button class="btn" type="button" data-open-skill="'+esc(r.ref||r.name)
      +'">Finder 打开目录</button>'
      +'<a class="btn" href="../'+encodeURI(r.rel)+'/SKILL.md">打开 SKILL.md</a>'
      +(r.url?'<a class="btn" href="'+esc(r.url)+'" target="_blank" rel="noopener">上游 ↗</a>':'');
  const dlabel=r.kind==='mcp'?'MCP 清单记录'
    :r.kind==='scout'?'索引条目 · 内容未下载'
    :'SKILL.md 全文 · '+r.lines+' 行';
  tr.insertAdjacentHTML('afterend','<tr class="detail"><td colspan="3"><div class="dwrap">'
    +'<div class="dbar">'+actions+'</div>'
    +'<div><div class="dlabel">'+dlabel+'</div>'
    +'<div class="dbody">'+mdRender(r.body)+'</div></div>'+files+'</div></td></tr>');
});

document.getElementById('chips').addEventListener('click',e=>{
  const b=e.target.closest('.chip'); if(!b) return;
  cat=b.dataset.cat;
  document.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-pressed',String(c===b)));
  render();
});
document.getElementById('tagFilters').addEventListener('change',e=>{
  const select=e.target.closest('[data-tag-ns]'); if(!select) return;
  if(select.value) tagFilters[select.dataset.tagNs]=select.value;
  else delete tagFilters[select.dataset.tagNs];
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

GENERATED_BEGIN = "<!-- BEGIN GENERATED -->"
GENERATED_END = "<!-- END GENERATED -->"


def collect_rows(repo: Repository) -> list[dict[str, Any]]:
    active = {
        raw_ref
        for target in repo.read_desired_installations()["targets"].values()
        for raw_ref in target.get("skills", [])
    }
    rows: list[dict[str, Any]] = []
    for ref, entry in sorted(repo.skill_registry().items()):
        raw = (entry.path / "SKILL.md").read_text(encoding="utf-8", errors="replace")
        frontmatter = parse_skill_frontmatter(raw)
        body = _skill_body(raw)
        attachments = sorted(
            path.relative_to(entry.path).as_posix()
            for path in entry.path.rglob("*")
            if path.is_file() and path.name != "SKILL.md"
        )
        local_metadata = repo.metadata_record(ref) or {}
        source_record = repo.source_record(ref)
        if entry.owner_kind == "plugin":
            source_record = repo.read_sources()["plugins"].get(entry.owner_id or "")
        source_label, source_url = _source_view(source_record)
        rows.append(
            {
                "kind": "skill",
                "name": entry.name,
                "ref": ref,
                "owner": entry.owner_kind,
                "ownerId": entry.owner_id,
                "cat": entry.category,
                "catLabel": repo.category_label(entry.category),
                "desc": (
                    local_metadata.get("description")
                    or str(frontmatter.get("description") or "")
                    or "（未写中文说明，见 SKILL.md）"
                ),
                "how": local_metadata.get("trigger", ""),
                "tags": local_metadata.get("tags", []),
                "rec": local_metadata.get("recommendation", 3),
                "rel": entry.path.relative_to(repo.root).as_posix(),
                "lines": body.count("\n") + 1,
                "nfiles": len(attachments),
                "files": attachments,
                "body": body.strip(),
                "manual": bool(frontmatter.get("disable-model-invocation")),
                "active": ref in active,
                "status": "常驻" if ref in active else "已收录",
                "path": "",
                "repo": source_label,
                "url": source_url,
                "runtime": "",
                "targets": [],
            }
        )
    return rows


def collect_scout_rows(repo: Repository) -> list[dict[str, Any]]:
    inventory = {entry.name for entry in repo.skill_registry().values()}
    rows: list[dict[str, Any]] = []
    for source_name, record in sorted(repo.read_scout()["sources"].items()):
        source_arg = scout.source_argument(record)
        for item in record.get("skills", []):
            if item["name"] in inventory:
                continue
            body = (
                f"**用途**：{item['description']}\n\n"
                f"- 来源：{source_arg}\n"
                f"- 候选路径：`{item['path']}`\n\n"
                "安装：\n\n```\n"
                f"agents-kit skill import {source_arg} "
                f"--candidate {item['path']} --category <分类> "
                '--scope <global|project> --description "<中文说明>" '
                "--tag <标签>…\n```"
            )
            rows.append(
                {
                    "kind": "scout",
                    "name": item["name"],
                    "cat": "未收录",
                    "catLabel": "未收录",
                    "desc": item["description"],
                    "how": "",
                    "tags": [],
                    "rec": 0,
                    "rel": "",
                    "lines": 0,
                    "nfiles": 0,
                    "files": [],
                    "body": body,
                    "manual": False,
                    "active": False,
                    "status": "仅索引",
                    "path": item["path"],
                    "repo": source_name,
                    "url": scout.raw_skill_url(record, item["path"]),
                    "runtime": "",
                    "targets": [],
                }
            )
    return rows


def collect_mcp_rows(repo: Repository) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for name, record in sorted(repo.read_mcps()["servers"].items()):
        distribution = record["distribution"]
        package = distribution.get("package") or distribution["type"]
        version = distribution.get("version")
        runtime = package + (f"@{version}" if version else "")
        source_label, source_url = _mcp_source_view(record["source"]["url"])
        rows.append(
            {
                "kind": "mcp",
                "name": name,
                "cat": "MCP",
                "catLabel": "MCP",
                "desc": record["description"],
                "how": "、".join(record["tags"]),
                "tags": [],
                "rec": record["recommendation"],
                "rel": "",
                "lines": 0,
                "nfiles": 0,
                "files": [],
                "body": json.dumps(record, ensure_ascii=False, indent=2),
                "manual": False,
                "active": record["enabled"],
                "status": "启用" if record["enabled"] else "",
                "path": "",
                "repo": source_label,
                "url": source_url,
                "runtime": runtime,
                "targets": record["targets"],
                "distribution": distribution["type"],
                "package": package,
                "version": version,
            }
        )
    return rows


def render_markdown(repo: Repository, rows: list[dict[str, Any]]) -> str:
    by_category = _by_category(rows)
    active_count = sum(1 for row in rows if row["active"])
    source_count = len(repo.read_sources()["skills"])
    lines = [
        "# 技能清单",
        "",
        (
            f"共 **{len(rows)}** 个 · 常驻 **{active_count}** 个 · "
            f"有上游可检查更新 **{source_count}** 个"
        ),
        "",
        (
            "可搜索网页清册由 `agents-kit docs build` 生成到 "
            "`docs/index.html`，不进入 Git。"
        ),
        "",
        "`●` = 常驻",
        "",
    ]
    for category in repo.categories:
        category_rows = by_category.get(category, [])
        lines.extend(
            [
                (
                    f"## {repo.category_label(category)} "
                    f"(`{category}`，{len(category_rows)} 个)"
                ),
                "",
                "| 技能 | 说明 | 标签 | 常驻 | 来源 |",
                "|---|---|---|:--:|---|",
            ]
        )
        for row in sorted(category_rows, key=lambda item: item["name"]):
            description = row["desc"][:70].replace("|", "\\|").replace("**", "")
            if row["url"]:
                source = f"[{row['repo']}]({row['url']})"
            else:
                source = "—"
            tags = " ".join(f"`{tag}`" for tag in row["tags"])
            lines.append(
                f"| `{row['name']}` | {description} | {tags} | "
                f"{'●' if row['active'] else ''} | {source} |"
            )
        lines.append("")
    return "\n".join(lines) + "\n"


def render_catalog_markdown(repo: Repository) -> str:
    sources = repo.read_scout()["sources"]
    inventory = repo.skill_registry()
    active = {
        raw_ref
        for target in repo.read_desired_installations()["targets"].values()
        for raw_ref in target.get("skills", [])
    }
    active_names = {repo.require_skill(ref).name for ref in active if ref in inventory}
    indexed_total = sum(len(record.get("skills", [])) for record in sources.values())
    inactive = sorted(
        (entry for ref, entry in inventory.items() if ref not in active),
        key=lambda entry: (entry.category, entry.name),
    )
    lines = [
        "# 收藏技能总目录",
        "",
        (
            f"全部收藏 **{indexed_total + len(inventory)}** 个："
            f"未收录索引 **{indexed_total}** · 已收录 **{len(inventory)}**"
            f"（其中常驻 **{len(active)}**）"
        ),
        "",
        "匹配优先级：常驻（会话里已可见）→ 已收录未常驻（启用即可，零下载）→",
        "未收录索引（从上游安装）。按描述匹配即可；描述拿不准、候选难取舍或任务",
        "关键时再读全文——已收录的直接读本地",
        "`~/agents_kit/skills/` 或 owner Plugin 中的 `SKILL.md`，未收录的点「技能」列链接",
        "（指向上游默认分支最新版）。链接 404 说明上游改了目录，运行",
        "`agents-kit source inspect --refresh-index` 重扫后重试。安装未收录技能前",
        "先读 `~/agents_kit/docs/skill-taxonomy.md` 选分类标签；用户未说明范围时",
        "先问装全局还是项目。注意带 `scripts/`、`references/` 附件的技能必须安装",
        "后才能完整使用。",
        "",
        "维护：收藏新来源 `agents-kit source inspect <仓库> --save`；重扫全部",
        "`--refresh-index`；移除来源编辑 `scout.json` 后运行 `agents-kit docs",
        "build`。第二、三层来自仓库清册自动渲染，无需维护。",
        "",
        "## 一、未收录索引（看上但还没进仓库）",
        "",
    ]
    if not sources:
        lines.extend(
            [
                "索引为空。收藏来源：`agents-kit source inspect <仓库> --save`。",
                "",
            ]
        )
    for name, record in sorted(sources.items()):
        indexed = record.get("skills", [])
        revision = str(record.get("revision") or "")[:9]
        source_arg = scout.source_argument(record)
        header = f"### {name}（{len(indexed)} 个"
        header += f" · 扫描版本 `{revision}`）" if revision else "）"
        lines.extend([header, ""])
        if record.get("note"):
            lines.extend([str(record["note"]), ""])
        lines.append(f"- 来源：{source_arg}")
        lines.append(
            f"- 安装：`agents-kit skill import {source_arg} "
            "--candidate <候选路径> --category <分类> --scope <global|project> "
            '--description "<中文说明>" --tag <标签>…`'
        )
        lines.extend(["", "| 技能 | 用途 | 候选路径 | 已装 |", "|---|---|---|:--:|"])
        for item in indexed:
            url = scout.raw_skill_url(record, item["path"])
            title = f"[{item['name']}]({url})" if url else f"`{item['name']}`"
            description = item["description"].replace("|", "\\|")
            installed = (
                "●"
                if any(entry.name == item["name"] for entry in inventory.values())
                else ""
            )
            lines.append(
                f"| {title} | {description} | `{item['path']}` | {installed} |"
            )
        lines.append("")
    lines.extend(
        [
            "## 二、已收录、未常驻（仓库现成，启用即可用）",
            "",
            "全局启用：`agents-kit global enable <技能名>`；只装进当前项目：",
            "`agents-kit project install <技能名> --project <项目路径>`。",
            "",
        ]
    )
    if inactive:
        lines.extend(["| 技能 | 分类 | 用途 |", "|---|---|---|"])
        for entry in inactive:
            description = str(
                (repo.metadata_record(entry.qualified_id) or {}).get("description", "")
            ).replace("|", "\\|")
            lines.append(
                f"| `{entry.name}` | {repo.category_label(entry.category)} "
                f"| {description} |"
            )
        lines.append("")
    else:
        lines.extend(["（无）", ""])
    lines.extend(
        [
            "## 三、常驻（会话里天然可见，此处仅备查）",
            "",
            " · ".join(f"`{name}`" for name in sorted(active_names)) or "（无）",
            "",
        ]
    )
    return "\n".join(lines)


def render_mcp_markdown(repo: Repository, rows: list[dict[str, Any]]) -> str:
    enabled_count = sum(1 for row in rows if row["active"])
    lines = [
        "# MCP 清单",
        "",
        f"共 **{len(rows)}** 个 · 全局启用 **{enabled_count}** 个",
        "",
        "| MCP | 说明 | 分发 | 版本 | 目标 | 启用 | 上游 |",
        "|---|---|---|---|---|:--:|---|",
    ]
    for row in rows:
        description = row["desc"].replace("|", "\\|")
        source = f"[{row['repo']}]({row['url']})" if row["url"] else "—"
        lines.append(
            f"| `{row['name']}` | {description} | `{row['package']}` | "
            f"`{row['version'] or '—'}` | {', '.join(row['targets'])} | "
            f"{'●' if row['active'] else ''} | {source} |"
        )
    lines.extend(
        [
            "",
            "客户端配置由 `agents-kit mcp apply --all` 从 `mcps.json` 收敛。",
            "仓库只保存凭据来源，不保存凭据值。",
            "",
        ]
    )
    return "\n".join(lines)


def render_plugin_markdown(repo: Repository) -> str:
    lines = [
        "# Plugin 清单",
        "",
        f"共 **{len(repo.plugin_inventory())}** 个完整 Plugin。",
        "",
        "| Plugin | 上游目标 | Claude | Codex | 内嵌 Skill | 来源 |",
        "|---|---|---|---|---|---|",
    ]
    source_records = repo.read_sources()["plugins"]
    for plugin_id, spec in sorted(repo.plugin_inventory().items()):
        source_label, source_url = _source_view(source_records.get(plugin_id))
        source = (
            f"[{source_label}]({source_url})"
            if source_label and source_url
            else "本地维护"
        )
        skills = ", ".join(f"`{name}`" for name in sorted(spec.embedded_skills))
        lines.append(
            f"| `{plugin_id}` | {', '.join(sorted(spec.upstream_targets)) or '—'} "
            f"| {spec.targets.get('claude').support if spec.targets.get('claude') else '—'} "
            f"| {spec.targets.get('codex').support if spec.targets.get('codex') else '—'} "
            f"| {skills or '—'} | {source} |"
        )
    lines.extend(
        [
            "",
            (
                "平台 manifest 是各自的权威源文件；"
                "`agents-kit marketplace build` 只生成根 Marketplace 索引。"
            ),
            (
                "内嵌 Skill 是否能脱离 Plugin 安装，以 "
                "`agents-kit.plugin.json` 的 `standalone` 声明为准。"
            ),
            "",
        ]
    )
    return "\n".join(lines)


def render_html(
    repo: Repository,
    skill_rows: list[dict[str, Any]],
    mcp_rows: list[dict[str, Any]],
    scout_rows: list[dict[str, Any]] | None = None,
) -> str:
    scout_rows = scout_rows or []
    rows = [*skill_rows, *scout_rows, *mcp_rows]
    by_category = _by_category(rows)
    total = len(skill_rows)
    active_count = sum(1 for row in skill_rows if row["active"])
    scout_count = len(scout_rows)
    mcp_count = len(mcp_rows)
    enabled_mcp_count = sum(1 for row in mcp_rows if row["active"])
    source_count = len(repo.read_sources()["skills"])
    data = json.dumps(rows, ensure_ascii=False)
    data = data.replace("</", r"<\/").replace("<!--", "<\\u0021--")
    chips = [
        (
            f'<button class="chip" data-cat="*" aria-pressed="true">'
            f'全部<span class="c">{len(rows)}</span></button>'
        ),
        (
            f'<button class="chip" data-cat="__act" aria-pressed="false">'
            f'生效<span class="c">{active_count + enabled_mcp_count}</span></button>'
        ),
    ]
    for category in repo.categories:
        category_rows = by_category.get(category, [])
        chips.append(
            f'<button class="chip" data-cat="{esc(category)}" '
            f'aria-pressed="false">{esc(repo.category_label(category))}'
            f'<span class="c">{len(category_rows)}</span></button>'
        )
    if scout_rows:
        chips.append(
            '<button class="chip" data-cat="未收录" aria-pressed="false">未收录'
            f'<span class="c">{scout_count}</span></button>'
        )
    if mcp_rows:
        chips.append(
            '<button class="chip" data-cat="MCP" aria-pressed="false">MCP'
            f'<span class="c">{len(mcp_rows)}</span></button>'
        )
    used_tags = {tag for row in skill_rows for tag in row.get("tags", [])}
    tag_controls: list[str] = []
    for namespace, definition in repo.tag_namespaces.items():
        tags = sorted(tag for tag in used_tags if tag.startswith(f"{namespace}/"))
        options = "".join(
            f'<option value="{esc(tag)}">{esc(tag)}</option>' for tag in tags
        )
        tag_controls.append(
            f'<label class="tag-field">{esc(definition["label"])}'
            f'<select data-tag-ns="{esc(namespace)}">'
            f'<option value="">全部</option>{options}</select></label>'
        )
    script = JS.replace("__DATA__", data).replace(
        "__RECLABEL__", json.dumps(RECLABEL, ensure_ascii=False)
    )
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>agents_kit 清册 · {total} 个技能 · {scout_count} 个未收录 · {mcp_count} 个 MCP</title>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>{total} 个技能 · {scout_count} 个未收录 · {mcp_count} 个 MCP</h1>
  <p class="lede">每行标签标明状态：<b>常驻</b>（全局生效）、<b>已收录</b>（仓库有，启用即可用）、
  <b>仅索引</b>（未收录，只有链接和描述，内容未下载）。点名称可就地展开完整记录。
  本页由 <code>agents-kit docs build</code> 生成。</p>
</header>
<div class="stats">
  <div class="stat"><span class="n">{total}</span><span class="l">已收录技能</span></div>
  <div class="stat g"><span class="n">{active_count}</span><span class="l">常驻（全局生效）</span></div>
  <div class="stat"><span class="n">{scout_count}</span><span class="l">未收录（仅索引）</span></div>
  <div class="stat"><span class="n">{source_count}</span><span class="l">有来源记录</span></div>
  <div class="stat"><span class="n">{mcp_count}</span><span class="l">MCP 清单</span></div>
  <div class="stat g"><span class="n">{enabled_mcp_count}</span><span class="l">MCP 已启用</span></div>
</div>
<div class="controls">
  <div class="row"><input id="q" type="search" placeholder="搜技能、MCP、说明、来源…" aria-label="搜索">
    <span class="count" id="count"></span></div>
  <div class="row" id="chips">{"".join(chips)}</div>
  <div class="row tag-controls" id="tagFilters">{"".join(tag_controls)}</div>
  <div class="row"><span class="sl">排序</span>
    <button class="sbtn on" data-sort="name" data-dir="asc" type="button">名称</button>
    <button class="sbtn" data-sort="rec" type="button">推荐指数</button>
    <button class="sbtn" data-sort="cat" type="button">分类</button>
  </div>
</div>
<table><tbody id="tb"></tbody></table>
<div class="empty" id="empty" hidden>没有匹配项。</div>
<footer>
  <p>技能正文来自 <code>skills/**/SKILL.md</code>；MCP 来自
  <code>mcps.json</code>。中文说明和技能来源分别来自
  <code>metadata.json</code> 与 <code>sources.json</code>。</p>
  <p>本文件是本地或 CI 构建产物，不进入 Git。</p>
</footer>
</div>
<script>{script}</script>
</body>
</html>
"""


def render_architecture(
    repo: Repository,
    rows: list[dict[str, Any]],
    mcp_rows: list[dict[str, Any]],
) -> str:
    existing_path = repo.root / "docs" / "architecture.md"
    if existing_path.is_file():
        existing = existing_path.read_text(encoding="utf-8")
    else:
        existing = (
            "# agents_kit 架构\n\n"
            "本文件记录稳定设计。生成区块由 `agents-kit docs build` 更新。\n\n"
            f"{GENERATED_BEGIN}\n{GENERATED_END}\n"
        )
    if GENERATED_BEGIN not in existing or GENERATED_END not in existing:
        raise ValueError("docs/architecture.md 缺生成区块标记")
    by_category = _by_category(rows)
    scout_sources = repo.read_scout()["sources"]
    scout_total = sum(
        len(record.get("skills", [])) for record in scout_sources.values()
    )
    generated = "\n".join(
        [
            GENERATED_BEGIN,
            "",
            "## 当前事实",
            "",
            f"- 技能：{len(rows)}",
            f"- Plugin：{len(repo.plugin_inventory())}",
            f"- 常驻：{sum(1 for row in rows if row['active'])}",
            (
                "- 来源记录："
                f"{len(repo.read_sources()['skills'])} 条 Skill，"
                f"{len(repo.read_sources()['plugins'])} 条 Plugin"
            ),
            f"- metadata：{len(repo.read_metadata()['skills'])}",
            f"- 收藏索引：{len(scout_sources)} 个来源，{scout_total} 个技能",
            f"- MCP：{len(mcp_rows)}",
            f"- MCP 已启用：{sum(1 for row in mcp_rows if row['active'])}",
            (
                "- 分类："
                + ", ".join(
                    f"{repo.category_label(name)}({len(by_category.get(name, []))})"
                    for name in repo.categories
                )
            ),
            "",
            "## 状态所有权",
            "",
            "- `agents-kit.json`：taxonomy、标签词表、安装目标和默认策略",
            "- `plugins/`：完整 Plugin 包及平台权威 manifest",
            "- `desired-installations.json`：按平台保存期望安装状态",
            "- `active.txt`：旧版兼容清单，不再拥有安装状态",
            "- `sources.json`：Skill 和 Plugin provider 来源记录",
            "- `metadata.json`：中文清册、标签和依赖",
            "- `scout.json`：收藏索引，未安装技能的名字、用途和来源定位",
            "- `mcps.json`：MCP 清单、上游、锁定版本、启动方式和启用状态",
            "- 根 Marketplace 索引：由平台 manifest 确定性生成",
            "",
            GENERATED_END,
        ]
    )
    start = existing.index(GENERATED_BEGIN)
    end = existing.index(GENERATED_END) + len(GENERATED_END)
    return existing[:start] + generated + existing[end:]


def render_cli_reference(command_help: str) -> str:
    return (
        "# agents-kit 命令参考\n\n"
        "本文件由 `agents-kit docs build` 生成。\n\n"
        "```text\n" + command_help.rstrip() + "\n```\n"
    )


def expected_tracked_documents(
    repo: Repository, *, command_help: str
) -> dict[Path, str]:
    rows = collect_rows(repo)
    mcp_rows = collect_mcp_rows(repo)
    return {
        repo.root / "docs" / "skills.md": render_markdown(repo, rows),
        repo.root / "docs" / "plugins.md": render_plugin_markdown(repo),
        repo.root / "docs" / "catalog.md": render_catalog_markdown(repo),
        repo.root / "docs" / "mcps.md": render_mcp_markdown(repo, mcp_rows),
        repo.root / "docs" / "cli.md": render_cli_reference(command_help),
        repo.root / "docs" / "architecture.md": render_architecture(
            repo, rows, mcp_rows
        ),
    }


def build(repo: Repository, *, command_help: str) -> dict[str, Any]:
    changed: list[str] = []
    rows = collect_rows(repo)
    mcp_rows = collect_mcp_rows(repo)
    scout_rows = collect_scout_rows(repo)
    tracked = expected_tracked_documents(repo, command_help=command_help)
    for path, content in tracked.items():
        if repo.write_text_if_changed(path, content):
            changed.append(path.relative_to(repo.root).as_posix())
    html_path = repo.root / "docs" / "index.html"
    if repo.write_text_if_changed(
        html_path, render_html(repo, rows, mcp_rows, scout_rows)
    ):
        changed.append(html_path.relative_to(repo.root).as_posix())
    return {
        "skills": len(rows),
        "plugins": len(repo.plugin_inventory()),
        "mcps": len(mcp_rows),
        "changed": changed,
        "html": str(html_path),
    }


def check(repo: Repository, *, command_help: str) -> list[str]:
    stale: list[str] = []
    for path, expected in expected_tracked_documents(
        repo, command_help=command_help
    ).items():
        actual = path.read_text(encoding="utf-8") if path.is_file() else None
        if actual != expected:
            stale.append(path.relative_to(repo.root).as_posix())
    return stale


def _by_category(
    rows: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row["cat"]].append(row)
    return grouped


def _skill_body(raw: str) -> str:
    lines = raw.splitlines()
    if not lines or lines[0].strip() != "---":
        return raw
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return "\n".join(lines[index + 1 :])
    return raw


def _source_view(
    record: dict[str, Any] | None,
) -> tuple[str | None, str | None]:
    if not record:
        return None, None
    locator = record.get("locator", {})
    url = str(locator.get("url") or "")
    provider = record.get("provider")
    if provider == "git" and url:
        parsed = urllib.parse.urlparse(url)
        repo_path = parsed.path.removesuffix(".git").strip("/")
        label = f"{parsed.hostname}/{repo_path}" if parsed.hostname else repo_path
        if parsed.scheme not in {"http", "https"}:
            return label, None
        display_url = url.removesuffix(".git")
        ref = locator.get("ref")
        path = locator.get("path")
        if parsed.hostname == "github.com" and ref:
            display_url += f"/tree/{ref}"
            if path:
                display_url += f"/{path}"
        return label, display_url
    if provider == "http" and url:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme in {"http", "https"}:
            return parsed.hostname or "HTTP", url
        return "HTTP", None
    return str(provider), None


def _mcp_source_view(url: str) -> tuple[str, str | None]:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return url, None
    path = parsed.path.removesuffix(".git").strip("/")
    label = f"{parsed.hostname}/{path}" if path else parsed.hostname or url
    return label, url.removesuffix(".git")
