# PubMed Search Skill for Antigravity/Claude Code

PubMed/PMC医学文献検索スキル。依存関係なしでPubMed APIに直接アクセスし、文献検索、抄録取得、被引用数分析などが可能です。

## 🚀 機能

| 機能 | 説明 |
|------|------|
| **文献検索** | キーワード、MeSH用語、著者名で検索（関連度順/日付順でソート可能） |
| **要約取得** | タイトル、著者、ジャーナル、PMCID等のメタデータを取得 |
| **抄録取得** | 詳細なメタデータを含む抄録をXML形式で取得 |
| **類似論文検索** | 関連論文を類似度スコア付きで取得 |
| **被引用数分析** | iCite APIで引用カウント、相対引用率（RCR）、NIHパーセンタイルを取得 |
| **PMC全文/PDF** | Open Access論文のリンクを取得 |
| **RIS/MEDLINE出力** | 参考文献管理ソフト用にエクスポート |

## 📦 インストール

### Antigravity/OpenClawへのインストール

```bash
# スキルフォルダにクローン
git clone https://github.com/masa061580/pubmed-skill.git .agent/skills/pubmed

# または手動でコピー
mkdir -p .agent/skills/pubmed
cp SKILL.md .agent/skills/pubmed/
cp -r references .agent/skills/pubmed/
```

### Claude Codeへのインストール

```bash
# ユーザーディレクトリにコピー
mkdir -p ~/.claude/skills/pubmed
cp SKILL.md ~/.claude/skills/pubmed/
cp -r references ~/.claude/skills/pubmed/
```

## 🔧 依存関係

**なし！** このスキルはPubMed E-utilities APIに直接アクセスするため、追加のパッケージは不要です。

## Claude Web UIで使用する場合
以下のDomainをAllowed Listに手動で追加する必要があります。
```
eutils.ncbi.nlm.nih.gov
esummary.ncbi.nlm.nih.gov
icite.od.nih.gov
www.ncbi.nlm.nih.gov
```


## 📖 使用方法

### 基本的な検索

```bash
# PubMedで検索（AIが自動的にAPIにアクセス）
"大腸内視鏡AIについてPubMedで検索して"

# MeSH用語を使った検索
"colonoscopy[mh] AND artificial intelligence[mh]で検索"

# 著者検索
"Misawa H著者の論文を検索"
```

### API直接アクセス（上級者向け）

```
# 検索（日付順）
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=QUERY&retmax=20&retmode=json&sort=pub_date

# 検索（関連度順）
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=QUERY&retmax=20&retmode=json&sort=relevance

# 要約取得
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=PMID1,PMID2&retmode=json

# 抄録取得
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=PMID1,PMID2&rettype=abstract&retmode=xml

# 被引用数（iCite）
https://icite.od.nih.gov/api/pubs?pmids=PMID1,PMID2,PMID3
```

## 📚 APIエンドポイント一覧

| 機能 | エンドポイント |
|------|---------------|
| 検索 | `eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` |
| 要約 | `eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi` |
| 取得 | `eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi` |
| 類似検索 | `eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi` |
| 被引用数 | `icite.od.nih.gov/api/pubs` |
| PMC全文 | `www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi` |

## 🔍 クエリ構文

詳細なMeSH用語とクエリ構文については [references/query-syntax.md](references/query-syntax.md) を参照してください。

### よく使うフィールド

| フィールド | 説明 | 例 |
|-----------|------|-----|
| `[mh]` | MeSH用語 | `colonoscopy[mh]` |
| `[tiab]` | タイトル/抄録 | `AI[tiab]` |
| `[au]` | 著者 | `Misawa H[au]` |
| `[dp]` | 出版日 | `2024[dp]` |
| `[pt]` | 出版タイプ | `review[pt]` |

## ⚡ レート制限

| 条件 | 制限 |
|------|------|
| APIキーなし | 3リクエスト/秒 |
| APIキーあり | 10リクエスト/秒 |

APIキーは [NCBI Settings](https://www.ncbi.nlm.nih.gov/account/settings/) から取得できます。

## 📁 フォルダ構成

```
pubmed-skill/
├── README.md              # このファイル
├── SKILL.md               # スキル定義（Antigravity形式）
└── references/
    └── query-syntax.md    # MeSH用語とクエリ構文リファレンス
```

## 🔗 関連スキル

- [citation-skill](https://github.com/masa061580/citation-skill) - Zotero/BibTeX検索とPandoc引用生成

## 📄 ライセンス

MIT License

## 🤝 貢献

Issue、Pull Requestは歓迎します！
