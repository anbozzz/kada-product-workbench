import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"

const parser = unified().use(remarkParse).use(remarkGfm)
const expandable = new Set(["heading", "list", "table", "blockquote", "code", "image", "imageReference"])

export function hasMarkdownStructure(source: string): boolean {
  const visit = (node: { type: string; children?: readonly { type: string }[] }): boolean =>
    expandable.has(node.type) || Boolean(node.children?.some(visit))
  return visit(parser.parse(source))
}
