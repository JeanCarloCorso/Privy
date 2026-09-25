# Segurança, criptografia e transparência

Cada instalação do navegador é um dispositivo. O cliente gera identidade, prekeys e estado do ratchet usando o CSPRNG da plataforma por meio do SDK OpenE2EE. Somente material público é publicado. Chaves privadas e plaintext nunca fazem parte de requests, telemetria ou logs.

Senhas autenticam contas; não são chaves de mensagem. O backend armazena Argon2id da senha. Um futuro backup de chaves será opcional, cifrado no cliente com chave derivada por Argon2id calibrado e salt aleatório; o servidor verá apenas o blob cifrado. Recuperar a conta não recupera mensagens se o usuário não tiver um dispositivo ou backup criptográfico válido.

## Fluxo de mensagem

1. O cliente obtém bundles públicos dos dispositivos.
2. Valida assinatura e mudança de identidade.
3. A biblioteca cria/avança uma sessão por dispositivo e cifra com associated data canônico.
4. Só o envelope é enviado e persistido.
5. O destinatário valida, avança seu estado atomicamente e decifra localmente.
6. Confirmações de leitura também são eventos E2EE; o servidor conhece apenas entrega técnica.

O servidor vê IDs, participantes, chaves públicas, timestamps de transporte, tamanho do envelope, status técnico, IP na borda e SDP/ICE. Não vê texto, chaves privadas, estado do ratchet, mídia decifrada ou nomes privados de conversa.

## Aplicação web

CSP estrita, scripts locais, lockfile, nenhum analytics/script de terceiros, escaping do React, cookies HttpOnly e releases reproduzíveis reduzem risco. Porém, se alguém modificar o JavaScript servido, poderá exfiltrar chaves ou plaintext. Privy não será descrito como “100% seguro”. Auditoria e transparência de builds são defesas adicionais.

O histórico local é cifrado com AES-256-GCM e uma `CryptoKey` não exportável, separada por conta. Isso protege uma cópia isolada dos registros, mas scripts da mesma origem ainda podem solicitar o uso da chave. O cliente mostra um código de segurança de 60 dígitos derivado das duas identidades públicas para comparação fora de banda.

Até existir provisionamento E2EE de dispositivos com testes completos, produção suporta somente o dispositivo primário. Fluxos parciais de vinculação, rotação e backup falham fechados.
