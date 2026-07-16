# Repository Working Conventions

- After completing and validating a user-requested implementation or build change, create a focused Git commit automatically unless the user explicitly asks not to commit.
- Stage only the files or hunks produced for the current request. Preserve unrelated and pre-existing worktree changes.
- Use a concise conventional commit message that describes the completed outcome.
- After committing a completed implementation or build change, push the current branch to GitHub automatically unless the user explicitly asks not to push.
- When the completed change is on `main`, also fast-forward `origin/claude/compiler` to the same commit so the Netlify production site mirrors `main`.
- Never force-push the production branch. If `claude/compiler` cannot be fast-forwarded, stop and report the divergence instead of overwriting it.
- Do not open pull requests unless the user explicitly requests one.
