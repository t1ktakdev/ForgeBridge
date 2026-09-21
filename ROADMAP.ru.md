# ForgeBridge — путь к 1.0

> **Текущий релиз:** `v0.1.0-alpha.4`  
> **Следующая цель:** `v0.2.0-beta.1`  
> **Оценка готовности к v1.0:** **≈68%**

ForgeBridge активно развивается. Эта дорожная карта специально консервативная: функция считается
готовой только когда есть реальная реализация, тесты, нужная документация и понятный release path.

Процент — это **взвешенная инженерная оценка milestone-блоков**. Это не оценка качества, не SLA, не
дата релиза и не обещание, что оставшиеся задачи одинаковы по сложности.

## Откуда берётся 68%

| Milestone                                                     |      Вес | Текущая готовность |    Вклад |
| ------------------------------------------------------------- | -------: | -----------------: | -------: |
| Core local agent и execution model                            |      20% |               100% |    20.0% |
| Permissions, approvals, audit и локальные security boundaries |      15% |                90% |    13.5% |
| Control Center и onboarding UX                                |      15% |                85% |    12.8% |
| Packaging, CI, npm, MCP Registry и release artifacts          |      10% |                90% |     9.0% |
| Update / repair / recovery lifecycle                          |      10% |                45% |     4.5% |
| Public API stability, migrations и deprecations               |      10% |                40% |     4.0% |
| Multi-device / remote routing                                 |      10% |                20% |     2.0% |
| Compatibility matrix и независимый production security gate   |      10% |                20% |     2.0% |
| **Итого**                                                     | **100%** |                    | **≈68%** |

Оценка обновляется на публичных релизных milestone, а не после каждого коммита.

## Что уже готово

В публичной alpha уже есть:

- локальная device identity и permissioned execution;
- canonical filesystem boundaries и policy enforcement;
- semantic project inspection и project validation;
- filesystem read/search/write/patch;
- Git read/write workflows с защищёнными mutation paths;
- terminal/PTY и durable jobs;
- изолированная browser automation;
- approvals, временные grants и redacted audit log;
- stdio и authenticated loopback MCP transports;
- Secure MCP Tunnel integration;
- guided setup и local device management;
- Control Center: Overview, Projects, Devices, Jobs, Sessions, Approvals, Audit, Settings;
- RU/EN и dark/light темы;
- Windows/macOS/Linux CI;
- проверка реально устанавливаемого npm tarball;
- SHA-256 и deterministic CycloneDX SBOM;
- публикация npm prerelease и MCP Registry.

## Следующая цель: v0.2.0-beta.1

### 1. Multi-device foundation

План:

- directory известных устройств;
- online/offline и last seen;
- selected/active device;
- безопасный routing abstraction;
- local route как первая реальная реализация;
- boundary для remote route без fake connectivity;
- выбор устройства в Control Center;
- permission checks, привязанные к адресуемому устройству.

Полноценный облачный coordinator для первой beta не обязателен.

### 2. Update / repair / recovery

Целевой UX:

```text
forgebridge update --check
forgebridge update
forgebridge repair
forgebridge doctor
```

Нужно:

- сохранять пользовательский state/config при обновлении;
- проверять новую версию до переключения;
- rollback/recovery после неудачного или повреждённого update;
- находить сломанную установку и отсутствующие runtime dependencies;
- показывать lifecycle status в Control Center.

### 3. Первый compatibility freeze

До beta публичные поверхности должны получить статус:

- **stable**
- **beta**
- **experimental**
- **deprecated**

Это относится к MCP tools, CLI, config format, permission semantics и local Control API.

## Beta hardening

После `0.2.0-beta.1` приоритет смещается с новых крупных функций на совместимость и failure
behavior:

- config/schema migrations;
- deprecation warnings и replacement paths;
- upgrade с alpha и предыдущих beta;
- network interruption/reconnect;
- corrupt state и partial-install recovery;
- PowerShell 5.1/7;
- Chrome/Chromium variations;
- большие audit/job datasets;
- accessibility и keyboard UX;
- live activity/log viewers и pagination.

## Gate перед 1.0 RC

`1.0.0-rc.1` должен появиться только после:

- clean Windows install/update/uninstall validation;
- реального Linux/macOS validation;
- отсутствия критических permission/path/symlink/secret findings;
- проверки update rollback и repair;
- public API inventory и migration policy;
- provenance/signing strategy;
- независимого security review или эквивалентного внешнего pass;
- нормальной troubleshooting/support документации;
- отсутствия известных release-blocking regressions.

## Release ladder

| Релиз              | Цель                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------- |
| ✅ `0.1.0-alpha.4` | Публичная alpha: новый Control Center, onboarding, device management и release pipeline |
| 🟡 `0.2.0-beta.1`  | Multi-device foundation, update/repair lifecycle, первый compatibility freeze           |
| ⏭ `0.2.0-beta.2+`  | Compatibility, recovery, UX и security hardening                                        |
| ⏭ `1.0.0-rc.1`     | Production validation candidate без крупных новых фич                                   |
| 🎯 `1.0.0`         | Stable public API и documented support contract                                         |

## Что пока не обещается

Сюда относятся идеи, которые могут появиться позже, но не выдаются за текущие возможности:

- ForgeBridge cloud service;
- vendor-neutral remote coordinator;
- billing/accounts;
- обход privilege boundaries;
- произвольная desktop automation вне permission model;
- гарантия одинакового UI support во всех MCP-клиентах.

## Признаки здорового релиза

- CI на Windows/macOS/Ubuntu;
- production dependency audit;
- deterministic package validation;
- npm install validation;
- MCP Registry validation;
- secret preflight;
- release checksum + SBOM;
- чистая публичная Git history и release notes.

Подробный инженерный план: [docs/implementation-plan.md](docs/implementation-plan.md).
