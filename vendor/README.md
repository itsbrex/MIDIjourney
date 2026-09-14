# Shared Pollinations UI snapshot

`pollinations-ui-0.1.0-alpha.1.tgz` is an unmodified `npm pack --ignore-scripts`
snapshot of the prebuilt shared UI package from the local Pollinations checkout
at `pollinations/packages/ui`, captured on 2026-09-13.

- Checkout HEAD: `45406080a3269c144d90d63c9cb72b306910d891`. The artifact is the
  local built distribution, not a claim that the checkout or build was clean.
- Archive SHA-256: `7b0d607eaf8f9900bfd6a5097d642b91b63bdebd86454445cdc81ce6f8853743`.
- Package license: MIT; its notices and font licenses are included in the archive.
- Compatible SDK pinned in this app: `@pollinations/sdk@5.1.0-alpha.7`.

The npm alpha tag still points to an older build under the same version number,
without `ColorModeToggle` or the mode-aware design tokens. This local snapshot
lets the app use the actual package implementation, without copying or
reimplementing a theme switch in the app. It is not a new published package.

The vendored archive is the reproducible dependency for this release candidate;
the checksum is enforced by the build checks and package lock. No sibling
checkout is used at build time. Replace it only with an identified published
version containing the same features, after repeating UI/auth acceptance.
