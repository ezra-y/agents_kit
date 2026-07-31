---
name: thesis-figure-skill
description: Create editable academic framework diagrams, methodology flows, conceptual models, service blueprints, and system relationship figures with TikZ or draw.io. Use for thesis figures that must remain structured, inspectable, and easy to revise rather than AI-generated raster illustrations.
---

# Academic Diagram：学术论文配图工具（TikZ + draw.io）

（完整原文见 README 中的仓库链接；本存档保留全部方法论要点，2026-07-14 抓取）

## 画图哲学
每张图先服务于论文论证和可读性。四步循环：①定义成功标准 ②选择格式与布局 ③过程校验 ④完成判断。保持可编辑，不用装饰掩盖关系不清。

## 布局检查项
- 信息密度：只保留支撑论点所需的节点和关系，不设最低元素数量。
- 视觉层次：按核心、支撑和注释建立清晰层级；简单图不强行增加层级。
- 连线：不同线型和颜色只用于表达不同关系，不作为装饰指标。
- 空间：为标签和阅读路径保留稳定留白，不追求固定填充率。
- 附加值：图应揭示正文不易快速看出的结构、顺序或关联。

## 强制流程
①明确画图指令（领域/格式/布局/模块表/连线逻辑/空间规划/视觉强调）→ ②ASCII 布局草图（对齐组/视觉平衡/间距节奏三检）→ ③生成代码 → ④编译渲染 → ⑤依次检查关系错误、信息不足和排版问题 → ⑥最多集中修订三轮；仍不清楚时重新选择布局。

## 质量红线
先确认关系再写代码；交付前必须检查渲染结果。不得出现文字溢出、节点重叠、无语义的连线穿越或无法辨认的字号。

## 关键技术事实（TikZ）
xelatex+rotate=90 中文会崩；编译后必查 Missing character（静默失败）；长回路拆 3 段 \draw；-|/|- 优先于手动拐点；zone 标题用 label=；装饰 fill 放 background 层。

## 默认配色
蓝 DAE8FC/6C8EBF、绿 D5E8D4/82B366、橙 FFE6CC/D79B00、紫 E1D5E7/9673A6、红 F8CECC/B85450、灰 F5F5F5/666666。只有在颜色承担稳定语义时使用多色；打印或学校模板要求优先。
