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

## Apple-side checklist

1. Create a **Developer ID Application** certificate (G2 Sub-CA). Do not use Apple Development, Mac App Store, or Developer ID Installer.
2. Export the identity from Keychain **login → My Certificates** (the certificate row, which includes the private key) as `.p12`.
3. In App Store Connect → Users and Access → Integrations → App Store Connect API, generate an Admin (or equivalent) key and download the `.p8` once.

## After switching from ad-hoc builds

Gatekeeper should accept the notarized app without **Open Anyway**. Full Disk Access may still need to be granted once. Users who already granted FDA to an ad-hoc build may need to add the notarized app again, because TCC keys access to the code-signing identity.
