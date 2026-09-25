# Arquitetura

## Fronteiras de confiança

```text
Navegador A                         Infraestrutura não confiável                         Navegador B
identidade privada ─┐                                                               ┌─ identidade privada
estado do ratchet ──┼─ envelope cifrado ─ TLS ─ API/WS ─ PostgreSQL ─ TLS ─────────┼─ estado do ratchet
plaintext ──────────┘               (ciphertext + roteamento)                       └─ plaintext
                                      │
                                      └─ sinalização WebRTC (SDP/ICE), nunca mídia
```

O navegador é a fronteira criptográfica. A API é confiável para disponibilidade, autenticação, autorização, ordem aproximada e entrega, mas **não** para confidencialidade do conteúdo.

## Componentes

- `apps/web`: React/TypeScript. Futuramente mantém identidade e estado do protocolo por dispositivo em IndexedDB, cifra antes da rede e decifra depois dela.
- `apps/api`: Fastify/TypeScript. Sessões opacas em cookie, autorização, diretório de chaves públicas, envelopes, WebSocket e sinalização.
- PostgreSQL: contas, hashes de senha, hashes de sessão, dispositivos, material público, conversas e ciphertexts.
- STUN/TURN: conectividade ICE. TURN retransmite pacotes já protegidos por DTLS-SRTP e ainda observa IPs, volume e tempo.

## Protocolo E2EE escolhido

Para conversas 1:1/múltiplos dispositivos será usado o desenho Signal: acordo assíncrono por dispositivo (PQXDH/X3DH conforme suporte comprovado da biblioteca), Double Ratchet e gerenciamento de sessões equivalente ao Sesame. Isso fornece chave distinta por mensagem, sigilo futuro e recuperação pós-comprometimento em condições documentadas. A implementação virá de biblioteca mantida/auditável com build reproduzível para browser/WASM; não copiaremos a especificação em código próprio.

O servidor guarda apenas identity public key, signed prekey, assinatura, lote limitado de one-time prekeys e envelopes opacos. Mudanças de identity key exigem aviso e nova verificação por safety number/QR. Cada mensagem é cifrada separadamente para todos os dispositivos autorizados do destinatário e para os outros dispositivos do remetente.

MLS (RFC 9420) é candidato para grupos, não para a primeira entrega 1:1. AES-GCM isolado, “uma chave por conversa” ou RSA direto não são substitutos para um protocolo ratcheting.

## Chamadas

WebRTC negocia ICE por sinalização autenticada. Mídia usa DTLS-SRTP no navegador. Em chamadas P2P de duas pessoas, a API nunca recebe mídia; um TURN pode retransmitir ciphertext. SDP e candidatos ICE revelam metadados e, dependendo da topologia, participantes podem conhecer seus IPs. `iceTransportPolicy: relay` será uma opção de privacidade com custo/latência. SFU e gravação no servidor ficam fora do escopo 1:1 e exigiriam E2EE adicional antes de adoção.

## Contratos de dados privados

Endpoints de mensagens aceitarão somente um envelope binário/base64 versionado com cabeçalho autenticado, IDs opacos, chave pública de ratchet, contador e ciphertext. Não haverá propriedade `text`, `body` ou `plaintext`. Limites de tamanho e schema estrito serão aplicados antes de persistir.
