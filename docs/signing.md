# Signing, notarization, and GitHub secrets

Release DMGs are signed with a **Developer ID Application** certificate and notarized with `notarytool`. Certificates never live in this repository.

Local `npm run build:mac` stays **ad-hoc** so day-to-day packaging does not need Apple credentials.

## GitHub Actions secrets

Set these on the `diskheadroom` repository under **Settings → Secrets and variables → Actions**. The **Release** workflow fails if any are missing, so an unsigned ad-hoc DMG is not published by accident.

| Secret | Contents |
| --- | --- |
| `CSC_LINK` | Base64 of the Developer ID Application `.p12` (`base64 -i cert.p12 \| pbcopy`) |
| `CSC_KEY_PASSWORD` | Password used when exporting that `.p12` |
| `APPLE_API_KEY` | Full text of the App Store Connect API `.p8` (including `BEGIN` / `END`) |
| `APPLE_API_KEY_ID` | Key ID from App Store Connect |
| `APPLE_API_ISSUER` | Issuer UUID from App Store Connect |
| `APPLE_TEAM_ID` | 10-character Team ID from [developer.apple.com/account](https://developer.apple.com/account) |

The workflow writes `APPLE_API_KEY` to a temporary `.p8` path before electron-builder runs. `APPLE_API_KEY` in the builder environment is that path, not the secret name.

`CSC_LINK` is consumed by the workflow's own import step, not by electron-builder. electron-builder 26 passes the `.p12` password to `security set-key-partition-list`, which authenticates against the keychain and fails with `SecKeychainUnlock: The user name or passphrase you entered is not correct` no matter what the password is ([electron-builder#10066](https://github.com/electron-userland/electron-builder/issues/10066)). The workflow imports the certificate into a temporary keychain itself and exports `CSC_KEYCHAIN`, so the builder discovers the identity instead of recreating that keychain. Drop the import step once the upstream fix ships.

## Apple-side checklist

1. Create a **Developer ID Application** certificate (G2 Sub-CA). Do not use Apple Development, Mac App Store, or Developer ID Installer.
2. Export the identity from Keychain **login → My Certificates** (the certificate row, which includes the private key) as `.p12`.
3. In App Store Connect → Users and Access → Integrations → App Store Connect API, generate an Admin (or equivalent) key and download the `.p8` once.

## After switching from ad-hoc builds

Gatekeeper should accept the notarized app without **Open Anyway**. Full Disk Access may still need to be granted once. Users who already granted FDA to an ad-hoc build may need to add the notarized app again, because TCC keys access to the code-signing identity.
