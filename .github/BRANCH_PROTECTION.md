# Branch Protection Configuration

This document describes the branch protection rules and how to configure them.

## Branch Protection Rules

### Production Branch
- **Source Branch Restriction**: Only `develop` branch can create PRs to `production`
- **Required Status Checks**: All CI checks must pass
- **Required Pull Request Reviews**: At least 1 approval (if configured)
- **Enforce Admins**: Even admins must follow these rules

### Develop Branch
- **Source Branch Restriction**: Feature branches and hotfix branches can create PRs to `develop`
- **Blocked Source**: `production` branch cannot create PRs to `develop` (reverse flow prevention)
- **Required Status Checks**: All CI checks must pass
- **Required Pull Request Reviews**: At least 1 approval (if configured)

## Automated Enforcement

A GitHub Actions workflow (`.github/workflows/validate-branch-protection.yml`) automatically enforces these rules:

1. **Blocks PRs to production from non-develop branches**
   - Automatically comments on the PR explaining the violation
   - Fails the check to block merging

2. **Blocks PRs from production to develop**
   - Prevents reverse flow
   - Comments on the PR explaining why

3. **Warns when feature branches go directly to production**
   - Provides a warning (not blocking) to encourage proper workflow

## Manual Configuration Steps

To make the validation workflow a required check:

1. Go to **Settings** → **Branches** in your GitHub repository
2. For the `production` branch:
   - Add "Validate Branch Protection" to required status checks
   - Ensure "Require branches to be up to date before merging" is enabled
3. For the `develop` branch:
   - Add "Validate Branch Protection" to required status checks
   - Ensure "Require branches to be up to date before merging" is enabled

## Workflow

```
feature/xyz → develop → production
```

1. Create feature branch from `develop`
2. Create PR: `feature/xyz` → `develop`
3. After merge to `develop`, create PR: `develop` → `production`

## Testing

To test the branch protection:
1. Create a test PR from a feature branch directly to `production`
2. The workflow should fail and comment on the PR
3. The PR should be blocked from merging

