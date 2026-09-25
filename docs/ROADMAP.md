# Entrega por fases

## Fase 1 — Fundação

Monorepo, API, frontend, PostgreSQL, cadastro/login/logout/me com Argon2id, sessão opaca, interface e headers. Critério: testes/typecheck verdes, cookie seguro em produção e nenhum segredo em log.

## Fase 2 — Transporte (implementada)

Conversas diretas idempotentes, membership transacional, descoberta de usuários, WebSocket autenticado, envelopes opacos e persistência. Foram adicionados testes de autorização negativa, schema estrito contra plaintext, rate limit e IDs idempotentes. O hub WebSocket atual é local ao processo; Redis/NATS será necessário antes de múltiplas réplicas.

## Fase 3 — E2EE (implementada no escopo inicial)

SDK browser, identidade composta, prekeys EC/ML-KEM, PQXDH, Double/Triple Ratchet, IndexedDB, envelopes persistentes e consumo atômico de chaves de uso único. Testes cobrem a fronteira sem plaintext, rejeição de chave privada e autorização negativa. Auditoria independente, safety numbers/QR, vinculação/revogação completa de dispositivos e backup cifrado permanecem pendentes antes de produção.

## Fase 4 — Chamadas

Sinalização, ICE/STUN/TURN, áudio/vídeo, controles e estados. Critério: backend/TURN não recebem mídia decifrada; sinalização autorizada/expira; teste em redes distintas.

## Fase 5 — Hardening

Pentest, CSP sem exceções, CSRF/origin, SBOM, fuzzing de envelopes, logs/backups, incident response e auditoria criptográfica externa.
