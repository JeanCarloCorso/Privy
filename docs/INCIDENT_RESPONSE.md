# Resposta a incidentes

1. Suspenda novos cadastros e preserve evidências sem registrar plaintext ou chaves.
2. Isole a release afetada, revogue sessões e credenciais de infraestrutura e publique um bundle conhecido.
3. Se a origem web foi comprometida, trate todas as chaves usadas durante a janela como potencialmente expostas. Force nova identidade/dispositivo e alerte sobre mudança de safety number.
4. Se apenas o banco vazou, rotacione `SESSION_PEPPER`, revogue sessões e credenciais do banco. Ciphertexts continuam sujeitos a análise offline e retenção de metadados.
5. Registre linha do tempo, alcance, hashes dos artefatos e decisões. Não copie mensagens de usuários para tickets ou logs.
6. Restaure em ambiente limpo, valide SBOM, assinatura, CSP, migrações e monitoramento antes de reabrir.
