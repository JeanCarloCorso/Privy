# Modelo de ameaça

## Protegemos contra

- captura de tráfego: TLS mais cifra no nível da mensagem;
- leitura ou vazamento do banco: mensagens são ciphertext e sessões são armazenadas como hash;
- servidor curioso/comprometido depois do envio: não há chaves privadas no backend;
- acesso horizontal: toda consulta é limitada pelo usuário autenticado e pela participação;
- perda temporária de uma chave de sessão: o ratchet limita mensagens passadas e pode recuperar segurança futura após nova entropia.

## Não protegemos completamente contra

- navegador, sistema operacional, extensão ou dispositivo comprometido;
- servidor/CDN comprometido entregando JavaScript malicioso;
- captura de tela, destinatário malicioso ou backup inseguro do próprio usuário;
- análise de metadados (participantes, horários, tamanhos aproximados, IP na borda/TURN);
- negação de serviço e comprometimento simultâneo dos endpoints.

| Ativo | Local | Controle principal |
|---|---|---|
| Senha | memória do usuário/API no login | Argon2id, TLS, rate limit, nunca logada |
| Sessão | cookie + hash no banco | 256 bits, HttpOnly, Secure em produção, SameSite=Strict, expiração/revogação |
| Chave privada E2EE | dispositivo | não exportável quando viável; backup opcional cifrado no cliente |
| Mensagem | navegador | protocolo Signal; backend recebe envelope opaco |
| Mídia | navegadores | WebRTC DTLS-SRTP; TURN apenas retransmite |

Rate limits por rota, conta e origem; enumeração de login reduzida; limites de payload; logs estruturados com allowlist. Denúncia de conteúdo exige ação explícita do usuário e compartilhamento consciente.
