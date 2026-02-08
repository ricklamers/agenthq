---
name: git-land
description: Land local git changes by analyzing diffs, staging files, writing a conventional commit, and pushing to the remote branch. Use when asked to finalize and publish code changes in a repository.
---

# Git Land

Use this sequence:
1. Analyze changes.
2. Add files.
3. Write a conventional commit.
4. Push to remote.

## Workflow

### 1) Analyze changes

Inspect what changed before staging:
- Run `git status --short`.
- Run `git diff` for unstaged changes.
- Run `git diff --staged` if staged changes already exist.
- Confirm changes are intentional and relevant to the requested task.

### 2) Add files

Stage only intended changes:
- Prefer targeted staging with `git add <path>` for specific files.
- Use `git add -A` only when all tracked and untracked changes should be included.
- Re-check staged content with `git diff --staged`.

### 3) Write a conventional commit

Create a commit message in Conventional Commits format:
- Pattern: `<type>(<scope>): <subject>`
- Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.
- Keep subject concise and imperative.
- Add a body when context is needed.

Example:
```bash
git commit -m "fix(auth): handle token refresh race condition"
```

### 4) Push to remote

Publish the commit:
- If upstream exists: `git push`.
- If branch has no upstream: `git push -u origin <branch>`.
- Confirm clean state with `git status --short`.
