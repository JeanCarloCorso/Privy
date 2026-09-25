# Produção

O repositório possui uma configuração endurecida, mas o lançamento permanece bloqueado até uma auditoria independente. `npm run release:check` exige o relatório em `security/audit-report.pdf`, seu SHA-256 e um `RELEASE_ID` imutável.

## Implantação

1. Use Node 22.12+ e execute testes, typecheck, build, auditoria de dependências e migrações em jobs separados.
2. Armazene `DATABASE_URL` e um `SESSION_PEPPER` aleatório em secret manager. A configuração recusa banco sem TLS, origem HTTP e pepper previsível.
3. Construa `docker-compose.production.yml`. O frontend e a API ficam na mesma origem; `/api/` é encaminhado internamente e somente o proxy web liga uma porta localhost.
4. Termine TLS 1.3 em um ingress confiável diante da porta 8080. Valide todos os subdomínios antes de manter `includeSubDomains` no HSTS.
5. Use PostgreSQL privado, TLS com CA verificada, backup cifrado e restore drill documentado. Nunca publique a porta do banco.
6. Para múltiplas réplicas, substitua rate limit/presença em memória por Redis e distribua envelopes por um broker autenticado.

## Gate obrigatório

```bash
npm ci
npm run typecheck
npm test
npm run build
npm audit --omit=dev
npm sbom --sbom-format cyclonedx > sbom.cdx.json
WEB_ORIGIN=https://seu-dominio.example \
RELEASE_ID=<commit-imutavel> \
SECURITY_AUDIT_SHA256=<sha256-do-relatorio> \
npm run release:check
```

Também são obrigatórios DAST autenticado, teste de duas contas/dispositivos em browsers isolados, verificação do dump do banco, restore drill e revisão do plano de [resposta a incidentes](INCIDENT_RESPONSE.md).

## Restrições atuais

- Somente o dispositivo primário deve ser habilitado. Vinculação e backup continuam fail-closed.
- Não alegar compatibilidade com Signal Messenger ou libsignal.
- Não alegar segurança absoluta. Um comprometimento da origem web pode comprometer o cliente.
- Chamadas WebRTC pertencem à Fase 4 e não estão liberadas nesta release.
