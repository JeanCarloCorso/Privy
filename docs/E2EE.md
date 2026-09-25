# E2EE da Fase 3

## Decisão

O Privy usa `@open-e2ee/signal-protocol-sdk` 5.0.0, uma implementação TypeScript independente para navegadores. A política padrão estrita combina PQXDH (X25519, Ed25519 e ML-KEM-1024) para estabelecer a sessão, Double/Triple Ratchet para evoluir chaves por mensagem e Sesame para sessões por dispositivo. Não há algoritmo criptográfico criado pelo Privy.

O pacote oficial `@signalapp/libsignal-client` não foi escolhido porque seu binding publicado é voltado a Node/desktop e não oferece integração web suportada. O SDK adotado roda no navegador e fornece adaptador IndexedDB. Ele não é compatível com o wire format dos aplicativos Signal.

## Fluxo

1. No primeiro acesso autenticado, o SDK cria no navegador uma identidade X25519/Ed25519, um registration ID e prekeys EC e ML-KEM.
2. Chaves privadas e estados do ratchet são gravados somente no IndexedDB. A API não possui campos para recebê-los.
3. O cliente publica a identidade e as prekeys públicas. A API aceita objetos estritos e rejeita propriedades extras.
4. Ao iniciar uma sessão, o remetente busca um bundle público. A API consome atomicamente uma prekey EC e uma prekey ML-KEM de uso único.
5. O SDK cifra o texto antes do `fetch`. A API autentica o remetente, confere a participação na conversa e persiste `ciphertext` em `e2ee_envelopes`.
6. O WebSocket notifica o destinatário. O SDK descriptografa localmente, avança o ratchet e confirma a entrega.

## Visibilidade do servidor

O servidor vê IDs de conta/dispositivo, horários, tamanho e tipo externo dos envelopes, chaves públicas, estoque de prekeys, relações de conversa e metadados normais de TLS. Ele não recebe texto, chave privada, chave de sessão, estado do ratchet ou senha em texto puro. Logs redigem ciphertext, envelopes, cookies, authorization e senha.

## Recuperação e limites

- Limpar o IndexedDB perde a identidade privada desta instalação. A senha autentica a conta, mas não recupera chaves E2EE.
- O SDK é independente e não apresenta auditoria externa de uma empresa de segurança. Auditoria criptográfica é obrigatória antes de produção.
- JavaScript não garante constant-time nem limpeza determinística de memória.
- IndexedDB não protege contra JavaScript malicioso na mesma origem. Um servidor comprometido que altere o bundle pode capturar chaves e plaintext.
- Metadados permanecem visíveis. Esta fase não implementa sealed sender ou anonimização de rede.
- O histórico local é cifrado com AES-256-GCM e uma chave não exportável por conta. Sincronização de histórico entre dispositivos ainda não foi implementada.
- Vinculação segura, backup cifrado e rotação de identidade falham fechados até serem implementados.

## Validação

```bash
npm install
npm run db:migrate
npm test
npm run typecheck
npm run build
```

Os testes verificam rejeição de material privado, ausência de plaintext, autorização da conversa e entrega exclusiva de ciphertext.

## Referências

- https://signal.org/docs/specifications/pqxdh/
- https://signal.org/docs/specifications/doubleratchet/
- https://docs.open-e2ee.dev/start/browser
- https://github.com/open-e2ee/signal-protocol-js/blob/main/docs/SECURITY.md
