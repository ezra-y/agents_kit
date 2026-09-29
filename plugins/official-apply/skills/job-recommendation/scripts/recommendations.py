import argparse
import json
import os
import re
from pathlib import Path
import tempfile
from urllib.parse import urlparse
import xml.etree.ElementTree as ET


STATUSES = {"待选择", "待投递", "处理中", "已提交", "需要处理", "提交结果待核实"}
FINAL_STATUSES = {"已提交", "处理中", "提交结果待核实"}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        temporary = stream.name
    os.replace(temporary, path)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def all_jobs(batch):
    for company in batch["companies"]:
        for rank, job in enumerate(company["jobs"], 1):
            yield company, rank, job


def validate(batch):
    for key in ("title", "materialSummary", "orderPolicy"):
        require(isinstance(batch.get(key), str) and batch[key].strip(), f"缺少 {key}")
    require(isinstance(batch.get("companies"), list), "companies 必须为数组")
    companies, urls = set(), set()
    for company in batch["companies"]:
        name = company.get("name")
        require(isinstance(name, str) and name.strip() and name not in companies, "公司名称为空或重复")
        companies.add(name)
        require(isinstance(company.get("jobs"), list), f"{name} 缺少 jobs")
        limit = company.get("maxApplications")
        require(limit is None or (type(limit) is int and limit >= 0), f"{name} 投递上限无效")
        count = company.get("submittedBefore")
        require(count is None or (type(count) is int and count >= 0), f"{name} 已提交数量无效")
        if limit is not None:
            require(bool(company.get("limitSource")), f"{name} 缺少名额依据")
        for job in company["jobs"]:
            for key in ("title", "url", "source", "checkedAt"):
                require(isinstance(job.get(key), str) and job[key].strip(), f"{name} 岗位缺少 {key}")
            require(isinstance(job.get("jd"), str), f"{name} JD 必须为文本")
            require(bool(job["jd"].strip()) or job.get("informationStatus") == "待核实", f"{name} 缺少完整 JD")
            url = urlparse(job["url"])
            require(url.scheme in {"http", "https"} and url.netloc, "岗位链接无效")
            require(job["url"] not in urls, f"岗位链接重复：{job['url']}")
            urls.add(job["url"])
            score = job.get("score")
            require((type(score) is int and 0 <= score <= 100) or
                    (score is None and job.get("informationStatus") == "待核实"), f"{job['title']} 适配度须为 0～100 整数；待核实可留空")
            require(job.get("status", "待选择") in STATUSES, f"{job['title']} 状态无效")
            require(isinstance(job.get("preferenceScope", ""), str), "志愿分组须为文本")
        for owner in [company, *company["jobs"]]:
            for key in ("maxApplications", "remainingApplications", "submittedBefore", "preferenceRank"):
                value = owner.get(key)
                require(value is None or (type(value) is int and value >= (1 if key == "preferenceRank" else 0)),
                        f"{name} {key} 无效")
    return batch


def text_node(parent, tag, text, **attributes):
    node = ET.SubElement(parent, tag, attributes)
    lines = str(text).split("\n")
    node.text = lines[0]
    for line in lines[1:]:
        ET.SubElement(node, "br").tail = line
    return node


def selected_count(company):
    return sum(job.get("selected", False) for job in company["jobs"])


def submitted_count(company):
    previous = company.get("submittedBefore")
    return None if previous is None else previous + sum(job.get("status") == "已提交" for job in company["jobs"])


def terms(batch, company, job):
    return {"company": company["name"], "title": job["title"], "url": job["url"],
            "city": job.get("city", ""), "materialSummary": batch["materialSummary"],
            "orderPolicy": batch["orderPolicy"], "preferenceScope": job.get("preferenceScope", "")}


def render(batch):
    require(not batch.get("document"), "已有文档请读取最新选择并按块更新，保留原确认块")
    root = ET.Element("root")
    text_node(root, "title", batch["title"])
    text_node(root, "p", f"使用材料：{batch['materialSummary']}\n志愿顺序：{batch['orderPolicy']}")
    text_node(root, "p", "在“投递志愿”后填写 1、2、3……表示确认投递及顺序，留空表示暂不投递。每个公司或独立招聘项目从 1 开始连续填写。")
    for company in batch["companies"]:
        text_node(root, "h1", company["name"], seq="auto")
        limit = company.get("maxApplications")
        submitted = submitted_count(company)
        limit_text = company.get("limitText") or (str(limit) if limit is not None else "待核实")
        text_node(root, "p", f"官网投递规则：{limit_text}　已选：{selected_count(company)}　当前入口已提交：{submitted if submitted is not None else '待核实'}")
        if not company["jobs"]:
            text_node(root, "p", "当前没有合适的岗位。")
        for job in company["jobs"]:
            heading = ET.SubElement(root, "h2", {"seq": "auto"})
            text_node(heading, "a", job["title"], href=job["url"])
            fields = [f"适配度 {job['score']}/100" if job.get("score") is not None else "适配度待核实"]
            for key, label in (("city", "地点"), ("salary", "薪资"), ("recruitmentType", "招聘类型"),
                               ("eligibility", "申请条件"), ("deadline", "截止日期"), ("limitText", "投递规则")):
                if job.get(key):
                    fields.append(f"{label}：{job[key]}")
            text_node(root, "p", "　｜　".join(fields))
            confirmation = ET.SubElement(root, "p")
            text_node(confirmation, "a", "投递志愿", href=job["url"]).tail = "："
            text_node(root, "p", f"投递状态：{job.get('status', '待选择')}")
            text_node(root, "p", job["jd"] or "完整职位说明待核实。")
    return "\n".join(ET.tostring(node, encoding="unicode") for node in root)


def snapshot_document(snapshot):
    require(snapshot.get("ok") is True, "文档读取失败")
    document = snapshot["data"]["document"]
    root = ET.fromstring("<root>" + document["content"] + "</root>")
    require(root.find("fragment") is None, "需要完整文档，不能使用局部或关键词快照")
    return document, root


def block_id(node):
    return node.get("block-id") or node.get("id")


def preference(node, url):
    if node is None or node.tag != "p":
        return None, "岗位确认项缺失，需要恢复原确认项"
    links = list(node.iter("a"))
    if len(links) != 1 or links[0].get("href") != url:
        return None, "确认项链接已变化，需要核对具体岗位"
    if "".join(links[0].itertext()).strip() != "投递志愿":
        return None, "确认行文字发生变化，需要核对投递意愿"
    match = re.fullmatch(r"投递志愿\s*[：:]\s*([1-9][0-9]*)?", "".join(node.itertext()).strip())
    if match is None:
        return None, "投递志愿请填写正整数或留空"
    return int(match[1]) if match[1] else None, ""


def bind(batch, snapshot, url):
    document, root = snapshot_document(snapshot)
    previous = batch.get("document", {})
    require(not previous or previous["id"] == document["document_id"], "增量绑定须使用原文档")
    nodes = {block_id(node): node for node in root.iter() if block_id(node)}
    known_urls = {job["url"] for _, _, job in all_jobs(batch)}
    by_url = {}
    for node in root.iter("p"):
        for link in node.iter("a"):
            href = link.get("href")
            if href not in known_urls or "".join(link.itertext()).strip() != "投递志愿":
                continue
            require(href not in by_url, "同一岗位出现多个确认项")
            by_url[href] = node
    bindings = {}
    history = list(previous.get("previousBindings", []))
    for company, _, job in all_jobs(batch):
        saved = previous.get("bindings", {}).get(job["url"])
        published = terms(batch, company, job)
        if (saved and saved["published"] == published and saved["blockId"] in nodes
                and nodes[saved["blockId"]].tag == "p"):
            bindings[job["url"]] = saved
            continue
        node = by_url.get(job["url"])
        require(node is not None and block_id(node), f"没有找到岗位确认块：{job['title']}")
        rank, problem = preference(node, job["url"])
        require(not problem and rank is None, "新增或重新确认的投递志愿须留空")
        require(not saved or saved["blockId"] != block_id(node), "申请内容变化后，请创建新的空白确认项")
        if saved:
            history.append({"url": job["url"], **saved})
        job["selected"] = False
        job["preferenceRank"] = None
        bindings[job["url"]] = {"blockId": block_id(node), "published": published}
    batch["document"] = {"id": document["document_id"], "url": url, "bindings": bindings,
                         "previousBindings": history}
    return batch


def quota_problem(jobs, owners, previous_default=None):
    pending = [job for job in jobs if job.get("selected") and job.get("status") not in FINAL_STATUSES]
    if not pending:
        return ""
    values = {key: {owner[key] for owner in owners if owner.get(key) is not None}
              for key in ("remainingApplications", "maxApplications", "submittedBefore")}
    if any(len(options) > 1 for options in values.values()):
        return "同一名额范围的资料不一致，需要核实"
    remaining, limit, previous = (next(iter(values[key]), None)
                                 for key in ("remainingApplications", "maxApplications", "submittedBefore"))
    if previous is None:
        previous = previous_default
    processing = sum(job.get("status") in {"处理中", "提交结果待核实"} for job in jobs)
    if remaining is not None:
        if len(pending) + processing > remaining:
            return f"已选数量超过官网剩余名额 {remaining}"
    elif limit is not None:
        if previous is None:
            return "需要先核实官网已有申请数量"
        occupied = previous + processing + sum(job.get("status") == "已提交" for job in jobs)
        if len(pending) + occupied > limit:
            return f"已选数量超过官网名额 {limit}"
    return ""


def choices(batch, snapshot):
    document, root = snapshot_document(snapshot)
    binding = batch["document"]
    require(document["document_id"] == binding["id"], "读取的文档与本批绑定不一致")
    nodes = {block_id(node): node for node in root.iter() if block_id(node)}
    selected, ready, blocked = [], [], []
    for company, _, job in all_jobs(batch):
        saved = binding["bindings"].get(job["url"])
        node = nodes.get(saved["blockId"]) if saved else None
        rank, problem = preference(node, job["url"])
        job["preferenceRank"] = rank
        job["selected"] = rank is not None
        if not problem and saved["published"] != terms(batch, company, job):
            problem = "岗位或材料已变化，需要重新确认"
        if not problem and job.get("informationStatus") == "待核实":
            problem = "岗位资料待核实"
        if problem:
            if job.get("status", "待选择") not in FINAL_STATUSES:
                job["status"] = "需要处理"
            blocked.append({"url": job["url"], "reason": problem})
            if job.get("selected"):
                selected.append(job["url"])
            continue
        if job.get("status", "待选择") not in FINAL_STATUSES:
            job["status"] = "待投递" if job["selected"] else "待选择"
        if job["selected"]:
            selected.append(job["url"])
    for company in batch["companies"]:
        company_problem = quota_problem(company["jobs"], [company])
        groups = {}
        for job in company["jobs"]:
            groups.setdefault(job.get("preferenceScope", ""), []).append(job)
        for scope, jobs in groups.items():
            chosen = [job for job in jobs if job.get("selected")]
            pending = [job for job in chosen if job.get("status") not in FINAL_STATUSES]
            ranks = sorted(job["preferenceRank"] for job in chosen)
            problem = ""
            if len(ranks) != len(set(ranks)):
                problem = "同一志愿组的数字重复，请调整投递志愿"
            elif ranks != list(range(1, len(ranks) + 1)):
                problem = "同一志愿组须从 1 开始连续填写，请补全投递志愿"
            blocked_urls = {item["url"] for item in blocked}
            if any(job["url"] in blocked_urls for job in chosen):
                problem = problem or "同组已选岗位需要处理，待核实后按志愿顺序继续"
            if scope:
                owners = [{key: job.get(key, company.get(key) if len(groups) == 1 else None)
                           for key in ("remainingApplications", "maxApplications", "submittedBefore")} for job in jobs]
                scoped_problem = quota_problem(jobs, owners, 0 if submitted_count(company) == 0 else None)
            else:
                scoped_problem = ""
            problem = problem or company_problem or scoped_problem
            if problem:
                blocked.extend({"url": job["url"], "reason": problem} for job in chosen)
                for job in pending:
                    job["status"] = "需要处理"
                continue
            ready.extend({"company": company["name"], "title": job["title"], "url": job["url"],
                          "taskId": job.get("taskId"), "recordId": job.get("recordId"),
                          "loginProfileName": company.get("loginProfileName"),
                          "preferenceScope": scope, "preferenceRank": job["preferenceRank"],
                          "documentId": binding["id"], "confirmationBlockId": binding["bindings"][job["url"]]["blockId"]}
                         for job in sorted(pending, key=lambda job: job["preferenceRank"]) if job["url"] not in blocked_urls)
    return {"documentId": binding["id"], "revisionId": document.get("revision_id"),
            "selected": selected, "ready": ready, "blocked": blocked}


def records(batch):
    result = []
    for company, rank, job in all_jobs(batch):
        fields = {"公司": company["name"], "岗位": job["title"], "岗位链接": job["url"],
                  "完整JD": job["jd"], "适配度": job.get("score"), "推荐顺序": rank,
                  "确认投递": job.get("selected", False), "提交状态": job.get("status", "待选择"),
                  "投递志愿": job.get("preferenceRank"),
                  "已选数量": selected_count(company), "可投数量": job.get("maxApplications", company.get("maxApplications")),
                  "当前入口已投数量": submitted_count(company),
                  "剩余可投数量": job.get("remainingApplications", company.get("remainingApplications")),
                  "投递规则": job.get("limitText") or company.get("limitText") or company.get("limitSource", ""),
                  "阅读文档": batch.get("document", {}).get("url", "")}
        for key, label in (("city", "工作地点"), ("salary", "薪资"), ("recruitmentType", "招聘类型"),
                           ("eligibility", "届别要求"), ("deadline", "截止日期"), ("organization", "招聘单位/部门")):
            fields[label] = job.get(key, "")
        result.append({"recordId": job.get("recordId"), "fields": fields})
    return result


def main():
    parser = argparse.ArgumentParser(description="生成岗位资料、绑定飞书文档并读取用户选择")
    parser.add_argument("command", choices=["validate", "render", "bind", "choices", "records"])
    parser.add_argument("--batch", required=True, type=Path)
    parser.add_argument("--snapshot", type=Path)
    parser.add_argument("--url")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    batch = validate(read_json(args.batch))
    if args.command == "render":
        require(args.output is not None, "render 需要 --output")
        args.output.write_text(render(batch), encoding="utf-8")
        result = {"output": str(args.output)}
    elif args.command == "bind":
        require(args.snapshot is not None and args.url, "bind 需要 --snapshot 和 --url")
        bind(batch, read_json(args.snapshot), args.url)
        write_json(args.batch, batch)
        result = batch["document"]
    elif args.command == "choices":
        require(args.snapshot is not None, "choices 需要 --snapshot")
        result = choices(batch, read_json(args.snapshot))
        write_json(args.batch, batch)
    elif args.command == "records":
        result = records(batch)
    else:
        result = {"companies": len(batch["companies"]), "jobs": sum(1 for _ in all_jobs(batch))}
    if args.output and args.command != "render":
        write_json(args.output, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
