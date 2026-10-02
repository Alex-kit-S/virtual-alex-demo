#!/usr/bin/env python3
"""scripts/tests/code_standard_ast.py - the Python half of the code-standard checker.

WHAT. Reads Python files and reports, as one JSON document on stdout, what the JavaScript side of
the checker cannot see for itself: every comment, every docstring, the module docstring, whether the
file has a main guard, the encoding Python reads it in, the tests that pin a known defect, the calls
that read another file as text, and the code with the comments and docstrings taken out.
scripts/tests/code-standard.mjs is its only caller outside its own test.

HOW. main() calls describe() per named file, which decodes it as Python would (read_source) and
reports a decode, parse or depth failure inside the JSON rather than failing the whole batch. A
decoded file's facts come from facts_of: the comments, the docstrings, the main guard, the encoding
and the code with comments and docstrings blanked out, plus two further outputs it calls for - every
test whose name pins a defect, from pinned_tests (each with its fingerprint, what decides whether it
runs, and why it might not), and every call that reads another file as text, from read_calls (with
the paths it can resolve). Each of those three functions, and the helpers their own docstrings name
(canonical, ReadPaths), carries its own detail. The JSON is ASCII-only, so no console code page can
mangle it.

NEVER. Imports, runs or writes any file it reads. Uses anything outside the standard library. Skips a
file it cannot decode or parse, or one nested too deeply to walk: that file is reported with its
error, and the caller treats that as a failure, never as a clean file. Parses with an interpreter
older than the test files' floor: it parses every test file with the interpreter the checker finds
(python3, then python), and that interpreter must be Python 3.10 or newer, because a test file may use
syntax an older one cannot parse; an older one gets that sentence and exit 1, not a traceback.

Usage: python scripts/tests/code_standard_ast.py <file> [<file> ...]
Exit: 0 every named file was described (a file that cannot be decoded, parsed or walked is reported
inside the JSON, with its error) - 1 no file was named, or the interpreter is older than Python 3.10
"""

from __future__ import annotations

import ast
import hashlib
import io
import json
import sys
import tokenize
from pathlib import Path
from typing import TYPE_CHECKING, TypedDict

FLOOR = (3, 10)
FLOOR_SENTENCE = (
    "code_standard_ast.py parses every test file with the interpreter the checker finds (python3, then "
    "python), and that interpreter must be Python 3.10 or newer, because a test file may use syntax an "
    "older one cannot parse"
)
PINNED_MARK = "_PINNED_DEFECT_"
READ_METHODS = frozenset({"read_text", "read_bytes", "open"})
# The keyword a reader function takes its file by, when it is not passed first.
FILE_KEYWORDS = ("file", "filename")
# How many name-bindings ReadPaths chases through an alias before giving up: deep enough for the
# indirection real code uses, shallow enough that a cyclic or self-referential binding cannot recurse
# forever.
READ_DEPTH = 3
# How many calls or attribute accesses dotted() follows to resolve a name: bounds recursion on an
# expression that could otherwise reference itself.
RESOLVE_DEPTH = 8
# How many helper calls deep skip_spellings() follows looking for a SkipTest call: bounds recursion
# through a long helper-calls-helper chain.
HELPER_DEPTH = 4
VERSION_FIELDS = frozenset({"ctx", "kind", "type_comment", "type_params"})
# unittest's and pytest's ways to not run a test, or to pass it when it fails, by their last dotted name.
SKIPPING_DECORATORS = frozenset({"skip", "skipIf", "skipUnless", "expectedFailure", "skipif", "xfail"})
SKIP_ATTRIBUTES = frozenset({"__unittest_skip__", "__unittest_skip_why__", "__unittest_expecting_failure__"})
MODULE_HOOKS = frozenset({"setUpModule", "tearDownModule", "load_tests"})
# The methods unittest calls on a test case without the test naming them.
RUN_HOOKS = frozenset(
    {
        "setUp",
        "tearDown",
        "setUpClass",
        "tearDownClass",
        "asyncSetUp",
        "asyncTearDown",
        "run",
        "debug",
        "__call__",
        "__init__",
        "__new__",
        "__init_subclass__",
        "__getattribute__",
        "__getattr__",
        "_callSetUp",
        "_callTestMethod",
        "_callTearDown",
        "_callCleanup",
        "doCleanups",
        "doClassCleanups",
    }
)
# The hooks that decide, by themselves, whether a test body runs: replacing one replaces the runner.
RUNNER_OVERRIDES = frozenset({"run", "debug", "__call__", "_callTestMethod", "__getattribute__"})
# What in unittest itself decides which tests are collected and how they run; a file assigning one replaces it.
UNITTEST_RUNNERS = RUNNER_OVERRIDES | frozenset(
    {
        "main",
        "TestProgram",
        "runTests",
        "testMethodPrefix",
        "testNamePatterns",
        "getTestCaseNames",
        "loadTestsFromModule",
        "loadTestsFromTestCase",
        "loadTestsFromName",
        "loadTestsFromNames",
        "skip",
        "skipIf",
        "skipUnless",
        "SkipTest",
        "expectedFailure",
        "_callSetUp",
        "_callTearDown",
    }
)
# The unittest.main keywords that change how tests report, never which tests run.
SAFE_MAIN_KEYWORDS = frozenset({"verbosity", "buffer", "failfast", "catchbreak", "warnings", "tb_locals", "durations"})
EXIT_CALLS = frozenset({"sys.exit", "os._exit", "exit", "quit", "builtins.exit"})
BLOCK_FIELDS = ("body", "orelse", "handlers", "finalbody", "cases")

# The aliases exist for the type checker only, so this file still parses, and refuses with its sentence,
# on an interpreter below the floor.
if TYPE_CHECKING:
    from collections.abc import Iterable, Iterator

    Canonical = str | list["Canonical"]
    DocNode = ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef
    Function = ast.FunctionDef | ast.AsyncFunctionDef
    Binding = str | ast.AST
    Paths = tuple[list[list[str]], list[str]]


class ReadCall(TypedDict):
    """A call that reads a file: the parts of each path it can name, what it left out, and its function's strings."""

    line: int
    func: str
    strings: list[str]
    alternatives: list[list[str]]
    refused: list[str]
    nearby: list[str]


class PinnedTest(TypedDict):
    """A test function that pins a known defect: what it asserts, what runs it, and why it would not run."""

    line: int
    name: str
    ids: list[str]
    fingerprint: str
    context: str
    stops: list[str]


class FileFacts(TypedDict, total=False):
    """Everything the checker needs from one file, or the error that stopped the read."""

    code: str
    comments: list[tuple[int, str]]
    docstrings: list[tuple[int, int, str]]
    module_doc: str | None
    main_guard: bool
    encoding: str
    pinned: list[PinnedTest]
    reads: list[ReadCall]
    error: str


# ------------------------------------------------------------------------------------ canonical form


def canonical(node: object) -> Canonical:
    """Return a version-stable nested-list form of an AST node, a list of nodes or a leaf value."""
    if isinstance(node, ast.AST):
        out: list[Canonical] = [type(node).__name__]
        for name in node._fields:
            if name in VERSION_FIELDS:
                continue
            value = getattr(node, name, None)
            if value is None or value == []:
                continue
            out.append([name, canonical(value)])
        return out
    if isinstance(node, list):
        return [canonical(item) for item in node]
    return [type(node).__name__, repr(node)]


def digest(shape: object) -> str:
    """Return the first 16 hex digits of the sha256 of a canonical shape."""
    return hashlib.sha256(json.dumps(shape, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]


def docstring_expr(node: DocNode) -> ast.Expr | None:
    """Return the Expr statement holding the node's docstring, or None when it has none."""
    body = node.body
    if body and isinstance(body[0], ast.Expr):
        value = body[0].value
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            return body[0]
    return None


def is_text(stmt: ast.AST) -> bool:
    """True for a statement that is only a string: a docstring, or a bare string standing in for a comment."""
    return isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str)


def without_doc(node: ast.AST) -> Canonical:
    """Return the canonical form of a definition with its docstring left out, or of any other node."""
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        doc = docstring_expr(node)
        body = [stmt for stmt in node.body if stmt is not doc]
        head = canonical(node.args) if not isinstance(node, ast.ClassDef) else canonical(node.bases)
        return [type(node).__name__, node.name, head, canonical(node.decorator_list), canonical(body)]
    return canonical(node)


# ------------------------------------------------------------------------------------------ walking

NESTED = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)


def own_walk(nodes: Iterable[ast.AST]) -> Iterator[ast.AST]:
    """Walk nodes without entering a nested function, class or lambda (which is yielded, not entered)."""
    stack: list[ast.AST] = list(nodes)
    while stack:
        node = stack.pop()
        yield node
        if not isinstance(node, NESTED):
            stack.extend(ast.iter_child_nodes(node))


def flat_statements(body: list[ast.stmt]) -> list[ast.stmt]:
    """The statements of a body in the order they are written, each compound one followed by its own.

    A nested function or class is one statement: what it holds runs only when it is called.
    """
    out: list[ast.stmt] = []
    for stmt in body:
        out.append(stmt)
        if isinstance(stmt, NESTED):
            continue
        for field in BLOCK_FIELDS:
            for item in getattr(stmt, field, None) or []:
                if isinstance(item, ast.stmt):
                    out.extend(flat_statements([item]))
                elif isinstance(getattr(item, "body", None), list):
                    out.extend(flat_statements(item.body))
    return out


def module_level(tree: ast.Module) -> list[ast.stmt]:
    """Every statement that runs when the module is imported, compound blocks entered, in written order."""
    return flat_statements(tree.body)


def position(node: ast.AST | str) -> tuple[int, int]:
    """Return a node's (line, column), or (0, 0) for a node that has none (an imported name's binding)."""
    return (getattr(node, "lineno", 0), getattr(node, "col_offset", 0))


def is_main_guard(stmt: ast.stmt) -> bool:
    """True for an if statement whose condition compares __name__."""
    return isinstance(stmt, ast.If) and any(
        isinstance(node, ast.Name) and node.id == "__name__" for node in ast.walk(stmt.test)
    )


def names_main(node: ast.expr) -> bool:
    """True for "__main__", or a tuple, list or set that holds it."""
    if isinstance(node, ast.Constant):
        return node.value == "__main__"
    if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
        return any(names_main(item) for item in node.elts)
    return False


def is_name(node: ast.expr) -> bool:
    """True for the name __name__."""
    return isinstance(node, ast.Name) and node.id == "__name__"


def has_main_guard(tree: ast.Module) -> bool:
    """True when the file compares __name__ with "__main__" anywhere, in either order, by ==, !=, in,
    __eq__ or __contains__."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare):
            operands = [node.left, *node.comparators]
            for left, right in ((operands[k], operands[k + 1]) for k in range(len(operands) - 1)):
                if (is_name(left) and names_main(right)) or (names_main(left) and is_name(right)):
                    return True
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in ("__eq__", "__contains__")
            and (is_name(node.func.value) or names_main(node.func.value))
            and any(is_name(arg) or names_main(arg) for arg in node.args)
        ):
            return True
    return False


# ------------------------------------------------------------------------------------- name bindings


def binding_targets(target: ast.expr) -> Iterator[ast.expr]:
    """Every expression an assignment target binds, a tuple or list unpacked."""
    if isinstance(target, (ast.Tuple, ast.List)):
        for item in target.elts:
            yield from binding_targets(item)
    elif isinstance(target, ast.Starred):
        yield from binding_targets(target.value)
    else:
        yield target


def bound_names(stmt: ast.AST) -> Iterator[tuple[str, Binding]]:
    """Every (name, what it is bound to) one statement binds: a definition, a value, or an imported dotted path.

    A name removed by del is bound to the del statement itself.
    """
    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        yield stmt.name, stmt
    elif isinstance(stmt, ast.Assign):
        for target in stmt.targets:
            for sub in binding_targets(target):
                if isinstance(sub, ast.Name):
                    yield sub.id, stmt.value
    elif isinstance(stmt, (ast.AnnAssign, ast.AugAssign)) and isinstance(stmt.target, ast.Name):
        if stmt.value is not None:
            yield stmt.target.id, stmt.value
    elif isinstance(stmt, ast.NamedExpr) and isinstance(stmt.target, ast.Name):
        yield stmt.target.id, stmt.value
    elif isinstance(stmt, ast.Delete):
        for target in stmt.targets:
            for sub in binding_targets(target):
                if isinstance(sub, ast.Name):
                    yield sub.id, stmt
    elif isinstance(stmt, ast.Import):
        for alias in stmt.names:
            yield (alias.asname or alias.name.split(".")[0]), (alias.name if alias.asname else alias.name.split(".")[0])
    elif isinstance(stmt, ast.ImportFrom):
        for alias in stmt.names:
            yield (alias.asname or alias.name), f"{stmt.module or ''}.{alias.name}".lstrip(".")


SIMPLE_STATEMENTS = (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.Delete, ast.Expr)


def assigned_targets(stmt: ast.AST) -> list[ast.expr]:
    """What an assignment or del statement binds, a tuple or list unpacked; nothing for any other statement."""
    if isinstance(stmt, (ast.Assign, ast.Delete)):
        return [sub for target in stmt.targets for sub in binding_targets(target)]
    if isinstance(stmt, (ast.AnnAssign, ast.AugAssign)):
        return [stmt.target]
    return []


def touched_names(stmt: ast.stmt) -> Iterator[str]:
    """Every name a simple statement assigns or deletes, as a name or an attribute, or setattr()s or delattr()s."""
    for target in assigned_targets(stmt):
        if isinstance(target, ast.Name):
            yield target.id
        elif isinstance(target, ast.Attribute):
            yield target.attr
    for node in ast.walk(stmt):
        if isinstance(node, ast.NamedExpr) and isinstance(node.target, ast.Name):
            yield node.target.id
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in ("setattr", "delattr")
            and len(node.args) > 1
            and isinstance(node.args[1], ast.Constant)
            and isinstance(node.args[1].value, str)
        ):
            yield node.args[1].value


def mutates_an_object(stmt: ast.stmt) -> bool:
    """True for an assignment or del whose target is an attribute or an item, not a plain name."""
    return any(not isinstance(target, ast.Name) for target in assigned_targets(stmt))


def module_definitions(tree: ast.Module) -> dict[str, ast.AST]:
    """Each module-level function, class and assigned name, with the last statement that defines it."""
    found: dict[str, ast.AST] = {}
    for stmt in tree.body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            found[stmt.name] = stmt
        elif isinstance(stmt, ast.Assign):
            found.update({target.id: stmt for target in stmt.targets if isinstance(target, ast.Name)})
        elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            found[stmt.target.id] = stmt
    return found


class Names:
    """What a name in one file can stand for: every module-level binding of it, and a function's own on top."""

    def __init__(
        self,
        module: dict[str, list[Binding]],
        local: dict[str, list[Binding]] | None = None,
        cache: dict[int, Names] | None = None,
    ) -> None:
        """Hold the module's bindings and, optionally, one function's; `cache` is shared by every function's view."""
        self.module = module
        self.local = local or {}
        self.cache: dict[int, Names] = {} if cache is None else cache

    def bound(self, name: str) -> list[Binding]:
        """Return what a name is bound to: the function's own bindings when it has any, else the module's."""
        return self.local.get(name) or self.module.get(name, [])

    def within(self, func: ast.AST | None) -> Names:
        """Return these names with one function's own bindings on top (nested functions left out)."""
        if not isinstance(func, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            return self
        if id(func) not in self.cache:
            local: dict[str, list[Binding]] = {}
            body = func.body if isinstance(func.body, list) else [func.body]
            for node in own_walk(body):
                for name, bound in bound_names(node):
                    local.setdefault(name, []).append(bound)
            self.cache[id(func)] = Names(self.module, local, self.cache)
        return self.cache[id(func)]


def dotted(node: ast.AST | None, names: Names, depth: int = 0) -> set[str]:
    """Every dotted name an expression can stand for, a name read through what binds it.

    A call stands for what it calls, so unittest.skip("x") is unittest.skip; a class stands for its
    bases too, so a class deriving from SkipTest is a SkipTest.
    """
    if node is None or depth > RESOLVE_DEPTH:
        return set()
    if isinstance(node, ast.Call):
        return dotted(node.func, names, depth + 1)
    if isinstance(node, ast.Attribute):
        return {f"{base}.{node.attr}" for base in dotted(node.value, names, depth + 1) or {"?"}}
    if isinstance(node, ast.Name):
        out = {node.id}
        for bound in names.bound(node.id):
            if isinstance(bound, str):
                out.add(bound)
            elif isinstance(bound, ast.ClassDef):
                for base in bound.bases:
                    out |= dotted(base, names, depth + 1)
            elif isinstance(bound, ast.expr):
                out |= dotted(bound, names, depth + 1)
        return out
    return set()


def last_names(node: ast.AST | None, names: Names) -> set[str]:
    """The last dotted name of everything an expression can stand for."""
    return {name.rsplit(".", 1)[-1] for name in dotted(node, names)}


def functions_of(node: ast.AST | None, names: Names, depth: int = 0) -> list[Function]:
    """The functions of this file an expression can stand for: a name bound to one, or a call of such a name."""
    if node is None or depth > RESOLVE_DEPTH:
        return []
    if isinstance(node, ast.Call):
        return functions_of(node.func, names, depth + 1)
    out: list[Function] = []
    if isinstance(node, ast.Name):
        for bound in names.bound(node.id):
            if isinstance(bound, (ast.FunctionDef, ast.AsyncFunctionDef)):
                out.append(bound)
            elif isinstance(bound, ast.expr):
                out += functions_of(bound, names, depth + 1)
    return out


# ---------------------------------------------------------------------------------------- the module


class ModuleIndex:
    """One parsed file, indexed once for every pinned test in it."""

    def __init__(self, tree: ast.Module) -> None:
        """Index the module's bindings, its classes, the parent of every node, and what every pin shares."""
        self.tree = tree
        self.statements = module_level(tree)
        self.bindings: dict[str, list[Binding]] = {}
        self.binders: dict[str, list[ast.stmt]] = {}
        for stmt in self.statements:
            for name, bound in bound_names(stmt):
                self.bindings.setdefault(name, []).append(bound)
                self.binders.setdefault(name, []).append(stmt)
        self.names = Names(self.bindings)
        self.parents: dict[int, ast.AST] = {}
        # Every simple statement anywhere in the file, by each name it assigns, deletes or setattr()s.
        self.touched: dict[str, list[ast.stmt]] = {}
        for node in ast.walk(tree):
            for child in ast.iter_child_nodes(node):
                self.parents[id(child)] = node
            if isinstance(node, SIMPLE_STATEMENTS):
                for name in dict.fromkeys(touched_names(node)):
                    self.touched.setdefault(name, []).append(node)
        self.definitions = module_definitions(tree)
        guards = [stmt for stmt in tree.body if is_main_guard(stmt)]
        inside = {id(node) for guard in guards for node in ast.walk(guard) if node is not guard}
        # The module-level statements every pin's context holds: the main guard whole, every other
        # module-level expression that is not a bare string (the module docstring is one), and every
        # module-level assignment to something that is not a plain name.
        self.shared_context: list[ast.stmt] = [
            stmt
            for stmt in self.statements
            if id(stmt) not in inside
            and (is_main_guard(stmt) or (isinstance(stmt, ast.Expr) and not is_text(stmt)) or mutates_an_object(stmt))
        ]
        self.main_calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and any(name in ("unittest.main", "unittest.TestProgram") for name in dotted(node.func, self.names))
        ]
        self.file_stops: list[str] | None = None

    def owners(self, node: ast.AST) -> list[ast.AST]:
        """The statements a node sits inside, outermost first, the module left out."""
        owners: list[ast.AST] = []
        parent = self.parents.get(id(node))
        while parent is not None and not isinstance(parent, ast.Module):
            owners.insert(0, parent)
            parent = self.parents.get(id(parent))
        return owners

    def module_class(self, name: str) -> ast.ClassDef | None:
        """The class a module-level name is bound to when that binding is a class of this file."""
        bound = self.bindings.get(name, [])
        return bound[-1] if bound and isinstance(bound[-1], ast.ClassDef) else None

    def chain(self, cls: ast.ClassDef) -> list[ast.ClassDef]:
        """The class and the classes of this file it derives from, depth first and left to right, once each."""
        out: list[ast.ClassDef] = []

        def visit(node: ast.ClassDef) -> None:
            if node in out:
                return
            out.append(node)
            for base in node.bases:
                found = self.module_class(base.id) if isinstance(base, ast.Name) else None
                if found is not None:
                    visit(found)

        visit(cls)
        return out

    def external_bases(self, chain: list[ast.ClassDef]) -> list[ast.expr]:
        """The bases of a class chain that are not classes of this file."""
        return [
            base
            for cls in chain
            for base in cls.bases
            if not (isinstance(base, ast.Name) and self.module_class(base.id) is not None)
        ]


def members_of(chain: list[ast.ClassDef]) -> dict[str, ast.AST]:
    """Each name the classes of a chain define, with the definition the first class to hold it gives."""
    members: dict[str, ast.AST] = {}
    for cls in chain:
        for stmt in cls.body:
            for name, _bound in bound_names(stmt):
                members.setdefault(name, stmt)
    return members


def root_name(node: ast.expr) -> str | None:
    """The name an attribute chain, a call or a subscript starts from: unittest for unittest.skip("x")."""
    while isinstance(node, (ast.Attribute, ast.Call, ast.Subscript)):
        node = node.func if isinstance(node, ast.Call) else node.value
    return node.id if isinstance(node, ast.Name) else None


# ------------------------------------------------------------------------------ what a pin asserts


def reached_helpers(func: Function, chain: list[ast.ClassDef], index: ModuleIndex) -> dict[str, ast.AST]:
    """One level of the helpers a test names: module definitions, and chain members it reaches by name."""
    module = index.definitions
    members = members_of(chain)
    inherited = members_of(chain[1:])
    chain_names = {cls.name for cls in chain}
    named: dict[str, ast.AST] = {}
    for node in ast.walk(func):
        if node is func:
            continue
        if isinstance(node, ast.Name) and node.id in module:
            named[node.id] = module[node.id]
        elif isinstance(node, ast.Attribute):
            owner = node.value
            if isinstance(owner, ast.Name) and owner.id in {"self", "cls"} | chain_names and node.attr in members:
                named[f"{owner.id}.{node.attr}"] = members[node.attr]
            elif (
                isinstance(owner, ast.Call)
                and isinstance(owner.func, ast.Name)
                and owner.func.id == "super"
                and node.attr in inherited
            ):
                named[f"super().{node.attr}"] = inherited[node.attr]
    return named


def fingerprint(func: Function, chain: list[ast.ClassDef], index: ModuleIndex) -> str:
    """Return the digest of a test's canonical tree with one level of the helpers it names.

    The helpers are the module-level definitions and assignments it names, and the members of its class
    chain it reaches through self, cls, super() or a class name; each is taken with its docstring left
    out, so only what runs moves the fingerprint.
    """
    named = reached_helpers(func, chain, index)
    helpers = [[name, without_doc(named[name])] for name in sorted(named)]
    return digest([without_doc(func), helpers])


# ------------------------------------------------------------------------------- what runs a pin


def context_statements(func: Function, chain: list[ast.ClassDef], index: ModuleIndex) -> list[ast.AST]:
    """The module's statements that decide whether a test runs, in written order.

    The main guard, every other module-level call and every module-level assignment to an object; each
    binding of a class of the chain, of setUpModule, tearDownModule or load_tests, and of the name every
    base, decorator and class keyword starts from; and every statement anywhere that assigns, deletes or
    setattr()s the test's name or a unittest skip attribute.
    """
    roots = {cls.name for cls in chain} | MODULE_HOOKS
    heads = [*func.decorator_list, *(part for cls in chain for part in (*cls.bases, *cls.decorator_list))]
    heads += [keyword.value for cls in chain for keyword in cls.keywords]
    roots |= {name for name in map(root_name, heads) if name}
    picked: dict[int, ast.AST] = {id(stmt): stmt for stmt in index.shared_context}
    for name in roots:
        for stmt in index.binders.get(name, []):
            if not (isinstance(stmt, ast.ClassDef) and stmt in chain):
                picked[id(stmt)] = stmt
    for name in SKIP_ATTRIBUTES | {func.name}:
        for stmt in index.touched.get(name, []):
            picked[id(stmt)] = stmt
    return sorted(picked.values(), key=position)


def run_context(func: Function, chain: list[ast.ClassDef], index: ModuleIndex) -> str:
    """Return the digest of everything outside a test's own body that decides whether it runs."""
    classes: list[Canonical] = []
    for cls in chain:
        body: list[Canonical] = []
        for stmt in cls.body:
            if is_text(stmt) or stmt is func:
                continue
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if stmt.name in RUN_HOOKS or stmt.name == func.name:
                    body.append(without_doc(stmt))
                continue
            body.append(canonical(stmt))
        classes.append([cls.name, canonical(cls.bases), canonical(cls.keywords), canonical(cls.decorator_list), body])
    module = [without_doc(stmt) for stmt in context_statements(func, chain, index)]
    return digest([canonical(func.decorator_list), classes, module])


# ----------------------------------------------------------------------------- why a pin would not run


def methods_called(call: ast.Call, members: dict[str, ast.AST]) -> list[Function]:
    """The methods of a class chain a call reaches through self, cls or super(): self.vs(...) is vs."""
    func = call.func
    if not isinstance(func, ast.Attribute):
        return []
    owner = func.value
    reaches = (isinstance(owner, ast.Name) and owner.id in ("self", "cls")) or (
        isinstance(owner, ast.Call) and isinstance(owner.func, ast.Name) and owner.func.id == "super"
    )
    method = members.get(func.attr) if reaches else None
    return [method] if isinstance(method, (ast.FunctionDef, ast.AsyncFunctionDef)) else []


def skip_spellings(
    body: list[ast.stmt] | ast.AST,
    names: Names,
    index: ModuleIndex,
    members: dict[str, ast.AST] | None = None,
    depth: int = 0,
) -> list[str]:
    """Why running this code would skip the test it belongs to, following the helpers it calls.

    A raise of anything that stands for SkipTest, a call of anything that stands for skipTest, pytest.skip
    or a skip decorator, an assignment of a unittest skip attribute, and the same in the functions of
    this file and the methods of the class chain it calls, a few levels deep.
    """
    nodes = body if isinstance(body, list) else [body]
    found: list[str] = []
    for node in (sub for top in nodes for sub in ast.walk(top)):
        if isinstance(node, ast.Raise) and node.exc is not None and "SkipTest" in last_names(node.exc, names):
            found.append("raises SkipTest")
        elif isinstance(node, ast.Call):
            spelled = dotted(node.func, names)
            last = {name.rsplit(".", 1)[-1] for name in spelled}
            if "skipTest" in last or any(name.endswith("pytest.skip") for name in spelled):
                shown = ast.unparse(node.func)
                via = sorted(name for name in spelled if name.endswith(("skipTest", "pytest.skip")))
                found.append(f"calls {shown}" if shown in via or not via else f"calls {shown}, which is {via[0]}")
            elif depth < HELPER_DEPTH:
                for helper in functions_of(node.func, names) + methods_called(node, members or {}):
                    inner = skip_spellings(helper.body, names.within(helper), index, members, depth + 1)
                    found += [f"calls {ast.unparse(node.func)}, which {reason}" for reason in inner[:1]]
        elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                attr = target.attr if isinstance(target, ast.Attribute) else getattr(target, "id", "")
                if attr in SKIP_ATTRIBUTES:
                    found.append(f"sets {attr}")
    return list(dict.fromkeys(found))


def skipping_decorator(dec: ast.expr, index: ModuleIndex) -> bool:
    """True when a decorator stands for a skip or an expected failure, directly, by an alias, or by its body."""
    if last_names(dec, index.names) & SKIPPING_DECORATORS:
        return True
    return any(skip_spellings(fn.body, index.names.within(fn), index, depth=1) for fn in functions_of(dec, index.names))


def collection_stops(func: Function, owners: list[ast.AST], chain: list[ast.ClassDef], index: ModuleIndex) -> list[str]:
    """Why unittest would never collect this test, or would collect another object under its name."""
    reasons: list[str] = []
    classes = [owner for owner in owners if isinstance(owner, ast.ClassDef)]
    for owner in owners:
        if not isinstance(owner, ast.ClassDef):
            reasons.append(f"it sits inside a block ({type(owner).__name__})")
    if not classes:
        reasons.append("it is a function outside any class, and unittest runs only TestCase methods")
        return reasons
    if len(classes) > 1:
        reasons.append(f"its class sits inside {classes[0].name}, and unittest collects only module-level classes")
    if not func.name.startswith("test"):
        reasons.append("its name does not start with test, so unittest does not collect it")
    cls = chain[0]
    if index.module_class(cls.name) is not cls and cls in index.tree.body:
        reasons.append(f"the name {cls.name} is bound again later in the file, so unittest never sees this class")
    bases = [dotted(base, index.names) for base in index.external_bases(chain)]
    if not any(name.endswith("TestCase") for spelled in bases for name in spelled):
        if all(spelled <= {"object"} for spelled in bases):
            reasons.append("its class is not a unittest.TestCase, so unittest does not collect it")
    elif isinstance(func, ast.AsyncFunctionDef) and not any(
        name.endswith("IsolatedAsyncioTestCase") for spelled in bases for name in spelled
    ):
        reasons.append("it is async in a class that never awaits it")
    after = False
    for stmt in cls.body:
        if stmt is func:
            after = True
        elif after and any(name == func.name for name, _bound in bound_names(stmt)):
            reasons.append("its name is bound again later in its class, so the method unittest runs is another one")
            break
    for stmt in index.touched.get(func.name, []):
        if not isinstance(index.parents.get(id(stmt)), ast.ClassDef):
            reasons.append(f"its name is rebound elsewhere in the file ({ast.unparse(stmt).splitlines()[0][:80]})")
    return reasons


def body_stops(func: Function, chain: list[ast.ClassDef], index: ModuleIndex) -> list[str]:
    """Why the test's own body would not run as written."""
    members = members_of(chain)
    reasons = [f"it {reason}" for reason in skip_spellings(func.body, index.names.within(func), index, members)]
    flat = flat_statements(func.body)
    if any(isinstance(stmt, ast.Return) for stmt in flat[:-1]):
        reasons.append("it returns before its last statement")
    if any(isinstance(node, (ast.Yield, ast.YieldFrom)) for node in own_walk(func.body)):
        reasons.append("it yields, so unittest gets a generator and runs none of its body")
    for stmt in flat:
        if isinstance(stmt, (ast.If, ast.While)) and isinstance(stmt.test, ast.Constant) and not stmt.test.value:
            under = f"{type(stmt).__name__.lower()} {ast.unparse(stmt.test)}"
            reasons.append(f"part of it sits under {under}, which never runs")
            break
    return reasons


def chain_stops(func: Function, chain: list[ast.ClassDef], index: ModuleIndex) -> list[str]:
    """Why the classes a test belongs to would skip it, mark it, or not run it as written."""
    reasons: list[str] = []
    members = members_of(chain)
    for position_in_chain, cls in enumerate(chain):
        where = "its class" if position_in_chain == 0 else f"its base class {cls.name}"
        for dec in cls.decorator_list:
            if skipping_decorator(dec, index):
                reasons.append(f"{where} carries @{ast.unparse(dec)}")
        for stmt in cls.body:
            for name, _bound in bound_names(stmt):
                if name in SKIP_ATTRIBUTES:
                    reasons.append(f"{cls.name} sets {name}")
                if name in RUNNER_OVERRIDES:
                    reasons.append(f"{cls.name} replaces {name}, the method that runs the test")
                if name in RUN_HOOKS and isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    found = skip_spellings(stmt.body, index.names.within(stmt), index, members)
                    reasons += [f"{cls.name}.{name} {reason}" for reason in found]
            if any(
                isinstance(target, ast.Attribute)
                and target.attr == "__unittest_expecting_failure__"
                and root_name(target) == func.name
                for target in assigned_targets(stmt)
            ):
                reasons.append("it is marked as an expected failure, so a failing assertion passes")
    owners = {func.name, "self", "cls"} | {cls.name for cls in chain}
    for attr in sorted(SKIP_ATTRIBUTES):
        for stmt in index.touched.get(attr, []):
            if isinstance(index.parents.get(id(stmt)), ast.ClassDef):
                continue
            for target in assigned_targets(stmt):
                if isinstance(target, ast.Attribute) and target.attr == attr and root_name(target) in owners:
                    reasons.append(f"{ast.unparse(target)} is assigned in the file")
            for node in ast.walk(stmt):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id == "setattr"
                    and len(node.args) > 1
                    and isinstance(node.args[1], ast.Constant)
                    and node.args[1].value == attr
                    and root_name(node.args[0]) in owners
                ):
                    reasons.append(f"{ast.unparse(node)} is called in the file")
    return reasons


def module_stops(index: ModuleIndex) -> list[str]:
    """Why the module, run as CI runs it (python <file>), would not run its tests as written; once per file."""
    if index.file_stops is None:
        index.file_stops = file_stops(index)
    return index.file_stops


def file_stops(index: ModuleIndex) -> list[str]:
    """Why the module, run as CI runs it (python <file>), would not run its tests as written."""
    reasons: list[str] = []
    names = index.names
    for name in ("setUpModule", "tearDownModule"):
        for stmt in index.binders.get(name, []):
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                reasons += [f"{name} {reason}" for reason in skip_spellings(stmt.body, names.within(stmt), index)]
    if index.binders.get("load_tests"):
        reasons.append("the module defines load_tests, which picks the tests that run")
    main_calls = index.main_calls
    if not main_calls:
        reasons.append("the file never calls unittest.main, so running it (as CI does) runs no test")
    for call in main_calls:
        if call.args or any(k.arg not in SAFE_MAIN_KEYWORDS for k in call.keywords):
            reasons.append(f"it runs through {ast.unparse(call)}, which can leave it out")
    for attr in sorted(UNITTEST_RUNNERS):
        for stmt in index.touched.get(attr, []):
            for target in assigned_targets(stmt):
                root = root_name(target) if isinstance(target, ast.Attribute) and target.attr == attr else None
                if root and any(name.split(".")[0] == "unittest" for name in dotted(ast.Name(id=root), names)):
                    reasons.append(f"the file replaces {ast.unparse(target)}, which decides what runs")
    first_main = min((position(call) for call in main_calls), default=None)
    for stmt in index.statements:
        if first_main is None or position(stmt) >= first_main:
            break
        calls = [node for node in own_walk([stmt]) if isinstance(node, ast.Call)]
        raises = isinstance(stmt, ast.Raise) and "SystemExit" in last_names(stmt.exc, names)
        exits = [c for c in calls if dotted(c.func, names) & EXIT_CALLS and not any(c is n for n in main_calls)]
        if raises or (exits and not any(call in main_calls for call in calls)):
            reasons.append("the file exits before unittest.main runs")
    return reasons


def stops_of(func: Function, owners: list[ast.AST], chain: list[ast.ClassDef], index: ModuleIndex) -> list[str]:
    """Return why a test function would not run as written, each reason once."""
    reasons = [f"@{ast.unparse(dec)}" for dec in func.decorator_list if skipping_decorator(dec, index)]
    reasons += collection_stops(func, owners, chain, index)
    reasons += chain_stops(func, chain, index)
    reasons += body_stops(func, chain, index)
    reasons += module_stops(index)
    return list(dict.fromkeys(reasons))


def pinned_tests(index: ModuleIndex) -> list[PinnedTest]:
    """Return every test function whose name pins a defect: its fingerprint, its context and its stops."""
    pinned: list[PinnedTest] = []
    for node in ast.walk(index.tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or PINNED_MARK not in node.name:
            continue
        owners = index.owners(node)
        cls = next((owner for owner in reversed(owners) if isinstance(owner, ast.ClassDef)), None)
        chain = index.chain(cls) if cls is not None else []
        pinned.append(
            {
                "line": node.lineno,
                "name": node.name,
                "ids": pinned_ids(node.name),
                "fingerprint": fingerprint(node, chain, index),
                "context": run_context(node, chain, index),
                "stops": stops_of(node, owners, chain, index),
            }
        )
    pinned.sort(key=lambda item: item["line"])
    return pinned


def pinned_ids(name: str) -> list[str]:
    """Return the defect ids a test name pins; an underscore in the name stands for a hyphen in the id."""
    suffix = name.split(PINNED_MARK, 1)[1]
    return [suffix.replace("_", "-")] if suffix else []


# ------------------------------------------------------------------------------------------- reads


# The calls a path is built with, whose parts are the path's parts: by the last dotted name they stand for.
PATH_BUILDERS = frozenset({"Path", "PurePath", "PosixPath", "PurePosixPath", "WindowsPath", "PureWindowsPath"})
PATH_JOINERS = frozenset({"os.path.join", "posixpath.join", "ntpath.join", "os.path.normpath", "os.path.abspath"})
PATH_METHODS = frozenset({"joinpath", "resolve", "absolute"})
FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)


def parameters(func: ast.AST) -> set[str]:
    """The names a function or lambda takes as parameters."""
    if not isinstance(func, FUNCTIONS):
        return set()
    args = func.args
    every = [*args.posonlyargs, *args.args, *args.kwonlyargs, args.vararg, args.kwarg]
    return {arg.arg for arg in every if arg is not None}


class ReadPaths:
    """What a read's path can name, found exactly or not at all.

    A part resolves through a string constant, a + or an f-string of known pieces, a / of path parts,
    Path(), str(), os.path.join() or joinpath() of known parts, a name whose nearest binding in scope is
    bound once (to a value, or by a for loop over a literal list or tuple, or over a name bound once to
    one), and each branch of a conditional. A parameter, a name bound more than once, an attribute
    (self.path, audit.CONTRACT_REL), any other call and a subscript resolve to nothing, and say why.
    """

    def __init__(self, tree: ast.Module, index: ModuleIndex) -> None:
        """Index the scopes of one parsed file."""
        self.tree = tree
        self.index = index
        self.bindings: dict[int, dict[str, list[tuple[str, ast.AST | None]]]] = {}

    def scopes(self, node: ast.AST) -> list[ast.AST]:
        """The functions around a node, innermost first, then the module."""
        out: list[ast.AST] = []
        parent = self.index.parents.get(id(node))
        while parent is not None:
            if isinstance(parent, FUNCTIONS):
                out.append(parent)
            parent = self.index.parents.get(id(parent))
        return [*out, self.tree]

    def bound_in(self, scope: ast.AST) -> dict[str, list[tuple[str, ast.AST | None]]]:
        """Every binding a scope makes itself, by name: (kind, the value or the loop's iterable)."""
        if id(scope) in self.bindings:
            return self.bindings[id(scope)]
        found: dict[str, list[tuple[str, ast.AST | None]]] = {}
        declared: set[str] = set()

        def add(name: str, kind: str, value: ast.AST | None = None) -> None:
            found.setdefault(name, []).append((kind, value))

        for name in parameters(scope):
            add(name, "param")
        if isinstance(scope, ast.Lambda):
            body: list[ast.AST] = [scope.body]
        elif isinstance(scope, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = list(scope.body)
        else:
            body = []
        for node in own_walk(body):
            if isinstance(node, (ast.Global, ast.Nonlocal)):
                declared.update(node.names)
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        add(target.id, "value", node.value)
                    else:
                        for sub in binding_targets(target):
                            if isinstance(sub, ast.Name):
                                add(sub.id, "unpacked")
            elif isinstance(node, (ast.AnnAssign, ast.NamedExpr)) and isinstance(node.target, ast.Name):
                add(node.target.id, "value" if node.value is not None else "annotated", node.value)
            elif isinstance(node, ast.AugAssign) and isinstance(node.target, ast.Name):
                add(node.target.id, "augmented")
            elif isinstance(node, (ast.For, ast.AsyncFor)):
                if isinstance(node.target, ast.Name):
                    add(node.target.id, "loop", node.iter)
                else:
                    for sub in binding_targets(node.target):
                        if isinstance(sub, ast.Name):
                            add(sub.id, "unpacked")
            elif isinstance(node, (ast.With, ast.AsyncWith)):
                for item in node.items:
                    if item.optional_vars is None:
                        continue
                    for sub in binding_targets(item.optional_vars):
                        if isinstance(sub, ast.Name):
                            add(sub.id, "a with statement")
            elif isinstance(node, ast.ExceptHandler) and node.name:
                add(node.name, "an except clause")
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                for name, _bound in bound_names(node):
                    add(name, "an import")
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                add(node.name, "a definition")
            elif isinstance(node, ast.Delete):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        add(target.id, "deleted")
        for name in declared:
            found.pop(name, None)
        self.bindings[id(scope)] = found
        return found

    def name(self, node: ast.Name, depth: int) -> Paths:
        """What a name can name, through its nearest binding in scope."""
        for scope in self.scopes(node):
            bound = self.bound_in(scope).get(node.id)
            if not bound:
                continue
            if len(bound) > 1:
                return [[]], [f"{node.id}, bound more than once where it is read"]
            kind, value = bound[0]
            if kind == "value" and value is not None:
                return self.paths(value, depth + 1) if depth < READ_DEPTH else ([[]], [f"{node.id}, three names deep"])
            if kind == "loop" and value is not None:
                return self.elements(node.id, value, depth)
            words = {"param": "a parameter", "unpacked": "unpacked from a tuple", "augmented": "assigned again"}
            return [[]], [f"{node.id}, {words.get(kind, kind)}"]
        return [[]], [f"{node.id}, which this file does not bind"]

    def elements(self, name: str, iterable: ast.AST, depth: int) -> Paths:
        """Each path a loop variable can name: one per element of the literal list or tuple it walks."""
        if isinstance(iterable, ast.Name):
            for scope in self.scopes(iterable):
                bound = self.bound_in(scope).get(iterable.id)
                if bound:
                    kind, value = bound[0]
                    iterable = value if len(bound) == 1 and kind == "value" and value is not None else iterable
                    break
        if not isinstance(iterable, (ast.List, ast.Tuple)) or depth >= READ_DEPTH:
            return [[]], [f"{name}, a loop over something that is not a literal list or tuple"]
        return self.either([self.paths(item, depth + 1) for item in iterable.elts])

    @staticmethod
    def either(found: list[Paths]) -> Paths:
        """Every path any of the parts can name."""
        return [alt for alts, _ in found for alt in alts] or [[]], [why for _, whys in found for why in whys]

    @staticmethod
    def join(found: list[Paths]) -> Paths:
        """The paths the parts name one after another."""
        alts: list[list[str]] = [[]]
        why: list[str] = []
        for more, whys in found:
            alts = [left + right for left in alts for right in more]
            why += whys
        return alts, why

    def text(self, node: ast.AST, depth: int) -> list[str] | None:
        """The strings a + or an f-string builds when every piece is known, one per alternative, else None."""
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return [node.value]
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            left, right = self.text(node.left, depth), self.text(node.right, depth)
            return None if left is None or right is None else [a + b for a in left for b in right]
        if isinstance(node, ast.JoinedStr):
            out = [""]
            for value in node.values:
                if isinstance(value, ast.FormattedValue):
                    if value.conversion != -1 or value.format_spec is not None:
                        return None
                    piece = self.text(value.value, depth)
                else:
                    piece = self.text(value, depth)
                if piece is None:
                    return None
                out = [a + b for a in out for b in piece]
            return out
        if isinstance(node, ast.Name):
            alts, why = self.name(node, depth)
            return None if why or any(len(alt) != 1 for alt in alts) else [alt[0] for alt in alts]
        return None

    def paths(self, node: ast.AST, depth: int = 0) -> Paths:
        """The path parts an expression can name, one list per path, and why a part was left out."""
        if isinstance(node, (ast.BinOp, ast.JoinedStr)):
            joined = self.text(node, depth)
            if joined is not None:
                return [[text] for text in joined], []
        if isinstance(node, ast.Constant):
            return ([[node.value]] if isinstance(node.value, str) else [[]]), []
        if isinstance(node, ast.Name):
            return self.name(node, depth)
        if isinstance(node, ast.BinOp):
            return self.join([self.paths(node.left, depth), self.paths(node.right, depth)])
        if isinstance(node, ast.JoinedStr):
            return self.join([self.paths(value, depth) for value in node.values])
        if isinstance(node, ast.FormattedValue):
            return self.paths(node.value, depth)
        if isinstance(node, ast.IfExp):
            return self.either([self.paths(node.body, depth), self.paths(node.orelse, depth)])
        if isinstance(node, ast.BoolOp):
            return self.either([self.paths(value, depth) for value in node.values])
        if isinstance(node, ast.Starred):
            return self.paths(node.value, depth)
        if isinstance(node, ast.Call):
            func = node.func
            spelled = dotted(func, self.index.names)
            arguments = [self.paths(arg, depth) for arg in node.args]
            if (isinstance(func, ast.Name) and func.id == "str") or {
                name.rsplit(".", 1)[-1] for name in spelled
            } & PATH_BUILDERS:
                return self.join(arguments)
            if spelled & PATH_JOINERS:
                return self.join(arguments)
            if isinstance(func, ast.Attribute) and func.attr in PATH_METHODS and not spelled & {"os.path.abspath"}:
                return self.join([self.paths(func.value, depth), *arguments])
            shown = ast.unparse(func)
            return [[]], [f"{shown}(), a call"]
        if isinstance(node, ast.Attribute):
            return [[]], [f"{ast.unparse(node)}, an attribute"]
        return [[]], [f"{ast.unparse(node)}, which is not a path this leg can read"]


def literal_strings(node: ast.AST) -> list[str]:
    """Return the string literals written under a node, in source order, without reading names through."""
    found = [sub for sub in ast.walk(node) if isinstance(sub, ast.Constant) and isinstance(sub.value, str)]
    found.sort(key=lambda sub: (sub.lineno, sub.col_offset))
    return [str(sub.value) for sub in found]


def read_target(call: ast.Call, names: Names) -> tuple[str, ast.expr] | None:
    """The reader a call is and the expression naming its file, or None when the call reads no file.

    Called on a path (p.read_text(), p.open()), the path is the receiver. Called on a module or a class
    this file imports (io.open(p), Path.read_text(p)), or through a name bound to a reader (open(p),
    reader = open), the path is the first argument, or the keyword file= or filename=.
    """
    func = call.func
    argument = call.args[0] if call.args else next((k.value for k in call.keywords if k.arg in FILE_KEYWORDS), None)
    if isinstance(func, ast.Attribute) and func.attr in READ_METHODS:
        root = root_name(func.value)
        imported = (
            root is not None
            and not any(isinstance(node, ast.Call) for node in ast.walk(func.value))
            and any(isinstance(bound, str) for bound in names.bound(root))
        )
        if not imported:
            return func.attr, func.value
        return (func.attr, argument) if argument is not None else None
    if isinstance(func, ast.Name) and argument is not None:
        if func.id == "open" and not names.bound("open"):
            return "open", argument
        if last_names(func, names) & READ_METHODS:
            return "open" if "open" in last_names(func, names) else func.id, argument
    return None


def read_calls(tree: ast.Module, index: ModuleIndex) -> list[ReadCall]:
    """Return every call that reads a file: the paths it can name, found exactly, and its function's strings.

    The function's strings are what the caller matches a format-suppressed statement against: the text a
    test asserts about is written in the function that reads it, or in the module when the read is there.
    """
    module_names = Names(
        {
            name: [bound for bound in bounds if not isinstance(bound, (ast.FunctionDef, ast.AsyncFunctionDef))]
            for name, bounds in index.bindings.items()
        }
    )
    enclosing: dict[int, Function] = {}
    for function in ast.walk(tree):
        if isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for sub in ast.walk(function):
                enclosing[id(sub)] = function
    calls: list[ReadCall] = []
    resolver = ReadPaths(tree, index)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        scope = enclosing.get(id(node))
        names = nearest_bindings(module_names.within(scope), node) if scope is not None else module_names
        found = read_target(node, names)
        if found is None:
            continue
        label, path = found
        alternatives, refused = resolver.paths(path)
        calls.append(
            {
                "line": node.lineno,
                "func": label,
                "strings": alternatives[0],
                "alternatives": alternatives,
                "refused": list(dict.fromkeys(refused)),
                "nearby": literal_strings(scope if scope is not None else tree),
            }
        )
    calls.sort(key=lambda call: call["line"])
    return calls


def nearest_bindings(names: Names, at: ast.AST) -> Names:
    """These names with each local one narrowed to the last binding written before a node, when there is one."""
    line = position(at)
    local = {
        name: [bound for bound in bounds if position(bound) <= line][-1:] or bounds
        for name, bounds in names.local.items()
    }
    return Names(names.module, local)


# ----------------------------------------------------------------------------------------- the file


def char_column(line: str, byte_column: int) -> int:
    """Return the character column of a UTF-8 byte column, which is what ast reports."""
    return len(line.encode("utf-8")[:byte_column].decode("utf-8", errors="ignore"))


def blank(lines: list[str], start: tuple[int, int], end: tuple[int, int]) -> None:
    """Replace the source between two (line, character column) positions with spaces, newlines kept."""
    (row, col), (end_row, end_col) = start, end
    for index in range(row - 1, end_row):
        text = lines[index]
        first = col if index == row - 1 else 0
        last = end_col if index == end_row - 1 else len(text.rstrip("\n"))
        lines[index] = text[:first] + " " * (last - first) + text[last:]


class NulByteError(ValueError):
    """A file holds a NUL byte, which Python refuses anywhere in source code."""

    def __init__(self, line: int) -> None:
        """Name the line the first NUL byte sits on, counted the way Python counts lines."""
        super().__init__(f"a NUL byte on line {line}, which Python refuses in source code")


def read_source(path: str) -> tuple[str, str]:
    """Return a file's text as Python reads it, every line ending a newline, and the encoding it names.

    A NUL byte is looked for in the bytes before anything reads them, because which layer refuses it
    depends on the interpreter: 3.14's coding-cookie reader when it sits on the first line, the parser
    otherwise, as a SyntaxError from 3.12 on and a ValueError before.
    """
    data = Path(path).read_bytes()
    nul = data.find(b"\x00")
    if nul != -1:
        before = data[:nul].replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        raise NulByteError(before.count(b"\n") + 1)
    encoding, _lines = tokenize.detect_encoding(io.BytesIO(data).readline)
    text = data.decode(encoding)
    return text.replace("\r\n", "\n").replace("\r", "\n"), "utf-8" if encoding == "utf-8-sig" else encoding


def describe(path: str) -> FileFacts:
    """Return the facts about one file, or the error that stopped them, the file's own and no other's."""
    try:
        source, encoding = read_source(path)
    except OSError as error:
        return {"error": f"cannot read it: {type(error).__name__}: {error}"}
    except NulByteError as error:
        return {"error": f"cannot parse it: {error}"}
    except (SyntaxError, UnicodeDecodeError, LookupError) as error:
        return {"error": f"cannot decode it: {type(error).__name__}: {error}"}
    try:
        return facts_of(path, source, encoding)
    except (SyntaxError, ValueError, tokenize.TokenError) as error:
        # ast raises ValueError for a NUL byte before Python 3.12; read_source finds one first, so this only
        # keeps any other ValueError the parser may raise inside the JSON rather than failing the batch.
        return {"error": f"cannot parse it: {type(error).__name__}: {error}"}
    except (RecursionError, MemoryError) as error:
        return {"error": f"it nests deeper than this checker can walk: {type(error).__name__}: {error}"}


def facts_of(path: str, source: str, encoding: str) -> FileFacts:
    """Return the facts about one decoded file."""
    tree = ast.parse(source, filename=path)
    tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    # Split on newlines only: str.splitlines also splits on a form feed, a vertical tab, NEL and the
    # Unicode line separators, which tokenize and ast do not count as line ends.
    lines = [line + "\n" for line in source.split("\n")]
    lines[-1] = lines[-1][:-1]
    comments: list[tuple[int, str]] = []
    for token in tokens:
        if token.type == tokenize.COMMENT:
            comments.append((token.start[0], token.string[1:]))
            blank(lines, token.start, token.end)

    docstrings: list[tuple[int, int, str]] = []
    module_doc: str | None = None
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        doc = docstring_expr(node)
        if doc is not None and isinstance(doc.value, ast.Constant):
            text = str(doc.value.value)
            end_row = doc.end_lineno if doc.end_lineno is not None else doc.lineno
            end_byte = doc.end_col_offset if doc.end_col_offset is not None else doc.col_offset
            docstrings.append((doc.lineno, end_row, text))
            start_col = char_column(lines[doc.lineno - 1], doc.col_offset)
            end_col = char_column(lines[end_row - 1], end_byte)
            blank(lines, (doc.lineno, start_col), (end_row, end_col))
            if isinstance(node, ast.Module):
                module_doc = text

    docstrings.sort(key=lambda item: item[0])
    index = ModuleIndex(tree)
    return {
        "code": "".join(lines),
        "comments": comments,
        "docstrings": docstrings,
        "module_doc": module_doc,
        "main_guard": has_main_guard(tree),
        "encoding": encoding,
        "pinned": pinned_tests(index),
        "reads": read_calls(tree, index),
    }


def main(argv: list[str]) -> int:
    """Describe every named file as JSON on stdout; return the exit code."""
    if sys.version_info < FLOOR:
        version = ".".join(str(part) for part in sys.version_info[:3])
        sys.stderr.write(f"code_standard_ast: {FLOOR_SENTENCE}; this one is Python {version}\n")
        return 1
    if not argv:
        sys.stderr.write("usage: python scripts/tests/code_standard_ast.py <file> [<file> ...]\n")
        return 1
    report = {path: describe(path) for path in argv}
    sys.stdout.write(json.dumps(report, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
