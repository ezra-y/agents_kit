<div align="center">

# 深度调研 Skill

**逼 AI Agent 做「会下判断」的调研，而不是「会摆信息」的调研。**

[![License: MIT](https://img.shields.io/badge/License-MIT-2b2b2b?style=flat-square)](./LICENSE)
&nbsp;
[![Works with](https://img.shields.io/badge/works_with-Claude_Code_·_Cursor-4b4b4b?style=flat-square)](#快速开始)
&nbsp;
[![Stars](https://img.shields.io/github/stars/SeanEllyJames/deep-research-skill?style=flat-square&color=2b2b2b)](https://github.com/SeanEllyJames/deep-research-skill/stargazers)

一个即插即用的 Markdown 文件　·　无需安装　·　粘进去就能用

</div>

<br>

市面上绝大多数所谓的「AI 深度调研」，本质是 **Wide Research**：并行搜一堆来源，按主题分好类，给你一份工整的 checklist。看起来很全，事实也没错，但没用——它只有目录，没有判断。

这个 skill 把 Agent 掰到另一条路上：**Deep Research**。精读一手源，把它们之间的矛盾挑出来，最后落到一个业内人真的会跟你争论的判断上。

<br>

## 一个区分，决定一切

<div align="center">

| | Wide Research（默认模式） | Deep Research（本 skill） |
|:--|:--|:--|
| **方法** | 搜多个来源 → 按主题分类 → 出 checklist | 精读少数一手源 → 提炼张力 → 论证出判断 |
| **结构** | 主题分类：市场 / 竞争 / 趋势 | 论证链：观察 → 分析 → 判断 → 局限 |
| **产出** | 「A 做了 X，B 做了 Y」 | 「A 和 B 从相反前提出发却收敛了，为什么」 |
| **深度来自** | 你覆盖了多少角度 | 你用哪个框架在看 |
| **读起来像** | 排版整齐的维基词条 | 真动过脑子的人写的备忘录 |

</div>

Wide Research 是 LLM 的出厂设置，产出的是「正确的废话」。这个 skill 就是一套护栏，把它从默认模式里拽出来。

<br>

## 文件里装了什么

一套四阶段工作流，以及比工作流更重要的东西：不让 Agent 跳过 Phase 0 的纪律。

**`Phase 0`　元思考 — 绝不外包**
一次搜索都还没发起，先拷问问题本身：为什么问这个？隐藏假设是什么？有没有一个「显而易见但其实不对」的标准答案，而这篇报告的全部价值就是说清它为什么不对？然后写下「好答案」该长什么样：核心论点摆到一屋子业内人面前得能吵起来，而不是集体点头。

**`Phase 1`　一手源精读**
找到那 3 到 5 篇真正的原始文献（财报、创始人自己写的博文、电话会议逐字稿、论文原文），完整读完。二手总结每转一手，洞见就蒸发一层。

**`Phase 2`　对比与反例**
选 2 到 3 个案例做深度对比，专门去挖失败案例和批评声音。收敛本身是发现，分歧背后的原因是更大的发现。

**`Phase 3`　交叉验证**
多源印证的可信，单源的标注存疑，互相矛盾的——这才是最有意思的地方，去分析这个矛盾意味着什么。

**`Phase 4`　把论证写出来**
段落优先于表格，每一章只推进一个论点，诚实标注不知道的部分。最后一道自检：如果核心结论放到业内不会引发任何争论，重写。

<br>

## 六种翻车方式，以及怎么当场抓住自己

这个文件最值钱的部分是「翻车目录」：把 Agent 最容易走的捷径一条条写下来，每条都配一个**检测信号**，让你（或 Agent）当场判断是不是正在犯。

**1　·　跳过 Phase 0 直接搜**
没有假设引导，subagent 返回的是信息碎片，不是论证素材。
> 检测信号：subagent 的 prompt 里没有「假设」或「待验证的论点」。

**2　·　拿 subagent 的返回结构当报告骨架**
你会得到一个伪装成分析的主题目录。
> 检测信号：章节标题拿去当搜索关键词刚好合适（「定价对比」「适合谁」）——那是文件柜，不是论证。

**3　·　用表格和 bullet 替代思考**
一个洞见如果能塞进表格，它大概率不是洞见。
> 检测信号：删掉所有表格和 bullet 后，剩下的段落撑不起一篇文章。

**4　·　结论太安全**
「A 适合新手，B 适合老手」这种话不用调研就能说。
> 检测信号：核心结论发到专业群里，没人会出来反驳或讨论。

**5　·　把「全面」当「深度」**
10 个维度各 3 句，输给 3 个维度各 3 段。
> 检测信号：报告过万字，但核心论点三句话就能说完。

**6　·　子 agent 递归 fan-out**
一次真实事故就是这条规则的由来：主 agent 派 3 个 → 变 13 个 → 变 50+ → 最终 **149 个 agent，一笔意外的 API 账单**。
> 检测信号：你在给子 agent 的 prompt 里写了「你可以用 Agent 工具进一步搜索」。停，马上要炸。

<br>

## 快速开始

```text
1.  把 SKILL.md 放进 Agent 的 skills 目录，或直接粘进系统提示词 / 项目指令
2.  要做正经报告时，让 Agent「按深度调研 skill 来」处理你的题目
3.  看着它在搜索之前先停下来做 Phase 0 —— 那个停顿，就是全部意义所在
```

任何能读 skill 文件、能派 subagent 的 Agent 都能用（Claude Code、Cursor、Cline 等）。搜索那一步默认你手上有一个搜索 / 抓取工具（比如 Tavily 这类搜索 MCP，或 Agent 自带的联网搜索），有什么用什么，skill 会自动降级适配。

- 中文主版　→　[`SKILL.md`](./SKILL.md)
- English　→　[`SKILL.en.md`](./SKILL.en.md)

<br>

## 为什么信这一份

因为它是对着一堆真实的翻车记录写出来的，不是在书房里空想的。文件里每一条反模式，都是真实调研过程中犯过、并且烧钱或丢脸到值得为它立一条规矩的错误。那个 149 个 agent 的失控故事是真的，「你的章节标题就是搜索关键词」那个信号也是真的。这是踩过的坑结成的疤，写成了提示词。

<br>

---

<div align="center">

部分脱胎自 [grapeot/context-infrastructure](https://github.com/grapeot/context-infrastructure)（MIT），核心框架与内容为本人原创扩展。<br>
以 [MIT License](./LICENSE) 发布

</div>
