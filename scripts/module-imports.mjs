// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { builtinModules, createRequire } from "node:module";

let ts = null;
const typescript = () => (ts ??= createRequire(import.meta.url)("typescript"));
const BUILTIN = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

export function importsOf(source, fileName = "module.js") {
  const ts = typescript();
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const found = { static: [], dynamic: [] };
  for (const statement of file.statements) {
    const specifier = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) ? statement.moduleSpecifier : undefined;
    if (specifier && ts.isStringLiteral(specifier)) found.static.push(specifier.text);
  }
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) found.dynamic.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

export function isBare(specifier) {
  if (/^(?:\.{1,2}(?:\/|$)|\/|[A-Za-z]:[\\/]|[a-z][a-z0-9+.-]*:)/.test(specifier)) return false;
  return !BUILTIN.has(specifier) && !BUILTIN.has(specifier.split("/")[0]);
}

export const packageNamed = (specifier) => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
