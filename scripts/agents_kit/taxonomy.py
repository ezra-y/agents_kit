from __future__ import annotations

import re
from collections import Counter
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .repository import Repository

TAG_PATTERN = re.compile(r"^[a-z][a-z0-9-]*/[a-z0-9][a-z0-9-]*$")


class TaxonomyError(RuntimeError):
    pass


def normalize_tags(repo: Repository, tags: list[str]) -> list[str]:
    validate_tags(repo, tags)
    namespace_order = {name: index for index, name in enumerate(repo.tag_namespaces)}
    return sorted(
        tags,
        key=lambda tag: (
            namespace_order[tag.split("/", 1)[0]],
            tag.split("/", 1)[1],
        ),
    )


def validate_tags(repo: Repository, tags: Any) -> None:
    validate_known_tags(repo, tags)
    counts = Counter(tag.split("/", 1)[0] for tag in tags)
    for namespace, definition in repo.tag_namespaces.items():
        count = counts[namespace]
        minimum = definition["min"]
        maximum = definition["max"]
        if count < minimum:
            raise TaxonomyError(f"缺少 {namespace} 标签，至少需要 {minimum} 个")
        if count > maximum:
            raise TaxonomyError(f"{namespace} 标签最多 {maximum} 个，当前 {count} 个")


def validate_known_tags(repo: Repository, tags: Any) -> None:
    if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
        raise TaxonomyError("tags 必须是字符串数组")
    if len(tags) != len(set(tags)):
        raise TaxonomyError("tags 不能重复")
    if len(tags) > repo.max_tags:
        raise TaxonomyError(f"tags 最多 {repo.max_tags} 个")

    for tag in tags:
        if not TAG_PATTERN.fullmatch(tag):
            raise TaxonomyError(f"标签格式无效：{tag}")
        namespace, value = tag.split("/", 1)
        definition = repo.tag_namespaces.get(namespace)
        if definition is None:
            raise TaxonomyError(f"未知标签命名空间：{namespace}")
        if value not in definition["values"]:
            raise TaxonomyError(f"未登记标签：{tag}")


def validate_definition(config: dict[str, Any]) -> None:
    version = config.get("taxonomy_version")
    if not isinstance(version, int) or version < 1:
        raise TaxonomyError("taxonomy_version 必须是正整数")

    categories = config.get("categories")
    if not isinstance(categories, dict) or not categories:
        raise TaxonomyError("categories 必须是非空对象")
    for category, definition in categories.items():
        if not isinstance(category, str) or not TAG_PATTERN.fullmatch(
            f"category/{category}"
        ):
            raise TaxonomyError(f"分类 ID 无效：{category}")
        if not isinstance(definition, dict) or not all(
            isinstance(definition.get(key), str) and definition[key].strip()
            for key in ("label", "description")
        ):
            raise TaxonomyError(f"分类定义不完整：{category}")

    namespaces = config.get("tag_namespaces")
    if not isinstance(namespaces, dict) or not namespaces:
        raise TaxonomyError("tag_namespaces 必须是非空对象")
    for namespace, definition in namespaces.items():
        if not isinstance(namespace, str) or not TAG_PATTERN.fullmatch(
            f"{namespace}/value"
        ):
            raise TaxonomyError(f"标签命名空间无效：{namespace}")
        if not isinstance(definition, dict):
            raise TaxonomyError(f"标签命名空间定义无效：{namespace}")
        label = definition.get("label")
        minimum = definition.get("min")
        maximum = definition.get("max")
        values = definition.get("values")
        if not isinstance(label, str) or not label.strip():
            raise TaxonomyError(f"标签命名空间缺 label：{namespace}")
        if (
            not isinstance(minimum, int)
            or not isinstance(maximum, int)
            or minimum < 0
            or maximum < minimum
        ):
            raise TaxonomyError(f"标签数量约束无效：{namespace}")
        if (
            not isinstance(values, list)
            or not values
            or any(
                not isinstance(value, str)
                or not TAG_PATTERN.fullmatch(f"{namespace}/{value}")
                for value in values
            )
            or len(values) != len(set(values))
        ):
            raise TaxonomyError(f"标签词表无效：{namespace}")

    max_tags = config.get("max_tags")
    required_tags = sum(item["min"] for item in namespaces.values())
    if not isinstance(max_tags, int) or max_tags < required_tags:
        raise TaxonomyError("max_tags 小于各命名空间的最低标签数")
