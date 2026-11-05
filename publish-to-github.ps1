# Publish the local Owanbe repo to github.com/TheLionKing7/Owanbe (main) and remove the extra branches.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File .\publish-to-github.ps1
$ErrorActionPreference = "Stop"
Set-Location "C:\Users\DELL\Documents\GitHub\Owanbe"
$repo = "https://github.com/TheLionKing7/Owanbe.git"

# 1. Point the local repo at GitHub
if (git remote | Select-String -Quiet "^origin$") { git remote set-url origin $repo } else { git remote add origin $repo }
git fetch origin --prune

$remoteBranches = git for-each-ref --format="%(refname:lstrip=3)" refs/remotes/origin |
  Where-Object { $_ -and $_ -ne "HEAD" }
Write-Host "`nBranches currently on GitHub:" -ForegroundColor Cyan
$remoteBranches | ForEach-Object { Write-Host "  $_" }

# 2. Fold in whatever Sage 7 already put on remote main (e.g. blueprint/ docs).
#    On any file that exists in both, the local version (this codebase) wins.
if ($remoteBranches -contains "main") {
  git merge origin/main --allow-unrelated-histories -X ours --no-edit -m "chore: merge existing GitHub main into local codebase"
}

# 3. Push main and make it the default branch
git push -u origin main
if (Get-Command gh -ErrorAction SilentlyContinue) {
  gh repo edit TheLionKing7/Owanbe --default-branch main
} else {
  Write-Host "`nIf GitHub's default branch isn't 'main', change it at: https://github.com/TheLionKing7/Owanbe/settings (General -> Default branch)" -ForegroundColor Yellow
  Read-Host "Press Enter once the default branch is main (or already was)"
}

# 4. Delete every other branch on GitHub
$toDelete = $remoteBranches | Where-Object { $_ -ne "main" }
if ($toDelete) {
  Write-Host "`nThese branches will be DELETED from GitHub:" -ForegroundColor Red
  $toDelete | ForEach-Object { Write-Host "  $_" }
  if ((Read-Host "Type YES to delete them") -eq "YES") {
    $toDelete | ForEach-Object { git push origin --delete $_ }
    git fetch origin --prune
  } else { Write-Host "Skipped branch deletion." }
}

Write-Host "`nDone. GitHub now has:" -ForegroundColor Green
git ls-remote --heads origin
