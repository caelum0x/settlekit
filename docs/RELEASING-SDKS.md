# Releasing the SDKs

| SDK | Package | Version | Registry |
|-----|---------|---------|----------|
| TypeScript | `@settlekit/sdk` (+ `@settlekit/common`) | 0.1.0 | npm |
| React | `@settlekit/react` | 0.1.0 | npm |
| Python | `settlekit` | 0.1.0 | PyPI |
| Rust | `settlekit` | 0.1.0 | crates.io |
| Go | `github.com/caelum0x/settlekit/sdks/go` | v0.1.0 | Go module proxy (tag) |

All SDKs verify webhook signatures that carry one `v1` per active secret (secret rotation).

## One-time setup (owner)

1. npm: create the `@settlekit` organization, then add an automation token as the `NPM_TOKEN` repository secret.
2. PyPI: create the `settlekit` project and add this repository's `release-sdks` workflow as a trusted publisher.
3. crates.io: reserve `settlekit` and add `CARGO_REGISTRY_TOKEN` as a repository secret.
4. Go: DONE — `github.com/settlekit` is not a real GitHub org (404s; confirmed against both GitHub and the Go module proxy), so `sdks/go/go.mod`'s module path was changed to `github.com/caelum0x/settlekit/sdks/go` (this repository's real path). Still needed: tag `sdks/go/v0.1.0` so `go get` resolves a real version instead of a pseudo-version off `main`.
5. Confirm the MIT licence in each SDK's `LICENSE` file.

## Release

```bash
# bump versions in packages/{common,sdk,react}/package.json, sdks/python/pyproject.toml, sdks/rust/Cargo.toml
git tag sdk-v0.1.0 && git push origin sdk-v0.1.0
```

Run the workflow manually with `dry_run` to build and pack without publishing.
