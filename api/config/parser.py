"""Parser/dumper de configuração nginx com preservação de comentários.

Modela a config como uma árvore de nós:

  * Directive(name, args)          -> `name args;`
  * Block(name, args, children)    -> `name args { ... }`
  * Comment(text)                  -> `# text`

O objetivo é permitir ler a config, alterar sub-árvores específicas e
re-serializar (dump) mantendo os comentários. O espaçamento/linhas em branco
originais NÃO são preservados byte-a-byte — o dump normaliza a indentação —,
por isso só reescrevemos arquivos efetivamente modificados.
"""
from __future__ import annotations

from typing import Iterator


# --------------------------------------------------------------------------- #
# Nós da árvore
# --------------------------------------------------------------------------- #
class Node:
    def to_json(self) -> dict:  # pragma: no cover - sobrescrito
        raise NotImplementedError


class Comment(Node):
    def __init__(self, text: str):
        self.text = text

    def to_json(self) -> dict:
        return {"type": "comment", "text": self.text}


class Directive(Node):
    def __init__(self, name: str, args: list[str]):
        self.name = name
        self.args = args

    def to_json(self) -> dict:
        return {"type": "directive", "name": self.name, "args": list(self.args)}


class Block(Node):
    def __init__(self, name: str, args: list[str], children: list[Node] | None = None):
        self.name = name
        self.args = args
        self.children = children if children is not None else []

    def to_json(self) -> dict:
        return {
            "type": "block",
            "name": self.name,
            "args": list(self.args),
            "children": [c.to_json() for c in self.children],
        }

    def walk(self) -> Iterator[Node]:
        for c in self.children:
            yield c
            if isinstance(c, Block):
                yield from c.walk()


def node_from_json(data: dict) -> Node:
    t = data.get("type")
    if t == "comment":
        return Comment(data.get("text", ""))
    if t == "directive":
        return Directive(data["name"], list(data.get("args", [])))
    if t == "block":
        return Block(
            data["name"],
            list(data.get("args", [])),
            [node_from_json(c) for c in data.get("children", [])],
        )
    raise ValueError(f"nó inválido: {data!r}")


# --------------------------------------------------------------------------- #
# Tokenizer
# --------------------------------------------------------------------------- #
class _Token:
    __slots__ = ("kind", "value", "quoted")

    def __init__(self, kind: str, value: str = "", quoted: bool = False):
        self.kind = kind      # word | punct | comment
        self.value = value
        self.quoted = quoted


def _tokenize(text: str) -> list[_Token]:
    tokens: list[_Token] = []
    i, n = 0, len(text)
    cur = ""
    cur_quoted = False
    while i < n:
        c = text[i]
        if c == "#":
            if cur != "" or cur_quoted:
                tokens.append(_Token("word", cur, cur_quoted))
                cur, cur_quoted = "", False
            j = text.find("\n", i)
            if j == -1:
                j = n
            tokens.append(_Token("comment", text[i + 1:j].strip()))
            i = j
            continue
        if c in "\"'":
            quote = c
            i += 1
            buf = ""
            while i < n and text[i] != quote:
                if text[i] == "\\" and i + 1 < n:
                    buf += text[i + 1]  # unescape: \X -> X
                    i += 2
                    continue
                buf += text[i]
                i += 1
            i += 1  # consome a aspa de fechamento
            cur += buf
            cur_quoted = True
            continue
        if c in "{};":
            if cur != "" or cur_quoted:
                tokens.append(_Token("word", cur, cur_quoted))
                cur, cur_quoted = "", False
            tokens.append(_Token("punct", c))
            i += 1
            continue
        if c.isspace():
            if cur != "" or cur_quoted:
                tokens.append(_Token("word", cur, cur_quoted))
                cur, cur_quoted = "", False
            i += 1
            continue
        cur += c
        i += 1
    if cur != "" or cur_quoted:
        tokens.append(_Token("word", cur, cur_quoted))
    return tokens


# --------------------------------------------------------------------------- #
# Parser
# --------------------------------------------------------------------------- #
def parse(text: str) -> Block:
    """Parseia um arquivo de configuração em um Block raiz (name='')."""
    tokens = _tokenize(text)
    root = Block("", [])
    stack = [root]
    words: list[str] = []
    for tok in tokens:
        if tok.kind == "comment":
            stack[-1].children.append(Comment(tok.value))
            continue
        if tok.kind == "word":
            words.append(tok.value)
            continue
        # punct
        if tok.value == "{":
            name = words[0] if words else ""
            blk = Block(name, words[1:])
            stack[-1].children.append(blk)
            stack.append(blk)
            words = []
        elif tok.value == "}":
            if len(stack) > 1:
                stack.pop()
            words = []
        elif tok.value == ";":
            if words:
                stack[-1].children.append(Directive(words[0], words[1:]))
            words = []
    return root


# --------------------------------------------------------------------------- #
# Dumper
# --------------------------------------------------------------------------- #
_SPECIAL = set(" \t\r\n{};#\"'")


def _quote(arg: str) -> str:
    if arg == "" or any(ch in _SPECIAL for ch in arg):
        escaped = arg.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return arg


def _dump_nodes(nodes: list[Node], indent: int, out: list[str]) -> None:
    pad = "    " * indent
    for node in nodes:
        if isinstance(node, Comment):
            out.append(f"{pad}# {node.text}" if node.text else f"{pad}#")
        elif isinstance(node, Directive):
            args = " ".join(_quote(a) for a in node.args)
            line = _quote(node.name) + (f" {args}" if args else "")
            out.append(f"{pad}{line};")
        elif isinstance(node, Block):
            head = node.name
            if node.args:
                head += " " + " ".join(_quote(a) for a in node.args)
            out.append(f"{pad}{head} {{".strip() if not node.name and not node.args
                       else f"{pad}{head} {{")
            _dump_nodes(node.children, indent + 1, out)
            out.append(f"{pad}}}")


def dump(root: Block) -> str:
    out: list[str] = []
    _dump_nodes(root.children, 0, out)
    return "\n".join(out) + "\n"


def dump_nodes(nodes: list[Node]) -> str:
    """Serializa uma lista de nós (ex.: os filhos de um server block)."""
    if not nodes:
        return ""
    out: list[str] = []
    _dump_nodes(nodes, 0, out)
    return "\n".join(out) + "\n"
