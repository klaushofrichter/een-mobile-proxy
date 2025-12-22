# Release Archive Naming Convention

This document describes the archive naming convention and version extraction process used in the release workflow.

## Archive Naming Format

Release archives are named using the following format:

```
een-oauth-proxy-v{PROXY_VERSION}_v{ADMIN_VERSION}
```

Where:
- `PROXY_VERSION` is the version from `proxy/package.json`
- `ADMIN_VERSION` is the version from `admin/package.json`

### Example

If:
- Proxy version: `1.1.8`
- Admin version: `1.0.3`

Then the archive name will be:
```
een-oauth-proxy-v1.1.8_v1.0.3
```

## Archive Formats

Two archive formats are created for each release:
1. **ZIP**: `een-oauth-proxy-v{PROXY_VERSION}_v{ADMIN_VERSION}.zip`
2. **TAR.GZ**: `een-oauth-proxy-v{PROXY_VERSION}_v{ADMIN_VERSION}.tar.gz`

Both archives contain the same content, with the directory prefix matching the archive name.

## Version Extraction Process

The version extraction process is performed in the "Get version numbers" step of the release workflow:

1. **Read package.json files**:
   - `proxy/package.json` → Extract `version` field
   - `admin/package.json` → Extract `version` field

2. **Validate versions**:
   - Both versions must be present and non-empty
   - If either version is missing, the workflow fails with an error

3. **Create release tag**:
   - Format: `proxy-v{PROXY_VERSION}_admin-v{ADMIN_VERSION}`
   - Example: `proxy-v1.1.8_admin-v1.0.3`

4. **Create archive name**:
   - Format: `een-oauth-proxy-v{PROXY_VERSION}_v{ADMIN_VERSION}`
   - Example: `een-oauth-proxy-v1.1.8_v1.0.3`

## Archive Creation

Archives are created using `git archive`:

```bash
git archive --format=zip --prefix="${ARCHIVE_NAME}/" -o "${ARCHIVE_NAME}.zip" HEAD
git archive --format=tar.gz --prefix="${ARCHIVE_NAME}/" -o "${ARCHIVE_NAME}.tar.gz" HEAD
```

The `--prefix` option ensures all files in the archive are contained within a directory matching the archive name.

## Release Tag Format

The release tag follows a different format than the archive name:

- **Release Tag**: `proxy-v{PROXY_VERSION}_admin-v{ADMIN_VERSION}`
- **Archive Name**: `een-oauth-proxy-v{PROXY_VERSION}_v{ADMIN_VERSION}`

This allows the release tag to be more descriptive while keeping archive names concise.

## Workflow Location

The version extraction and archive naming logic is located in:
- **Workflow**: `.github/workflows/release.yml`
- **Step**: "Get version numbers" (lines 23-54)
- **Step**: "Create release archive" (lines 73-105)

## Related Files

- `.github/workflows/release.yml` - Release workflow definition
- `proxy/package.json` - Proxy version source
- `admin/package.json` - Admin version source

