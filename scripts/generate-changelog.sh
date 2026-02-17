#!/usr/bin/env bash
# Generate a grouped changelog from git commits between two refs.
# Requires bash 4+ for associative arrays.
#
# Usage:
#   ./scripts/generate-changelog.sh <repo_url> [prev_tag]
#
# Arguments:
#   repo_url  - GitHub repository URL (e.g., https://github.com/owner/repo)
#   prev_tag  - Previous release tag (optional; if omitted, includes all commits)
#
# Output:
#   Writes changelog.md in the current directory.
#   Commits are grouped by conventional commit prefix (feat/fix/docs/chore/security/ci).
#   Each entry links to its commit on GitHub.
#   Auto-generated version bump commits are excluded.

set -e

REPO_URL="${1:?Usage: generate-changelog.sh <repo_url> [prev_tag]}"
PREV_TAG="${2:-}"

echo "📝 Generating changelog..."

# Exclude auto-generated version bump commits from changelog
if [ -n "$PREV_TAG" ]; then
  echo "Generating changelog from $PREV_TAG to HEAD..."
  COMMITS=$(git log --format="%h %s" --no-merges --max-count=100 --grep='^bump version' --invert-grep "${PREV_TAG}..HEAD" 2>/dev/null || echo "")
else
  echo "Generating changelog from all commits..."
  COMMITS=$(git log --format="%h %s" --no-merges --max-count=100 --grep='^bump version' --invert-grep 2>/dev/null || echo "")
fi

if [ -z "$COMMITS" ]; then
  echo "- No changes recorded" > changelog.md
  echo "ℹ️ No commits found for changelog"
else
  # Group commits by conventional commit prefix (requires bash 4+)
  unset GROUPS GROUP_TITLES
  declare -A GROUPS=(
    ["feat"]=""
    ["fix"]=""
    ["docs"]=""
    ["chore"]=""
    ["security"]=""
    ["ci"]=""
    ["other"]=""
  )
  declare -A GROUP_TITLES=(
    ["feat"]="Features"
    ["fix"]="Bug Fixes"
    ["docs"]="Documentation"
    ["chore"]="Chores"
    ["security"]="Security"
    ["ci"]="CI/CD"
    ["other"]="Other Changes"
  )

  while IFS= read -r line; do
    SHA="${line%% *}"
    SUBJECT="${line#* }"
    # Sanitize shell metacharacters to prevent injection in markdown
    SAFE_SUBJECT="${SUBJECT//[\`\$\{\}]/}"
    ENTRY="- ${SAFE_SUBJECT} ([${SHA}](${REPO_URL}/commit/${SHA}))"

    # Match only recognized conventional commit prefixes (e.g., "feat:", "fix(scope):")
    PREFIX=$(echo "$SUBJECT" | sed -nE 's/^(feat|fix|docs|chore|security|ci)(\([^)]*\))?:.*/\1/p')

    case "$PREFIX" in
      feat|fix|docs|chore|security|ci)
        GROUPS[$PREFIX]+="${ENTRY}"$'\n'
        ;;
      *)
        GROUPS["other"]+="${ENTRY}"$'\n'
        ;;
    esac
  done <<< "$COMMITS"

  # Write grouped changelog
  : > changelog.md
  HAS_GROUPS=false

  for key in feat fix security docs chore ci; do
    if [ -n "${GROUPS[$key]}" ]; then
      HAS_GROUPS=true
      echo "#### ${GROUP_TITLES[$key]}" >> changelog.md
      echo "${GROUPS[$key]}" >> changelog.md
    fi
  done

  # Always write "other" last
  if [ -n "${GROUPS["other"]}" ]; then
    if [ "$HAS_GROUPS" = "true" ]; then
      echo "#### ${GROUP_TITLES["other"]}" >> changelog.md
    fi
    echo "${GROUPS["other"]}" >> changelog.md
  fi

  if [ -n "$COMMITS" ]; then
    COMMIT_COUNT=$(echo "$COMMITS" | wc -l | xargs)
  else
    COMMIT_COUNT=0
  fi
  echo "✅ Generated changelog with ${COMMIT_COUNT} commits"
fi

echo "📝 Changelog contents:"
cat changelog.md
