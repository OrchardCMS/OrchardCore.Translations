"""Validate the gettext grammar and limits supported by Orchard Core's PO parser."""

import re


class _ExpressionParser:
    _operators = (
        ("||",), ("&&",), ("==", "!="), ("<=", ">=", "<", ">"),
        ("+", "-"), ("*", "/", "%"),
    )

    def __init__(self, expression):
        self.tokens = re.findall(
            r"[0-9]+|==|!=|<=|>=|&&|\|\||[^\s]", expression
        )
        self.position = 0

    def consume(self, token):
        if self.position < len(self.tokens) and self.tokens[self.position] == token:
            self.position += 1
            return True
        return False

    def ternary(self, depth=1):
        if depth > 64:
            raise ValueError("plural expression exceeds Orchard Core's nesting limit")
        self.binary(0, depth)
        if self.consume("?"):
            self.ternary(depth + 1)
            if not self.consume(":"):
                raise ValueError("missing ':' in plural expression")
            self.ternary(depth + 1)

    def binary(self, level, depth):
        if level == len(self._operators):
            self.unary(depth)
            return
        self.binary(level + 1, depth)
        while any(self.consume(operator) for operator in self._operators[level]):
            self.binary(level + 1, depth)

    def unary(self, depth):
        if depth > 64:
            raise ValueError("plural expression exceeds Orchard Core's nesting limit")
        if self.consume("!"):
            self.unary(depth + 1)
        elif self.consume("("):
            self.ternary(depth + 1)
            if not self.consume(")"):
                raise ValueError("missing ')' in plural expression")
        elif self.consume("n"):
            return
        elif self.position < len(self.tokens):
            token = self.tokens[self.position]
            if not re.fullmatch(r"[0-9]+", token) or int(token) > 9223372036854775807:
                raise ValueError("unsupported token or integer in plural expression")
            self.position += 1
        else:
            raise ValueError("missing operand in plural expression")

    def validate(self):
        self.ternary()
        if self.position != len(self.tokens):
            raise ValueError("unexpected token in plural expression")


def plural_count(header, label):
    """Validate syntax, without evaluating or compiling catalog-supplied expressions."""
    try:
        if not isinstance(header, str):
            raise ValueError("missing Plural-Forms header")
        fields = {}
        for part in header.split(";"):
            if not part.strip():
                continue
            name, separator, value = part.partition("=")
            name = name.strip().lower()
            if not separator or name not in ("nplurals", "plural"):
                raise ValueError("unsupported Plural-Forms field")
            fields[name] = value.strip()
        count = fields.get("nplurals", "")
        if not re.fullmatch(r"[0-9]+", count) or not 1 <= int(count) <= 100:
            raise ValueError("nplurals must be between 1 and 100")
        expression = fields.get("plural", "")
        if not expression or len(expression.encode("utf-16-le")) // 2 > 1024:
            raise ValueError("plural expression must contain 1 to 1024 UTF-16 code units")
        _ExpressionParser(expression).validate()
        return int(count)
    except ValueError as error:
        raise ValueError(
            f"{label}: invalid or unsupported Plural-Forms header: {header!r}: {error}"
        ) from error
