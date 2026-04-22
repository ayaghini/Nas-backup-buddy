# Client App Packaging And Release

## Release Goals

The client app must be easy to install and safe to verify. Release artifacts should make it clear which app version, bundled tool versions, checksums, licenses, and known limitations apply.

## Supported Packages

| Platform | Target Package | Notes |
| --- | --- | --- |
| Windows | Installer and portable build if practical | Signing required before public beta where practical |
| macOS | DMG or app bundle | Signing and notarization required before public beta where practical |
| Linux | AppImage or deb/rpm where practical | Include clear dependency notes |

The first internal alpha may use unsigned development builds if the release notes clearly mark them as test-only.

## Signing

Use signed releases where practical.

Minimum stance:

- Internal alpha: unsigned allowed with clear warnings.
- Private beta: signing should be in place for Windows and macOS where practical.
- Public beta: signing is required or launch is blocked by a written decision record.

## Bundled Tool Manifest

Each release must include a manifest for bundled tools:

| Field | Required |
| --- | --- |
| Tool name | Yes |
| Version | Yes |
| Platform | Yes |
| Expected checksum | Yes |
| License | Yes |
| Source/download reference | Yes |
| Update notes | Yes |

Kopia and Syncthing are required in v1. Restic is future optional support.

## Checksum Verification

The client service must verify bundled tools before use.

Release process must record:

- App artifact checksums.
- Bundled Kopia checksums.
- Bundled Syncthing checksums.
- Tool manifest checksum.

The client must fail closed when a tool binary checksum does not match.

## AGPL-3.0 Requirements

The repository and release packages should include:

- `LICENSE` with AGPL-3.0 text.
- Third-party notices.
- A clear source availability statement.
- Build instructions.
- Modification and redistribution notes.

Do not claim AGPL-3.0 compliance for release artifacts until license files and third-party notices are present.

Current status:

- Root `LICENSE` exists with AGPL-3.0-only project notice and canonical license reference.
- Root `THIRD_PARTY_NOTICES.md` exists as a placeholder inventory.
- Full production release notice completeness still requires dependency and bundled-tool license audit.

## Third-Party License Inventory

Track at least:

- Tauri.
- Rust crates.
- React and TypeScript dependencies.
- Kopia.
- Syncthing.
- Packaging/signing tools.

The inventory should list package name, version, license, and source URL.

## Release Notes Template

```text
Version:
Release date:
Audience:
Supported platforms:
Signing status:
Bundled Kopia version:
Bundled Syncthing version:
New features:
Safety fixes:
Known limitations:
Upgrade notes:
Rollback notes:
Checksums:
```

## Upgrade Policy

Upgrades must preserve:

- Local config.
- Secret references.
- Tool manifest history.
- Previous health records needed for audit.

If an upgrade changes Kopia or Syncthing versions, release notes must call it out.

## Rollback Policy

Rollback notes must explain:

- Whether config format changed.
- Whether bundled tool versions changed.
- Whether repository format compatibility is affected.
- How to stop the local service before rollback.

The app should not auto-upgrade backup repository formats without explicit user confirmation.

## Public Release Gate

Do not publish public release artifacts until:

- Build succeeds on all target platforms.
- License files are present.
- Third-party notices are present.
- Bundled tool checksums are verified.
- Release artifact checksums are recorded.
- Signing status is documented.
- Local onboarding works.
- Restore drill failure maps to Critical.
- Health reports pass telemetry allowlist checks.
