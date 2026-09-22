#!/usr/bin/env python3
"""Validate the stable structure of Architecture Design, ADR, and RFC Markdown."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


DESIGN_HEADINGS = [
    "## 1. 结论与适用性",
    "## 2. 目标、范围与依据",
    "## 3. 架构驱动因素",
    "## 4. 整体设计",
    "## 5. 候选方案与取舍",
    "## 6. 实施、迁移与回滚",
    "## 7. 验证与可观测性",
    "## 8. 决定、风险与后续",
]
ADR_HEADINGS = [
    "## 背景与问题（Context and Problem）",
    "## 决策驱动因素（Decision Drivers）",
    "## 候选方案（Considered Options）",
    "## 决定结果（Decision Outcome）",
    "## 后果（Consequences）",
    "## 验证遵循情况（Confirmation）",
    "## 关联信息（More Information）",
]
RFC_HEADINGS = [
    "## 1. 问题与范围",
    "## 2. 当前事实、约束与 Unknown",
    "## 3. 提案",
    "## 4. 候选与 Trade-off",
    "## 5. 迁移、回滚与验证",
    "## 6. 需要回复的问题",
    "## 7. 意见记录",
    "## 8. 关闭结果",
]
PLACEHOLDER = re.compile(r"<[^>\n]+>|YYYY-MM-DD")


def frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}
    result: dict[str, str] = {}
    for line in text[4:end].splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            result[key.strip()] = value.strip()
    return result


def require_in_order(text: str, headings: list[str], errors: list[str]) -> None:
    cursor = -1
    for heading in headings:
        position = text.find(heading)
        if position < 0:
            errors.append(f"缺少固定章节：{heading}")
        elif position <= cursor:
            errors.append(f"章节顺序错误：{heading}")
        cursor = max(cursor, position)


def validate(path: Path, allow_template: bool) -> list[str]:
    text = path.read_text(encoding="utf-8")
    errors: list[str] = []
    title = next((line for line in text.splitlines() if line.startswith("# ")), "")

    if title.startswith("# 技术架构设计："):
        require_in_order(text, DESIGN_HEADINGS, errors)
        for field in ("Status", "Date", "Project", "Scope", "Product source", "Technical evidence", "Related decisions"):
            if not re.search(rf"^\| {re.escape(field)} \| .+ \|$", text, re.MULTILINE):
                errors.append(f"缺少设计元数据：{field}")
        status_match = re.search(r"^\| Status \| ([^|]+) \|$", text, re.MULTILINE)
        if status_match and status_match.group(1).strip() not in {"proposed", "adopted", "implemented", "superseded"}:
            errors.append("Design status 不在允许集合中")
    elif re.match(r"# ADR-(?:\d{4}|<NNNN>)：", title):
        require_in_order(text, ADR_HEADINGS, errors)
        meta = frontmatter(text)
        for field in ("status", "date", "scope", "supersedes", "superseded-by"):
            if field not in meta:
                errors.append(f"缺少 ADR 元数据：{field}")
        if meta.get("status") not in {"proposed", "accepted", "rejected", "deprecated", "superseded"}:
            errors.append("ADR status 不在允许集合中")
    elif re.match(r"# RFC-(?:\d{4}|<NNNN>)：", title):
        require_in_order(text, RFC_HEADINGS, errors)
        meta = frontmatter(text)
        for field in ("status", "result", "date", "response-deadline", "scope", "owner"):
            if field not in meta:
                errors.append(f"缺少 RFC 元数据：{field}")
        if meta.get("status") not in {"draft", "open", "closed"}:
            errors.append("RFC status 不在允许集合中")
        result = meta.get("result")
        if result not in {"pending", "adopted", "rejected", "withdrawn", "replaced"}:
            errors.append("RFC result 不在允许集合中")
        if meta.get("status") == "closed" and result == "pending":
            errors.append("已关闭 RFC 不能保留 pending 结果")
    else:
        errors.append("无法识别产物类型或标题编号不是四位数")

    if not allow_template:
        source_text = re.sub(r"(?m)^[ ]{0,3}<!--\s*architecture-id:\s*[^\s<>]+\s*-->[ \t]*$", "", text)
        placeholders = sorted(set(PLACEHOLDER.findall(source_text)))
        if placeholders:
            errors.append("仍有模板占位符：" + "、".join(placeholders[:8]))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--template", action="store_true", help="允许模板占位符")
    args = parser.parse_args()

    failed = False
    for path in args.paths:
        if not path.is_file():
            print(f"[FAIL] {path}: 文件不存在", file=sys.stderr)
            failed = True
            continue
        errors = validate(path, args.template)
        if errors:
            failed = True
            print(f"[FAIL] {path}", file=sys.stderr)
            for error in errors:
                print(f"  - {error}", file=sys.stderr)
        else:
            print(f"[PASS] {path}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
