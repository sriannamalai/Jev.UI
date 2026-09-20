import type { Json, Question, Request } from './schema.js';

export type ExportTarget = 'curl' | 'python' | 'typescript';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export function exportRequest(target: ExportTarget, request: Request): string {
  switch (target) {
    case 'curl':
      return toCurl(request);
    case 'python':
      return toPython(request);
    case 'typescript':
      return toTypeScript(request);
  }
}

// ---------------------------------------------------------------------------
// cURL
// ---------------------------------------------------------------------------

export function toCurl(request: Request): string {
  const body = JSON.stringify(request, null, 2);
  const delimiter = chooseHeredocDelimiter(body);
  return (
    [
      `curl -X POST ${ENDPOINT} \\`,
      '  -H "Authorization: Bearer $TYPESAFE_API_KEY" \\',
      '  -H "Content-Type: application/json" \\',
      `  -d @- <<'${delimiter}'`,
      body,
      delimiter,
    ].join('\n') + '\n'
  );
}

// Exact-line collision avoidance for the heredoc delimiter. A standard JSON
// pretty-print never produces a bare `EOF` line (strings/keys are always
// quoted), but this stays defensive regardless of how `body` is produced.
export function chooseHeredocDelimiter(body: string): string {
  const lines = new Set(body.split('\n'));
  if (!lines.has('EOF')) return 'EOF';
  let n = 1;
  while (lines.has(`JEV_EOF_${n}`)) n += 1;
  return `JEV_EOF_${n}`;
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

export function toPython(request: Request): string {
  const classes = new Set<string>(['TypeSafeClient']);
  for (const question of Object.values(request.questions)) {
    classes.add(pythonClassName(question.type));
  }
  const imports = Array.from(classes).sort().join(', ');

  const lines: string[] = [];
  lines.push(`from typesafe_sdk import ${imports}`);
  lines.push('');
  lines.push('client = TypeSafeClient()');
  lines.push('');
  lines.push('response = client.system_one(');
  lines.push(`    state=${renderPyValue(request.state, 4)},`);
  lines.push('    questions={');
  for (const [name, question] of Object.entries(request.questions)) {
    lines.push(`        ${pythonStringLiteral(name)}: ${renderPyQuestion(question, 8)},`);
  }
  lines.push('    },');
  if (request.model !== undefined) {
    lines.push(`    model=${renderPyValue(request.model, 4)},`);
  }
  lines.push(')');
  lines.push('');
  lines.push('print(response.answers)');
  return lines.join('\n') + '\n';
}

function pythonClassName(type: Question['type']): string {
  switch (type) {
    case 'noul':
      return 'Noul';
    case 'choice':
      return 'Choice';
    case 'score':
      return 'Score';
  }
}

function renderPyQuestion(question: Question, indent: number): string {
  const pad = ' '.repeat(indent + 4);
  const close = ' '.repeat(indent);
  const lines = [`${pythonClassName(question.type)}(`];
  lines.push(`${pad}instructions=${renderPyValue(question.instructions, indent + 4)},`);
  if (question.type === 'noul') {
    if (question.criteria !== undefined) {
      lines.push(`${pad}criteria=${renderPyValue(question.criteria, indent + 4)},`);
    }
  } else {
    lines.push(`${pad}criteria=${renderPyValue(question.criteria, indent + 4)},`);
  }
  lines.push(`${close})`);
  return lines.join('\n');
}

function renderPyValue(value: Json, indent: number): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return pythonStringLiteral(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = indent + 4;
    const pad = ' '.repeat(inner);
    const items = value.map((v) => `${pad}${renderPyValue(v, inner)},`);
    return `[\n${items.join('\n')}\n${' '.repeat(indent)}]`;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  const inner = indent + 4;
  const pad = ' '.repeat(inner);
  const items = keys.map(
    (k) => `${pad}${pythonStringLiteral(k)}: ${renderPyValue(value[k]!, inner)},`,
  );
  return `{\n${items.join('\n')}\n${' '.repeat(indent)}}`;
}

// Builds a Python string literal directly (not by post-processing JSON
// escaping): all non-ASCII is emitted as \uXXXX, and code points above
// U+FFFF as \UXXXXXXXX (Python does not recombine a \uXXXX surrogate pair
// the way UTF-16 source text would).
function pythonStringLiteral(value: string): string {
  let out = '"';
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (cp === 0x08) out += '\\b';
    else if (cp === 0x09) out += '\\t';
    else if (cp === 0x0a) out += '\\n';
    else if (cp === 0x0c) out += '\\f';
    else if (cp === 0x0d) out += '\\r';
    else if (cp < 0x20) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else if (cp < 0x7f) out += ch;
    else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += `\\U${cp.toString(16).padStart(8, '0')}`;
  }
  out += '"';
  return out;
}

// ---------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------

export function toTypeScript(request: Request): string {
  const lines: string[] = [];
  lines.push('import { TypeSafeClient } from "@typesafe-ai/sdk";');
  lines.push('');
  lines.push('const client = new TypeSafeClient();');
  lines.push('');
  lines.push('const response = await client.systemOne({');
  lines.push(`  state: ${renderTsValue(request.state, 2)},`);
  if (request.model !== undefined) {
    lines.push(`  model: ${renderTsValue(request.model, 2)},`);
  }
  lines.push('  questions: {');
  for (const [name, question] of Object.entries(request.questions)) {
    lines.push(`    ${JSON.stringify(name)}: ${renderTsQuestion(question, 4)},`);
  }
  lines.push('  },');
  lines.push('});');
  lines.push('');
  lines.push('console.log(response.answers);');
  return lines.join('\n') + '\n';
}

function renderTsQuestion(question: Question, indent: number): string {
  const pad = ' '.repeat(indent + 2);
  const close = ' '.repeat(indent);
  const lines = ['{'];
  lines.push(`${pad}type: ${JSON.stringify(question.type)},`);
  lines.push(`${pad}instructions: ${renderTsValue(question.instructions, indent + 2)},`);
  if (question.type === 'noul') {
    if (question.criteria !== undefined) {
      lines.push(`${pad}criteria: ${renderTsValue(question.criteria, indent + 2)},`);
    }
  } else {
    lines.push(`${pad}criteria: ${renderTsValue(question.criteria, indent + 2)},`);
  }
  lines.push(`${close}}`);
  return lines.join('\n');
}

function renderTsValue(value: Json, indent: number): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = indent + 2;
    const pad = ' '.repeat(inner);
    const items = value.map((v) => `${pad}${renderTsValue(v, inner)},`);
    return `[\n${items.join('\n')}\n${' '.repeat(indent)}]`;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  const inner = indent + 2;
  const pad = ' '.repeat(inner);
  const items = keys.map((k) => `${pad}${JSON.stringify(k)}: ${renderTsValue(value[k]!, inner)},`);
  return `{\n${items.join('\n')}\n${' '.repeat(indent)}}`;
}
