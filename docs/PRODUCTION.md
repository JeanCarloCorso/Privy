# Produção

- Termine as fases e revisão independente antes de aceitar comunicação real.
- TLS 1.3 no proxy, HSTS após validar subdomínios e PostgreSQL privado com TLS/backups cifrados.
- Injete `SESSION_PEPPER` (32+ bytes aleatórios) por secret manager; nunca reutilize o exemplo.
- Prefira frontend e API na mesma origem; cookie `Secure`, `HttpOnly`, `SameSite=Strict`.
- Migrations em job separado; Redis para rate limit/presença ao escalar.
- TURN com credenciais efêmeras, TLS, quotas e retenção mínima de logs.
- Fixe dependências pelo lockfile, gere SBOM, verifique artefatos e proíba scripts remotos.
- Separe produção/staging/desenvolvimento, rotacione segredos e teste restauração/revogação.
