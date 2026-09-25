# Segurança, criptografia e transparência

Cada instalação do navegador será um dispositivo. O cliente gera identidade, prekeys e estado do ratchet usando CSPRNG da plataforma por meio da biblioteca escolhida. Somente material público é publicado. Chaves privadas e plaintext nunca fazem parte de requests, telemetria ou logs.

Senhas autenticam contas; não são chaves de mensagem. O backend armazena Argon2id da senha. Um futuro backup de chaves será opcional, cifrado no cliente com chave derivada por Argon2id calibrado e salt aleatório; o servidor verá apenas o blob cifrado. Recuperar a conta não recupera mensagens se o usuário não tiver um dispositivo ou backup criptográfico válido.

## Fluxo futuro de mensagem

1. O cliente obtém bundles públicos dos dispositivos.
2. Valida assinatura e mudança de identidade.
3. A biblioteca cria/avança uma sessão por dispositivo e cifra com associated data canônico.
4. Só o envelope é enviado e persistido.
5. O destinatário valida, avança seu estado atomicamente e decifra localmente.
6. Confirmações de leitura também são eventos E2EE; o servidor conhece apenas entrega técnica.

O servidor vê IDs, participantes, chaves públicas, timestamps de transporte, tamanho do envelope, status técnico, IP na borda e SDP/ICE. Não vê texto, chaves privadas, estado do ratchet, mídia decifrada ou nomes privados de conversa.

## Aplicação web

CSP estrita, scripts locais, lockfile, nenhum analytics/script de terceiros, escaping do React, cookies HttpOnly e releases reproduzíveis reduzem risco. Porém, se alguém modificar o JavaScript servido, poderá exfiltrar chaves ou plaintext. Privy não será descrito como “100% seguro”. Auditoria e transparência de builds são defesas adicionais.

A Fase 1 protege autenticação e sessão, mas ainda não declara mensagens E2EE. Telas de mensagens permanecem desabilitadas até os testes criptográficos passarem.
