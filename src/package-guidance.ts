import { readFileSync, lstatSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const names = ['repository-analysis', 'validation-planning', 'controlled-review', 'task-planning', 'recovery-explanation', 'runtime-observability', 'scenario-management', 'evidence-management', 'software-design-quality','project-memory','project-planning','greenfield-bootstrap'] as const;
/** Explicit host-selected package text, never inherited project/global skills or execution authority. */
export function packageGuidance(name: typeof names[number]): string {
  if (!names.includes(name)) throw new Error('PACKAGE_GUIDANCE_INVALID');
  const path = fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url));
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) throw new Error('PACKAGE_GUIDANCE_INVALID');
  const text = readFileSync(path).toString('utf8');
  if (!text.startsWith(`---\nname: ${name}\n`)) throw new Error('PACKAGE_GUIDANCE_INVALID');
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  if (!body || body === text.trim()) throw new Error('PACKAGE_GUIDANCE_INVALID');
  return `PACKAGE GUIDANCE (not authority; host contracts and role permissions remain unchanged):\n${body}`;
}

/** Display wording only: identities, evidence and output schemas keep their exact meaning. */
export const HUMAN_LANGUAGE_GUIDANCE=`\nHuman-facing fields must use clear, natural English. Use short sentences and concrete verbs. Explain what happened, what remains to do, and the next action. Prefer plain descriptions such as task, starting files, working copy and check passed when explaining technical concepts. Avoid formal or obscure labels when plain wording is possible. Keep exact file paths, technical symbols, protocol fields, identity values and required status enums unchanged. Never translate or omit verbatim evidence, risks or constraints; distinguish planned work from completed and verified work.`;
