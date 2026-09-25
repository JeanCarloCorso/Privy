# Protocolo de transporte — Fase 2

Esta fase entrega roteamento e persistência. Ela **não** afirma confidencialidade de conteúdo até a biblioteca E2EE da Fase 3 produzir os envelopes.

## HTTP

- `GET /users/search?q=`: retorna ID, username, display name e criação; exige sessão e mínimo de dois caracteres.
- `POST /conversations { peerUserId }`: cria ou retorna uma conversa direta única para o par, dentro de transação.
- `GET /conversations`: retorna apenas conversas das quais a sessão participa.
- `GET /conversations/:id/messages`: histórico paginado; não membros recebem `404`.
- `POST /conversations/:id/messages`: aceita exclusivamente o envelope abaixo.

```json
{
  "senderDeviceId": "uuid",
  "recipientDeviceId": "uuid",
  "protocolVersion": 1,
  "clientMessageId": "uuid",
  "envelope": "base64-canônico"
}
```

O schema é estrito: propriedades como `text`, `body`, `plaintext` e `privateKey` tornam a requisição inválida. O envelope é limitado a 1 MiB decodificado. `clientMessageId` junto aos dispositivos fornece idempotência. O backend confirma que remetente, destinatário e conversa possuem relação autorizada, mas não interpreta o envelope.

## WebSocket

`GET /realtime` usa o cookie opaco HttpOnly. O handshake valida `Origin` exatamente contra `WEB_ORIGIN`, mitigando Cross-Site WebSocket Hijacking. Eventos previstos:

```json
{ "type": "realtime.ready" }
{ "type": "message.created", "message": { "...": "envelope persistido" } }
{ "type": "ping" }
{ "type": "pong" }
```

O evento é publicado somente para IDs que pertencem à conversa. A persistência acontece antes da publicação; reconexão recupera eventos perdidos pelo histórico HTTP.

## Limites atuais

- O fan-out é mantido em memória e atende uma réplica. Produção horizontal requer broker autenticado e testes de isolamento.
- Timestamps, participantes, tamanhos e frequência permanecem metadados visíveis.
- Presença detalhada e indicadores de leitura serão eventos E2EE.
- O frontend não oferece caixa de texto até a Fase 3; aceitar texto agora criaria falsa segurança.
