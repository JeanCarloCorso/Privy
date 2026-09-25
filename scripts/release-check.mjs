import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const requiredFiles = ['docs/E2EE.md', 'docs/THREAT_MODEL.md', 'docs/INCIDENT_RESPONSE.md', 'security/audit-report.pdf'];
const failures = [];
for (const file of requiredFiles) { try { await access(file); } catch { failures.push(`arquivo obrigatório ausente: ${file}`); } }
if (!/^https:\/\//.test(process.env.WEB_ORIGIN ?? '')) failures.push('WEB_ORIGIN deve ser HTTPS');
if (!/^[a-f0-9]{64}$/.test(process.env.SECURITY_AUDIT_SHA256 ?? '')) failures.push('SECURITY_AUDIT_SHA256 deve registrar o SHA-256 da auditoria independente');
if (!process.env.RELEASE_ID || process.env.RELEASE_ID.length < 8) failures.push('RELEASE_ID imutável não informado');
try { const report = await readFile('security/audit-report.pdf'); const digest = createHash('sha256').update(report).digest('hex'); if (process.env.SECURITY_AUDIT_SHA256 && digest !== process.env.SECURITY_AUDIT_SHA256) failures.push('hash do relatório de auditoria não confere'); } catch { /* absence already reported */ }
if (failures.length) { console.error(`Release bloqueado:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('Gate documental de release aprovado. Execute também testes, auditoria de dependências, DAST e restore drill.');
