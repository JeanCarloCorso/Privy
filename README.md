# Privy

Privy é uma plataforma web de comunicação privada em desenvolvimento. O servidor autentica usuários, roteia eventos e persiste **envelopes criptografados**; conteúdo privado e chaves privadas pertencem aos clientes.

> Estado atual: **Fase 3 — E2EE**. Identidades e chaves privadas são criadas no navegador; PQXDH estabelece sessões e Double Ratchet protege cada mensagem. O backend persiste somente material público e ciphertext.

## Início rápido

Requisitos: Node.js 22.12+, npm 10+ e Docker com Compose.

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:migrate
npm run dev
```

Se a migration falhar, confirme primeiro que o container está saudável com
`docker compose ps`. O comando lê sempre o arquivo `.env` da raiz, mesmo sendo
executado pelo workspace `apps/api`.

- frontend: http://localhost:5173
- API: http://localhost:3000
- healthcheck: http://localhost:3000/health

O PostgreSQL de desenvolvimento usa `127.0.0.1:5433` para evitar colisão com instalações locais comuns na porta 5432.

Para testes e verificações: `npm test` e `npm run typecheck`.

Documentação: [arquitetura](docs/ARCHITECTURE.md), [E2EE](docs/E2EE.md), [transporte](docs/TRANSPORT.md), [modelo de ameaça](docs/THREAT_MODEL.md), [segurança](docs/SECURITY.md), [fases](docs/ROADMAP.md) e [produção](docs/PRODUCTION.md).

## Princípio de implementação

Antes de qualquer campo privado ser enviado: **o servidor precisa conhecer esse dado?** Se não, ele deve ser cifrado no navegador. O backend rejeita formatos de mensagem que não sejam envelopes cifrados; não existe endpoint para plaintext.

## Aviso honesto

Ainda não houve auditoria independente; por isso `npm run release:check` bloqueia um lançamento de produção. E2EE não protege endpoints comprometidos e uma aplicação web não consegue impedir que um servidor comprometido entregue JavaScript malicioso.
