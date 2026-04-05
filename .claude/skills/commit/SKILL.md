---
name: commit
description: Stage relevant changes and create a well-crafted git commit with conventional message style.
metadata:
  author: Charlie Yang
  version: "1.0.0"
---

Create a git commit for the current changes.

**Input**: Optional commit message hint or description. If omitted, infer from the diff.

**Steps**

1. **Gather context** (run in parallel)
   ```bash
   git status
   git diff
   git diff --cached
   git log --oneline -5
   ```

2. **Analyze changes**
   - Review both staged and unstaged changes
   - Identify which files are relevant to commit
   - Skip files that likely contain secrets (.env, credentials.json, etc.)
   - If there are no changes to commit, inform the user and stop

3. **Stage files**
   - Add relevant changed and untracked files by name
   - Do NOT use `git add -A` or `git add .`
   - If unsure whether a file should be included, ask the user

4. **Draft commit message**
   - Follow the repository's existing commit message style (check git log)
   - Keep the first line concise (under 72 characters)
   - Use a body for additional context if needed
   - Focus on the "why" not the "what"
   - Append the co-author trailer

5. **Commit**
   - Use a HEREDOC for the commit message to preserve formatting:
     ```bash
     git commit -m "$(cat <<'EOF'
     <message>

     Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
     EOF
     )"
     ```

6. **Verify**
   - Run `git status` after commit to confirm success
   - Show the commit hash and summary

**Guardrails**
- NEVER use `git add -A` or `git add .`
- NEVER commit .env, credentials, or secret files
- NEVER amend existing commits unless explicitly asked
- NEVER push to remote — only commit locally
- If a pre-commit hook fails, fix the issue and create a NEW commit (do not --amend)
